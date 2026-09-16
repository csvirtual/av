// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): prova
// do painel de Super Admin — CLI de seed (scripts/seedPlatformAdmin.js),
// login/logout/me (routes/admin/auth.js), listar/mudar status de lojas
// (routes/admin/tenants.js) — e, principalmente, que o subdomínio
// admin.<MULTI_TENANT_DOMAIN> nunca vaza pra dentro do pipeline de uma
// loja (nem o contrário): sessão de admin não autentica como loja, sessão
// de loja não autentica como admin, e nenhuma rota de loja (/api/*) é
// alcançável pelo Host do painel.
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

const { seedPlatformAdmin } = await import('./scripts/seedPlatformAdmin.js');
const { createNewTenant } = await import('./scripts/createTenant.js');
const { controlDb } = await import('./control/db.js');
const Database = (await import('better-sqlite3')).default;

const suffix = Date.now();
const adminUsername = `super-${suffix}`;
const adminPassword = 'senha-super-admin-123';
await seedPlatformAdmin(adminUsername, adminPassword);

const slugA = `panel-a-${suffix}`;
const tenantA = await createNewTenant(slugA, 'Painel Tenant A', 'Painel Tenant A');
{
  const tdb = new Database(tenantA.dbPath);
  const row = tdb.prepare("SELECT * FROM users WHERE username_lower = 'admin'").get();
  const data = JSON.parse(row.data);
  data.mustChangePassword = false;
  tdb.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id);
  tdb.close();
}
const hostA = `${slugA}.${DOMAIN}`;

