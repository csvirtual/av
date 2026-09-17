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

  // Máquina A cadastra o produto e dá entrada de estoque
  await pageA.fill('#f-barcode', 'DEMO-CIMENTO-50KG');
  await pageA.fill('#f-name', 'Cimento CP-II 50kg');
  await pageA.fill('#f-price', '38.90');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(400);
  for (let i = 0; i < 20; i++) {
    await pageA.click('[data-entrada]');
    await pageA.waitForTimeout(150);
  }
  await pageB.waitForTimeout(500);

  // Máquina B vende 5 unidades no Pix, sem qualquer ação da máquina A
  await pageB.click('[data-cart]');
  await pageB.waitForTimeout(150);
  for (let i = 0; i < 4; i++) { await pageB.click('[data-cart]'); await pageB.waitForTimeout(150); }
  await pageB.selectOption('#pay-method', 'Pix');
  await pageB.click('#finalize-btn');
  await pageB.waitForTimeout(600);

  await pageA.waitForTimeout(700);
  await pageA.screenshot({ path: 'demo-maquina-a.png' });

  // Máquina A estorna 1 unidade — máquina B precisa ver em tempo real
  await pageA.click('#sales-tbody [data-view]');
  await pageA.waitForTimeout(300);
  await pageA.fill('[data-refund-qty="0"]', '1');
  await pageA.fill('#refund-reason', 'Demonstração — cliente devolveu 1 saco');
  await pageA.click('#confirm-refund-btn');
  await pageA.waitForTimeout(600);

  await pageB.waitForTimeout(700);
  await pageB.screenshot({ path: 'demo-maquina-b.png' });

  console.log('screenshots salvos: demo-maquina-a.png, demo-maquina-b.png');
  await browser.close();
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
