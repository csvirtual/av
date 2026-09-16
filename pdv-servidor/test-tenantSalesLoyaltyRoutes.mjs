// Etapa 5 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): prova
// de isolamento pra fatia final — routes/sales.js (venda/estorno) e
// routes/loyalty.js (config/extrato/resgate de fidelidade), que também
// resolveu a conversão pendente de lib/loyaltyLedger.js
// (insertLoyaltyStmt/insertCreditStmt). Dois tenants distintos, cada um
// com produto/cliente/venda próprios, confirmando que venda, estorno,
// pontos de fidelidade e crédito de troca nunca vazam entre tenants.
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
const slugA = `sl-a-${suffix}`;
const slugB = `sl-b-${suffix}`;
const tenantA = await createNewTenant(slugA, 'SalesLoyalty Tenant A', 'SalesLoyalty Tenant A');
const tenantB = await createNewTenant(slugB, 'SalesLoyalty Tenant B', 'SalesLoyalty Tenant B');

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

function seedProduct(dbPath, tag) {
  const tdb = new Database(dbPath);
  const product = { id: crypto.randomUUID(), name: `Produto ${tag}`, nameLower: `produto ${tag}`.toLowerCase(), barcode: `SL-${tag}-${suffix}`, unit: 'un', quantity: 100, price: 10, costPrice: 5, active: true };
  tdb.prepare('INSERT INTO products (id, barcode, name_lower, active, updated_at, data) VALUES (?, ?, ?, 1, ?, ?)').run(product.id, product.barcode, product.nameLower, Date.now(), JSON.stringify(product));
  tdb.close();
  return product.id;
}
const productA = seedProduct(tenantA.dbPath, 'A');
const productB = seedProduct(tenantB.dbPath, 'B');

const hostA = `${slugA}.${DOMAIN}`;
const hostB = `${slugB}.${DOMAIN}`;

