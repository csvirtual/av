// Etapa 5b do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// primeira prova PONTA A PONTA com rotas de negócio de verdade (auth +
// company + license, convertidas nesta fatia pra usar req.db). Provisiona
// dois tenants reais, faz login como o admin de CADA UM pelo Host certo, e
// confirma que a sessão de A nunca autentica em B, e que os dados de
// empresa lidos por cada um são exclusivamente os dele — a prova de
// isolamento que a etapa 4 documentou como "só possível depois da etapa 5"
// começa a valer aqui, pela primeira rota convertida.
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
const slugA = `auth-a-${suffix}`;
const slugB = `auth-b-${suffix}`;
const tenantA = await createNewTenant(slugA, 'Auth Tenant A', 'Auth Tenant A');
const tenantB = await createNewTenant(slugB, 'Auth Tenant B', 'Auth Tenant B');

// admin nasce com mustChangePassword=true — destrava direto no banco de
// cada um, igual ao padrão já usado nos outros testes desta suíte contra
// um servidor de verdade.
for (const t of [tenantA, tenantB]) {
  const tdb = new Database(t.dbPath);
  const row = tdb.prepare("SELECT * FROM users WHERE username_lower = 'admin'").get();
  const data = JSON.parse(row.data);
  data.mustChangePassword = false;
  tdb.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id);
  tdb.close();
}

// dá um nome fantasia diferente pra cada loja, direto no PUT /api/company
// de cada uma, pra depois confirmar que GET só devolve o da própria loja.
const hostA = `${slugA}.${DOMAIN}`;
const hostB = `${slugB}.${DOMAIN}`;

try {
  const loginA = await request(hostA, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  const loginB = await request(hostB, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login como admin da loja A funciona', loginA.status === 200, loginA.status);
  check('login como admin da loja B funciona', loginB.status === 200, loginB.status);
  check('cookie de sessão de A é diferente do de B', loginA.cookie && loginB.cookie && loginA.cookie !== loginB.cookie);

  const patchA = await request(hostA, {
    method: 'PUT', reqPath: '/api/company', cookie: loginA.cookie,
    body: {
      cnpj: '11.444.777/0001-61', razaoSocial: 'Loja A LTDA', nomeFantasia: 'Loja A', telefone: '(11) 90000-0001',
      endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', cep: '01000-000' },
    },
  });
  const patchB = await request(hostB, {
    method: 'PUT', reqPath: '/api/company', cookie: loginB.cookie,
    body: {
      cnpj: '11.222.333/0001-81', razaoSocial: 'Loja B LTDA', nomeFantasia: 'Loja B', telefone: '(11) 90000-0002',
      endereco: { logradouro: 'Rua B', numero: '2', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', cep: '02000-000' },
    },
  });
  check('PUT /api/company da loja A aceito', patchA.status === 200, JSON.stringify(patchA.body));
  check('PUT /api/company da loja B aceito', patchB.status === 200, JSON.stringify(patchB.body));

  const getA = await request(hostA, { reqPath: '/api/company', cookie: loginA.cookie });
  const getB = await request(hostB, { reqPath: '/api/company', cookie: loginB.cookie });
  check('GET /api/company da loja A devolve o nome fantasia dela', getA.body.nomeFantasia === 'Loja A', getA.body.nomeFantasia);
  check('GET /api/company da loja B devolve o nome fantasia dela (não o de A)', getB.body.nomeFantasia === 'Loja B', getB.body.nomeFantasia);

  // O cookie de sessão é host-only (sem Domain wildcard) — o navegador já
  // garante isso sozinho; aqui simulamos o "e se alguém tentasse mandar o
  // cookie de A pro Host de B na mão" pra confirmar que MESMO NESSE caso
  // o servidor nunca mistura: a sessão de A resolve o USUÁRIO de A contra
  // o BANCO de B (porque req.db vem do Host, não do cookie), então o
  // usuário simplesmente não existe lá — trata como não-autenticado.
  const crossHostAttempt = await request(hostB, { reqPath: '/api/auth/me', cookie: loginA.cookie });
  check('cookie de A enviado pro Host de B nunca autentica como um usuário de B', crossHostAttempt.status === 401, crossHostAttempt.status);

  const meA = await request(hostA, { reqPath: '/api/auth/me', cookie: loginA.cookie });
  check('GET /api/auth/me com o Host e cookie certos continua funcionando normalmente', meA.status === 200 && meA.body.user?.username === 'admin', meA.status);
} finally {
  controlDb.prepare('DELETE FROM tenants WHERE slug IN (?, ?)').run(slugA, slugB);
  fs.rmSync(path.join(__dirname, 'tenants', slugA), { recursive: true, force: true });
  fs.rmSync(path.join(__dirname, 'tenants', slugB), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
