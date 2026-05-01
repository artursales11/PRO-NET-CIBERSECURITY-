'use strict';
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { z }    = require('zod');
const { supabase }    = require('../utils/db');
const logger          = require('../utils/logger');
const { loginLimiter, registerLimiter } = require('../middleware/security');

const router = express.Router();
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
const MAX_ATTEMPTS  = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const LOCK_MIN      = parseInt(process.env.LOCK_DURATION_MINUTES) || 15;

// ── VALIDATORS ───────────────────────────────────────────────
const RegisterSchema = z.object({
  name:     z.string().min(2).max(100).trim(),
  email:    z.string().email().toLowerCase(),
  password: z.string()
    .min(8, 'Mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Precisa de ao menos uma letra maiúscula')
    .regex(/[0-9]/, 'Precisa de ao menos um número'),
  plan:     z.enum(['basic','pro','enterprise']).default('basic'),
});

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// ── HELPERS ──────────────────────────────────────────────────
function generateTokens(user) {
  const payload = { sub: user.id, email: user.email, plan: user.plan };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });

  const refreshToken = jwt.sign(
    { sub: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
}

async function storeRefreshToken(userId, refreshToken) {
  const hash      = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await supabase.from('refresh_tokens').insert({ user_id: userId, token_hash: hash, expires_at: expiresAt });
}

// ── POST /auth/register ───────────────────────────────────────
router.post('/register', registerLimiter, async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
  }

  const { name, email, password, plan } = parsed.data;

  // Verifica se já existe
  const { data: existing } = await supabase
    .from('users').select('id').eq('email', email).single();
  if (existing) {
    return res.status(409).json({ error: 'Email já cadastrado' });
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const { data: user, error } = await supabase.from('users').insert({
    name, email, password_hash, plan,
  }).select('id,name,email,plan').single();

  if (error) {
    logger.error('register_error', { error: error.message });
    return res.status(500).json({ error: 'Erro ao criar conta' });
  }

  const { accessToken, refreshToken } = generateTokens(user);
  await storeRefreshToken(user.id, refreshToken);
  await logger.audit(user.id, 'register', 'users', req.ip, req.get('user-agent'));

  logger.info('user_registered', { id: user.id, email: user.email, plan: user.plan });

  res.status(201).json({
    user:         { id: user.id, name: user.name, email: user.email, plan: user.plan },
    access_token:  accessToken,
    refresh_token: refreshToken,
  });
});

// ── POST /auth/login ──────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Email ou senha inválidos' });
  }

  const { email, password } = parsed.data;

  const { data: user } = await supabase
    .from('users')
    .select('id,name,email,plan,password_hash,is_active,login_attempts,locked_until')
    .eq('email', email.toLowerCase())
    .single();

  // Usuário não existe — resposta genérica (evita user enumeration)
  if (!user) {
    await new Promise(r => setTimeout(r, 300)); // timing attack mitigation
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  // Conta bloqueada
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
    return res.status(423).json({ error: `Conta bloqueada por ${mins} minuto(s) por excesso de tentativas` });
  }

  // Conta inativa
  if (!user.is_active) {
    return res.status(403).json({ error: 'Conta desativada. Entre em contato com o suporte.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    const attempts = (user.login_attempts || 0) + 1;
    const locked_until = attempts >= MAX_ATTEMPTS
      ? new Date(Date.now() + LOCK_MIN * 60 * 1000)
      : null;

    await supabase.from('users').update({ login_attempts: attempts, locked_until }).eq('id', user.id);

    logger.warn('login_failed', { email, ip: req.ip, attempts });
    await logger.audit(user.id, 'login_failed', 'auth', req.ip, req.get('user-agent'), { attempts });

    if (attempts >= MAX_ATTEMPTS) {
      return res.status(423).json({ error: `Conta bloqueada por ${LOCK_MIN} minutos por excesso de tentativas` });
    }

    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  // Login bem-sucedido — reseta tentativas
  await supabase.from('users').update({ login_attempts: 0, locked_until: null }).eq('id', user.id);

  const { accessToken, refreshToken } = generateTokens(user);
  await storeRefreshToken(user.id, refreshToken);

  logger.info('login_success', { id: user.id, email: user.email, ip: req.ip });
  await logger.audit(user.id, 'login', 'auth', req.ip, req.get('user-agent'));

  res.json({
    user:         { id: user.id, name: user.name, email: user.email, plan: user.plan },
    access_token:  accessToken,
    refresh_token: refreshToken,
  });
});

// ── POST /auth/refresh ────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'Refresh token ausente' });

  let payload;
  try {
    payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
  } catch {
    return res.status(401).json({ error: 'Refresh token inválido ou expirado' });
  }

  const hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
  const { data: stored } = await supabase
    .from('refresh_tokens')
    .select('*').eq('token_hash', hash).eq('revoked', false).single();

  if (!stored || new Date(stored.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Refresh token inválido' });
  }

  // Revoga o token usado (rotation)
  await supabase.from('refresh_tokens').update({ revoked: true }).eq('id', stored.id);

  const { data: user } = await supabase
    .from('users').select('id,name,email,plan,is_active').eq('id', payload.sub).single();
  if (!user || !user.is_active) return res.status(401).json({ error: 'Usuário não encontrado' });

  const { accessToken, refreshToken: newRefresh } = generateTokens(user);
  await storeRefreshToken(user.id, newRefresh);

  res.json({ access_token: accessToken, refresh_token: newRefresh });
});

// ── POST /auth/logout ─────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const { refresh_token } = req.body;
  if (refresh_token) {
    const hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
    await supabase.from('refresh_tokens').update({ revoked: true }).eq('token_hash', hash);
  }
  res.json({ ok: true });
});

// ── GET /auth/me ──────────────────────────────────────────────
router.get('/me', require('../middleware/auth').requireAuth, async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id,name,email,plan,created_at,email_verified')
    .eq('id', req.user.id)
    .single();
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json({ user });
});

module.exports = router;
