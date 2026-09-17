// Etapa 5 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): prova
// de isolamento pras rotas convertidas na fatia 5f — products.js (catálogo
// + movimentações de estoque) e users.js (vendedores/permissões). Dois
// tenants distintos, cada um com dado real gravado nas duas áreas,
// confirmando que tudo bate com o banco daquele tenant especificamente e
// nunca vaza pro outro.
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
const slugA = `pu-a-${suffix}`;
const slugB = `pu-b-${suffix}`;
const tenantA = await createNewTenant(slugA, 'ProdUser Tenant A', 'ProdUser Tenant A');
const tenantB = await createNewTenant(slugB, 'ProdUser Tenant B', 'ProdUser Tenant B');

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

try {
  const loginA = await request(hostA, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login no tenant A funciona', loginA.status === 200, loginA.status);
  const cookieA = loginA.cookie;

  const loginB = await request(hostB, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login no tenant B funciona', loginB.status === 200, loginB.status);
  const cookieB = loginB.cookie;

  // --- Produtos/estoque ---
  const barcode = `PU-${suffix}`;
  const createProductA = await request(hostA, { method: 'POST', reqPath: '/api/products', cookie: cookieA, body: { barcode, name: 'Produto ProdUser A', unit: 'un', price: 10, costPrice: 5 } });
  check('produto criado no tenant A', createProductA.status === 201, JSON.stringify(createProductA.body));
  const productA = createProductA.body.product;

  const listProductsA = await request(hostA, { reqPath: '/api/products', cookie: cookieA });
  check('produto aparece na listagem do tenant A', listProductsA.body.products?.some((p) => p.id === productA?.id));

  const listProductsB = await request(hostB, { reqPath: '/api/products', cookie: cookieB });
  check('produto do tenant A NÃO aparece na listagem do tenant B', !listProductsB.body.products?.some((p) => p.id === productA?.id));

  // mesmo código de barras deve ser livre em outro tenant (bancos separados)
  const createSameBarcodeB = await request(hostB, { method: 'POST', reqPath: '/api/products', cookie: cookieB, body: { barcode, name: 'Produto ProdUser B', unit: 'un', price: 20, costPrice: 8 } });
  check('mesmo código de barras é aceito no tenant B (bancos independentes)', createSameBarcodeB.status === 201, JSON.stringify(createSameBarcodeB.body));

  const movementFromB = await request(hostB, {
    method: 'POST', reqPath: `/api/products/${productA?.id}/movimentos`, cookie: cookieB,
    body: { qty: 5, type: 'ajuste', dedupeKey: `dk-mov-crossb-${suffix}` },
  });
  check('ajustar estoque do produto do tenant A pelo tenant B falha (produto não encontrado)', movementFromB.status === 400 && /não encontrado/i.test(movementFromB.body.error || ''), JSON.stringify(movementFromB.body));

  const movementOwnA = await request(hostA, {
    method: 'POST', reqPath: `/api/products/${productA?.id}/movimentos`, cookie: cookieA,
    body: { qty: 15, type: 'ajuste', dedupeKey: `dk-mov-owna-${suffix}` },
  });
  check('ajustar estoque do próprio produto no tenant A funciona', movementOwnA.status === 201 && movementOwnA.body.product?.quantity === 15, JSON.stringify(movementOwnA.body));

  // --- Usuários/permissões ---
  const createUserA = await request(hostA, { method: 'POST', reqPath: '/api/users', cookie: cookieA, body: { nome: 'Vendedor A', username: `vendedor-pu-${suffix}`, password: 'senha1234', permissions: {} } });
  check('vendedor criado no tenant A', createUserA.status === 201, JSON.stringify(createUserA.body));
  const userA = createUserA.body.user;

  const listUsersA = await request(hostA, { reqPath: '/api/users', cookie: cookieA });
  check('vendedor aparece na listagem do tenant A', listUsersA.body.users?.some((u) => u.id === userA?.id));

  const listUsersB = await request(hostB, { reqPath: '/api/users', cookie: cookieB });
  check('vendedor do tenant A NÃO aparece na listagem do tenant B', !listUsersB.body.users?.some((u) => u.id === userA?.id));

  // mesmo username deve ser livre em outro tenant
  const createSameUsernameB = await request(hostB, { method: 'POST', reqPath: '/api/users', cookie: cookieB, body: { nome: 'Vendedor B', username: `vendedor-pu-${suffix}`, password: 'senha1234', permissions: {} } });
  check('mesmo username é aceito no tenant B (bancos independentes)', createSameUsernameB.status === 201, JSON.stringify(createSameUsernameB.body));

  const deactivateFromB = await request(hostB, { method: 'POST', reqPath: `/api/users/${userA?.id}/ativo`, cookie: cookieB, body: { active: false } });
  check('desativar usuário do tenant A pelo tenant B falha (usuário não encontrado)', deactivateFromB.status === 400 && /não encontrado/i.test(deactivateFromB.body.error || ''), JSON.stringify(deactivateFromB.body));

  const cookieCrossCheck = await request(hostB, { reqPath: '/api/users', cookie: cookieA });
  check('cookie do tenant A enviado ao Host do tenant B não autentica (401)', cookieCrossCheck.status === 401, cookieCrossCheck.status);
} finally {
  controlDb.prepare('DELETE FROM tenants WHERE slug IN (?, ?)').run(slugA, slugB);
  fs.rmSync(path.join(__dirname, 'tenants', slugA), { recursive: true, force: true });
  fs.rmSync(path.join(__dirname, 'tenants', slugB), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
