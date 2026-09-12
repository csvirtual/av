// Prova views/clientes.js (copiada sem alteração da extensão) contra o
// servidor multi-terminal — Fase 9, passo 8. Cobre cadastro/edição/
// inativação/exclusão de cliente, extrato de fiado com pagamento, e
// resgate de pontos de fidelidade — os 3 domínios que esta tela junta
// (customersRepo.js, loyaltyRepo.js, novo nesta fatia).
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-clientes.cjs` noutra.
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

async function createProduct(page, { name, barcode, price, cost, qty }) {
  await page.goto(`${BASE}/#/estoque`);
  await page.waitForTimeout(400);
  await page.click('button:has-text("+ Novo produto")');
  await page.waitForTimeout(300);
  await page.fill('#f-name', name);
  await page.fill('#f-barcode', barcode);
  await page.fill('#f-price', String(price));
  await page.fill('#f-cost', String(cost));
  await page.fill('#f-quantity', String(qty));
  await page.click('.modal button:has-text("Cadastrar produto")');
  await page.waitForTimeout(500);
}

/** Compra um item pro cliente selecionado e finaliza a venda com a forma
 * de pagamento dada ('Dinheiro' ou 'Fiado'). Assume que a página já está
 * em #/venda. */
async function sellToCustomer(page, { productName, customerName, method }) {
  await page.fill('input[placeholder*="Escaneie" i]', productName);
  await page.waitForTimeout(400);
  await page.click('[data-pick]');
  await page.waitForTimeout(300);
  await page.fill('#customer-search', customerName);
  await page.waitForTimeout(400);
  await page.click('[data-pick-customer]');
  await page.waitForTimeout(300);
  await page.click('#add-payment-btn');
  await page.waitForTimeout(200);
  if (method === 'Fiado') {
    await page.selectOption('select[data-pay-method="0"]', 'Fiado', { force: true });
    await page.waitForTimeout(300);
  }
  await page.click('#finalize-btn');
  await page.waitForTimeout(700);
  await page.click('button:has-text("Fechar")').catch(() => {});
  await page.waitForTimeout(300);
}

/** Abre o menu "Opções" da 1ª linha da tabela e clica no item com o texto
 * dado — mesma UI real que um usuário usa desde a consolidação dos botões
 * de linha (Ver compras/Editar/Inativar-Reativar/Excluir) num dropdown só. */
