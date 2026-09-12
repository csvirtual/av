// Fase 3 (caixa): API-level, sem navegador — mesma ideia de
// test-sales-concurrency.cjs. Cobre: (1) modo "único" — 10 tentativas
// simultâneas de abrir só deixam 1 passar; (2) sangria/suprimento com
// idempotência; (3) fechamento com conta esperado x contado batendo certo;
// (4) modo "porTerminal" — dois terminais diferentes conseguem ter, cada um,
// seu próprio caixa aberto ao mesmo tempo, e um terceiro terminal tentando
// abrir onde já tem outro aberto (mesmo terminal) é rejeitado.
const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login(cookieJar) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const setCookie = res.headers.get('set-cookie');
  cookieJar.cookie = setCookie.split(';')[0];
  return res.json();
}

function api(cookieJar, terminalId) {
  return async (path, opts = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieJar.cookie,
        ...(terminalId ? { 'X-Terminal-Id': terminalId } : {}),
        ...(opts.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };
}

(async () => {
  const jar = {};
  await login(jar);
  const call = api(jar);

  // Garante modo "único" pra primeira leva de testes.
  await call('/api/cash/config', { method: 'PUT', body: JSON.stringify({ caixaMode: 'unico' }) });

  // fecha qualquer caixa que tenha ficado aberto de um teste anterior
  const openNow = await call('/api/cash/open');
  if (openNow.body.session) {
    await call(`/api/cash/sessions/${openNow.body.session.id}/fechar`, {
      method: 'POST', body: JSON.stringify({ countedAmounts: {}, confirmUsername: 'admin', confirmPassword: 'admin123' }),
    });
  }

  // (1) 10 aberturas simultâneas no modo único — só 1 pode vencer
  const attempts = await Promise.all(
    Array.from({ length: 10 }, () => call('/api/cash/open', { method: 'POST', body: JSON.stringify({ openingAmount: 100 }) }))
  );
  const opened = attempts.filter((a) => a.status === 201);
  const rejected = attempts.filter((a) => a.status === 400);
  check('exatamente 1 de 10 aberturas simultâneas venceu (modo único)', opened.length === 1 && rejected.length === 9, `abertas=${opened.length} rejeitadas=${rejected.length}`);
  check('as rejeitadas tiveram mensagem de caixa já aberto', rejected.every((r) => /já existe um caixa aberto/i.test(r.body.error)));

  const session = opened[0].body.session;
  check('sessão aberta com troco inicial 100', session.openingAmount === 100, session.openingAmount);

  // (2) sangria + suprimento, com idempotência
  const dk1 = 'dedupe-sangria-' + Date.now();
  const sangria = await call(`/api/cash/sessions/${session.id}/movimento`, {
    method: 'POST', body: JSON.stringify({ type: 'sangria', amount: 30, reason: 'Depósito no banco', dedupeKey: dk1 }),
  });
  check('sangria de 30 registrada', sangria.status === 201, sangria.status);
  const sangriaDup = await call(`/api/cash/sessions/${session.id}/movimento`, {
    method: 'POST', body: JSON.stringify({ type: 'sangria', amount: 30, reason: 'Depósito no banco', dedupeKey: dk1 }),
  });
  check('reenviar a mesma sangria (mesma dedupeKey) é rejeitado', sangriaDup.status === 409, sangriaDup.status);
  const suprimento = await call(`/api/cash/sessions/${session.id}/movimento`, {
    method: 'POST', body: JSON.stringify({ type: 'suprimento', amount: 20, reason: 'Reforço de troco', dedupeKey: 'dedupe-suprimento-' + Date.now() }),
  });
  check('suprimento de 20 registrado', suprimento.status === 201, suprimento.status);

  // faz uma venda em dinheiro pra entrar na conta do "esperado"
  await call('/api/products', { method: 'POST', body: JSON.stringify({ barcode: 'CASH-TEST-01', name: 'Item teste caixa', price: 50 }) });
  const productsRes = await call('/api/products');
  const product = productsRes.body.products.find((p) => p.barcode === 'CASH-TEST-01');
  await call(`/api/products/${product.id}/movimentos`, { method: 'POST', body: JSON.stringify({ type: 'ajuste', qty: 5, dedupeKey: 'dedupe-stock-cash-' + Date.now() }) });
  const sale = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 1, unitPrice: 50 }],
      payments: [{ method: 'Dinheiro', amount: 50 }],
      dedupeKey: 'dedupe-sale-cash-' + Date.now(),
    }),
  });
  check('venda em dinheiro registrada pra dentro do caixa aberto', sale.status === 201 && sale.body.sale.cashSessionId === session.id, sale.body.sale && sale.body.sale.cashSessionId);

  // esperado em Dinheiro: 100 (abertura) - 30 (sangria) + 20 (suprimento) + 50 (venda) = 140
  const preview = await call(`/api/cash/sessions/${session.id}`);
  check('prévia do esperado bate: 100-30+20+50=140', Math.abs(preview.body.expected.Dinheiro - 140) < 0.001, preview.body.expected.Dinheiro);

  // (3) fechamento com diferença de -5 (faltou dinheiro)
  const fechar = await call(`/api/cash/sessions/${session.id}/fechar`, {
    method: 'POST', body: JSON.stringify({ countedAmounts: { Dinheiro: 135 }, closingNotes: 'Teste automatizado', confirmUsername: 'admin', confirmPassword: 'admin123' }),
  });
  check('fechamento aceito', fechar.status === 200, fechar.status);
  check('diferença calculada certa (135-140=-5)', Math.abs(fechar.body.session.difference - (-5)) < 0.001, fechar.body.session.difference);
  check('status vira fechado', fechar.body.session.status === 'fechado', fechar.body.session.status);

  const reopenAttempt = await call('/api/cash/open');
  check('depois de fechado, /open não mostra mais sessão ativa', reopenAttempt.body.session === null, JSON.stringify(reopenAttempt.body.session));

  const fecharDeNovo = await call(`/api/cash/sessions/${session.id}/fechar`, {
    method: 'POST', body: JSON.stringify({ countedAmounts: {}, confirmUsername: 'admin', confirmPassword: 'admin123' }),
  });
  check('fechar um caixa já fechado é rejeitado', fecharDeNovo.status === 400, fecharDeNovo.status);

  // (4) modo "porTerminal" — dois terminais abrem ao mesmo tempo, cada um o seu
  await call('/api/cash/config', { method: 'PUT', body: JSON.stringify({ caixaMode: 'porTerminal' }) });
  const terminalA = 'term-A-' + Date.now();
  const terminalB = 'term-B-' + Date.now();
  const callA = api(jar, terminalA);
  const callB = api(jar, terminalB);

  const openA = await callA('/api/cash/open', { method: 'POST', body: JSON.stringify({ openingAmount: 50, terminalName: 'Caixa 1' }) });
  const openB = await callB('/api/cash/open', { method: 'POST', body: JSON.stringify({ openingAmount: 70, terminalName: 'Caixa 2' }) });
  check('terminal A abriu seu próprio caixa', openA.status === 201, openA.status);
  check('terminal B abriu seu próprio caixa (independente do A)', openB.status === 201, openB.status);
  check('são sessões diferentes', openA.body.session.id !== openB.body.session.id);

  const openAAgain = await callA('/api/cash/open', { method: 'POST', body: JSON.stringify({ openingAmount: 999 }) });
  check('terminal A tentando abrir de novo (já tem um aberto NELE) é rejeitado', openAAgain.status === 400 && /neste terminal/i.test(openAAgain.body.error), openAAgain.body.error);

  const openViewA = await callA('/api/cash/open');
  const openViewB = await callB('/api/cash/open');
  check('GET /open do terminal A só mostra a sessão do A (troco 50)', openViewA.body.session.openingAmount === 50, openViewA.body.session.openingAmount);
  check('GET /open do terminal B só mostra a sessão do B (troco 70)', openViewB.body.session.openingAmount === 70, openViewB.body.session.openingAmount);

  // limpa: fecha os dois caixas por-terminal abertos neste teste
  await callA(`/api/cash/sessions/${openA.body.session.id}/fechar`, { method: 'POST', body: JSON.stringify({ countedAmounts: {}, confirmUsername: 'admin', confirmPassword: 'admin123' }) });
  await callB(`/api/cash/sessions/${openB.body.session.id}/fechar`, { method: 'POST', body: JSON.stringify({ countedAmounts: {}, confirmUsername: 'admin', confirmPassword: 'admin123' }) });
  await call('/api/cash/config', { method: 'PUT', body: JSON.stringify({ caixaMode: 'unico' }) });

  console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
