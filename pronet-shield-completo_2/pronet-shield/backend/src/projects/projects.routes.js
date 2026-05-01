'use strict';
const express = require('express');
const { z }   = require('zod');
const { supabase }  = require('../utils/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const ProjectSchema = z.object({
  name:        z.string().min(2).max(100).trim(),
  target_url:  z.string().url('URL inválida'),
  target_host: z.string().min(2).max(253).trim(),
  description: z.string().max(500).optional(),
});

// GET /projects
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('projects')
    .select(`
      id, name, target_url, target_host, description, is_active, created_at,
      scans ( id, score_total, status, created_at )
    `)
    .eq('user_id', req.user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Adiciona último scan a cada projeto
  const projects = data.map(p => ({
    ...p,
    latest_scan: p.scans?.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0] || null,
    scans: undefined,
  }));

  res.json({ projects });
});

// POST /projects
router.post('/', async (req, res) => {
  const parsed = ProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });

  const { data, error } = await supabase.from('projects').insert({
    ...parsed.data,
    user_id: req.user.id,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ project: data });
});

// GET /projects/:id
router.get('/:id', async (req, res) => {
  const { data: project } = await supabase
    .from('projects').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

  const { data: scans } = await supabase
    .from('scans').select('id,status,score_total,score_ssl,score_headers,score_ports,created_at,ai_summary')
    .eq('project_id', project.id).order('created_at', { ascending: false }).limit(10);

  const { data: nist } = await supabase
    .from('nist_scores').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(1);

  res.json({ project, scans: scans||[], nist: nist?.[0] || null });
});

// PATCH /projects/:id
router.patch('/:id', async (req, res) => {
  const parsed = ProjectSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos' });

  const { data, error } = await supabase
    .from('projects').update(parsed.data).eq('id', req.params.id).eq('user_id', req.user.id).select().single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Projeto não encontrado' });
  res.json({ project: data });
});

// DELETE /projects/:id (soft delete)
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('projects').update({ is_active: false }).eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