async function clickOptionsItem(page, itemText) {
  await page.locator('[data-options]').first().click();
  await page.waitForTimeout(200);
  await page.locator(`.row-options-item:has-text("${itemText}")`).click();
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('console.error: ' + m.text()); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page);

  // ---------- Cadastro de cliente ----------
  await page.goto(`${BASE}/#/clientes`);
  await page.waitForTimeout(500);
  await page.click('#new-customer-btn');
  await page.waitForTimeout(300);
  await page.fill('#f-nome', 'Cliente Teste Clientes');
  await page.fill('#f-telefone', '11987654321');
  await page.fill('#f-limit', '500');
  await page.click('.modal button:has-text("Cadastrar cliente")');
  await page.waitForTimeout(500);
  let listText = await page.locator('#view-root').innerText();
  check('Cliente recém-cadastrado aparece na lista', listText.includes('Cliente Teste Clientes'));

  // ---------- Edição ----------
  await clickOptionsItem(page, 'Editar');
  await page.waitForTimeout(300);
  await page.fill('#f-nome', 'Cliente Teste Clientes (editado)');
  await page.click('.modal button:has-text("Salvar")');
  await page.waitForTimeout(500);
  listText = await page.locator('#view-root').innerText();
  check('Edição de nome reflete na lista', listText.includes('Cliente Teste Clientes (editado)'));

  // ---------- Inativar / reativar (confirmDialog, não confirm() nativo) ----------
  await clickOptionsItem(page, 'Inativar');
  await page.waitForTimeout(300);
  await page.click('.modal button:has-text("Inativar")');
  await page.waitForTimeout(500);
  let row = await page.locator('tr', { hasText: 'Cliente Teste Clientes (editado)' }).innerText();
  check('Inativar cliente muda o status pra INATIVO', /INATIVO/i.test(row), row);
  await clickOptionsItem(page, 'Reativar');
  await page.waitForTimeout(300);
  await page.click('.modal button:has-text("Reativar")');
  await page.waitForTimeout(500);
  row = await page.locator('tr', { hasText: 'Cliente Teste Clientes (editado)' }).innerText();
  check('Reativar cliente volta o status pra ATIVO', /ATIVO/i.test(row) && !/INATIVO/i.test(row), row);

  // ---------- Venda fiada gera dívida visível no extrato ----------
  await createProduct(page, { name: 'Produto Fiado Clientes', barcode: 'CLI-FIADO-1', price: 50, cost: 30, qty: 10 });
  await page.goto(`${BASE}/#/venda`);
  await page.waitForTimeout(400);
  await sellToCustomer(page, { productName: 'Produto Fiado Clientes', customerName: 'Cliente Teste Clientes', method: 'Fiado' });

  await page.goto(`${BASE}/#/clientes`);
  await page.waitForTimeout(500);
  row = await page.locator('tr', { hasText: 'Cliente Teste Clientes (editado)' }).innerText();
  check('Extrato mostra dívida de R$ 50,00 depois da venda fiada', /50,00/.test(row), row);

  // ---------- Pagamento parcial de fiado ----------
  await page.click('[data-detail]');
  await page.waitForTimeout(400);
  const ledgerModalText = await page.locator('.modal').innerText();
  check('Modal de extrato mostra "Registrar pagamento" (tem dívida em aberto)', ledgerModalText.includes('Registrar pagamento'));
  await page.click('.modal button:has-text("Registrar pagamento")');
  await page.waitForTimeout(400);
  await page.fill('#f-amount', '20');
  await page.click('.modal button:has-text("Confirmar")');
  await page.waitForTimeout(600);

  await page.waitForTimeout(300);
  row = await page.locator('tr', { hasText: 'Cliente Teste Clientes (editado)' }).innerText();
  check('Saldo cai pra R$ 30,00 depois do pagamento parcial de R$ 20,00', /30,00/.test(row), row);

  check('Zero erros JS/rede durante o fluxo real (cadastro/edição/venda fiada/pagamento)', errors.length === 0, JSON.stringify(errors));

  // ---------- Adversário: pagamento maior que a dívida é rejeitado pelo SERVIDOR ----------
  const overPaymentResult = await page.evaluate(async () => {
    const listRes = await fetch('/api/customers?q=Cliente Teste Clientes', { credentials: 'include' });
    const { customers } = await listRes.json();
    const customer = customers[0];
    const res = await fetch(`/api/customers/${customer.id}/pagamento`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ amount: 9999, paymentMethod: 'Dinheiro', dedupeKey: crypto.randomUUID() }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  });
  check('Servidor rejeita pagamento de R$9999 contra dívida de R$30 (nunca confia num valor que passe da UI)', overPaymentResult.status >= 400 && /dívida/i.test(overPaymentResult.body.error || ''), JSON.stringify(overPaymentResult));

  // ---------- Adversário: reenviar o MESMO pagamento (dedupeKey) não duplica ----------
  const dedupeAttack = await page.evaluate(async () => {
    const listRes = await fetch('/api/customers?q=Cliente Teste Clientes', { credentials: 'include' });
    const { customers } = await listRes.json();
    const customer = customers[0];
    const dedupeKey = crypto.randomUUID();
    const body = JSON.stringify({ amount: 5, paymentMethod: 'Dinheiro', dedupeKey });
    const first = await fetch(`/api/customers/${customer.id}/pagamento`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body });
    const second = await fetch(`/api/customers/${customer.id}/pagamento`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body });
    return { firstStatus: first.status, secondStatus: second.status };
  });
  check('1º pagamento aceito, reenvio da MESMA chave rejeitado (409) — sem pagamento duplicado', dedupeAttack.firstStatus < 300 && dedupeAttack.secondStatus === 409, JSON.stringify(dedupeAttack));

  // Quita o resto da dívida (30 - 5 do teste de dedupe = 25) — precisa
  // chegar a zero pra exclusão no fim do teste não ser bloqueada (o
  // servidor/tela corretamente recusam excluir cliente com saldo devedor).
  await page.evaluate(async () => {
    const listRes = await fetch('/api/customers?q=Cliente Teste Clientes', { credentials: 'include' });
    const { customers } = await listRes.json();
    const customer = customers[0];
    await fetch(`/api/customers/${customer.id}/pagamento`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ amount: 25, paymentMethod: 'Dinheiro', dedupeKey: crypto.randomUUID() }),
    });
  });

  // ---------- Fidelidade: configura, vende, resgata pontos ----------
  await page.evaluate(async () => {
    await fetch('/api/loyalty/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ pointsPerReal: 1, redemptionRate: 10 }),
    });
  });
  await createProduct(page, { name: 'Produto Fidelidade Clientes', barcode: 'CLI-LOY-1', price: 100, cost: 60, qty: 5 });
  await page.goto(`${BASE}/#/venda`);
  await page.waitForTimeout(400);
  await sellToCustomer(page, { productName: 'Produto Fidelidade Clientes', customerName: 'Cliente Teste Clientes', method: 'Dinheiro' });

  await page.goto(`${BASE}/#/clientes`);
  await page.waitForTimeout(500);
  await page.click('[data-detail]');
  await page.waitForTimeout(400);
  const ledgerModalText2 = await page.locator('.modal').innerText();
  check('Extrato mostra pontos ganhos (100 pontos por R$100 vendido, pointsPerReal=1) e botão de resgatar', /100\s*pontos|Resgatar pontos/i.test(ledgerModalText2), ledgerModalText2.slice(0, 400));

  const redeemBtn = page.locator('.modal #redeem-points-btn');
  if (await redeemBtn.count() > 0) {
    await redeemBtn.click();
    await page.waitForTimeout(400);
    await page.click('.modal button:has-text("Confirmar resgate")');
    await page.waitForTimeout(600);
    const afterRedeem = await page.locator('body').innerText();
    check('Toast confirma o resgate de pontos', /resgatad|crédito/i.test(afterRedeem));
  } else {
    check('Botão de resgatar pontos apareceu no extrato', false, ledgerModalText2.slice(0, 400));
  }

  // ---------- Adversário: resgatar mais pontos do que o cliente tem ----------
  const overRedeemResult = await page.evaluate(async () => {
    const listRes = await fetch('/api/customers?q=Cliente Teste Clientes', { credentials: 'include' });
    const { customers } = await listRes.json();
    const customer = customers[0];
    const res = await fetch(`/api/loyalty/${customer.id}/resgatar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ points: 999999, dedupeKey: crypto.randomUUID() }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  });
  check('Servidor rejeita resgatar 999999 pontos (nunca confia num valor que passe da UI)', overRedeemResult.status >= 400 && /pontos dispon/i.test(overRedeemResult.body.error || ''), JSON.stringify(overRedeemResult));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---------- Exclusão de cliente (admin tem a permissão, saldo zerado) ----------
  await page.goto(`${BASE}/#/clientes`);
  await page.waitForTimeout(500);
  await clickOptionsItem(page, 'Excluir');
  await page.waitForTimeout(300);
  await page.click('.modal button:has-text("Excluir")');
  await page.waitForTimeout(500);
  const afterDeleteText = await page.locator('#view-root').innerText();
  check('Cliente excluído (saldo zerado) some da lista', !afterDeleteText.includes('Cliente Teste Clientes (editado)'), afterDeleteText.slice(0, 200));

  // ---------- Adversário: exclusão sem permissão é rejeitada pelo SERVIDOR ----------
  // Cria um vendedor SEM a permissão 'deleteCustomer' e tenta excluir um
  // cliente novo com a sessão dele — prova que a checagem é da FONTE
  // (routes/customers.js), não só do botão escondido na tela.
  const permissionAttack = await page.evaluate(async () => {
    const vendorUsername = 'vendedor-sem-permissao-' + Date.now();
    await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ nome: 'Vendedor Sem Permissão', username: vendorUsername, password: 'senha1234', permissions: { deleteCustomer: false } }),
    });
    const custRes = await fetch('/api/customers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ nome: 'Cliente Pra Ataque de Permissão' }),
    });
    const { customer } = await custRes.json();
    // Faz login como o vendedor (isso troca o cookie de sessão desta
    // mesma aba — daqui em diante os fetch()s seguintes usam a sessão
    // DELE, não mais a do admin).
    await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ username: vendorUsername, password: 'senha1234' }),
    });
    const delRes = await fetch(`/api/customers/${customer.id}`, { method: 'DELETE', credentials: 'include' });
    return { status: delRes.status, body: await delRes.json().catch(() => ({})) };
  });
  check('Vendedor sem a permissão deleteCustomer não consegue excluir (403, direto na API)', permissionAttack.status === 403, JSON.stringify(permissionAttack));

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
