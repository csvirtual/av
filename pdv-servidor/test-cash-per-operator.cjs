// Modo de caixa "por vendedor" (porOperador) — pedido do usuário: cada
// operador (admin ou vendedor) abre/fecha o PRÓPRIO caixa, em vez de um
// único caixa compartilhado. API-level, sem navegador, mesmo padrão de
// test-cash.cjs. Cobre: (1) dois operadores conseguem, cada um, ter seu
// próprio caixa aberto ao mesmo tempo; (2) um operador não mexe (sangria/
// suprimento/retificação/fechamento) no caixa de outro — 403; (3) admin
// pode mexer em qualquer caixa, mesmo não sendo o dono; (4) abrir um
// segundo caixa pro mesmo operador enquanto já tem um aberto é rejeitado.
const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : null;
  const body = await res.json().catch(() => ({}));
  return { cookie, body, status: res.status };
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
  const callAdmin = api(admin.cookie);

  await callAdmin('/api/cash/config', { method: 'PUT', body: JSON.stringify({ caixaMode: 'porOperador' }) });
  const configCheck = await callAdmin('/api/cash/config');
  check('modo "porOperador" salvo', configCheck.body.caixaMode === 'porOperador', configCheck.body.caixaMode);

  const suffix = Date.now();
  const u1 = `op1-${suffix}`;
  const u2 = `op2-${suffix}`;
  const createV1 = await callAdmin('/api/users', { method: 'POST', body: JSON.stringify({ nome: 'Operador Um', username: u1, password: 'senha123', permissions: {} }) });
  const createV2 = await callAdmin('/api/users', { method: 'POST', body: JSON.stringify({ nome: 'Operador Dois', username: u2, password: 'senha123', permissions: {} }) });
  check('vendedor 1 criado', createV1.status === 201, createV1.status);
  check('vendedor 2 criado', createV2.status === 201, createV2.status);

  const login1 = await login(u1, 'senha123');
  const login2 = await login(u2, 'senha123');
  const call1 = api(login1.cookie);
  const call2 = api(login2.cookie);

  // (1) cada um abre o próprio caixa, ao mesmo tempo
  const open1 = await call1('/api/cash/open', { method: 'POST', body: JSON.stringify({ openingAmount: 100 }) });
  const open2 = await call2('/api/cash/open', { method: 'POST', body: JSON.stringify({ openingAmount: 200 }) });
  check('operador 1 abriu seu próprio caixa', open1.status === 201, open1.status);
  check('operador 2 abriu seu próprio caixa (independente do 1)', open2.status === 201, open2.status);
  check('são sessões diferentes', open1.body.session && open2.body.session && open1.body.session.id !== open2.body.session.id);

  const view1 = await call1('/api/cash/open');
  const view2 = await call2('/api/cash/open');
  check('GET /open do operador 1 só mostra o dele (troco 100)', view1.body.session && view1.body.session.openingAmount === 100, view1.body.session && view1.body.session.openingAmount);
  check('GET /open do operador 2 só mostra o dele (troco 200)', view2.body.session && view2.body.session.openingAmount === 200, view2.body.session && view2.body.session.openingAmount);

  // (4) operador 1 tenta abrir de novo enquanto já tem um aberto
  const reopen1 = await call1('/api/cash/open', { method: 'POST', body: JSON.stringify({ openingAmount: 999 }) });
  check('operador 1 tentando abrir de novo (já tem o dele aberto) é rejeitado', reopen1.status === 400 && /você já tem um caixa aberto/i.test(reopen1.body.error), reopen1.body.error);

  const session1 = open1.body.session;
  const session2 = open2.body.session;

  // (2) operador 2 não mexe no caixa do operador 1
  const v2SangriaOnV1 = await call2(`/api/cash/sessions/${session1.id}/movimento`, {
    method: 'POST', body: JSON.stringify({ type: 'sangria', amount: 10, reason: 'Teste cross-operador', dedupeKey: 'dk-cross-' + suffix }),
  });
  check('operador 2 tentando sangria no caixa do operador 1 toma 403', v2SangriaOnV1.status === 403, v2SangriaOnV1.status);

  const v2CloseV1 = await call2(`/api/cash/sessions/${session1.id}/fechar`, {
    method: 'POST', body: JSON.stringify({ countedAmounts: {}, confirmUsername: u2, confirmPassword: 'senha123' }),
  });
  check('operador 2 tentando fechar o caixa do operador 1 toma 403', v2CloseV1.status === 403, v2CloseV1.status);

  // operador 1 mexe no próprio, normalmente
  const v1SangriaOwn = await call1(`/api/cash/sessions/${session1.id}/movimento`, {
    method: 'POST', body: JSON.stringify({ type: 'sangria', amount: 10, reason: 'Sangria normal', dedupeKey: 'dk-own-' + suffix }),
  });
  check('operador 1 registra sangria no próprio caixa normalmente', v1SangriaOwn.status === 201, v1SangriaOwn.status);

  // (3) admin pode mexer em qualquer caixa, mesmo não sendo o dono
  const adminSangriaOnV1 = await callAdmin(`/api/cash/sessions/${session1.id}/movimento`, {
    method: 'POST', body: JSON.stringify({ type: 'suprimento', amount: 5, reason: 'Admin cobre qualquer situação', dedupeKey: 'dk-admin-' + suffix }),
  });
  check('admin registra movimento no caixa do operador 1, mesmo não sendo o dono', adminSangriaOnV1.status === 201, adminSangriaOnV1.status);

  const adminCloseV2 = await callAdmin(`/api/cash/sessions/${session2.id}/fechar`, {
    method: 'POST', body: JSON.stringify({ countedAmounts: { Dinheiro: 200 }, confirmUsername: 'admin', confirmPassword: 'admin123' }),
  });
  check('admin fecha o caixa do operador 2 (esqueceu de fechar / foi embora)', adminCloseV2.status === 200, adminCloseV2.status);

  // operador 1 fecha o próprio, normalmente
  const v1CloseOwn = await call1(`/api/cash/sessions/${session1.id}/fechar`, {
    method: 'POST', body: JSON.stringify({ countedAmounts: { Dinheiro: 115 }, confirmUsername: u1, confirmPassword: 'senha123' }),
  });
  check('operador 1 fecha o próprio caixa normalmente', v1CloseOwn.status === 200, v1CloseOwn.status);

  // volta pro modo padrão pra não vazar estado pros outros testes
  await callAdmin('/api/cash/config', { method: 'PUT', body: JSON.stringify({ caixaMode: 'unico' }) });

  console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
