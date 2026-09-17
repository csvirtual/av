// Etapa 5 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): prova
// de isolamento pra rota convertida na fatia 5g — backup.js (exportar/
// restaurar/zerar). Dois tenants distintos: o tenant A exporta um backup
// contendo um cliente próprio, e a prova real de isolamento é que RESTAURAR
// esse mesmo backup no tenant B só afeta o banco físico do tenant B (o
// tenant A continua intacto) — não porque a rota filtrou nada, mas porque
// cada tenant já é um arquivo SQLite fisicamente separado.
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
const slugA = `bkp-a-${suffix}`;
const slugB = `bkp-b-${suffix}`;
const tenantA = await createNewTenant(slugA, 'Backup Tenant A', 'Backup Tenant A');
const tenantB = await createNewTenant(slugB, 'Backup Tenant B', 'Backup Tenant B');

function patchAdmin(dbPath) {
  const tdb = new Database(dbPath);
  const row = tdb.prepare("SELECT * FROM users WHERE username_lower = 'admin'").get();
  const data = JSON.parse(row.data);
  data.mustChangePassword = false;
  tdb.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id);
  tdb.close();
}
patchAdmin(tenantA.dbPath);
patchAdmin(tenantB.dbPath);

const hostA = `${slugA}.${DOMAIN}`;
const hostB = `${slugB}.${DOMAIN}`;
const BACKUP_PASSWORD = 'senha-backup-123';

try {
  const loginA = await request(hostA, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login no tenant A funciona', loginA.status === 200, loginA.status);
  const cookieA = loginA.cookie;

  const loginB = await request(hostB, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login no tenant B funciona', loginB.status === 200, loginB.status);
  let cookieB = loginB.cookie;

  const createCustomerA = await request(hostA, { method: 'POST', reqPath: '/api/customers', cookie: cookieA, body: { nome: 'Cliente Backup A' } });
  check('cliente criado no tenant A (vai entrar no backup)', createCustomerA.status === 201, createCustomerA.status);

  const currentCountsA = await request(hostA, { reqPath: '/api/backup/current-counts', cookie: cookieA });
  check('contagem atual do tenant A inclui o cliente criado', currentCountsA.body.counts?.customers === 1, JSON.stringify(currentCountsA.body));

  const currentCountsB = await request(hostB, { reqPath: '/api/backup/current-counts', cookie: cookieB });
  check('contagem atual do tenant B NÃO inclui nada do tenant A (banco vazio)', currentCountsB.body.counts?.customers === 0, JSON.stringify(currentCountsB.body));

  const exportA = await request(hostA, { method: 'POST', reqPath: '/api/backup/export', cookie: cookieA, body: { password: BACKUP_PASSWORD } });
  check('exportar backup do tenant A funciona', exportA.status === 200 && !!exportA.body.envelope, exportA.status);

  const previewFromB = await request(hostB, { method: 'POST', reqPath: '/api/backup/preview', cookie: cookieB, body: { envelope: exportA.body.envelope, password: BACKUP_PASSWORD } });
  check('preview do backup do tenant A no tenant B mostra 1 cliente no arquivo x 0 atual', previewFromB.status === 200 && previewFromB.body.fileCounts?.customers === 1 && previewFromB.body.currentCounts?.customers === 0, JSON.stringify(previewFromB.body));

  const importIntoB = await request(hostB, { method: 'POST', reqPath: '/api/backup/import', cookie: cookieB, body: { envelope: exportA.body.envelope, password: BACKUP_PASSWORD } });
  check('restaurar o backup do tenant A DENTRO do tenant B funciona (grava só no banco físico do B)', importIntoB.status === 200, JSON.stringify(importIntoB.body));

  // A restauração troca a tabela `users` inteira pela do arquivo (do tenant
  // A) — a sessão antiga de B (cookieB) aponta pra um userId que não existe
  // mais nesse banco, então precisa logar de novo (mesmo comportamento já
  // existente em modo single-tenant: restaurar um backup de outra
  // instalação sempre invalida sessões abertas).
  const reloginB = await request(hostB, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('sessão antiga de B expira após restaurar (precisa logar de novo com o admin restaurado)', reloginB.status === 200, reloginB.status);
  cookieB = reloginB.cookie;

  const countsBAfterImport = await request(hostB, { reqPath: '/api/backup/current-counts', cookie: cookieB });
  check('após restaurar, tenant B agora tem o cliente (seu próprio banco foi alterado)', countsBAfterImport.body.counts?.customers === 1, JSON.stringify(countsBAfterImport.body));

  const countsAAfterImportIntoB = await request(hostA, { reqPath: '/api/backup/current-counts', cookie: cookieA });
  check('tenant A continua com exatamente 1 cliente (não foi duplicado nem afetado pela restauração no B)', countsAAfterImportIntoB.body.counts?.customers === 1, JSON.stringify(countsAAfterImportIntoB.body));

  const listCustomersA = await request(hostA, { reqPath: '/api/customers', cookie: cookieA });
  const listCustomersB = await request(hostB, { reqPath: '/api/customers', cookie: cookieB });
  check('cliente do tenant A e a cópia restaurada no tenant B têm o MESMO id (veio do mesmo arquivo) mas vivem em bancos físicos diferentes', listCustomersA.body.customers?.[0]?.id === listCustomersB.body.customers?.[0]?.id, JSON.stringify({ a: listCustomersA.body.customers?.[0]?.id, b: listCustomersB.body.customers?.[0]?.id }));

  const resetB = await request(hostB, { method: 'POST', reqPath: '/api/backup/reset', cookie: cookieB });
  check('zerar operação no tenant B funciona (cadastro de cliente preservado, é RESET_TABLES que muda)', resetB.status === 200, JSON.stringify(resetB.body));

  const listCustomersAAfterResetB = await request(hostA, { reqPath: '/api/customers', cookie: cookieA });
  check('zerar o tenant B não afeta o cliente do tenant A', listCustomersAAfterResetB.body.customers?.length === 1, JSON.stringify(listCustomersAAfterResetB.body));
} finally {
  controlDb.prepare('DELETE FROM tenants WHERE slug IN (?, ?)').run(slugA, slugB);
  fs.rmSync(path.join(__dirname, 'tenants', slugA), { recursive: true, force: true });
  fs.rmSync(path.join(__dirname, 'tenants', slugB), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
