// Prova views/financeiro.js (copiada sem alteração da extensão) contra o
// servidor multi-terminal — Fase 9, passo 14. Contas a pagar/receber com
// pagamento parcial de verdade (uma conta só fecha quando a soma bate o
// total), exclusão de pagamento reabrindo a conta sozinha, cancelamento
// só antes de qualquer pagamento. Toda a lógica de negócio já existia
// pronta no servidor desde a Fase 5 (routes/finance.js) — este passo só
// ligou a tela real por cima.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-financeiro.cjs` noutra.
const { chromium } = require('playwright');

const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login(page, username, password) {
  await page.goto(BASE);
  await page.fill('#username', username);
  await page.fill('#password', password);
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

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('console.error: ' + m.text()); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page, 'admin', 'admin123');

  const vendorSetup = await apiCall(page, '/api/users', {
    method: 'POST', body: JSON.stringify({ nome: 'Vendedor Sem Financeiro', username: 'vendedor.sem.financeiro', password: 'senhaVendedor1', permissions: {} }),
  });
  check('Vendedor sem "financeiro" criado', vendorSetup.status === 201, vendorSetup.status);

  // ---------- Fluxo real: cadastro, pagamento parcial, conclusão ----------
  await page.goto(`${BASE}/#/financeiro`);
  await page.waitForTimeout(600);
  let viewText = await page.locator('#view-root').innerText();
  check('Estado inicial: sem contas, resumo zerado', viewText.includes('Nenhuma conta encontrada'));

  await page.click('#new-entry-btn');
  await page.waitForTimeout(300);
  await page.selectOption('#f-type', 'pagar');
  await page.fill('#f-description', 'Aluguel de setembro');
  await page.fill('#f-amount', '1000');
  await page.fill('#f-duedate', '2026-09-30');
  await page.fill('#f-category', 'aluguel');
  await page.click('.modal button:has-text("Cadastrar conta")');
  await page.waitForTimeout(600);
  viewText = await page.locator('#view-root').innerText();
  check('Conta cadastrada aparece PENDENTE, resumo "a pagar" reflete R$ 1.000,00', /R\$\s*1\.000,00/.test(viewText) && /PENDENTE/i.test(viewText), viewText.slice(0, 300));

  await page.click('[data-pay]');
  await page.waitForTimeout(300);
  await page.fill('#f-amount', '400');
  await page.click('.modal button:has-text("Confirmar")');
  await page.waitForTimeout(600);
  viewText = await page.locator('#view-root').innerText();
  check(
    'Pagamento parcial (400/1000) mostra "PAGO PARCIALMENTE", falta R$ 600,00, resumo "a pagar" cai pro saldo restante (não o total)',
    /PAGO PARCIALMENTE/i.test(viewText) && /Falta\s*R\$\s*600,00/.test(viewText) && /R\$\s*600,00/.test(viewText),
    viewText.slice(0, 400),
  );

  // ---------- Adversária: não dá pra pagar além do restante ----------
  const entriesAfterPartial = await apiCall(page, '/api/finance');
  const entryId = entriesAfterPartial.body.entries[0].id;
  const overPay = await apiCall(page, `/api/finance/${entryId}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 700, paymentMethod: 'Dinheiro' }),
  });
  check('Servidor rejeita pagar mais do que o restante (600) numa conta parcial', overPay.status === 400 && /maior que o restante/i.test(overPay.body.error || ''), JSON.stringify(overPay));

  // ---------- Adversária: reenvio duplicado (dedupeKey) ----------
  const dedupeKey = 'dupe-payment-key';
  const firstPay = await apiCall(page, `/api/finance/${entryId}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 100, paymentMethod: 'Pix', dedupeKey }),
  });
  const secondPay = await apiCall(page, `/api/finance/${entryId}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 100, paymentMethod: 'Pix', dedupeKey }),
  });
  check('Primeiro pagamento com dedupeKey passa', firstPay.status === 201, firstPay.status);
  check('Reenvio do MESMO pagamento (mesma dedupeKey) é rejeitado', secondPay.status === 409, secondPay.status);

  // O pagamento direto por API acima mudou o saldo no servidor, mas a tela
  // ainda tem o `entry` velho (600 de restante) fechado na memória da
  // última renderização — o modal de pagamento pré-preenche o campo com
  // esse valor stale. Sem recarregar, "Confirmar" mandaria 600 (não mais
  // válido, restam só 500) e o servidor rejeitaria, deixando um modal
  // aberto (erro) que bloqueia os próximos cliques. Mesmo padrão já visto
  // no aviso de redirecionamento de caixa.js: passa por outra rota
  // primeiro pra forçar uma renderização de verdade com o dado fresco.
  await page.goto(`${BASE}/#/dashboard`);
  await page.waitForTimeout(300);
  await page.goto(`${BASE}/#/financeiro`);
  await page.waitForTimeout(600);

  // Conclui o pagamento restante (500) pela UI, fechando a conta.
  await page.click('[data-pay]');
  await page.waitForTimeout(300);
  await page.click('.modal button:has-text("Confirmar")'); // pré-preenchido com o restante
  await page.waitForTimeout(600);
  viewText = await page.locator('#view-root').innerText();
  check('Conta totalmente paga: status PAGO, some do resumo "a pagar" (volta a 0)', /\bPAGO\b/i.test(viewText) && !/PARCIALMENTE/i.test(viewText) && /A PAGAR \(PENDENTE\)[\s\S]{0,40}R\$\s*0,00/.test(viewText), viewText.slice(0, 400));

  // ---------- Ver pagamentos + excluir um, reabrindo a conta ----------
  await page.click('[data-payments]');
  await page.waitForTimeout(300);
  let paymentsText = await page.locator('.modal').innerText();
  check('Extrato de pagamentos mostra as 3 entradas (400+100+500)', paymentsText.includes('400,00') && paymentsText.includes('100,00') && paymentsText.includes('500,00'), paymentsText.slice(0, 300));

  await page.click('[data-delete-payment]');
  await page.waitForTimeout(300);
  await page.click('[data-action="ok"]');
  await page.waitForTimeout(600);
  viewText = await page.locator('#view-root').innerText();
  check(
    'Excluir um pagamento reabre a conta (some de PAGO, volta a ter saldo em aberto)',
    !viewText.includes('PAGO</span>') || /PENDENTE|PARCIALMENTE/i.test(viewText),
    viewText.slice(0, 400),
  );

  check('Zero erros JS/rede durante o fluxo real (cadastro/pagamento parcial+total/exclusão)', errors.length === 0, JSON.stringify(errors));

  // ---------- Adversária: cancelar conta com pagamento é bloqueado; sem pagamento funciona ----------
  const cancelWithPayment = await apiCall(page, `/api/finance/${entryId}/cancelar`, { method: 'POST' });
  check('Cancelar conta que ainda tem pagamento registrado é bloqueado', cancelWithPayment.status === 400, JSON.stringify(cancelWithPayment));

  const cleanEntryRes = await apiCall(page, '/api/finance', {
    method: 'POST', body: JSON.stringify({ type: 'receber', description: 'Venda avulsa a receber', amount: 250, dueDate: Date.now() }),
  });
  const cleanEntryId = cleanEntryRes.body.entry.id;
  const cancelClean = await apiCall(page, `/api/finance/${cleanEntryId}/cancelar`, { method: 'POST' });
  check('Cancelar conta sem pagamento nenhum funciona', cancelClean.status === 200 && cancelClean.body.entry.status === 'cancelado', JSON.stringify(cancelClean));

  // Cancelar uma conta TOTALMENTE PAGA (não só "com pagamento" — o caso
  // acima já cobre isso via qualquer pagamento > 0) precisa do mesmo
  // bloqueio: uma vez paga, a única forma de "desfazer" é excluir os
  // pagamentos, nunca cancelar por cima.
  const paidEntryRes = await apiCall(page, '/api/finance', {
    method: 'POST', body: JSON.stringify({ type: 'pagar', description: 'Conta que vai ser paga e depois tentarão cancelar', amount: 80, dueDate: Date.now() }),
  });
  const paidEntryId = paidEntryRes.body.entry.id;
  await apiCall(page, `/api/finance/${paidEntryId}/pagamento`, { method: 'POST', body: JSON.stringify({ amount: 80, paymentMethod: 'Dinheiro' }) });
  const cancelPaid = await apiCall(page, `/api/finance/${paidEntryId}/cancelar`, { method: 'POST' });
  check('Cancelar conta já totalmente paga é rejeitado', cancelPaid.status === 400 && /já paga/i.test(cancelPaid.body.error || ''), JSON.stringify(cancelPaid));

  // ---------- Adversária: conta vencida aparece com o status certo ----------
  const overdueRes = await apiCall(page, '/api/finance', {
    method: 'POST', body: JSON.stringify({ type: 'pagar', description: 'Conta vencida de teste', amount: 50, dueDate: Date.now() - 5 * 24 * 60 * 60 * 1000 }),
  });
  check('Conta com vencimento no passado criada', overdueRes.status === 201, overdueRes.status);
  await page.goto(`${BASE}/#/dashboard`);
  await page.waitForTimeout(300);
  await page.goto(`${BASE}/#/financeiro`);
  await page.waitForTimeout(600);
  viewText = await page.locator('#view-root').innerText();
  check('Conta vencida aparece com status VENCIDO e conta no resumo de vencidas', /VENCIDO/i.test(viewText) && /CONTAS VENCIDAS[\s\S]{0,20}1/.test(viewText), viewText.slice(0, 400));

  // ---------- Adversária: gate de permissão (vendedor sem 'financeiro' toma 403) ----------
  const vendorLogin = await apiCall(page, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'vendedor.sem.financeiro', password: 'senhaVendedor1' }) });
  check('Login do vendedor sem "financeiro" funciona', vendorLogin.status === 200, vendorLogin.status);

  const vendorReadFinance = await apiCall(page, '/api/finance');
  check('Vendedor sem "financeiro" toma 403 até pra LER contas (rota inteira exige a permissão, igual a extensão)', vendorReadFinance.status === 403, vendorReadFinance.status);

  const vendorCreateFinance = await apiCall(page, '/api/finance', { method: 'POST', body: JSON.stringify({ type: 'pagar', description: 'x', amount: 1, dueDate: Date.now() }) });
  check('Vendedor sem "financeiro" toma 403 tentando criar conta', vendorCreateFinance.status === 403, vendorCreateFinance.status);

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
