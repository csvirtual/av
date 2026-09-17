// Etapa 3 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): o
// middleware de resolução por Host em server.js. Só faz sentido rodar
// contra um servidor iniciado COM a variável MULTI_TENANT_DOMAIN definida
// — sem ela o middleware nem entra em ação (mesmo comportamento de
// sempre), e nenhum destes cenários (404 por slug desconhecido, etc.)
// existe. Diferente dos outros test-*.cjs, usa node:http puro (não
// fetch()) porque precisa mandar um cabeçalho Host arbitrário — o Fetch
// padrão bloqueia isso de propósito.
//
// Uso:
//   MULTI_TENANT_DOMAIN=pdv-csvirtual.com.br PORT=3131 ALLOW_TEST_PAGES=1 node server.js &
//   node test-tenantResolver.mjs
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
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const { createNewTenant } = await import('./scripts/createTenant.js');
const { controlDb } = await import('./control/db.js');

const suffix = Date.now();
const slugA = `resolver-a-${suffix}`;
const slugB = `resolver-b-${suffix}`;
await createNewTenant(slugA, 'Resolver A', 'Resolver A');
await createNewTenant(slugB, 'Resolver B', 'Resolver B');

try {
  const okA = await rawRequest(`${slugA}.${DOMAIN}`);
  check(`Host de tenant conhecido (${slugA}) responde normalmente`, okA.status === 200, okA.status);

  const okB = await rawRequest(`${slugB}.${DOMAIN}`);
  check(`Host de outro tenant conhecido (${slugB}) responde normalmente`, okB.status === 200, okB.status);

  const unknown = await rawRequest(`nao-existe-${suffix}.${DOMAIN}`);
  check('Host de slug desconhecido (mas dentro do domínio) dá 404', unknown.status === 404, unknown.status);

  const wrongDomain = await rawRequest(`${slugA}.outrodominio.com`);
  check('Host fora do domínio configurado dá 404 (nunca cai num tenant por acidente)', wrongDomain.status === 404, wrongDomain.status);

  const bareDomain = await rawRequest(DOMAIN);
  check('Host igual ao domínio-base, sem nenhum subdomínio, dá 404', bareDomain.status === 404, bareDomain.status);

  // A resolução acontece ANTES de tudo — inclusive de servir os arquivos
  // estáticos (mesmo html/css/js) — então um Host desconhecido também não
  // consegue baixar a própria página de login.
  const staticUnknown = await rawRequest(`nao-existe-${suffix}.${DOMAIN}`, '/');
  check('Host desconhecido também não consegue carregar a página (nem estático escapa do gate)', staticUnknown.status === 404, staticUnknown.status);
} finally {
  controlDb.prepare('DELETE FROM tenants WHERE slug IN (?, ?)').run(slugA, slugB);
  fs.rmSync(path.join(__dirname, 'tenants', slugA), { recursive: true, force: true });
  fs.rmSync(path.join(__dirname, 'tenants', slugB), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
