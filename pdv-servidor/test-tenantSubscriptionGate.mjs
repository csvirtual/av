// Etapa 7 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): prova
// de que o controle de assinatura da PLATAFORMA (tenants.status/expires_at
// no banco de controle) bloqueia uma loja ANTES de qualquer rota — mesmo
// gate único que já bloqueia Host desconhecido (etapa 3), agora também pra
// status "suspenso"/"cancelado" e pra `expires_at` no passado. Cobre tanto
// HTTP quanto a conexão WebSocket. Também confirma que "trial"/"ativo"
// dentro do prazo (o caso comum) continuam liberados — nenhuma regressão
// no comportamento das fatias anteriores.
//
// Uso: precisa de um servidor rodando com MULTI_TENANT_DOMAIN definida.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOMAIN = process.env.MULTI_TENANT_DOMAIN || 'pdv-csvirtual.com.br';
const PORT = Number(process.env.PORT) || 3131;

const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

function request(hostHeader, { method = 'GET', reqPath = '/api/status', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: reqPath, method,
      headers: {
        Host: hostHeader,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const setCookie = res.headers['set-cookie']?.[0]?.split(';')[0] || null;
        let parsedBody = null;
        try { parsedBody = JSON.parse(data); } catch { parsedBody = data; }
        resolve({ status: res.statusCode, body: parsedBody, cookie: setCookie });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function connectWs(hostHeader) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Host: hostHeader } });
    ws.on('open', () => resolve({ ws }));
    ws.on('error', reject);
    ws.on('close', () => resolve({ ws, closedEarly: true }));
  });
}

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const { createNewTenant, setTenantStatus, VALID_TENANT_STATUSES } = await import('./scripts/createTenant.js');
const { controlDb } = await import('./control/db.js');

const suffix = Date.now();
const slugTrial = `sub-trial-${suffix}`;
const slugSuspenso = `sub-susp-${suffix}`;
const slugCancelado = `sub-canc-${suffix}`;
const slugExpirado = `sub-exp-${suffix}`;
const slugAtivoOk = `sub-ativo-ok-${suffix}`;

const slugs = [slugTrial, slugSuspenso, slugCancelado, slugExpirado, slugAtivoOk];
for (const slug of slugs) await createNewTenant(slug, `Assinatura ${slug}`, `Assinatura ${slug}`);

try {
  check('VALID_TENANT_STATUSES inclui os 4 status documentados em control/schema.sql', ['trial', 'ativo', 'suspenso', 'cancelado'].every((s) => VALID_TENANT_STATUSES.has(s)), [...VALID_TENANT_STATUSES]);

  // Loja recém-criada (status "trial" padrão, sem expires_at) — caso comum,
  // continua liberada (mesmo comportamento das etapas anteriores).
  const trialResp = await request(`${slugTrial}.${DOMAIN}`, { reqPath: '/api/status' });
  check('loja em "trial" sem vencimento responde normalmente (200)', trialResp.status === 200, trialResp.status);

  // Suspenso.
  setTenantStatus(slugSuspenso, 'suspenso');
  const suspensoResp = await request(`${slugSuspenso}.${DOMAIN}`, { reqPath: '/api/status' });
  check('loja "suspenso" bloqueada com 403', suspensoResp.status === 403, suspensoResp.status);
  // Achado do usuário (print): a resposta de bloqueio saía como TEXTO PURO
  // sem nenhum estilo — server.js#sendTenantBlocked agora devolve JSON
  // (pra rota de API, exatamente como antes em formato mas não mais em
  // corpo cru) OU uma página HTML própria, autocontida, no mesmo padrão
  // visual do resto do PDV (pra navegação de página).
  check('mensagem de bloqueio (JSON, rota de API) menciona suspensão', /suspensa/i.test(suspensoResp.body?.error || ''), JSON.stringify(suspensoResp.body));
  const suspensoStatic = await request(`${slugSuspenso}.${DOMAIN}`, { reqPath: '/index.html' });
  check('loja "suspenso" também bloqueada pra estático (nada carrega, nem a página)', suspensoStatic.status === 403, suspensoStatic.status);
  check('bloqueio de página (não-API) devolve HTML estilizado, não texto puro', typeof suspensoStatic.body === 'string' && suspensoStatic.body.includes('<html') && /suspensa/i.test(suspensoStatic.body), suspensoStatic.body?.slice(0, 120));

  // Cancelado.
  setTenantStatus(slugCancelado, 'cancelado');
  const canceladoResp = await request(`${slugCancelado}.${DOMAIN}`, { reqPath: '/api/status' });
  check('loja "cancelado" bloqueada com 403', canceladoResp.status === 403, canceladoResp.status);
  check('mensagem de bloqueio menciona cancelamento', /cancelada/i.test(canceladoResp.body?.error || ''), JSON.stringify(canceladoResp.body));

  // Expirado — status "ativo", mas expires_at no passado.
  setTenantStatus(slugExpirado, 'ativo', new Date(Date.now() - 86400000).toISOString());
  const expiradoResp = await request(`${slugExpirado}.${DOMAIN}`, { reqPath: '/api/status' });
  check('loja "ativo" com expires_at no passado é bloqueada com 403', expiradoResp.status === 403, expiradoResp.status);
  check('mensagem de bloqueio menciona expiração', /expirou/i.test(expiradoResp.body?.error || ''), JSON.stringify(expiradoResp.body));

  // Ativo com vencimento no futuro — continua liberado.
  setTenantStatus(slugAtivoOk, 'ativo', new Date(Date.now() + 30 * 86400000).toISOString());
  const ativoOkResp = await request(`${slugAtivoOk}.${DOMAIN}`, { reqPath: '/api/status' });
  check('loja "ativo" com vencimento no futuro responde normalmente (200)', ativoOkResp.status === 200, ativoOkResp.status);

  // Reverter suspensão — loja volta a responder normalmente (o gate lê o
  // estado atual a cada requisição, nunca um valor cacheado).
  setTenantStatus(slugSuspenso, 'ativo', 'null');
  const reativadoResp = await request(`${slugSuspenso}.${DOMAIN}`, { reqPath: '/api/status' });
  check('loja reativada volta a responder normalmente (200), sem precisar reiniciar o servidor', reativadoResp.status === 200, reativadoResp.status);

  // WebSocket: conexão pra loja suspensa/cancelada/expirada é recusada; pra
  // uma loja liberada, conecta normalmente.
  setTenantStatus(slugSuspenso, 'suspenso');
  const wsSuspenso = await connectWs(`${slugSuspenso}.${DOMAIN}`);
  await waitFor(300);
  check('WebSocket pra loja "suspenso" é recusado', wsSuspenso.ws.readyState === WebSocket.CLOSED || wsSuspenso.ws.readyState === WebSocket.CLOSING, wsSuspenso.ws.readyState);

  const wsTrial = await connectWs(`${slugTrial}.${DOMAIN}`);
  check('WebSocket pra loja "trial" liberada conecta normalmente', wsTrial.ws.readyState === WebSocket.OPEN, wsTrial.ws.readyState);
  try { wsTrial.ws.close(); } catch { /* melhor esforço */ }
} finally {
  for (const slug of slugs) {
    controlDb.prepare('DELETE FROM tenants WHERE slug = ?').run(slug);
    fs.rmSync(path.join(__dirname, 'tenants', slug), { recursive: true, force: true });
  }
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
