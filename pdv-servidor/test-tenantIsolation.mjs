// Etapa 4 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// primeira prova de isolamento com dois tenants reais.
//
// Escopo HONESTO desta etapa: nenhuma rota de negócio (produtos, vendas,
// clientes...) lê req.tenantId/req.db ainda — isso só entra na etapa 5
// (routes/*.js trocando o `db` fixo por req.db). Então um teste de IDOR
// clássico ("login como A, tenta adivinhar id de B em /api/products/:id")
// não provaria nada de verdade hoje — todo endpoint de negócio ainda lê o
// MESMO `db` fixo do processo inteiro, não importa o Host da requisição.
// Esse teste completo, ponta a ponta, entra junto da etapa 5.
//
// O que ESTE teste prova, de verdade, com o que já existe até a etapa 4:
// (1) a resolução por Host (middleware da etapa 3) nunca mistura tenants,
// nem sob concorrência real — muitas requisições em paralelo, alternando
// Host A/B, e cada resposta tem que vir com o tenantId EXATO do Host que
// a pediu (via /api/status#tenantId, ver server.js); (2) o arquivo
// resolvido pra cada tenant bate com o registrado no banco de controle;
// (3) reforça (por uma via diferente da etapa 2) que os dados de A e B
// são fisicamente arquivos separados.
//
// Uso: precisa de um servidor rodando com MULTI_TENANT_DOMAIN definida
// (mesmo requisito de test-tenantResolver.mjs).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOMAIN = process.env.MULTI_TENANT_DOMAIN || 'pdv-csvirtual.com.br';
const PORT = Number(process.env.PORT) || 3131;

const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

function rawRequest(hostHeader, reqPath = '/api/status') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: reqPath, method: 'GET',
      headers: { Host: hostHeader },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }));
    });
    req.on('error', reject);
    req.end();
  });
}

const { createNewTenant } = await import('./scripts/createTenant.js');
const { controlDb } = await import('./control/db.js');
const Database = (await import('better-sqlite3')).default;

const suffix = Date.now();
const slugA = `isolamento-a-${suffix}`;
const slugB = `isolamento-b-${suffix}`;
const tenantA = await createNewTenant(slugA, 'Isolamento A', 'Isolamento A');
const tenantB = await createNewTenant(slugB, 'Isolamento B', 'Isolamento B');

try {
  // (1) o arquivo resolvido pra cada tenant bate com o registrado no
  // banco de controle (a MESMA fonte que o middleware de Host consulta).
  const rowA = controlDb.prepare('SELECT db_path FROM tenants WHERE id = ?').get(tenantA.id);
  const rowB = controlDb.prepare('SELECT db_path FROM tenants WHERE id = ?').get(tenantB.id);
  check('db_path do tenant A aponta pro arquivo certo dele', rowA.db_path === tenantA.dbPath, rowA.db_path);
  check('db_path do tenant B aponta pro arquivo certo dele (diferente do A)', rowB.db_path === tenantB.dbPath && rowB.db_path !== rowA.db_path);

  // (2) reforço da isolação física (mesma ideia da etapa 2, por uma via
  // diferente): grava um marcador em cada arquivo direto, sem passar pelo
  // servidor, e confirma que aparece só no arquivo certo.
  const dbA = new Database(tenantA.dbPath);
  const dbB = new Database(tenantB.dbPath);
  dbA.prepare("INSERT INTO company (id, data) VALUES ('config', ?)").run(JSON.stringify({ nomeFantasia: 'Marcador exclusivo de A' }));
  dbB.prepare("INSERT INTO company (id, data) VALUES ('config', ?)").run(JSON.stringify({ nomeFantasia: 'Marcador exclusivo de B' }));
  const readA = JSON.parse(dbA.prepare("SELECT data FROM company WHERE id = 'config'").get().data);
  const readB = JSON.parse(dbB.prepare("SELECT data FROM company WHERE id = 'config'").get().data);
  check('marcador de A não vaza pro arquivo de B', readA.nomeFantasia !== readB.nomeFantasia, `A=${readA.nomeFantasia} B=${readB.nomeFantasia}`);
  dbA.close();
  dbB.close();

  // (3) o teste que importa nesta etapa: sob CONCORRÊNCIA real (não uma
  // requisição de cada vez), a resolução por Host nunca mistura os dois
  // tenants — cada resposta tem que trazer o tenantId exato de quem
  // pediu, mesmo com dezenas de requisições intercaladas em paralelo.
  const ROUNDS = 30;
  const requests = [];
  for (let i = 0; i < ROUNDS; i++) {
    requests.push(rawRequest(`${slugA}.${DOMAIN}`).then((r) => ({ expected: tenantA.id, ...r })));
    requests.push(rawRequest(`${slugB}.${DOMAIN}`).then((r) => ({ expected: tenantB.id, ...r })));
  }
  const responses = await Promise.all(requests);
  const allCorrect = responses.every((r) => r.status === 200 && r.body.tenantId === r.expected);
  const mismatches = responses.filter((r) => r.body.tenantId !== r.expected);
  check(`${ROUNDS * 2} requisições concorrentes (A/B intercaladas) nunca misturam tenantId`, allCorrect, mismatches.length ? `${mismatches.length} erradas` : 'todas corretas');
} finally {
  controlDb.prepare('DELETE FROM tenants WHERE slug IN (?, ?)').run(slugA, slugB);
  fs.rmSync(path.join(__dirname, 'tenants', slugA), { recursive: true, force: true });
  fs.rmSync(path.join(__dirname, 'tenants', slugB), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
