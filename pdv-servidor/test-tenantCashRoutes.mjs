// Etapa 5 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// segunda rota de negócio convertida (routes/cash.js) — prova ponta a
// ponta de que abrir/movimentar/fechar caixa em duas lojas diferentes,
// pelo próprio Host de cada uma, nunca mistura sessão de caixa entre elas.
//
// Uso: precisa de um servidor rodando com MULTI_TENANT_DOMAIN definida.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

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
        resolve({ status: res.statusCode, body: JSON.parse(data || '{}'), cookie: setCookie });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const { createNewTenant } = await import('./scripts/createTenant.js');
const { controlDb } = await import('./control/db.js');
const Database = (await import('better-sqlite3')).default;

const suffix = Date.now();
const slugA = `cash-a-${suffix}`;
const slugB = `cash-b-${suffix}`;
const tenantA = await createNewTenant(slugA, 'Cash Tenant A', 'Cash Tenant A');
const tenantB = await createNewTenant(slugB, 'Cash Tenant B', 'Cash Tenant B');

for (const t of [tenantA, tenantB]) {
  const tdb = new Database(t.dbPath);
  const row = tdb.prepare("SELECT * FROM users WHERE username_lower = 'admin'").get();
  const data = JSON.parse(row.data);
  data.mustChangePassword = false;
  tdb.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id);
  tdb.close();
}

const hostA = `${slugA}.${DOMAIN}`;
const hostB = `${slugB}.${DOMAIN}`;

try {
  const loginA = await request(hostA, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  const loginB = await request(hostB, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });

  // Modo único é o padrão em cada loja nova — cada uma abre seu PRÓPRIO
  // caixa, com troco inicial diferente, pra distinguir claramente.
  const openA = await request(hostA, { method: 'POST', reqPath: '/api/cash/open', cookie: loginA.cookie, body: { openingAmount: 100 } });
  const openB = await request(hostB, { method: 'POST', reqPath: '/api/cash/open', cookie: loginB.cookie, body: { openingAmount: 200 } });
  check('caixa aberto na loja A (troco 100)', openA.status === 201 && openA.body.session?.openingAmount === 100, openA.status);
  check('caixa aberto na loja B (troco 200), independente do de A', openB.status === 201 && openB.body.session?.openingAmount === 200, openB.status);
  check('são sessões de caixa diferentes (ids diferentes)', openA.body.session?.id !== openB.body.session?.id);

  const viewA = await request(hostA, { reqPath: '/api/cash/open', cookie: loginA.cookie });
  const viewB = await request(hostB, { reqPath: '/api/cash/open', cookie: loginB.cookie });
  check('GET /api/cash/open da loja A só mostra o caixa dela (100)', viewA.body.session?.openingAmount === 100, viewA.body.session?.openingAmount);
  check('GET /api/cash/open da loja B só mostra o caixa dela (200)', viewB.body.session?.openingAmount === 200, viewB.body.session?.openingAmount);

  // Sangria na loja A não pode aparecer na loja B de jeito nenhum — nem
  // como movimento visível, nem afetando o "esperado" dela.
  const movA = await request(hostA, {
    method: 'POST', reqPath: `/api/cash/sessions/${openA.body.session.id}/movimento`, cookie: loginA.cookie,
    body: { type: 'sangria', amount: 30, reason: 'Depósito no banco (loja A)', dedupeKey: `dk-a-${suffix}` },
  });
  check('sangria registrada no caixa da loja A', movA.status === 201, movA.status);

  const sessionDetailB = await request(hostB, { reqPath: `/api/cash/sessions/${openB.body.session.id}`, cookie: loginB.cookie });
  check('detalhe do caixa da loja B não tem NENHUM movimento (a sangria foi só na A)', (sessionDetailB.body.movements || []).length === 0, JSON.stringify(sessionDetailB.body.movements));
  check('esperado em Dinheiro da loja B continua 200 (não sofreu a sangria de A)', sessionDetailB.body.expected?.Dinheiro === 200, sessionDetailB.body.expected?.Dinheiro);

  // Tentar usar o id da sessão de A, mas autenticado (Host+cookie) como B
  // — precisa dar "não encontrado", nunca vazar/aceitar.
  const crossAttempt = await request(hostB, {
    method: 'POST', reqPath: `/api/cash/sessions/${openA.body.session.id}/movimento`, cookie: loginB.cookie,
    body: { type: 'sangria', amount: 999, reason: 'Tentativa cruzada', dedupeKey: `dk-cross-${suffix}` },
  });
  check('B tentando mexer no id de caixa de A (pelo Host de B) recebe "não encontrado"', crossAttempt.status === 400 && /não encontrado/i.test(crossAttempt.body.error), JSON.stringify(crossAttempt.body));

  const closeA = await request(hostA, {
    method: 'POST', reqPath: `/api/cash/sessions/${openA.body.session.id}/fechar`, cookie: loginA.cookie,
    body: { countedAmounts: { Dinheiro: 70 }, confirmUsername: 'admin', confirmPassword: 'admin123' },
  });
  check('fechamento do caixa da loja A funciona (100 - 30 sangria = 70 esperado, bateu)', closeA.status === 200 && Math.abs((closeA.body.session?.difference ?? 99) - 0) < 0.01, JSON.stringify(closeA.body));

  const viewBAfter = await request(hostB, { reqPath: '/api/cash/open', cookie: loginB.cookie });
  check('fechar o caixa de A não afeta o caixa (ainda aberto) da loja B', viewBAfter.body.session?.id === openB.body.session.id, viewBAfter.body.session?.id);
} finally {
  controlDb.prepare('DELETE FROM tenants WHERE slug IN (?, ?)').run(slugA, slugB);
  fs.rmSync(path.join(__dirname, 'tenants', slugA), { recursive: true, force: true });
  fs.rmSync(path.join(__dirname, 'tenants', slugB), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
