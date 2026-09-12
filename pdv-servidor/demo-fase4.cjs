const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const machineA = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const machineB = await browser.newContext({ viewport: { width: 1000, height: 800 } });
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

  // Máquina A cadastra a cliente e o produto
  await pageA.fill('#new-customer-nome', 'Maria da Silva');
  await pageA.fill('#new-customer-telefone', '(11) 9 8888-7766');
  await pageA.click('#add-customer-btn');
  await pageA.waitForTimeout(400);

  await pageA.fill('#f-barcode', 'FIADO-DEMO-01');
  await pageA.fill('#f-name', 'Saco de argamassa 20kg');
  await pageA.fill('#f-price', '25');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(400);
  for (let i = 0; i < 10; i++) { await pageA.click('[data-entrada]'); await pageA.waitForTimeout(120); }
  await pageB.waitForTimeout(500);

  // Máquina B vende 3 unidades fiado pra Maria
  await pageB.selectOption('#sale-customer-select', { label: 'Maria da Silva' });
  await pageB.click('[data-cart]');
  await pageB.waitForTimeout(150);
  await pageB.click('[data-cart]');
  await pageB.waitForTimeout(150);
  await pageB.click('[data-cart]');
  await pageB.waitForTimeout(150);
  await pageB.selectOption('#pay-method', 'Fiado');
  await pageB.click('#finalize-btn');
  await pageB.waitForTimeout(600);

  // Máquina A vê o saldo devedor em tempo real, sem ter feito nada
  await pageA.waitForTimeout(700);
  await pageA.screenshot({ path: 'demo-fiado-maquina-a-saldo.png' });

  // Máquina A abre o extrato de Maria e registra um pagamento parcial
  await pageA.click('[data-open-customer]');
  await pageA.waitForTimeout(300);
  await pageA.screenshot({ path: 'demo-fiado-extrato.png' });
  await pageA.fill('#payment-amount', '30');
  await pageA.selectOption('#payment-method', 'Pix');
  await pageA.click('#confirm-payment-btn');
  await pageA.waitForTimeout(600);

  // Máquina B vê o saldo cair em tempo real
  await pageB.waitForTimeout(700);
  await pageB.screenshot({ path: 'demo-fiado-maquina-b-apos-pagamento.png' });

  console.log('screenshots salvos.');
  await browser.close();
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
