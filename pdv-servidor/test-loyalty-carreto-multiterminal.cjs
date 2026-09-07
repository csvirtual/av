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

  // Máquina A configura fidelidade (1 ponto por real, 1 ponto = R$1)
  await pageA.fill('#loyalty-points-rate', '1');
  await pageA.fill('#loyalty-redemption-rate', '1');
  await pageA.click('#save-loyalty-config-btn');
  await pageA.waitForTimeout(400);

  await pageA.fill('#new-customer-nome', 'Cliente Fidelidade MT');
  await pageA.click('#add-customer-btn');
  await pageA.waitForTimeout(400);

  await pageA.fill('#f-barcode', 'LOYALTY-MT-01');
  await pageA.fill('#f-name', 'Produto Fidelidade MT');
  await pageA.fill('#f-price', '50');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(400);
  await pageA.click('[data-entrada]');
  await pageA.waitForTimeout(200);

  // Máquina A vende 50 (1 unidade) pro cliente, em dinheiro — ganha 50 pontos
  await pageA.selectOption('#sale-customer-select', { label: 'Cliente Fidelidade MT' });
  await pageA.click('[data-cart]');
  await pageA.waitForTimeout(150);
  await pageA.selectOption('#pay-method', 'Dinheiro');
  await pageA.click('#finalize-btn');
  await pageA.waitForTimeout(600);

  // Máquina B vê os 50 pontos na tabela de clientes, em tempo real
  await pageB.waitForTimeout(700);
  const bPointsText = await pageB.locator('#customers-tbody tr td').nth(3).textContent();
  check('máquina B vê os 50 pontos ganhos na venda da A, em tempo real', bPointsText.trim() === '50', bPointsText);

  // Máquina B resgata 20 pontos (vira R$20 de crédito)
  await pageB.click('[data-open-customer]');
  await pageB.waitForTimeout(300);
  await pageB.fill('#redeem-points', '20');
  await pageB.click('#confirm-redeem-btn');
  await pageB.waitForTimeout(600);
  await pageB.click('#close-modal-btn');
  await pageB.waitForTimeout(200);

  // Máquina A vê o crédito de troca aparecer, em tempo real
  await pageA.waitForTimeout(700);
  const aCreditText = await pageA.locator('#customers-tbody tr td').nth(4).textContent();
  check('máquina A vê o crédito de troca (R$20,00) do resgate feito na B, em tempo real', aCreditText.includes('20,00'), aCreditText);

  // Máquina A cria um carreto pro cliente
  await pageA.selectOption('#delivery-customer-select', { label: 'Cliente Fidelidade MT' });
  await pageA.selectOption('#delivery-item-product-select', { label: 'Produto Fidelidade MT' });
  await pageA.fill('#delivery-item-qty', '1');
  await pageA.click('#add-delivery-item-btn');
  await pageA.waitForTimeout(200);
  await pageA.fill('#delivery-address', 'Rua Multi-Terminal, 42');
  await pageA.click('#create-delivery-btn');
  await pageA.waitForTimeout(500);

  // Máquina B vê o carreto em tempo real
  const bDeliveryRows = await pageB.locator('#deliveries-tbody tr').count();
  check('máquina B vê o carreto criado na A, em tempo real', bDeliveryRows === 1, bDeliveryRows);

  // Máquina B marca como entregue
  await pageB.click('[data-deliver]');
  await pageB.waitForTimeout(600);

  // Máquina A vê o status mudar pra "Entregue", em tempo real
  await pageA.waitForTimeout(700);
  const aDeliveryStatusText = await pageA.locator('#deliveries-tbody tr td').nth(3).textContent();
  check('máquina A vê o carreto como "Entregue" (marcado na B), em tempo real', aDeliveryStatusText.trim() === 'Entregue', aDeliveryStatusText);

  console.log('\nerros JS máquina A:', errorsA.length, JSON.stringify(errorsA));
  console.log('erros JS máquina B:', errorsB.length, JSON.stringify(errorsB));
  const ok = results.every(Boolean) && errorsA.length === 0 && errorsB.length === 0;
  console.log('\n' + (ok ? 'TUDO OK — FIDELIDADE/CARRETO MULTI-TERMINAL FUNCIONANDO' : 'ALGO FALHOU'));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
