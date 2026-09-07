const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const machineA = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
  const machineB = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const pageA = await machineA.newPage();
  const pageB = await machineB.newPage();

  await pageA.goto('http://localhost:3131/test.html');
  await pageB.goto('http://localhost:3131/test.html');
  await pageA.waitForTimeout(300);
  await pageB.waitForTimeout(300);
  await pageA.click('#login-btn');
  await pageB.click('#login-btn');
  await pageA.waitForSelector('#ws-status.connected');
  await pageB.waitForSelector('#ws-status.connected');

  await pageA.fill('#loyalty-points-rate', '1');
  await pageA.fill('#loyalty-redemption-rate', '10');
  await pageA.click('#save-loyalty-config-btn');
  await pageA.waitForTimeout(400);

  await pageA.fill('#new-customer-nome', 'João Pereira');
  await pageA.fill('#new-customer-telefone', '(11) 9 7777-6655');
  await pageA.click('#add-customer-btn');
  await pageA.waitForTimeout(400);

  await pageA.fill('#f-barcode', 'FIDEL-DEMO-01');
  await pageA.fill('#f-name', 'Tijolo baiano (milheiro)');
  await pageA.fill('#f-price', '400');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(400);
  await pageA.click('[data-entrada]');
  await pageA.waitForTimeout(200);

  await pageA.selectOption('#sale-customer-select', { label: 'João Pereira' });
  await pageA.click('[data-cart]');
  await pageA.waitForTimeout(150);
  await pageA.selectOption('#pay-method', 'Pix');
  await pageA.click('#finalize-btn');
  await pageA.waitForTimeout(600);

  // Máquina B resgata parte dos pontos ganhos na venda da A
  await pageB.waitForTimeout(700);
  await pageB.click('[data-open-customer]');
  await pageB.waitForTimeout(300);
  await pageB.fill('#redeem-points', '200');
  await pageB.click('#confirm-redeem-btn');
  await pageB.waitForTimeout(600);
  await pageB.screenshot({ path: 'demo-fidelidade-extrato-b.png' });
  await pageB.click('#close-modal-btn');
  await pageB.waitForTimeout(200);

  // Máquina A vê os pontos e o crédito de troca em tempo real
  await pageA.waitForTimeout(700);
  await pageA.screenshot({ path: 'demo-fidelidade-maquina-a.png' });

  // Máquina A cria um carreto pro cliente
  await pageA.selectOption('#delivery-customer-select', { label: 'João Pereira' });
  await pageA.selectOption('#delivery-item-product-select', { label: 'Tijolo baiano (milheiro)' });
  await pageA.fill('#delivery-item-qty', '1');
  await pageA.click('#add-delivery-item-btn');
  await pageA.waitForTimeout(200);
  await pageA.fill('#delivery-address', 'Obra da Rua das Palmeiras, 88');
  await pageA.click('#create-delivery-btn');
  await pageA.waitForTimeout(500);

  // Máquina B marca como entregue
  await pageB.click('[data-deliver]');
  await pageB.waitForTimeout(600);

  // Máquina A vê o carreto como entregue, em tempo real
  await pageA.waitForTimeout(700);
  await pageA.screenshot({ path: 'demo-carreto-maquina-a.png' });

  console.log('screenshots salvos.');
  await browser.close();
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
