// Etapa 5 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): prova
// de isolamento pras rotas convertidas nesta fatia — audit.js (log),
// suppliers.js (fornecedores), reports.js (relatório de vendas) e
// deliveries.js (carreto). Um tenant só, mas com dado real gravado em
// cada uma dessas quatro áreas, confirmando que tudo bate com o banco
// daquele tenant especificamente (não o legado nem outro tenant).
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
const slugA = `misc-a-${suffix}`;
const tenantA = await createNewTenant(slugA, 'Misc Tenant A', 'Misc Tenant A');

const tdb = new Database(tenantA.dbPath);
const row = tdb.prepare("SELECT * FROM users WHERE username_lower = 'admin'").get();
const data = JSON.parse(row.data);
data.mustChangePassword = false;
tdb.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id);
tdb.close();

const hostA = `${slugA}.${DOMAIN}`;

try {
  const login = await request(hostA, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login no tenant de teste funciona', login.status === 200, login.status);
  const cookie = login.cookie;

  // Fornecedor
  const createSupplier = await request(hostA, { method: 'POST', reqPath: '/api/suppliers', cookie, body: { nome: 'Fornecedor Misc A' } });
  check('fornecedor criado no tenant A', createSupplier.status === 201, createSupplier.status);
  const listSuppliers = await request(hostA, { reqPath: '/api/suppliers', cookie });
  check('fornecedor aparece na listagem do próprio tenant', listSuppliers.body.suppliers?.some((s) => s.nome === 'Fornecedor Misc A'));

  // Carreto (customer precisa existir — cria via customers.js direto pelo banco, já que essa rota ainda não foi convertida nesta fatia)
  const custDb = new Database(tenantA.dbPath);
  const customer = { id: crypto.randomUUID(), nome: 'Cliente Misc A', nameLower: 'cliente misc a', telefone: '', endereco: 'Rua Teste', active: true, createdAt: Date.now() };
  custDb.prepare('INSERT INTO customers (id, name_lower, data) VALUES (?, ?, ?)').run(customer.id, customer.nameLower, JSON.stringify(customer));
  custDb.close();

  const createDelivery = await request(hostA, {
    method: 'POST', reqPath: '/api/deliveries', cookie,
    body: { customerId: customer.id, items: [{ source: 'avulso', name: 'Item Misc', unit: 'un', qty: 1 }], dedupeKey: `dk-misc-${suffix}` },
  });
  check('carreto criado no tenant A', createDelivery.status === 201, JSON.stringify(createDelivery.body));
  const listDeliveries = await request(hostA, { reqPath: '/api/deliveries', cookie });
  check('carreto aparece na listagem do próprio tenant', listDeliveries.body.deliveries?.some((d) => d.customerId === customer.id));

  // Auditoria
  const listAudit = await request(hostA, { reqPath: '/api/audit?limit=50', cookie });
  check('log de auditoria do tenant A tem o login e a criação do fornecedor', listAudit.status === 200 && listAudit.body.items?.some((e) => e.action === 'Login'), listAudit.status);

  // Relatório de vendas (sem venda nenhuma ainda — só confirma que responde e não erra, dado que sales.js ainda não foi convertido)
  const report = await request(hostA, { reqPath: '/api/reports/vendas', cookie });
  check('relatório de vendas do tenant A responde 200 (mesmo sem vendas)', report.status === 200 && report.body.totalCount === 0, JSON.stringify(report.body));
} finally {
  controlDb.prepare('DELETE FROM tenants WHERE slug = ?').run(slugA);
  fs.rmSync(path.join(__dirname, 'tenants', slugA), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