try {
  const loginA = await request(hostA, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login no tenant A funciona', loginA.status === 200, loginA.status);
  const cookieA = loginA.cookie;

  const loginB = await request(hostB, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login no tenant B funciona', loginB.status === 200, loginB.status);
  const cookieB = loginB.cookie;

  // Cliente + configura fidelidade (1 ponto por real) no tenant A.
  const createCustomerA = await request(hostA, { method: 'POST', reqPath: '/api/customers', cookie: cookieA, body: { nome: 'Cliente Venda A' } });
  check('cliente criado no tenant A', createCustomerA.status === 201, createCustomerA.status);
  const customerA = createCustomerA.body.customer;

  const setLoyaltyConfigA = await request(hostA, { method: 'PUT', reqPath: '/api/loyalty/config', cookie: cookieA, body: { pointsPerReal: 1, redemptionRate: 100 } });
  check('config de fidelidade do tenant A aplicada', setLoyaltyConfigA.status === 200, JSON.stringify(setLoyaltyConfigA.body));

  const loyaltyConfigB = await request(hostB, { reqPath: '/api/loyalty/config', cookie: cookieB });
  check('config de fidelidade do tenant B continua no default (não herdou do tenant A)', loyaltyConfigB.body.pointsPerReal === 0, JSON.stringify(loyaltyConfigB.body));

  // --- Venda no tenant A ---
  const saleA = await request(hostA, {
    method: 'POST', reqPath: '/api/sales', cookie: cookieA,
    body: {
      items: [{ productId: productA, qty: 2 }], customerId: customerA.id,
      payments: [{ method: 'Dinheiro', amount: 20 }], dedupeKey: `dk-sale-a-${suffix}`,
    },
  });
  check('venda criada no tenant A', saleA.status === 201, JSON.stringify(saleA.body));
  const saleAId = saleA.body.sale?.id;

  const listSalesA = await request(hostA, { reqPath: '/api/sales', cookie: cookieA });
  check('venda aparece na listagem do tenant A', listSalesA.body.items?.some((s) => s.id === saleAId));

  const listSalesB = await request(hostB, { reqPath: '/api/sales', cookie: cookieB });
  check('venda do tenant A NÃO aparece na listagem do tenant B', !listSalesB.body.items?.some((s) => s.id === saleAId));

  const getSaleFromB = await request(hostB, { reqPath: `/api/sales/${saleAId}`, cookie: cookieB });
  check('acessar a venda do tenant A pelo tenant B retorna 404', getSaleFromB.status === 404, getSaleFromB.status);

  const refundFromB = await request(hostB, {
    method: 'POST', reqPath: `/api/sales/${saleAId}/refund`, cookie: cookieB,
    body: { items: [{ itemIndex: 0, productId: productA, qty: 1 }], reason: 'teste cross-tenant', dedupeKey: `dk-refund-crossb-${suffix}` },
  });
  check('estornar a venda do tenant A pelo tenant B falha (venda não encontrada)', refundFromB.status === 400 && /não encontrada/i.test(refundFromB.body.error || ''), JSON.stringify(refundFromB.body));

  // --- Pontos de fidelidade ganhos na venda ficam só no tenant A ---
  const loyaltyA = await request(hostA, { reqPath: `/api/loyalty/${customerA.id}`, cookie: cookieA });
  check('cliente do tenant A ganhou pontos de fidelidade da venda (20 * 1 ponto/real = 20)', loyaltyA.body.points === 20, JSON.stringify(loyaltyA.body));

  // --- Estoque debitado só no tenant A ---
  const productAfterSaleA = await request(hostA, { reqPath: `/api/products/${productA}`, cookie: cookieA });
  check('estoque do produto A debitado pela venda (100-2=98)', productAfterSaleA.body.product?.quantity === 98, JSON.stringify(productAfterSaleA.body));

  const productBUnaffected = await request(hostB, { reqPath: `/api/products/${productB}`, cookie: cookieB });
  check('estoque do produto B (outro tenant) continua intacto (100)', productBUnaffected.body.product?.quantity === 100, JSON.stringify(productBUnaffected.body));

  // --- Estorno de verdade no próprio tenant A funciona ---
  const refundOwnA = await request(hostA, {
    method: 'POST', reqPath: `/api/sales/${saleAId}/refund`, cookie: cookieA,
    body: { items: [{ itemIndex: 0, productId: productA, qty: 1 }], reason: 'teste próprio tenant', dedupeKey: `dk-refund-owna-${suffix}` },
  });
  check('estornar a própria venda no tenant A funciona', refundOwnA.status === 200, JSON.stringify(refundOwnA.body));

  // --- Resgate de fidelidade: crédito de troca gerado só no tenant A ---
  const redeemA = await request(hostA, {
    method: 'POST', reqPath: `/api/loyalty/${customerA.id}/resgatar`, cookie: cookieA,
    body: { points: 10, dedupeKey: `dk-redeem-a-${suffix}` },
  });
  check('resgate de pontos no tenant A funciona', redeemA.status === 201, JSON.stringify(redeemA.body));

  const loyaltyAfterRedeem = await request(hostA, { reqPath: `/api/loyalty/${customerA.id}`, cookie: cookieA });
  check('crédito de troca do tenant A refletiu o resgate', loyaltyAfterRedeem.body.credit === redeemA.body.amount, JSON.stringify(loyaltyAfterRedeem.body));

  // --- Cookie cross-tenant não autentica ---
  const cookieCrossCheck = await request(hostB, { reqPath: '/api/sales', cookie: cookieA });
  check('cookie do tenant A enviado ao Host do tenant B não autentica (401)', cookieCrossCheck.status === 401, cookieCrossCheck.status);

  // --- Tenant B segue funcionando normalmente e de forma independente ---
  const saleB = await request(hostB, {
    method: 'POST', reqPath: '/api/sales', cookie: cookieB,
    body: { items: [{ productId: productB, qty: 1 }], payments: [{ method: 'Dinheiro', amount: 10 }], dedupeKey: `dk-sale-b-${suffix}` },
  });
  check('venda no tenant B funciona normalmente e de forma independente', saleB.status === 201, JSON.stringify(saleB.body));
} finally {
  controlDb.prepare('DELETE FROM tenants WHERE slug IN (?, ?)').run(slugA, slugB);
  fs.rmSync(path.join(__dirname, 'tenants', slugA), { recursive: true, force: true });
  fs.rmSync(path.join(__dirname, 'tenants', slugB), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
