// Etapa 5 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): prova
// de isolamento pras rotas convertidas na fatia 5e — customers.js (clientes
// e fiado), finance.js (contas a pagar/receber) e purchases.js (pedidos de
// compra). Dois tenants distintos, cada um com dado real gravado nas três
// áreas, confirmando que tudo bate com o banco daquele tenant
// especificamente e nunca vaza pro outro (incluindo tentativa de acessar
// registro do tenant B usando o cookie de sessão do tenant A).
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
const slugA = `fin-a-${suffix}`;
const slugB = `fin-b-${suffix}`;
const tenantA = await createNewTenant(slugA, 'Finance Tenant A', 'Finance Tenant A');
const tenantB = await createNewTenant(slugB, 'Finance Tenant B', 'Finance Tenant B');

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

function seedSupplierAndProduct(dbPath, tag) {
  const tdb = new Database(dbPath);
  const supplier = { id: crypto.randomUUID(), nome: `Fornecedor ${tag}` };
  tdb.prepare('INSERT INTO suppliers (id, name_lower, data) VALUES (?, ?, ?)').run(supplier.id, supplier.nome.toLowerCase(), JSON.stringify(supplier));
  const product = { id: crypto.randomUUID(), nome: `Produto ${tag}`, nameLower: `produto ${tag}`.toLowerCase(), barcode: null, unit: 'un', quantity: 0, costPrice: 0, salePrice: 10, active: true };
  tdb.prepare('INSERT INTO products (id, barcode, name_lower, active, updated_at, data) VALUES (?, ?, ?, 1, ?, ?)').run(product.id, null, product.nameLower, Date.now(), JSON.stringify(product));
  tdb.close();
  return { supplierId: supplier.id, productId: product.id };
}
const seedA = seedSupplierAndProduct(tenantA.dbPath, 'A');
const seedB = seedSupplierAndProduct(tenantB.dbPath, 'B');

const hostA = `${slugA}.${DOMAIN}`;
const hostB = `${slugB}.${DOMAIN}`;

try {
  const loginA = await request(hostA, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login no tenant A funciona', loginA.status === 200, loginA.status);
  const cookieA = loginA.cookie;

  const loginB = await request(hostB, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login no tenant B funciona', loginB.status === 200, loginB.status);
  const cookieB = loginB.cookie;

  // --- Clientes/fiado ---
  const createCustomerA = await request(hostA, { method: 'POST', reqPath: '/api/customers', cookie: cookieA, body: { nome: 'Cliente Fin A', creditLimit: 500 } });
  check('cliente criado no tenant A', createCustomerA.status === 201, createCustomerA.status);
  const customerA = createCustomerA.body.customer;

  const listCustomersA = await request(hostA, { reqPath: '/api/customers', cookie: cookieA });
  check('cliente aparece na listagem do tenant A', listCustomersA.body.customers?.some((c) => c.id === customerA.id));

  const listCustomersB = await request(hostB, { reqPath: '/api/customers', cookie: cookieB });
  check('cliente do tenant A NÃO aparece na listagem do tenant B', !listCustomersB.body.customers?.some((c) => c.id === customerA.id));

  const getCustomerFromB = await request(hostB, { reqPath: `/api/customers/${customerA.id}`, cookie: cookieB });
  check('acessar cliente do tenant A pelo tenant B retorna 404', getCustomerFromB.status === 404, getCustomerFromB.status);

  const getCustomerCrossCookie = await request(hostB, { reqPath: `/api/customers/${customerA.id}`, cookie: cookieA });
  check('cookie do tenant A enviado ao Host do tenant B não autentica (401)', getCustomerCrossCookie.status === 401, getCustomerCrossCookie.status);

  // --- Financeiro (contas a pagar/receber) ---
  const createEntryA = await request(hostA, { method: 'POST', reqPath: '/api/finance', cookie: cookieA, body: { type: 'pagar', description: 'Conta Fin A', amount: 100, dueDate: Date.now() + 86400000, dedupeKey: `dk-fin-create-${suffix}` } });
  check('conta financeira criada no tenant A', createEntryA.status === 201, createEntryA.status);

  const listEntriesA = await request(hostA, { reqPath: '/api/finance', cookie: cookieA });
  check('conta aparece na listagem do próprio tenant A', listEntriesA.body.entries?.some((e) => e.description === 'Conta Fin A'));

  const listEntriesB = await request(hostB, { reqPath: '/api/finance', cookie: cookieB });
  check('conta do tenant A NÃO aparece na listagem do tenant B', !listEntriesB.body.entries?.some((e) => e.description === 'Conta Fin A'));

  const payEntryFromB = await request(hostB, { method: 'POST', reqPath: `/api/finance/${createEntryA.body.entry.id}/pagamento`, cookie: cookieB, body: { amount: 100, paymentMethod: 'Dinheiro', dedupeKey: `dk-fin-crossb-${suffix}` } });
  check('pagar conta do tenant A pelo tenant B falha (conta não encontrada)', payEntryFromB.status === 400 && /não encontrada/i.test(payEntryFromB.body.error || ''), JSON.stringify(payEntryFromB.body));

  // --- Compras (pedidos de fornecedor) ---
  const createOrderA = await request(hostA, {
    method: 'POST', reqPath: '/api/purchases', cookie: cookieA,
    body: { supplierId: seedA.supplierId, items: [{ productId: seedA.productId, name: 'Produto A', unit: 'un', qty: 10, unitCost: 5 }] },
  });
  check('pedido de compra criado no tenant A', createOrderA.status === 201, JSON.stringify(createOrderA.body));
  const orderA = createOrderA.body.order;

  const listOrdersB = await request(hostB, { reqPath: '/api/purchases', cookie: cookieB });
  check('pedido do tenant A NÃO aparece na listagem do tenant B', !listOrdersB.body.orders?.some((o) => o.id === orderA?.id));

  const receiveFromB = await request(hostB, {
    method: 'POST', reqPath: `/api/purchases/${orderA?.id}/receber`, cookie: cookieB,
    body: { items: [{ productId: seedA.productId, qty: 5 }], dedupeKey: `dk-purch-crossb-${suffix}` },
  });
  check('receber pedido do tenant A pelo tenant B falha (pedido não encontrado)', receiveFromB.status === 400 && /não encontrado/i.test(receiveFromB.body.error || ''), JSON.stringify(receiveFromB.body));

  const receiveOwnA = await request(hostA, {
    method: 'POST', reqPath: `/api/purchases/${orderA?.id}/receber`, cookie: cookieA,
    body: { items: [{ productId: seedA.productId, qty: 10 }], dedupeKey: `dk-purch-owna-${suffix}` },
  });
  check('receber pedido próprio no tenant A funciona', receiveOwnA.status === 200 && receiveOwnA.body.order?.status === 'recebido', JSON.stringify(receiveOwnA.body));

  // --- Tenant B independente segue funcionando normalmente ---
  const createCustomerB = await request(hostB, { method: 'POST', reqPath: '/api/customers', cookie: cookieB, body: { nome: 'Cliente Fin B' } });
  check('cliente criado no tenant B funciona normalmente', createCustomerB.status === 201, createCustomerB.status);
} finally {
  controlDb.prepare('DELETE FROM tenants WHERE slug IN (?, ?)').run(slugA, slugB);
  fs.rmSync(path.join(__dirname, 'tenants', slugA), { recursive: true, force: true });
  fs.rmSync(path.join(__dirname, 'tenants', slugB), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
