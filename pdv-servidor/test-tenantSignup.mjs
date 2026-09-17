// Etapa 9 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): prova
// do cadastro self-service — POST /api/signup provisiona uma loja de
// verdade (mesma createNewTenant que a CLI usa), GET /api/signup/check-slug
// dá feedback em tempo real, trava de taxa por IP funciona, e — o mais
// importante — o domínio-base (cadastro) nunca vaza pra dentro do
// pipeline de uma loja nem do painel, e vice-versa.
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

const { controlDb } = await import('./control/db.js');

const suffix = Date.now();
const slug = `signup-${suffix}`;
const createdSlugs = [slug];

try {
  // --- Verificação de slug em tempo real ---
  const checkFree = await request(DOMAIN, { reqPath: `/api/signup/check-slug/${slug}` });
  check('check-slug de um slug livre retorna available:true', checkFree.status === 200 && checkFree.body.available === true, JSON.stringify(checkFree.body));

  const checkReserved = await request(DOMAIN, { reqPath: '/api/signup/check-slug/admin' });
  check('check-slug rejeita palavra reservada ("admin")', checkReserved.body.available === false, JSON.stringify(checkReserved.body));

  const checkInvalidFormat = await request(DOMAIN, { reqPath: '/api/signup/check-slug/A_B' });
  check('check-slug rejeita formato inválido (maiúscula/underscore)', checkInvalidFormat.body.available === false, JSON.stringify(checkInvalidFormat.body));

  // --- Cadastro em si ---
  const missingFields = await request(DOMAIN, { method: 'POST', reqPath: '/api/signup', body: { slug, razaoSocial: '', nomeFantasia: '' } });
  check('cadastro sem razão social/nome fantasia é rejeitado (400)', missingFields.status === 400, JSON.stringify(missingFields.body));

  const signup = await request(DOMAIN, {
    method: 'POST', reqPath: '/api/signup',
    body: { slug, razaoSocial: 'Loja Cadastro Próprio LTDA', nomeFantasia: 'Loja Cadastro Próprio' },
  });
  check('cadastro com dados válidos funciona (201)', signup.status === 201 && signup.body.slug === slug, JSON.stringify(signup.body));
  check('resposta do cadastro traz a credencial padrão (admin/admin123, troca obrigatória)', signup.body.loginHint?.username === 'admin' && signup.body.loginHint?.mustChangePassword === true, JSON.stringify(signup.body.loginHint));

  const dupSlug = await request(DOMAIN, {
    method: 'POST', reqPath: '/api/signup',
    body: { slug, razaoSocial: 'Outra Loja LTDA', nomeFantasia: 'Outra Loja' },
  });
  check('cadastrar o MESMO slug de novo é rejeitado (400, já existe)', dupSlug.status === 400, JSON.stringify(dupSlug.body));

  const checkNowTaken = await request(DOMAIN, { reqPath: `/api/signup/check-slug/${slug}` });
  check('check-slug do slug recém-criado agora mostra indisponível', checkNowTaken.body.available === false, JSON.stringify(checkNowTaken.body));

  // --- A loja criada pelo cadastro funciona de verdade (login real) ---
  const hostNew = `${slug}.${DOMAIN}`;
  const loginNewTenant = await request(hostNew, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login com a credencial padrão na loja recém-criada pelo cadastro funciona', loginNewTenant.status === 200, loginNewTenant.status);

  // --- Isolamento simétrico: domínio-base nunca vaza pra loja nem painel, e vice-versa ---
  const storeApiFromSignupHost = await request(DOMAIN, { reqPath: '/api/products' });
  check('rota de loja (/api/products) NÃO é alcançável pelo domínio-base (404)', storeApiFromSignupHost.status === 404, storeApiFromSignupHost.status);

  const signupApiFromStoreHost = await request(hostNew, { method: 'POST', reqPath: '/api/signup', body: { slug: `outro-${suffix}`, razaoSocial: 'X', nomeFantasia: 'X' } });
  check('rota de cadastro (/api/signup) NÃO é alcançável por um Host de loja (404)', signupApiFromStoreHost.status === 404, signupApiFromStoreHost.status);

  const signupApiFromAdminHost = await request(`admin.${DOMAIN}`, { method: 'POST', reqPath: '/api/signup', body: { slug: `outro2-${suffix}`, razaoSocial: 'X', nomeFantasia: 'X' } });
  check('rota de cadastro (/api/signup) NÃO é alcançável pelo Host do painel (404)', signupApiFromAdminHost.status === 404, signupApiFromAdminHost.status);

  const adminApiFromSignupHost = await request(DOMAIN, { reqPath: '/api/admin/tenants' });
  check('rota do painel (/api/admin/tenants) NÃO é alcançável pelo domínio-base (404)', adminApiFromSignupHost.status === 404, adminApiFromSignupHost.status);

  // --- Trava de taxa por IP ---
  let rateLimited = false;
  for (let i = 0; i < 8; i++) {
    const attemptSlug = `rate-${suffix}-${i}`;
    const res = await request(DOMAIN, { method: 'POST', reqPath: '/api/signup', body: { slug: attemptSlug, razaoSocial: `Rate ${i}`, nomeFantasia: `Rate ${i}` } });
    if (res.status === 201) createdSlugs.push(attemptSlug);
    if (res.status === 429) { rateLimited = true; break; }
  }
  check('depois de várias tentativas seguidas, a trava de taxa por IP entra em ação (429)', rateLimited);
} finally {
  for (const s of createdSlugs) {
    controlDb.prepare('DELETE FROM tenants WHERE slug = ?').run(s);
    fs.rmSync(path.join(__dirname, 'tenants', s), { recursive: true, force: true });
  }
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
