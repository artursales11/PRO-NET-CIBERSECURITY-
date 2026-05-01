'use strict';
const { supabase } = require('./db');

const LEVELS = { debug:0, info:1, warn:2, error:3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function fmt(level, msg, meta={}) {
  const ts = new Date().toISOString();
  const out = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  if (Object.keys(meta).length) return out + ' ' + JSON.stringify(meta);
  return out;
}

const logger = {
  debug: (msg, meta) => { if (LEVELS.debug >= MIN_LEVEL) console.debug(fmt('debug', msg, meta)); },
  info:  (msg, meta) => { if (LEVELS.info  >= MIN_LEVEL) console.info(fmt('info',  msg, meta)); },
  warn:  (msg, meta) => { if (LEVELS.warn  >= MIN_LEVEL) console.warn(fmt('warn',  msg, meta)); },
  error: (msg, meta) => { if (LEVELS.error >= MIN_LEVEL) console.error(fmt('error', msg, meta)); },

  // Persiste no banco para auditoria
  async audit(userId, action, resource, ip, userAgent, details={}) {
    await supabase.from('audit_logs').insert({
      user_id: userId || null,
      action, resource,
      ip: ip || null,
      user_agent: userAgent || null,
      details,
    }).catch(e => console.error('[audit] insert failed:', e.message));
  }
};

module.exports = logger;