try {
  // --- Login no painel ---
  const badLogin = await request(ADMIN_HOST, { method: 'POST', reqPath: '/api/admin/login', body: { username: adminUsername, password: 'senha-errada' } });
  check('login do painel com senha errada é rejeitado (401)', badLogin.status === 401, badLogin.status);

  const login = await request(ADMIN_HOST, { method: 'POST', reqPath: '/api/admin/login', body: { username: adminUsername, password: adminPassword } });
  check('login do painel com credenciais certas funciona', login.status === 200, login.status);
  const adminCookie = login.cookie;

  const me = await request(ADMIN_HOST, { reqPath: '/api/admin/me', cookie: adminCookie });
  check('GET /api/admin/me reconhece a sessão do painel', me.status === 200 && me.body.admin?.username === adminUsername, JSON.stringify(me.body));

  const meNoCookie = await request(ADMIN_HOST, { reqPath: '/api/admin/me' });
  check('GET /api/admin/me sem cookie retorna 401', meNoCookie.status === 401, meNoCookie.status);

  // --- Listar/mudar lojas ---
  const listNoAuth = await request(ADMIN_HOST, { reqPath: '/api/admin/tenants' });
  check('listar lojas sem sessão retorna 401', listNoAuth.status === 401, listNoAuth.status);

  const list = await request(ADMIN_HOST, { reqPath: '/api/admin/tenants', cookie: adminCookie });
  check('listar lojas com sessão funciona e inclui a loja de teste', list.status === 200 && list.body.tenants?.some((t) => t.slug === slugA), JSON.stringify(list.body.tenants?.map((t) => t.slug)));

  const suspend = await request(ADMIN_HOST, { method: 'POST', reqPath: `/api/admin/tenants/${slugA}/status`, cookie: adminCookie, body: { status: 'suspenso' } });
  check('suspender loja A pelo painel funciona', suspend.status === 200 && suspend.body.tenant?.status === 'suspenso', JSON.stringify(suspend.body));

  const blockedA = await request(hostA, { reqPath: '/api/status' });
  check('loja A suspensa pelo painel fica bloqueada (403) na hora, sem reiniciar', blockedA.status === 403, blockedA.status);

  const reactivate = await request(ADMIN_HOST, { method: 'POST', reqPath: `/api/admin/tenants/${slugA}/status`, cookie: adminCookie, body: { status: 'ativo', expiresAt: 'null' } });
  check('reativar loja A pelo painel funciona', reactivate.status === 200 && reactivate.body.tenant?.status === 'ativo', JSON.stringify(reactivate.body));

  const unblockedA = await request(hostA, { reqPath: '/api/status' });
  check('loja A reativada volta a responder (200)', unblockedA.status === 200, unblockedA.status);

  const invalidStatus = await request(ADMIN_HOST, { method: 'POST', reqPath: `/api/admin/tenants/${slugA}/status`, cookie: adminCookie, body: { status: 'nao-existe' } });
  check('status inválido é rejeitado (400)', invalidStatus.status === 400, JSON.stringify(invalidStatus.body));

  // --- Isolamento: painel nunca vaza pra loja, nem o contrário ---
  const storeApiFromAdminHost = await request(ADMIN_HOST, { reqPath: '/api/products', cookie: adminCookie });
  check('rota de loja (/api/products) NÃO é alcançável pelo Host do painel (404)', storeApiFromAdminHost.status === 404, storeApiFromAdminHost.status);

  const adminApiFromStoreHost = await request(hostA, { reqPath: '/api/admin/tenants', cookie: adminCookie });
  check('rota do painel (/api/admin/tenants) NÃO é alcançável pelo Host de uma loja (404)', adminApiFromStoreHost.status === 404, adminApiFromStoreHost.status);

  const loginStore = await request(hostA, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login normal da loja A continua funcionando', loginStore.status === 200, loginStore.status);
  const storeCookie = loginStore.cookie;

  const meWithStoreCookie = await request(ADMIN_HOST, { reqPath: '/api/admin/me', cookie: storeCookie });
  check('cookie de sessão de LOJA enviado ao painel não autentica como admin (401)', meWithStoreCookie.status === 401, meWithStoreCookie.status);

  const storeApiWithAdminCookie = await request(hostA, { reqPath: '/api/products', cookie: adminCookie });
  check('cookie de sessão do PAINEL enviado a uma loja não autentica como usuário dela (401)', storeApiWithAdminCookie.status === 401, storeApiWithAdminCookie.status);

  // --- Reaplicar o mesmo seed é idempotente (redefine senha, não duplica) ---
  await seedPlatformAdmin(adminUsername, 'outra-senha-valida-123');
  const oldPasswordLogin = await request(ADMIN_HOST, { method: 'POST', reqPath: '/api/admin/login', body: { username: adminUsername, password: adminPassword } });
  check('depois de reseedar, a senha ANTIGA para de funcionar', oldPasswordLogin.status === 401, oldPasswordLogin.status);
  const newPasswordLogin = await request(ADMIN_HOST, { method: 'POST', reqPath: '/api/admin/login', body: { username: adminUsername, password: 'outra-senha-valida-123' } });
  check('depois de reseedar, a senha NOVA funciona', newPasswordLogin.status === 200, newPasswordLogin.status);

  const logout = await request(ADMIN_HOST, { method: 'POST', reqPath: '/api/admin/logout', cookie: newPasswordLogin.cookie });
  check('logout do painel funciona', logout.status === 200, logout.status);
  const meAfterLogout = await request(ADMIN_HOST, { reqPath: '/api/admin/me', cookie: newPasswordLogin.cookie });
  check('sessão do painel invalidada depois do logout', meAfterLogout.status === 401, meAfterLogout.status);

  // --- Excluir loja (exige reconfirmar a senha do admin logado) ---
  // A senha do admin foi trocada pelo reseed acima — a partir daqui, a
  // senha "atual" é 'outra-senha-valida-123', não mais `adminPassword`.
  const currentAdminPassword = 'outra-senha-valida-123';

  const deleteNoAuth = await request(ADMIN_HOST, { method: 'DELETE', reqPath: `/api/admin/tenants/${slugA}` });
  check('excluir loja sem sessão retorna 401', deleteNoAuth.status === 401, deleteNoAuth.status);

  const deleteNoPassword = await request(ADMIN_HOST, { method: 'DELETE', reqPath: `/api/admin/tenants/${slugA}`, cookie: adminCookie });
  check('excluir loja sem informar senha é rejeitado (400)', deleteNoPassword.status === 400, JSON.stringify(deleteNoPassword.body));

  const deleteWrongPassword = await request(ADMIN_HOST, { method: 'DELETE', reqPath: `/api/admin/tenants/${slugA}`, cookie: adminCookie, body: { password: 'senha-errada-com-certeza' } });
  check('excluir loja com senha errada é rejeitado (400)', deleteWrongPassword.status === 400, JSON.stringify(deleteWrongPassword.body));

  const listStillThere = await request(ADMIN_HOST, { reqPath: '/api/admin/tenants', cookie: adminCookie });
  check('loja A continua na lista depois das tentativas com senha errada/faltando', listStillThere.body.tenants?.some((t) => t.slug === slugA), JSON.stringify(listStillThere.body.tenants?.map((t) => t.slug)));

  const deleteUnknown = await request(ADMIN_HOST, { method: 'DELETE', reqPath: `/api/admin/tenants/nao-existe-${suffix}`, cookie: adminCookie, body: { password: currentAdminPassword } });
  check('excluir loja inexistente (com senha certa) é rejeitado (400)', deleteUnknown.status === 400, JSON.stringify(deleteUnknown.body));

  const del = await request(ADMIN_HOST, { method: 'DELETE', reqPath: `/api/admin/tenants/${slugA}`, cookie: adminCookie, body: { password: currentAdminPassword } });
  check('excluir loja A pelo painel funciona (senha certa)', del.status === 200 && del.body.tenant?.slug === slugA, JSON.stringify(del.body));

  const listAfterDelete = await request(ADMIN_HOST, { reqPath: '/api/admin/tenants', cookie: adminCookie });
  check('loja excluída some da listagem', !listAfterDelete.body.tenants?.some((t) => t.slug === slugA), JSON.stringify(listAfterDelete.body.tenants?.map((t) => t.slug)));

  const blockedAfterDelete = await request(hostA, { reqPath: '/api/status' });
  check('loja excluída deixa de responder (404, resolveTenantRowFromHostname não acha mais)', blockedAfterDelete.status === 404, blockedAfterDelete.status);

  const { getTenantBySlug } = await import('./control/db.js');
  check('loja excluída some do banco de controle', getTenantBySlug(slugA) === null, getTenantBySlug(slugA));

  const tenantDirGone = !fs.existsSync(path.join(__dirname, 'tenants', slugA));
  const trashDirHasIt = fs.existsSync(path.join(__dirname, 'tenants', '_lixeira')) &&
    fs.readdirSync(path.join(__dirname, 'tenants', '_lixeira')).some((name) => name.startsWith(`${slugA}-`));
  check('pasta da loja saiu de tenants/<slug> e foi pra tenants/_lixeira (nunca apagada de verdade)', tenantDirGone && trashDirHasIt, `gone=${tenantDirGone} trashed=${trashDirHasIt}`);

  // --- Lixeira: listar e restaurar ---
  const lixeiraNoAuth = await request(ADMIN_HOST, { reqPath: '/api/admin/tenants/lixeira' });
  check('listar lixeira sem sessão retorna 401', lixeiraNoAuth.status === 401, lixeiraNoAuth.status);

  const lixeiraList = await request(ADMIN_HOST, { reqPath: '/api/admin/tenants/lixeira', cookie: adminCookie });
  const trashEntry = lixeiraList.body.trashed?.find((t) => t.slug === slugA);
  check('loja excluída aparece na lixeira', lixeiraList.status === 200 && !!trashEntry, JSON.stringify(lixeiraList.body.trashed));

  const restoreUnknown = await request(ADMIN_HOST, { method: 'POST', reqPath: `/api/admin/tenants/lixeira/${encodeURIComponent('nao-existe-' + suffix)}/restore`, cookie: adminCookie });
  check('restaurar entrada inexistente da lixeira é rejeitado (400)', restoreUnknown.status === 400, JSON.stringify(restoreUnknown.body));

  const restore = await request(ADMIN_HOST, { method: 'POST', reqPath: `/api/admin/tenants/lixeira/${encodeURIComponent(trashEntry.entry)}/restore`, cookie: adminCookie });
  check('restaurar loja A da lixeira funciona', restore.status === 200 && restore.body.tenant?.slug === slugA, JSON.stringify(restore.body));

  const listAfterRestore = await request(ADMIN_HOST, { reqPath: '/api/admin/tenants', cookie: adminCookie });
  check('loja restaurada volta a aparecer na listagem', listAfterRestore.body.tenants?.some((t) => t.slug === slugA), JSON.stringify(listAfterRestore.body.tenants?.map((t) => t.slug)));

  const unblockedAfterRestore = await request(hostA, { reqPath: '/api/status' });
  check('loja restaurada volta a responder (200)', unblockedAfterRestore.status === 200, unblockedAfterRestore.status);

  const lixeiraAfterRestore = await request(ADMIN_HOST, { reqPath: '/api/admin/tenants/lixeira', cookie: adminCookie });
  check('loja restaurada some da lixeira', !lixeiraAfterRestore.body.trashed?.some((t) => t.slug === slugA), JSON.stringify(lixeiraAfterRestore.body.trashed));
} finally {
  controlDb.prepare('DELETE FROM platform_admins WHERE username_lower = ?').run(adminUsername.toLowerCase());
  controlDb.prepare('DELETE FROM tenants WHERE slug = ?').run(slugA);
  fs.rmSync(path.join(__dirname, 'tenants', slugA), { recursive: true, force: true });
  // A exclusão pelo painel move a pasta pra tenants/_lixeira/<slug>-<ts> em
  // vez de apagar (ver control/db.js#deleteTenant) — limpa também esses
  // restos daqui, senão a lixeira acumula lixo de teste a cada rodada.
  const lixeiraDir = path.join(__dirname, 'tenants', '_lixeira');
  if (fs.existsSync(lixeiraDir)) {
    for (const name of fs.readdirSync(lixeiraDir)) {
      if (name.startsWith(`${slugA}-`)) fs.rmSync(path.join(lixeiraDir, name), { recursive: true, force: true });
    }
  }
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
