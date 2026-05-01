'use strict';
const rateLimit = require('express-rate-limit');
const logger    = require('../utils/logger');

// ── RATE LIMITERS ─────────────────────────────────────────────

/** Rate limit geral para a API */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max:      parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Muitas requisições. Tente novamente em instantes.' },
});

/** Rate limit estrito para login — evita brute force */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde 15 minutos.' },
  handler(req, res, next, options) {
    logger.warn('rate_limit_login', { ip: req.ip });
    res.status(429).json(options.message);
  },
});

/** Rate limit para registro de conta */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: { error: 'Limite de criação de contas atingido.' },
});

// ── SANITIZAÇÃO DE INPUT ─────────────────────────────────────

const XSS_PATTERNS = [/<script/i, /javascript:/i, /on\w+\s*=/i, /eval\s*\(/, /<iframe/i];
const SQLI_PATTERNS = [/(\bor\b|\band\b)\s+[\d'"]/i, /union\s+select/i, /;\s*(drop|delete|insert|update)/i, /--\s/];

function sanitizeValue(val) {
  if (typeof val !== 'string') return val;
  // Detecta tentativas
  if ([...XSS_PATTERNS, ...SQLI_PATTERNS].some(p => p.test(val))) {
    return '[SANITIZED]';
  }
  // Escapa caracteres perigosos básicos
  return val
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;')
    .replace(/\//g, '&#x2F;');
}

function sanitizeBody(obj, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== 'object') return obj;
  const clean = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    clean[k] = typeof v === 'string'  ? sanitizeValue(v)
             : typeof v === 'object'  ? sanitizeBody(v, depth + 1)
             : v;
  }
  return clean;
}

function sanitizeMiddleware(req, res, next) {
  if (req.body) req.body = sanitizeBody(req.body);
  next();
}

// ── SECURITY HEADERS (além do helmet) ────────────────────────
function securityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options',           'DENY');
  res.setHeader('X-Content-Type-Options',    'nosniff');
  res.setHeader('X-XSS-Protection',          '1; mode=block');
  res.setHeader('Referrer-Policy',           'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',        'geolocation=(), camera=(), microphone=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
}

module.exports = { apiLimiter, loginLimiter, registerLimiter, sanitizeMiddleware, securityHeaders };
