'use strict';
const express  = require('express');
const { z }    = require('zod');
const { supabase }              = require('../utils/db');
const logger                    = require('../utils/logger');
const { requireAuth, requirePlan } = require('../middleware/auth');
const { runFullScan, computeNISTFromScan } = require('./scanner');
const { generateAISummary }     = require('../utils/ai');
const { sendAlert }             = require('../utils/alerts');

const router = express.Router();
router.use(requireAuth);

// POST /scans — inicia scan em background
router.post('/', async (req, res) => {
  const schema = z.object({ project_id: z.string().uuid() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'project_id inválido' });

  const { project_id } = parsed.data;

  // Verifica que o projeto pertence ao usuário
  const { data: project } = await supabase
    .from('projects').select('*').eq('id', project_id).eq('user_id', req.user.id).single();
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

  // Cria o scan com status pending
  const { data: scan, error } = await supabase.from('scans').insert({
    project_id,
    user_id: req.user.id,
    status:  'pending',
    type:    'full',
  }).select('id,status,created_at').single();

  if (error) return res.status(500).json({ error: 'Erro ao criar scan' });

  // Retorna imediatamente e processa em background
  res.status(202).json({ scan_id: scan.id, status: 'pending', message: 'Scan iniciado' });

  // Background
  setImmediate(async () => {
    try {
      await supabase.from('scans').update({ status: 'running', started_at: new Date() }).eq('id', scan.id);

      const result = await runFullScan(project.target_url, project.target_host);
      const nist   = computeNISTFromScan(result);

      // Gera explicação com IA (se disponível)
      let ai_summary = null;
      if (process.env.ANTHROPIC_API_KEY) {
        ai_summary = await generateAISummary(result).catch(() => null);
      }

      // Salva resultado
      await supabase.from('scans').update({
        status:       'done',
        score_total:  result.total,
        score_ssl:    result.scores.ssl,
        score_headers: result.scores.headers,
        score_ports:  result.scores.ports,
        result_json:  result,
        ai_summary,
        completed_at: new Date(),
      }).eq('id', scan.id);

      // Salva NIST
      await supabase.from('nist_scores').insert({
        project_id,
        scan_id:  scan.id,
        govern:   nist.govern,
        identify: nist.identify,
        protect:  nist.protect,
        detect:   nist.detect,
        respond:  nist.respond,
        recover:  nist.recover,
        total:    nist.total,
      });

      // Alerta se score baixo
      if (result.total < 60) {
        await sendAlert(req.user.id, project_id, {
          title:    `⚠️ Score crítico: ${project.name}`,
          body:     `Score de segurança: ${result.total}/100 (${result.grade}). ${result.issues.length} problema(s) detectado(s).`,
          severity: result.total < 40 ? 'critical' : 'high',
        });
      }

      logger.info('scan_completed', { scan_id: scan.id, project: project.name, score: result.total });
    } catch (err) {
      logger.error('scan_failed', { scan_id: scan.id, error: err.message });
      await supabase.from('scans').update({ status: 'failed' }).eq('id', scan.id);
    }
  });
});

// GET /scans — lista scans do usuário (por projeto)
router.get('/', async (req, res) => {
  const project_id = req.query.project_id;
  let query = supabase
    .from('scans')
    .select('id,status,type,score_total,score_ssl,score_headers,score_ports,ai_summary,created_at,completed_at,project_id')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (project_id) query = query.eq('project_id', project_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ scans: data });
});

// GET /scans/:id — detalhe completo
router.get('/:id', async (req, res) => {
  const { data: scan } = await supabase
    .from('scans')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (!scan) return res.status(404).json({ error: 'Scan não encontrado' });
  res.json({ scan });
});

module.exports = router;
