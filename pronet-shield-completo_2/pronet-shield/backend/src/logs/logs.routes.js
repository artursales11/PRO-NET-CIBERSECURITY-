'use strict';
const express = require('express');
const { supabase } = require('../utils/db');
const { requireAuth, requirePlan } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /logs/alerts — alertas do usuário
router.get('/alerts', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const unread = req.query.unread === 'true';

  let query = supabase
    .from('alerts')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unread) query = query.eq('read', false);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ alerts: data || [] });
});

// PATCH /logs/alerts/:id/read
router.patch('/alerts/:id/read', async (req, res) => {
  await supabase.from('alerts').update({ read: true }).eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ ok: true });
});

// PATCH /logs/alerts/read-all
router.patch('/alerts/read-all', async (req, res) => {
  await supabase.from('alerts').update({ read: true }).eq('user_id', req.user.id).eq('read', false);
  res.json({ ok: true });
});

// GET /logs/security — eventos de segurança (Pro+)
router.get('/security', requirePlan('pro','enterprise'), async (req, res) => {
  const limit      = Math.min(parseInt(req.query.limit)||100, 500);
  const project_id = req.query.project_id;
  const type       = req.query.type;

  let query = supabase
    .from('security_events')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (project_id) query = query.eq('project_id', project_id);
  if (type)       query = query.eq('type', type);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ events: data || [] });
});

// GET /logs/audit — logs de auditoria (Enterprise)
router.get('/audit', requirePlan('enterprise'), async (req, res) => {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ logs: data || [] });
});

// GET /logs/summary — resumo de eventos (dashboard)
router.get('/summary', async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // últimas 24h

  const [{ count: alertCount }, { count: eventCount }] = await Promise.all([
    supabase.from('alerts').select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id).eq('read', false),
    supabase.from('security_events').select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id).gte('created_at', since),
  ]);

  res.json({ unread_alerts: alertCount || 0, events_24h: eventCount || 0 });
});

module.exports = router;
