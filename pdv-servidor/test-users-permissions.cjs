// Fase 7 (usuários/permissões/log): API-level, sem navegador. Cobre: (1)
// vendedor sem permissão nenhuma toma 403 nas telas restritas; (2) admin
// concede uma permissão específica e ela passa a valer, só pra aquela tela;
// (3) delegação de permissão por um vendedor com 'usuarios' é sempre
// clampada ao que ELE MESMO tem — nunca concede o que não possui, nem no
// cadastro nem na edição; (4) ninguém edita as próprias permissões, nem
// redefine a própria senha de admin sem SER admin; (5) não dá pra desativar
// o único admin ativo; (6) log de auditoria registra as ações e só quem tem
// 'logs' consegue ler; (7) excluir cliente exige a permissão 'deleteCustomer'
// especificamente.
const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return { cookie, status: res.status, user: body.user };
}

function api(cookie) {
  return async (path, opts = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(opts.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };
}

(async () => {
  const admin = await login('admin', 'admin123');
  check('login do admin funcionou', admin.status === 200, admin.status);
  const callAdmin = api(admin.cookie);

  // --- vendedor sem nenhuma permissão ---
  const v1Res = await callAdmin('/api/users', {
    method: 'POST',
    body: JSON.stringify({ nome: 'Vendedor Sem Permissão', username: 'vendedor1', password: 'senha123', permissions: {} }),
  });
  check('vendedor 1 criado (sem permissões)', v1Res.status === 201 && v1Res.body.user.role === 'vendedor', v1Res.status);
  const v1Login = await login('vendedor1', 'senha123');
  const callV1 = api(v1Login.cookie);

  const v1TriesFinance = await callV1('/api/finance');
  check('vendedor 1 (sem financeiro) toma 403 em Financeiro', v1TriesFinance.status === 403, v1TriesFinance.status);
  const v1TriesUsers = await callV1('/api/users');
  check('vendedor 1 (sem usuarios) toma 403 em Usuários', v1TriesUsers.status === 403, v1TriesUsers.status);
  const v1TriesAudit = await callV1('/api/audit');
  check('vendedor 1 (sem logs) toma 403 no log de auditoria', v1TriesAudit.status === 403, v1TriesAudit.status);

  // Admin concede só 'financeiro' — compras continua fechado
  const grantFinance = await callAdmin(`/api/users/${v1Res.body.user.id}`, {
    method: 'PUT', body: JSON.stringify({ permissions: { financeiro: true } }),
  });
  check('admin concede só "financeiro" ao vendedor 1', grantFinance.status === 200 && grantFinance.body.user.permissions.financeiro === true, grantFinance.body.user && grantFinance.body.user.permissions);
  const v1NowFinance = await callV1('/api/finance');
  check('vendedor 1 agora acessa Financeiro', v1NowFinance.status === 200, v1NowFinance.status);
  const v1StillNoCompras = await callV1('/api/purchases');
  check('vendedor 1 continua sem acesso a Compras (permissão diferente)', v1StillNoCompras.status === 403, v1StillNoCompras.status);

  // --- vendedor com 'usuarios' (delegação clampada) ---
  const v2Res = await callAdmin('/api/users', {
    method: 'POST',
    body: JSON.stringify({ nome: 'Vendedor Com Usuarios', username: 'vendedor2', password: 'senha123', permissions: { usuarios: true } }),
  });
  const v2Login = await login('vendedor2', 'senha123');
  const callV2 = api(v2Login.cookie);

  // vendedor2 tenta criar um usuário concedendo 'financeiro' e 'compras' —
  // nenhum dos dois deve colar, porque vendedor2 não tem nenhum dos dois.
  const v3ViaV2 = await callV2('/api/users', {
    method: 'POST',
    body: JSON.stringify({ nome: 'Vendedor Via V2', username: 'vendedor3', password: 'senha123', permissions: { financeiro: true, compras: true } }),
  });
  check('vendedor 2 (só com "usuarios") consegue criar conta nova', v3ViaV2.status === 201, v3ViaV2.status);
  check('delegação clampada: "financeiro" e "compras" NÃO foram concedidos (v2 não tem)', v3ViaV2.body.user.permissions.financeiro === false && v3ViaV2.body.user.permissions.compras === false, v3ViaV2.body.user && v3ViaV2.body.user.permissions);

  // vendedor2 não pode editar as próprias permissões
  const v2SelfEdit = await callV2(`/api/users/${v2Res.body.user.id}`, { method: 'PUT', body: JSON.stringify({ permissions: { financeiro: true } }) });
  check('vendedor 2 não pode editar as próprias permissões', v2SelfEdit.status === 400, v2SelfEdit.status);

  // vendedor2 tenta conceder 'financeiro' ao vendedor1 (que já tinha) — sem
  // ter 'financeiro' ele mesmo, a edição preserva o que já estava (true),
  // nunca é isto que prova a trava (precisa tentar RETIRAR sem ter, ou
  // conceder algo que o v1 não tinha ainda, tipo 'compras').
  const v2GrantComprasToV1 = await callV2(`/api/users/${v1Res.body.user.id}`, { method: 'PUT', body: JSON.stringify({ permissions: { financeiro: true, compras: true } }) });
  check('vendedor 2 edita vendedor 1 (tem "usuarios")', v2GrantComprasToV1.status === 200, v2GrantComprasToV1.status);
  check('mas "compras" continua false (v2 não tem "compras" pra repassar)', v2GrantComprasToV1.body.user.permissions.compras === false, v2GrantComprasToV1.body.user && v2GrantComprasToV1.body.user.permissions);
  check('"financeiro" continua true (preservado, v2 não tem mas já estava true)', v2GrantComprasToV1.body.user.permissions.financeiro === true, v2GrantComprasToV1.body.user && v2GrantComprasToV1.body.user.permissions);

  // --- redefinir senha do admin exige SER admin ---
  const v2ResetAdminPass = await callV2(`/api/users/${admin.user.id}/redefinir-senha`, { method: 'POST', body: JSON.stringify({ newPassword: 'hackeado123' }) });
  check('vendedor 2 (com "usuarios" mas não admin) não redefine senha do admin', v2ResetAdminPass.status === 400, v2ResetAdminPass.status);

  const v2ResetV1Pass = await callV2(`/api/users/${v1Res.body.user.id}/redefinir-senha`, { method: 'POST', body: JSON.stringify({ newPassword: 'novaSenha123' }) });
  check('vendedor 2 redefine a senha do vendedor 1 normalmente', v2ResetV1Pass.status === 200, v2ResetV1Pass.status);
  const v1LoginNewPass = await login('vendedor1', 'novaSenha123');
  check('vendedor 1 loga com a senha nova', v1LoginNewPass.status === 200, v1LoginNewPass.status);

  // --- não dá pra desativar o único admin ativo ---
  const deactivateAdmin = await callAdmin(`/api/users/${admin.user.id}/ativo`, { method: 'POST', body: JSON.stringify({ active: false }) });
  check('desativar o único admin ativo é rejeitado', deactivateAdmin.status === 400, deactivateAdmin.status);

  // --- log de auditoria ---
  const auditLog = await callAdmin('/api/audit');
  check('admin lê o log de auditoria', auditLog.status === 200 && auditLog.body.entries.length > 0, auditLog.status);
  check('log contém a criação do vendedor 1', auditLog.body.entries.some((e) => e.action === 'Cadastro de usuário' && e.entityId === v1Res.body.user.id), true);
  check('log contém um login', auditLog.body.entries.some((e) => e.action === 'Login'), true);

  // --- excluir cliente exige 'deleteCustomer' especificamente ---
  const customerRes = await callAdmin('/api/customers', { method: 'POST', body: JSON.stringify({ nome: 'Cliente pra excluir' }) });
  const v1DeleteNoPerm = await callV1(`/api/customers/${customerRes.body.customer.id}`, { method: 'DELETE' });
  check('vendedor 1 (sem deleteCustomer) não exclui cliente', v1DeleteNoPerm.status === 403, v1DeleteNoPerm.status);
  await callAdmin(`/api/users/${v1Res.body.user.id}`, { method: 'PUT', body: JSON.stringify({ permissions: { financeiro: true, deleteCustomer: true } }) });
  const v1DeleteWithPerm = await callV1(`/api/customers/${customerRes.body.customer.id}`, { method: 'DELETE' });
  check('vendedor 1 (com deleteCustomer) exclui cliente', v1DeleteWithPerm.status === 200, v1DeleteWithPerm.status);

  console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
