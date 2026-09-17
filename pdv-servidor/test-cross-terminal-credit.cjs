// Prova o fechamento da lacuna de crédito de troca cross-terminal
// (documentada no README, achado de arquitetura do passo 8 da Fase 9):
// antes, o crédito gerado por um estorno ou resgate de pontos só ficava
// disponível como forma de pagamento no MESMO terminal/sessão que gerou —
// noutro terminal, só aparecia no extrato do cliente, nunca como opção
// automática de pagamento em views/sale.js. Único desvio deliberado do
// princípio "portar sem reescrever" de toda a Fase 9: views/sale.js
// passou a consultar data/loyaltyRepo.js#getCustomerCredit() (o saldo
// real de `store_credits`, no servidor) sempre que um cliente é
// selecionado, em vez de só o `pendingCredit` local (localStorage).
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-cross-terminal-credit.cjs` noutra.
const { chromium } = require('playwright');

const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login(page) {
  await page.goto(BASE);
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(600);
}

async function apiCall(page, path, opts = {}) {
  const res = await page.request.fetch(`${BASE}${path}`, {
    method: opts.method || 'GET',
    data: opts.body,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

async function pickCustomer(page, term) {
  await page.fill('#customer-search', term);
  await page.waitForTimeout(500);
  await page.click('[data-pick-customer]');
  await page.waitForTimeout(500);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const errorsA = [], errorsB = [];
  const trackErrors = (page, bucket) => {
    page.on('pageerror', (e) => bucket.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) bucket.push('console.error: ' + m.text()); });
    page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me')) bucket.push(`HTTP ${res.status()} ${res.url()}`); });
  };
  trackErrors(pageA, errorsA);
  trackErrors(pageB, errorsB);

  await login(pageA);
  await login(pageB);

  // ---------- Setup: produto, dois clientes, fidelidade ligada ----------
  const prod = (await apiCall(pageA, '/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: '7811111111111', name: 'Produto Credito', category: 'material', unit: 'un', price: 50, costPrice: 20, minStock: 1 }),
  })).body.product;
  await apiCall(pageA, `/api/products/${prod.id}/movimentos`, { method: 'POST', body: JSON.stringify({ type: 'entrada', qty: 50, note: 'estoque', dedupeKey: crypto.randomUUID() }) });

  const customerX = (await apiCall(pageA, '/api/customers', { method: 'POST', body: JSON.stringify({ nome: 'Cliente X Credito' }) })).body.customer;
  const customerY = (await apiCall(pageA, '/api/customers', { method: 'POST', body: JSON.stringify({ nome: 'Cliente Y Sem Credito' }) })).body.customer;

  await apiCall(pageA, '/api/loyalty/config', { method: 'PUT', body: JSON.stringify({ pointsPerReal: 1, redemptionRate: 10 }) });

  // ---------- Terminal A: venda + estorno com crédito pro Cliente X ----------
  const sale = (await apiCall(pageA, '/api/sales', {
    method: 'POST', body: JSON.stringify({ items: [{ productId: prod.id, qty: 1 }], payments: [{ method: 'Dinheiro', amount: 50 }], customerId: customerX.id, dedupeKey: crypto.randomUUID() }),
  })).body.sale;
  const refund = await apiCall(pageA, `/api/sales/${sale.id}/refund`, {
    method: 'POST', body: JSON.stringify({ items: [{ itemIndex: 0, productId: prod.id, qty: 1 }], reason: 'Cliente trocou de ideia', generateCredit: true, dedupeKey: crypto.randomUUID() }),
  });
  check('Estorno com geração de crédito de troca (Terminal A)', refund.status === 200, refund.status);

  const loyaltyAfterRefund = await apiCall(pageA, `/api/loyalty/${customerX.id}`);
  check('Servidor registra R$ 50 de crédito real pro Cliente X', loyaltyAfterRefund.body.credit === 50, loyaltyAfterRefund.body.credit);

  // ---------- Terminal B (outra sessão/contexto): NUNCA participou do estorno ----------
  await pageB.goto(`${BASE}/#/venda`);
  await pageB.waitForTimeout(700);
  let bannerText = await pageB.locator('#credit-banner').innerText().catch(() => '');
  check('Sem cliente selecionado, Terminal B não mostra banner de crédito nenhum', bannerText.trim() === '', bannerText);

  await pickCustomer(pageB, 'Cliente X Credito');
  bannerText = await pageB.locator('#credit-banner').innerText();
  check('Terminal B, ao selecionar o Cliente X, vê o crédito de R$ 50 gerado no Terminal A', /R\$\s*50,00/.test(bannerText), bannerText);
  check('Banner deixa claro que vale em qualquer terminal', /qualquer terminal/i.test(bannerText), bannerText);

  // ---------- Trocar de cliente: banner deve refletir o NOVO cliente (sem crédito), não o antigo ----------
  await pageB.click('#clear-customer-btn');
  await pageB.waitForTimeout(300);
  await pickCustomer(pageB, 'Cliente Y Sem Credito');
  bannerText = await pageB.locator('#credit-banner').innerText().catch(() => '');
  check('Trocar pro Cliente Y (sem crédito) some com o banner do Cliente X — nunca mistura saldo de clientes diferentes', bannerText.trim() === '', bannerText);

  // ---------- Volta pro Cliente X e aplica o crédito como pagamento ----------
  await pageB.click('#clear-customer-btn');
  await pageB.waitForTimeout(300);
  await pickCustomer(pageB, 'Cliente X Credito');
  await pageB.waitForTimeout(400);

  // Adiciona um produto ao carrinho (R$50) pra ter contra o que aplicar o crédito.
  await pageB.fill('#scan-input', 'Produto Credito');
  await pageB.waitForTimeout(500);
  await pageB.click('[data-pick]');
  await pageB.waitForTimeout(400);

  await pageB.click('#use-credit-btn');
  await pageB.waitForTimeout(400);
  // O valor da linha de pagamento fica no `value` de um <input>, não em
  // texto visível — innerText() não capturaria isso.
  const creditRowValue = await pageB.locator('.payment-amount-input').first().inputValue();
  const paymentsText = await pageB.locator('#payments-box').innerText();
  check('Crédito de troca aplicado como forma de pagamento no Terminal B', /Crédito de troca/.test(paymentsText) && creditRowValue === '50.00', `${paymentsText.slice(0, 60)} | valor=${creditRowValue}`);
  const bannerAfterUse = await pageB.locator('#credit-banner').innerText().catch(() => '');
  check('Banner some depois de usar o crédito inteiro (nada sobrando)', bannerAfterUse.trim() === '', bannerAfterUse);

  // ---------- Finaliza a venda no Terminal B ----------
  await pageB.click('#finalize-btn');
  await pageB.waitForTimeout(800);
  const modalVisible = await pageB.locator('.modal', { hasText: 'Venda finalizada' }).count();
  check('Venda com crédito de troca finalizada com sucesso no Terminal B', modalVisible === 1, modalVisible);
  await pageB.click('.modal button:has-text("Fechar")').catch(() => {});
  await pageB.waitForTimeout(300);

  const loyaltyAfterSpend = await apiCall(pageA, `/api/loyalty/${customerX.id}`);
  check('Servidor confirma o crédito real ZERADO depois da venda concluída (consumido de verdade, não só na tela)', loyaltyAfterSpend.body.credit === 0, loyaltyAfterSpend.body.credit);

  // ---------- Regra de negócio já existente continua de pé: gastar mais do que o saldo real é recusado pelo servidor ----------
  const overspend = await apiCall(pageA, '/api/sales', {
    method: 'POST', body: JSON.stringify({ items: [{ productId: prod.id, qty: 1 }], payments: [{ method: 'Crédito de troca', amount: 999 }], customerId: customerX.id, dedupeKey: crypto.randomUUID() }),
  });
  check('Tentar gastar crédito além do saldo real (mesmo direto pela API) é recusado pelo servidor', overspend.status === 400, overspend.status);

  // ---------- Resgate de pontos de fidelidade (via Clientes) também aparece cross-terminal ----------
  const sale2 = (await apiCall(pageA, '/api/sales', {
    method: 'POST', body: JSON.stringify({ items: [{ productId: prod.id, qty: 4 }], payments: [{ method: 'Dinheiro', amount: 200 }], customerId: customerX.id, dedupeKey: crypto.randomUUID() }),
  })).body.sale;
  check('Segunda venda do Cliente X gera pontos de fidelidade', sale2.total === 200, sale2.total);
  const redemption = await apiCall(pageA, `/api/loyalty/${customerX.id}/resgatar`, { method: 'POST', body: JSON.stringify({ points: 100, dedupeKey: crypto.randomUUID() }) });
  check('Resgate de 100 pontos gera R$ 10 de crédito (redemptionRate=10)', redemption.status === 201 && redemption.body.amount === 10, JSON.stringify(redemption.body));

  await pageB.goto(`${BASE}/#/venda`);
  await pageB.waitForTimeout(700);
  await pickCustomer(pageB, 'Cliente X Credito');
  const bannerAfterRedemption = await pageB.locator('#credit-banner').innerText();
  check('Crédito de resgate de pontos (gerado em Clientes, Terminal A) também aparece no Terminal B', /R\$\s*10,00/.test(bannerAfterRedemption), bannerAfterRedemption);

  // ---------- Remover um pagamento de crédito devolve o valor pro banner (sem perder) ----------
  await pageB.fill('#scan-input', 'Produto Credito');
  await pageB.waitForTimeout(500);
  await pageB.click('[data-pick]');
  await pageB.waitForTimeout(400);
  await pageB.click('#use-credit-btn');
  await pageB.waitForTimeout(400);
  await pageB.click('[data-pay-remove]');
  await pageB.waitForTimeout(400);
  const bannerAfterRemove = await pageB.locator('#credit-banner').innerText();
  check('Remover o pagamento de crédito devolve o valor pro banner (não se perde)', /R\$\s*10,00/.test(bannerAfterRemove), bannerAfterRemove);

  check('Zero erros JS/rede no Terminal A', errorsA.length === 0, JSON.stringify(errorsA));
  check('Zero erros JS/rede no Terminal B', errorsB.length === 0, JSON.stringify(errorsB));

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
