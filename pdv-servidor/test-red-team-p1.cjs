// Passada 2 (Remediation) da auditoria adversarial de pré-lançamento: prova
// de regressão pros 5 achados P0/P1 confirmados na Passada 1 (Red Team) —
// cada um foi reproduzido de verdade primeiro (curl/fetch direto, fora da
// tela), corrigido, e este arquivo é o "não quebra mais" formal, no mesmo
// estilo de test-security.cjs (API-level, sem navegador).
//
// Cobre: (1) licença expirada bloqueia toda rota /api, mesmo com sessão já
// logada; (2) venda/estorno/recebimento de compra gravam em
// stock_movements (ledger de estoque completo, reconstrutível); (3)
// whitelist de método de pagamento em vendas; (4) pagamento negativo
// rejeitado; (5) fechamento de caixa exige senha de verdade no servidor;
// (6) limite de crédito de fiado reconferido de verdade no servidor (era
// só aviso de tela), inclusive sob concorrência real; (7) whitelist de
// paymentMethod em contas a pagar/receber (finance.js) e pagamento de
// fiado (customers.js).
const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function rawLogin(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, cookie: res.headers.get('set-cookie')?.split(';')[0] };
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

const dedupeKey = (label) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

(async () => {
  const adminLogin = await rawLogin('admin', 'admin123');
  check('login do admin funcionou', adminLogin.status === 200, adminLogin.status);
  const callAdmin = api(adminLogin.cookie);

  // Produto + estoque inicial pra usar nos testes de venda/estorno/pagamento.
  const prodRes = await callAdmin('/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: 'REDTEAM-P1-001', name: 'Produto Red Team P1', unit: 'un', price: 100, costPrice: 50 }),
  });
  const productId = prodRes.body.product?.id;
  check('produto de teste criado', prodRes.status === 201 && !!productId, prodRes.status);
  await callAdmin(`/api/products/${productId}/movimentos`, {
    method: 'POST', body: JSON.stringify({ type: 'ajuste', qty: 50, note: 'inicial', dedupeKey: dedupeKey('init') }),
  });

  // --- (2) e (3) e (4): venda ---
  const badMethodRes = await callAdmin('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId, qty: 1 }], payments: [{ method: 'Bitcoin', amount: 100 }],
      userName: 'admin', dedupeKey: dedupeKey('badmethod'),
    }),
  });
  check(
    'servidor REJEITA método de pagamento inventado ("Bitcoin") — achado P1 Red Team',
    badMethodRes.status === 400 && /forma de pagamento inválida/i.test(badMethodRes.body.error || ''),
    JSON.stringify(badMethodRes),
  );

  const negativePayRes = await callAdmin('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId, qty: 1 }],
      payments: [{ method: 'Dinheiro', amount: 110 }, { method: 'Pix', amount: -10 }],
      userName: 'admin', dedupeKey: dedupeKey('negpay'),
    }),
  });
  check(
    'servidor REJEITA pagamento negativo escondido dentro da soma (110 + -10 = 100) — achado P1 Red Team',
    negativePayRes.status === 400 && /não pode ser negativo/i.test(negativePayRes.body.error || ''),
    JSON.stringify(negativePayRes),
  );

  const saleRes = await callAdmin('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId, qty: 5 }], payments: [{ method: 'Dinheiro', amount: 500 }],
      userName: 'admin', dedupeKey: dedupeKey('normalsale'),
    }),
  });
  check('venda normal (Dinheiro) continua funcionando depois das validações novas', saleRes.status === 201, saleRes.status);
  const saleId = saleRes.body.sale?.id;

  const refundRes = await callAdmin(`/api/sales/${saleId}/refund`, {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId, itemIndex: 0, qty: 2 }], reason: 'teste de regressão', userName: 'admin', dedupeKey: dedupeKey('refund') }),
  });
  check('estorno continua funcionando', refundRes.status === 200, refundRes.status);

  // --- (2): ledger de estoque completo — reconstrói via stock_movements
  // sozinho (sem precisar combinar com a tabela `sales`) e compara com
  // product.quantity, que é exatamente o RECONCILIATOR da Fase 35 pedido
  // na auditoria, só que embutido no teste de regressão.
  const productAfter = await callAdmin(`/api/products/${productId}`);
  const movsRes = await callAdmin(`/api/products/${productId}/movimentos`);
  const movements = movsRes.body.movements || movsRes.body.items || [];
  const saleMovement = movements.find((m) => m.type === 'venda');
  const refundMovement = movements.find((m) => m.type === 'estorno');
  check('venda gravou um movimento em stock_movements (type=venda)', !!saleMovement && saleMovement.qty === -5, JSON.stringify(saleMovement));
  check('estorno gravou um movimento em stock_movements (type=estorno)', !!refundMovement && refundMovement.qty === 2, JSON.stringify(refundMovement));
  const reconstructed = movements.reduce((s, m) => s + m.qty, 0);
  check(
    'estoque reconstruído SÓ a partir de stock_movements bate com product.quantity (ledger completo, achado P1 Red Team)',
    reconstructed === productAfter.body.product.quantity,
    `reconstruído=${reconstructed} registrado=${productAfter.body.product.quantity}`,
  );

  // --- (5): fechamento de caixa exige senha de verdade no servidor ---
  const openRes = await callAdmin('/api/cash/open', {
    method: 'POST', body: JSON.stringify({ openingAmount: 100, terminalId: 'redteam-p1' }),
  });
  const sessionId = openRes.body.session?.id;
  check('abertura de caixa funcionou', openRes.status === 201 && !!sessionId, openRes.status);

  const closeNoPassRes = await callAdmin(`/api/cash/sessions/${sessionId}/fechar`, {
    method: 'POST', body: JSON.stringify({ countedAmounts: { Dinheiro: 100 } }),
  });
  check(
    'servidor REJEITA fechamento de caixa SEM nenhuma senha — achado P1 Red Team',
    closeNoPassRes.status === 400,
    JSON.stringify(closeNoPassRes),
  );

  const closeWrongPassRes = await callAdmin(`/api/cash/sessions/${sessionId}/fechar`, {
    method: 'POST', body: JSON.stringify({ countedAmounts: { Dinheiro: 100 }, confirmUsername: 'admin', confirmPassword: 'senhaErrada999' }),
  });
  check(
    'servidor REJEITA fechamento de caixa com senha ERRADA',
    closeWrongPassRes.status === 401,
    JSON.stringify(closeWrongPassRes),
  );

  const closeOkRes = await callAdmin(`/api/cash/sessions/${sessionId}/fechar`, {
    method: 'POST', body: JSON.stringify({ countedAmounts: { Dinheiro: 100 }, confirmUsername: 'admin', confirmPassword: 'admin123' }),
  });
  check('fechamento de caixa com senha CERTA funciona normalmente', closeOkRes.status === 200, closeOkRes.status);

  // --- (1): licença expirada bloqueia a API, mesmo com sessão já logada ---
  // Simula o trial expirado direto no banco (mesmo jeito que a Passada 1
  // reproduziu o achado original) — precisa do better-sqlite3 do PRÓPRIO
  // servidor (NODE_PATH), rodando neste mesmo processo de teste.
  const Database = require('better-sqlite3');
  const db = new Database('dados-da-loja.sqlite3');
  const stateRow = db.prepare("SELECT data FROM license_state WHERE id='state'").get();
  const state = stateRow ? JSON.parse(stateRow.data) : {};
  const originalTrialStartedAt = state.trialStartedAt;
  state.trialStartedAt = Date.now() - 8 * 24 * 60 * 60 * 1000; // trial é de 7 dias
  db.prepare("INSERT INTO license_state (id, data) VALUES ('state', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(JSON.stringify(state));

  const blockedRes = await callAdmin('/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: 'REDTEAM-LIC-BLOCK', name: 'Não deveria criar', unit: 'un', price: 1, costPrice: 1 }),
  });
  check(
    'servidor BLOQUEIA rota /api/* com sessão já logada quando a licença expira — achado P0 Red Team',
    blockedRes.status === 403 && blockedRes.body.licenseExpired === true,
    JSON.stringify(blockedRes),
  );

  const loginStillWorksRes = await rawLogin('admin', 'admin123');
  check('login continua funcionando mesmo com licença expirada (pra dar pra ativar uma chave nova)', loginStillWorksRes.status === 200, loginStillWorksRes.status);

  const statusStillWorksRes = await fetch(`${BASE}/api/license/status`);
  check('GET /api/license/status continua acessível mesmo bloqueado', statusStillWorksRes.status === 200, statusStillWorksRes.status);

  // Restaura o trial válido — não deixa o banco de teste "travado" pros
  // arquivos de teste seguintes na mesma bateria.
  state.trialStartedAt = originalTrialStartedAt ?? Date.now();
  db.prepare("INSERT INTO license_state (id, data) VALUES ('state', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(JSON.stringify(state));
  db.close();

  const unblockedRes = await callAdmin('/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: 'REDTEAM-LIC-UNBLOCK', name: 'Deveria criar de novo', unit: 'un', price: 1, costPrice: 1 }),
  });
  check('rota volta a funcionar normalmente depois da licença ser restaurada', unblockedRes.status === 201, unblockedRes.status);

  // --- (6): limite de crédito de fiado reconferido de verdade no servidor ---
  const fiadoProdRes = await callAdmin('/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: 'REDTEAM-FIADO-001', name: 'Produto Fiado Red Team', unit: 'un', price: 100, costPrice: 50 }),
  });
  const fiadoProductId = fiadoProdRes.body.product?.id;
  await callAdmin(`/api/products/${fiadoProductId}/movimentos`, {
    method: 'POST', body: JSON.stringify({ type: 'ajuste', qty: 50, note: 'inicial', dedupeKey: dedupeKey('fiado-prod-init') }),
  });
  const fiadoCustRes = await callAdmin('/api/customers', {
    method: 'POST', body: JSON.stringify({ nome: 'Cliente Fiado Red Team', creditLimit: 50 }),
  });
  const fiadoCustomerId = fiadoCustRes.body.customer?.id;
  check('cliente com limite de crédito (R$50) criado pro teste de fiado', fiadoCustRes.status === 201 && !!fiadoCustomerId, fiadoCustRes.status);

  const fiadoOverLimitRes = await callAdmin('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: fiadoProductId, qty: 5 }], payments: [{ method: 'Fiado', amount: 500 }],
      customerId: fiadoCustomerId, userName: 'admin', dedupeKey: dedupeKey('fiado-over-limit'),
    }),
  });
  check(
    'servidor REJEITA venda fiada acima do limite de crédito SEM confirmação — achado P1 Red Team',
    fiadoOverLimitRes.status === 400 && /acima do limite/i.test(fiadoOverLimitRes.body.error || ''),
    JSON.stringify(fiadoOverLimitRes),
  );

  const fiadoOverLimitConfirmedRes = await callAdmin('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: fiadoProductId, qty: 5 }], payments: [{ method: 'Fiado', amount: 500 }],
      customerId: fiadoCustomerId, fiadoLimitOverrideConfirmed: true, userName: 'admin', dedupeKey: dedupeKey('fiado-over-limit-confirmed'),
    }),
  });
  check(
    'venda fiada acima do limite COM confirmação explícita continua funcionando (mesmo comportamento de negócio de antes)',
    fiadoOverLimitConfirmedRes.status === 201,
    fiadoOverLimitConfirmedRes.status,
  );

  // Concorrência real: 2 vendas fiadas pro MESMO cliente (limite zerado
  // pelo estorno abaixo pra simplificar a conta), cada uma cabendo
  // isolada no limite, juntas não.
  const fiadoConcProdRes = await callAdmin('/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: 'REDTEAM-FIADO-CONC-001', name: 'Produto Fiado Concorrente Red Team', unit: 'un', price: 30, costPrice: 15 }),
  });
  const fiadoConcProductId = fiadoConcProdRes.body.product?.id;
  await callAdmin(`/api/products/${fiadoConcProductId}/movimentos`, {
    method: 'POST', body: JSON.stringify({ type: 'ajuste', qty: 10, note: 'inicial', dedupeKey: dedupeKey('fiado-conc-prod-init') }),
  });
  const fiadoConcCustRes = await callAdmin('/api/customers', {
    method: 'POST', body: JSON.stringify({ nome: 'Cliente Fiado Concorrente Red Team', creditLimit: 40 }),
  });
  const fiadoConcCustomerId = fiadoConcCustRes.body.customer?.id;
  const fiadoConcReqs = [1, 2].map((i) => fetch(`${BASE}/api/sales`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminLogin.cookie },
    body: JSON.stringify({
      items: [{ productId: fiadoConcProductId, qty: 1 }], payments: [{ method: 'Fiado', amount: 30 }],
      customerId: fiadoConcCustomerId, userName: 'admin', dedupeKey: dedupeKey('fiado-concurrent-' + i),
    }),
  }));
  const fiadoConcResults = await Promise.all(fiadoConcReqs);
  const fiadoConcStatuses = fiadoConcResults.map((r) => r.status);
  const fiadoConcSuccesses = fiadoConcStatuses.filter((s) => s === 201).length;
  check(
    'concorrência real: só 1 de 2 vendas fiadas (juntas estourando o limite, isoladas não) passa — sem double-spend do limite de crédito',
    fiadoConcSuccesses === 1,
    `status=${JSON.stringify(fiadoConcStatuses)}`,
  );
  const fiadoConcCustomerAfter = await callAdmin(`/api/customers/${fiadoConcCustomerId}`);
  check(
    'saldo devedor final bate exatamente com 1 venda (30), nunca as 2 juntas (60)',
    Math.abs(fiadoConcCustomerAfter.body.balance - 30) < 0.01,
    JSON.stringify(fiadoConcCustomerAfter.body),
  );

  // --- (7): whitelist de paymentMethod em finance.js/customers.js ---
  // Achado (Red Team, Passada 1): diferente de routes/sales.js, essas duas
  // rotas aceitavam paymentMethod sem nenhuma validação (objeto, string
  // gigante, HTML). Nunca deu pra manipular saldo com isso — `amount` é
  // sempre validado e clampado à parte — mas era um buraco real de
  // defesa em profundidade (dados não confiáveis armazenados sem checagem,
  // mesmo escapados na hora de renderizar). Corrigido com a mesma lista
  // que cada dropdown da tela mostra.
  const financeEntryRes = await callAdmin('/api/finance', {
    method: 'POST', body: JSON.stringify({ type: 'receber', description: 'Red Team paymentMethod', amount: 100, dueDate: Date.now() + 86400000 }),
  });
  const financeEntryId = financeEntryRes.body.entry?.id;
  const financeBadRes = await callAdmin(`/api/finance/${financeEntryId}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 10, paymentMethod: { evil: true }, dedupeKey: dedupeKey('finance-pm-obj') }),
  });
  check('finance.js rejeita paymentMethod fora da whitelist (objeto)', financeBadRes.status === 400, financeBadRes.status);
  const financeGoodRes = await callAdmin(`/api/finance/${financeEntryId}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 10, paymentMethod: 'Pix', dedupeKey: dedupeKey('finance-pm-ok') }),
  });
  check('finance.js aceita paymentMethod legítimo (Pix)', financeGoodRes.status === 201, financeGoodRes.status);

  const custPmRes = await callAdmin('/api/customers', { method: 'POST', body: JSON.stringify({ nome: 'Cliente Red Team paymentMethod' }) });
  const custPmId = custPmRes.body.customer?.id;
  const custPmSaleRes = await callAdmin('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId, qty: 1 }], payments: [{ method: 'Fiado', amount: 100 }],
      customerId: custPmId, userName: 'admin', dedupeKey: dedupeKey('cust-pm-sale'),
    }),
  });
  check('venda fiado pra testar paymentMethod de pagamento do cliente', custPmSaleRes.status === 201, custPmSaleRes.status);
  const custPmBadRes = await callAdmin(`/api/customers/${custPmId}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 10, paymentMethod: '<script>alert(1)</script>', dedupeKey: dedupeKey('cust-pm-xss') }),
  });
  check('customers.js rejeita paymentMethod fora da whitelist (XSS)', custPmBadRes.status === 400, custPmBadRes.status);
  const custPmGoodRes = await callAdmin(`/api/customers/${custPmId}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 10, paymentMethod: 'Dinheiro', dedupeKey: dedupeKey('cust-pm-ok') }),
  });
  check('customers.js aceita paymentMethod legítimo (Dinheiro)', custPmGoodRes.status === 201, custPmGoodRes.status);
  const custPmBalanceRes = await callAdmin(`/api/customers/${custPmId}`);
  check('saldo do cliente correto (100 - 10 = 90, ataques rejeitados não contaram)', Math.abs(custPmBalanceRes.body.balance - 90) < 0.01, custPmBalanceRes.body.balance);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
