'use strict';
/**
 * Pro Net Shield — Servidor Principal
 * JWT + Supabase + Scanner Real + Alertas + WebSocket
 */

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const http      = require('http');
const { WebSocketServer } = require('ws');
const cron      = require('node-cron');
const path      = require('path');

const logger    = require('./utils/logger');
const { supabase } = require('./utils/db');
const { apiLimiter, sanitizeMiddleware, securityHeaders } = require('./middleware/security');

// ── ROTAS ────────────────────────────────────────────────────
const authRoutes     = require('./auth/auth.routes');
const projectRoutes  = require('./projects/projects.routes');
const scanRoutes     = require('./scans/scans.routes');
const logRoutes      = require('./logs/logs.routes');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// ── WEBSOCKET: broadcast global ───────────────────────────────
const wsClients = new Map(); // userId → Set<ws>

function broadcast(userId, event, data) {
  const msg = JSON.stringify({ event, data, ts: Date.now() });
  if (userId) {
    wsClients.get(userId)?.forEach(ws => {
      if (ws.readyState === 1) ws.send(msg);
    });
  } else {
    // Para todos os clientes conectados
    wsClients.forEach(sockets =>
      sockets.forEach(ws => { if (ws.readyState === 1) ws.send(msg); })
    );
  }
}

// Torna broadcast disponível para outros módulos
global.shieldBroadcast = broadcast;

wss.on('connection', (ws) => {
  let userId = null;
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.action === 'subscribe' && msg.user_id) {
        userId = msg.user_id;
        if (!wsClients.has(userId)) wsClients.set(userId, new Set());
        wsClients.get(userId).add(ws);
        ws.send(JSON.stringify({ event: 'subscribed', data: { user_id: userId } }));
      }
    } catch {}
  });
  ws.on('close', () => {
    if (userId) wsClients.get(userId)?.delete(ws);
  });
});

// ── MIDDLEWARES GLOBAIS ───────────────────────────────────────
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:    ["'self'", "fonts.gstatic.com"],
      connectSrc: ["'self'", "wss:", "ws:"],
      imgSrc:     ["'self'", "data:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(securityHeaders);

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Request-ID'],
  credentials: true,
}));

app.use(express.json({ limit: '512kb' }));
app.use(sanitizeMiddleware);
app.use('/api/', apiLimiter);

// Request ID para rastreamento
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ── HEALTH CHECK (público) ────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: Date.now(), version: '2.0.0' });
});

// ── ROTAS DA API ──────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/scans',    scanRoutes);
app.use('/api/logs',     logRoutes);

// NIST — score mais recente de um projeto
app.get('/api/nist/:project_id', require('./middleware/auth').requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('nist_scores')
    .select('*')
    .eq('project_id', req.params.project_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!data) return res.status(404).json({ error: 'Nenhum score calculado ainda. Rode um scan primeiro.' });
  res.json({ nist: data });
});

// Dashboard summary
app.get('/api/dashboard', require('./middleware/auth').requireAuth, async (req, res) => {
  const uid = req.user.id;
  const since24h = new Date(Date.now() - 86400000).toISOString();

  const [projects, scans, alerts, events] = await Promise.all([
    supabase.from('projects').select('id,name,target_url', { count: 'exact' })
      .eq('user_id', uid).eq('is_active', true),
    supabase.from('scans').select('id,score_total,status,created_at')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(5),
    supabase.from('alerts').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).eq('read', false),
    supabase.from('security_events').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).gte('created_at', since24h),
  ]);

  const latestScan = scans.data?.[0];
  res.json({
    projects_count:   projects.count || 0,
    latest_scan:      latestScan || null,
    unread_alerts:    alerts.count  || 0,
    events_24h:       events.count  || 0,
    recent_scans:     scans.data    || [],
    plan:             req.user.plan,
  });
});

// ── FRONTEND (serve o index.html do painel) ───────────────────
app.use(express.static(path.join(__dirname, '../../frontend')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

// ── ERROR HANDLER ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('unhandled_error', { error: err.message, path: req.path, id: req.id });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Erro interno do servidor' : err.message,
    request_id: req.id,
  });
});

// ── CRON JOBS ─────────────────────────────────────────────────

// Limpa tokens expirados todo dia às 2h
cron.schedule('0 2 * * *', async () => {
  const { count } = await supabase
    .from('refresh_tokens')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString());
  logger.info('cron_cleanup_tokens', { removed: count });
});

// Pulse de sistema a cada 30s (para o WebSocket do frontend)
cron.schedule('*/30 * * * * *', async () => {
  const { exec } = require('child_process');
  const cpu = await new Promise(r => exec("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'", (e,o) => r(parseFloat(o)||0)));
  const mem = await new Promise(r => exec("free -m | awk '/^Mem/{printf \"%d\", $3*100/$2}'", (e,o) => r(parseInt(o)||0)));
  broadcast(null, 'system_pulse', { cpu, mem });
});

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
server.listen(PORT, async () => {
  console.log(`
╔═══════════════════════════════════════╗
║       PRO NET SHIELD v2.0             ║
║  Backend: http://localhost:${PORT}      ║
║  WS:      ws://localhost:${PORT}        ║
╚═══════════════════════════════════════╝
  `);

  const { testConnection } = require('./utils/db');
  const ok = await testConnection();

  if (!ok) {
    console.log('⚠️  Rodando SEM banco — apenas endpoints de health funcionam');
    console.log('   Corrija o .env e reinicie com: npm start\n');
  }

  logger.info('server_started', { port: PORT, env: process.env.NODE_ENV, db: ok });
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });
