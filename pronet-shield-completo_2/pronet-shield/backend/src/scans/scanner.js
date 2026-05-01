'use strict';
const tls   = require('tls');
const http  = require('http');
const https = require('https');
const { exec } = require('child_process');
const { URL }  = require('url');

function run(cmd, timeout = 15000) {
  return new Promise(r =>
    exec(cmd, { timeout }, (e, out, err) =>
      r({ ok: !e, out: (out||'').trim(), err: (err||'').trim() })
    )
  );
}

// ── SSL / TLS ─────────────────────────────────────────────────
function checkSSL(host) {
  return new Promise(resolve => {
    const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const cert    = sock.getPeerCertificate(true);
      const valid   = sock.authorized;
      const expDate = cert.valid_to ? new Date(cert.valid_to) : null;
      const days    = expDate ? Math.ceil((expDate - Date.now()) / 86400000) : 0;
      const proto   = sock.getProtocol();
      const issuer  = cert.issuer?.O || 'Desconhecido';
      const subject = cert.subject?.CN || host;
      sock.destroy();

      const score =
        (!valid)       ? 0  :
        days <= 0      ? 0  :
        days <= 7      ? 20 :
        days <= 30     ? 50 :
        proto === 'TLSv1.3' ? 100 :
        proto === 'TLSv1.2' ? 80  : 60;

      const issues = [];
      if (!valid)         issues.push('Certificado inválido ou não confiável');
      if (days <= 30)     issues.push(`Expira em ${days} dias`);
      if (proto !== 'TLSv1.3') issues.push(`Protocolo ${proto} — recomendado TLS 1.3`);

      resolve({ valid, expires: expDate?.toISOString(), days_left: days,
        protocol: proto, issuer, subject, score, issues });
    });
    sock.setTimeout(8000, () => { sock.destroy(); resolve({ valid: false, score: 0, issues: ['Timeout de conexão SSL'] }); });
    sock.on('error', () => resolve({ valid: false, score: 0, issues: ['Erro de conexão SSL — verifique se HTTPS está ativo'] }));
  });
}

// ── HTTP HEADERS ─────────────────────────────────────────────
const REQUIRED_HEADERS = [
  { name: 'strict-transport-security', desc: 'HSTS',                  weight: 20 },
  { name: 'content-security-policy',   desc: 'CSP',                   weight: 20 },
  { name: 'x-frame-options',           desc: 'X-Frame-Options',       weight: 15 },
  { name: 'x-content-type-options',    desc: 'X-Content-Type-Options', weight: 15 },
  { name: 'referrer-policy',           desc: 'Referrer-Policy',       weight: 10 },
  { name: 'permissions-policy',        desc: 'Permissions-Policy',    weight: 10 },
  { name: 'x-xss-protection',          desc: 'X-XSS-Protection',      weight: 10 },
];

function checkHeaders(targetUrl) {
  return new Promise(resolve => {
    let url;
    try { url = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl); }
    catch { return resolve({ score: 0, issues: ['URL inválida'], headers: [] }); }

    const mod     = url.protocol === 'https:' ? https : http;
    const opts    = { hostname: url.hostname, path: url.pathname || '/', method: 'HEAD', timeout: 8000, rejectUnauthorized: false };
    const reqObj  = mod.request(opts, (res) => {
      const found = res.headers;
      const results = REQUIRED_HEADERS.map(h => ({
        header:  h.name,
        desc:    h.desc,
        weight:  h.weight,
        present: !!found[h.name],
        value:   found[h.name] || null,
      }));
      const score = results.reduce((acc, h) => acc + (h.present ? h.weight : 0), 0);
      const issues = results.filter(h => !h.present).map(h => `Header ausente: ${h.desc}`);
      resolve({ score, results, issues, server: found.server || 'Não divulgado' });
    });
    reqObj.setTimeout(8000, () => { reqObj.destroy(); resolve({ score: 0, issues: ['Timeout'], headers: [] }); });
    reqObj.on('error', () => resolve({ score: 0, issues: ['Erro de conexão — verifique a URL'], headers: [] }));
    reqObj.end();
  });
}

// ── PORTAS ABERTAS (via ss ou nmap) ──────────────────────────
async function checkPorts(host) {
  // Para localhost usa ss (mais rápido)
  if (['localhost','127.0.0.1'].includes(host)) {
    const r = await run("ss -tlnp 2>/dev/null | grep LISTEN | awk '{print $4}' | rev | cut -d: -f1 | rev | sort -un");
    const ports = r.out.split('\n').map(Number).filter(p => p > 0);
    const riskyPorts = [21,23,25,110,143,3306,5432,6379,27017,8080,8888,9200,11211];
    const risky = ports.filter(p => riskyPorts.includes(p));
    const score = Math.max(0, 100 - risky.length * 20);
    const issues = risky.map(p => `Porta de risco exposta: ${p}`);
    return { ports, risky, score, issues };
  }

  // Para hosts externos tenta nmap (precisa estar instalado)
  const nmap = await run(`nmap -T4 --open -p 21,22,23,25,80,443,3306,5432,6379,8080,8443,8888 ${host} 2>/dev/null | grep open | awk '{print $1}'`, 30000);
  const open = nmap.out ? nmap.out.split('\n').map(l => parseInt(l)).filter(Boolean) : [];
  const risky = open.filter(p => ![22,80,443].includes(p));
  const score = Math.max(0, 100 - risky.length * 20);
  return { ports: open, risky, score, issues: risky.map(p => `Porta de risco: ${p}`) };
}

// ── RESPOSTA / UPTIME ─────────────────────────────────────────
function checkUptime(targetUrl) {
  return new Promise(resolve => {
    let url;
    try { url = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl); }
    catch { return resolve({ up: false, latency_ms: 0, status_code: 0, score: 0 }); }

    const mod  = url.protocol === 'https:' ? https : http;
    const t0   = Date.now();
    const opts = { hostname: url.hostname, path: url.pathname || '/', method: 'GET', timeout: 10000, rejectUnauthorized: false };
    const req  = mod.request(opts, (res) => {
      const latency = Date.now() - t0;
      const up      = res.statusCode < 500;
      const score   = up ? (latency < 500 ? 100 : latency < 1500 ? 75 : 50) : 0;
      resolve({ up, latency_ms: latency, status_code: res.statusCode, score });
      res.resume();
    });
    req.setTimeout(10000, () => { req.destroy(); resolve({ up: false, latency_ms: 10000, score: 0, status_code: 0 }); });
    req.on('error', () => resolve({ up: false, latency_ms: 0, score: 0, status_code: 0 }));
    req.end();
  });
}

// ── SCAN COMPLETO ─────────────────────────────────────────────
async function runFullScan(targetUrl, targetHost) {
  const host    = targetHost || new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl).hostname;
  const results = {};

  const [ssl, headers, ports, uptime] = await Promise.all([
    checkSSL(host).catch(e => ({ score: 0, issues: [e.message] })),
    checkHeaders(targetUrl).catch(e => ({ score: 0, issues: [e.message] })),
    checkPorts(host).catch(e => ({ score: 50, issues: [e.message] })),
    checkUptime(targetUrl).catch(e => ({ up: false, score: 0 })),
  ]);

  results.ssl     = ssl;
  results.headers = headers;
  results.ports   = ports;
  results.uptime  = uptime;

  const scores = {
    ssl:     ssl.score     || 0,
    headers: headers.score || 0,
    ports:   ports.score   || 0,
    uptime:  uptime.score  || 0,
  };

  const total  = Math.round(Object.values(scores).reduce((a,b) => a+b, 0) / Object.keys(scores).length);
  const grade  = total >= 90 ? 'A+' : total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'C' : 'D';
  const issues = [
    ...(ssl.issues     || []),
    ...(headers.issues || []),
    ...(ports.issues   || []),
    ...(!uptime.up ? ['Site fora do ar ou inacessível'] : []),
  ];

  return { target: targetUrl, host, scores, total, grade, issues, details: results, scanned_at: new Date().toISOString() };
}

// ── NIST SCORE BASEADO NO SCAN ────────────────────────────────
function computeNISTFromScan(scanResult) {
  const { scores, details } = scanResult;
  return {
    govern:   Math.round((scores.ssl + scores.headers) / 2),
    identify: scores.ports,
    protect:  Math.round((scores.headers + scores.ssl) / 2),
    detect:   scores.uptime,
    respond:  scores.uptime,
    recover:  Math.min(scores.ssl, scores.uptime),
    get total() {
      return Math.round((this.govern + this.identify + this.protect + this.detect + this.respond + this.recover) / 6);
    },
  };
}

module.exports = { runFullScan, checkSSL, checkHeaders, checkPorts, checkUptime, computeNISTFromScan };
