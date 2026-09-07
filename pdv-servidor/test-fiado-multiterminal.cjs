const { chromium } = require('playwright');

const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const machineA = await browser.newContext();
  const machineB = await browser.newContext();
  const pageA = await machineA.newPage();
  const pageB = await machineB.newPage();
  const errorsA = [], errorsB = [];
  pageA.on('pageerror', (e) => errorsA.push(e.message));
  pageB.on('pageerror', (e) => errorsB.push(e.message));

  await pageA.goto('http://localhost:3131/test.html');
  await pageB.goto('http://localhost:3131/test.html');
  await pageA.waitForTimeout(300);
  await pageB.waitForTimeout(300);
  await pageA.click('#login-btn');
  await pageB.click('#login-btn');
  await pageA.waitForSelector('#ws-status.connected');
  await pageB.waitForSelector('#ws-status.connected');

  // Máquina A cadastra o cliente — B precisa ver na lista em tempo real
  await pageA.fill('#new-customer-nome', 'Cliente Multi-Terminal');
  await pageA.fill('#new-customer-telefone', '11988887777');
  await pageA.click('#add-customer-btn');
  await pageA.waitForTimeout(500);
  const bCustomerRows = await pageB.locator('#customers-tbody tr').count();
  check('máquina B vê o cliente cadastrado na A, em tempo real', bCustomerRows === 1, bCustomerRows);

  // Máquina A cadastra o produto e dá estoque
  await pageA.fill('#f-barcode', 'FIADO-MT-01');
  await pageA.fill('#f-name', 'Produto Fiado Multi-Terminal');
  await pageA.fill('#f-price', '30');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(400);
  for (let i = 0; i < 5; i++) { await pageA.click('[data-entrada]'); await pageA.waitForTimeout(150); }
  await pageB.waitForTimeout(500);

  // Máquina B vende fiado pro cliente (2 unidades = R$60)
  await pageB.selectOption('#sale-customer-select', { label: 'Cliente Multi-Terminal' });
  await pageB.click('[data-cart]');
  await pageB.waitForTimeout(150);
  await pageB.click('[data-cart]');
  await pageB.waitForTimeout(150);
  await pageB.selectOption('#pay-method', 'Fiado');
  await pageB.click('#finalize-btn');
  await pageB.waitForTimeout(600);
  const errB = await pageB.locator('#error').textContent();
  check('venda fiada na máquina B não deu erro', !errB || errB.trim() === '', errB);

  // Máquina A vê a dívida aparecer no saldo do cliente, em tempo real, sem ter feito nada
  await pageA.waitForTimeout(700);
  const aBalanceText = await pageA.locator('#customers-tbody tr td').nth(2).textContent();
  check('máquina A vê o saldo devedor (R$ 60,00) em tempo real', aBalanceText.includes('60,00'), aBalanceText);

  // Máquina A abre o extrato e registra um pagamento parcial de 20
  await pageA.click('[data-open-customer]');
  await pageA.waitForTimeout(300);
  await pageA.fill('#payment-amount', '20');
  await pageA.click('#confirm-payment-btn');
  await pageA.waitForTimeout(600);

  // Máquina B vê o saldo cair pra 40 em tempo real, na lista
  await pageB.waitForTimeout(700);
  const bBalanceText = await pageB.locator('#customers-tbody tr td').nth(2).textContent();
  check('máquina B vê o saldo cair pra R$ 40,00 (60-20) em tempo real', bBalanceText.includes('40,00'), bBalanceText);

  console.log('\nerros JS máquina A:', errorsA.length, JSON.stringify(errorsA));
  console.log('erros JS máquina B:', errorsB.length, JSON.stringify(errorsB));
  const ok = results.every(Boolean) && errorsA.length === 0 && errorsB.length === 0;
  console.log('\n' + (ok ? 'TUDO OK — CLIENTES/FIADO MULTI-TERMINAL FUNCIONANDO' : 'ALGO FALHOU'));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
