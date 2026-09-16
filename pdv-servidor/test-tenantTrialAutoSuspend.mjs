// Etapa 9+ do roteiro multi-tenant: achado do usuário — quando o período
// de teste de 7 dias (lib/licenseState.js, por CNPJ, dentro do banco de
// CADA loja) acaba, a loja deve suspender também na PLATAFORMA
// (control/plataforma.sqlite3, o que o Painel de Controle mostra), não só
// ficar bloqueada por dentro. E selecionar "trial" no painel e salvar deve
// "renovar" a loja: reiniciar o relógio de 7 dias, voltando a liberar o
// acesso.
//
// Uso: precisa de um servidor rodando com MULTI_TENANT_DOMAIN definida.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOMAIN = process.env.MULTI_TENANT_DOMAIN || 'pdv-csvirtual.com.br';
const PORT = Number(process.env.PORT) || 3131;
const ADMIN_HOST = `admin.${DOMAIN}`;

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

const { createNewTenant } = await import('./scripts/createTenant.js');
const { seedPlatformAdmin } = await import('./scripts/seedPlatformAdmin.js');
const { controlDb } = await import('./control/db.js');
const Database = (await import('better-sqlite3')).default;

const suffix = Date.now();
const slug = `trialauto-${suffix}`;
const tenant = await createNewTenant(slug, 'Trial Auto', 'Trial Auto');
const host = `${slug}.${DOMAIN}`;

const adminUsername = `super-trialauto-${suffix}`;
const adminPassword = 'senha-super-admin-123';
await seedPlatformAdmin(adminUsername, adminPassword);

try {
  check('loja nasce com status "trial"', controlDb.prepare('SELECT status FROM tenants WHERE slug = ?').get(slug)?.status === 'trial');

  // Simula um trial já vencido há muito: grava direto no banco da PRÓPRIA
  // loja um trialStartedAt de 8 dias atrás (TRIAL_DURATION_MS é 7 dias).
  const tdb = new Database(tenant.dbPath);
  const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
  tdb.prepare("INSERT INTO license_state (id, data) VALUES ('state', @data) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run({ data: JSON.stringify({ trialStartedAt: eightDaysAgo }) });
  tdb.close();

  // A PRIMEIRA requisição de API já dispara — não precisa ser
  // /api/license/status especificamente: o gate de licença que já existia
  // (server.js, achado de auditoria P0, bloqueia TODA rota /api/* quando a
  // licença está inativa) é quem primeiro percebe o trial vencido, porque
  // o status da PLATAFORMA ainda é "trial" nesse instante (não bloqueado
  // ainda pelo middleware de resolução por Host, que roda antes).
  const firstReq = await request(host, { reqPath: '/api/status' });
  check('a primeira requisição de API já bloqueia (403) por licença vencida', firstReq.status === 403 && firstReq.body?.licenseExpired === true, JSON.stringify(firstReq.body));

  const rowAfterExpiry = controlDb.prepare('SELECT status FROM tenants WHERE slug = ?').get(slug);
  check('essa mesma checagem já auto-suspendeu a loja na PLATAFORMA', rowAfterExpiry.status === 'suspenso', rowAfterExpiry.status);

  // A partir daqui, quem bloqueia primeiro é o middleware de resolução por
  // Host (roda ANTES do gate de licença) — mensagem de "assinatura
  // suspensa", igual a um suspenso manual pelo painel.
  const secondReq = await request(host, { reqPath: '/api/status' });
  check('a partir da segunda requisição, quem bloqueia é o gate da PLATAFORMA (mensagem de suspensão)', secondReq.status === 403 && /suspensa/i.test(secondReq.body?.error || ''), JSON.stringify(secondReq.body));

  // Mesmo /api/license/status (que o gate de licença exclui de propósito,
  // pra continuar alcançável quando bloqueado só por ELE) fica bloqueado
  // agora — o gate da PLATAFORMA roda antes e nem deixa chegar lá.
  const licenseStatusBlocked = await request(host, { reqPath: '/api/license/status' });
  check('bloqueado na plataforma, nem /api/license/status escapa', licenseStatusBlocked.status === 403 && /suspensa/i.test(licenseStatusBlocked.body?.error || ''), JSON.stringify(licenseStatusBlocked.body));

  // --- Renovar: Super Admin seleciona "trial" no painel e salva ---
  const login = await request(ADMIN_HOST, { method: 'POST', reqPath: '/api/admin/login', body: { username: adminUsername, password: adminPassword } });
  check('login do Super Admin funciona', login.status === 200, login.status);

  const renew = await request(ADMIN_HOST, { method: 'POST', reqPath: `/api/admin/tenants/${slug}/status`, cookie: login.cookie, body: { status: 'trial', expiresAt: 'null' } });
  check('selecionar "trial" e salvar no painel funciona', renew.status === 200 && renew.body.tenant?.status === 'trial', JSON.stringify(renew.body));

  const statusAfterRenew = await request(host, { reqPath: '/api/status' });
  check('loja renovada volta a responder normalmente (200), sem precisar reiniciar o servidor', statusAfterRenew.status === 200, statusAfterRenew.status);

  const licenseStatusAfterRenew = await request(host, { reqPath: '/api/license/status' });
  const now = Date.now();
  const expiraEm = licenseStatusAfterRenew.body.expiraEm;
  const seteDiasMs = 7 * 24 * 60 * 60 * 1000;
  const dentroDaFaixaEsperada = typeof expiraEm === 'number' && Math.abs(expiraEm - (now + seteDiasMs)) < 60000; // folga de 1min
  check('renovar reiniciou o relógio: expira ~7 dias a partir de AGORA, não do trial antigo', licenseStatusAfterRenew.body.tipo === 'trial' && licenseStatusAfterRenew.body.active === true && dentroDaFaixaEsperada, JSON.stringify(licenseStatusAfterRenew.body));

  const rowAfterRenew = controlDb.prepare('SELECT status FROM tenants WHERE slug = ?').get(slug);
  check('status na plataforma voltou a ser "trial"', rowAfterRenew.status === 'trial', rowAfterRenew.status);
} finally {
  controlDb.prepare('DELETE FROM platform_admins WHERE username_lower = ?').run(adminUsername.toLowerCase());
  controlDb.prepare('DELETE FROM tenants WHERE slug = ?').run(slug);
  fs.rmSync(path.join(__dirname, 'tenants', slug), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
