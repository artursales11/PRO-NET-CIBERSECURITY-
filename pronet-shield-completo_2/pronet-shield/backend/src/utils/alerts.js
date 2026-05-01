'use strict';
const https      = require('https');
const nodemailer = require('nodemailer');
const { supabase } = require('./db');
const logger       = require('./logger');

const SEV_COLOR  = { low: 0x22c55e, medium: 0xf59e0b, high: 0xef4444, critical: 0x7f1d1d };
const SEV_EMOJI  = { low: '🟢', medium: '🟡', high: '🔴', critical: '🚨' };

// ── DISCORD ──────────────────────────────────────────────────
async function sendDiscordAlert(title, body, severity = 'high') {
  const webhook = process.env.DISCORD_WEBHOOK;
  if (!webhook) return;

  const payload = JSON.stringify({
    username: 'Pro Net Shield',
    embeds: [{
      title:       `${SEV_EMOJI[severity]||'⚠️'} ${title}`,
      description: body,
      color:       SEV_COLOR[severity] || SEV_COLOR.high,
      timestamp:   new Date().toISOString(),
      footer:      { text: 'Pro Net Shield — pronetprogramacao.com.br' },
    }],
  });

  return new Promise(resolve => {
    const url  = new URL(webhook);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = https.request(opts, res => resolve({ ok: res.statusCode < 300 }));
    req.on('error', e => { logger.warn('discord_alert_failed', { err: e.message }); resolve({ ok: false }); });
    req.write(payload);
    req.end();
  });
}

// ── EMAIL ────────────────────────────────────────────────────
let mailer = null;
function getMailer() {
  if (mailer || !process.env.SMTP_HOST) return mailer;
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return mailer;
}

async function sendEmailAlert(to, title, body) {
  const tp = getMailer();
  if (!tp || !to) return;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;background:#0f1117;border-radius:8px;overflow:hidden">
      <div style="background:#111318;padding:20px 24px;border-bottom:1px solid #1c2028">
        <span style="font-family:monospace;font-size:17px;color:#fff">Pro Net <span style="color:#b8975a">Shield</span></span>
      </div>
      <div style="padding:24px;background:#111318">
        <h2 style="color:#e2e8f0;font-size:16px;margin:0 0 12px">${title}</h2>
        <p style="color:#94a3b8;line-height:1.65;margin:0 0 16px;font-size:14px">${body}</p>
        <p style="color:#475569;font-size:12px;margin:0">${new Date().toLocaleString('pt-BR')}</p>
      </div>
    </div>`;
  try {
    await tp.sendMail({ from: `"Pro Net Shield" <${process.env.SMTP_USER}>`, to, subject: `[SHIELD] ${title}`, html });
  } catch(e) { logger.warn('email_alert_failed', { err: e.message }); }
}

// ── CENTRAL: salva no banco + envia por canal ─────────────────
async function sendAlert(userId, projectId, { title, body, severity = 'medium' }) {
  // Salva no banco (aparece no dashboard)
  await supabase.from('alerts').insert({
    user_id:    userId,
    project_id: projectId || null,
    title, body, severity,
    channel: 'dashboard',
  }).catch(() => {});

  // Discord
  if (process.env.DISCORD_WEBHOOK) {
    await sendDiscordAlert(title, body, severity);
  }

  // Email — busca email do usuário
  if (process.env.SMTP_HOST) {
    const { data: user } = await supabase.from('users').select('email').eq('id', userId).single().catch(() => ({}));
    if (user?.email) await sendEmailAlert(user.email, title, body);
  }

  logger.info('alert_sent', { userId, title, severity });
}

module.exports = { sendAlert, sendDiscordAlert, sendEmailAlert };
