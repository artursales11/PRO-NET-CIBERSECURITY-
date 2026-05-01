'use strict';
const jwt    = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Middleware de autenticação JWT.
 * Injeta req.user = { id, email, plan } em caso de sucesso.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token ausente' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, plan: payload.plan };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
}

/**
 * Middleware de plano mínimo.
 * plans = ['basic'] | ['pro','enterprise'] | ['enterprise']
 */
function requirePlan(...plans) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
    if (!plans.includes(req.user.plan)) {
      logger.warn('plan_denied', { user: req.user.id, required: plans, actual: req.user.plan });
      return res.status(403).json({
        error: 'Seu plano não inclui este recurso',
        required: plans,
        current: req.user.plan,
        upgrade_url: '/planos',
      });
    }
    next();
  };
}

module.exports = { requireAuth, requirePlan };
