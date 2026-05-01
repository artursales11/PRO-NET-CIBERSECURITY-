'use strict';
const https  = require('https');
const logger = require('./logger');

/**
 * Gera explicação em linguagem simples das vulnerabilidades encontradas
 * usando a API da Anthropic (Claude).
 */
async function generateAISummary(scanResult) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const issues = scanResult.issues || [];
  const score  = scanResult.total;
  const grade  = scanResult.grade;

  if (issues.length === 0) {
    return `✅ Parabéns! O site ${scanResult.target} não apresentou vulnerabilidades críticas. Score: ${score}/100 (${grade}).`;
  }

  const prompt = `Você é um especialista em segurança digital da Pro Net Programação (Fortaleza, Brasil).
Analise estes resultados de scan de segurança e explique em linguagem clara e direta para um cliente de negócios (não técnico) o que foi encontrado e o que precisa ser corrigido.

Site analisado: ${scanResult.target}
Score de segurança: ${score}/100 (nota ${grade})

Problemas encontrados:
${issues.map((i,n) => `${n+1}. ${i}`).join('\n')}

Detalhes:
- SSL: ${score <= 50 ? 'com problemas' : 'ok'} — dias restantes: ${scanResult.details?.ssl?.days_left || 'N/A'}
- Headers: ${scanResult.scores?.headers || 0}/100
- Portas: ${scanResult.scores?.ports || 0}/100

Responda em português do Brasil. Seja claro, objetivo e prático. Máximo 200 palavras.
Termine com uma recomendação concreta de próximos passos.`;

  return new Promise(resolve => {
    const body = JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages:   [{ role: 'user', content: prompt }],
    });

    const opts = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers:  {
        'Content-Type':      'application/json',
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || null);
        } catch { resolve(null); }
      });
    });

    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.on('error', e => { logger.warn('ai_summary_failed', { err: e.message }); resolve(null); });
    req.write(body);
    req.end();
  });
}

module.exports = { generateAISummary };
