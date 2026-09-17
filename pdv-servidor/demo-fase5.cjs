const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const machineA = await browser.newContext({ viewport: { width: 1000, height: 900 } });
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

  await pageA.fill('#new-supplier-nome', 'Distribuidora Cimento Forte');
  await pageA.fill('#new-supplier-telefone', '(11) 4444-5555');
  await pageA.click('#add-supplier-btn');
  await pageA.waitForTimeout(400);

  await pageA.fill('#f-barcode', 'COMPRA-DEMO-01');
  await pageA.fill('#f-name', 'Cimento CP-II 50kg');
  await pageA.fill('#f-price', '38');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(400);

  await pageA.selectOption('#order-supplier-select', { label: 'Distribuidora Cimento Forte' });
  await pageA.selectOption('#order-item-product-select', { label: 'Cimento CP-II 50kg' });
  await pageA.fill('#order-item-qty', '50');
  await pageA.fill('#order-item-cost', '24');
  await pageA.click('#add-order-item-btn');
  await pageA.waitForTimeout(200);
  await pageA.click('#create-order-btn');
  await pageA.waitForTimeout(500);

  // Máquina B recebe 30 das 50 unidades
  await pageB.click('[data-receive-order]');
  await pageB.waitForTimeout(300);
  await pageB.fill('[data-receive-qty]', '30');
  await pageB.click('#confirm-receive-btn');
  await pageB.waitForTimeout(600);

  // Máquina A vê o estoque e o status do pedido em tempo real, sem ter feito nada
  await pageA.waitForTimeout(700);
  await pageA.screenshot({ path: 'demo-compras-maquina-a.png' });

  // Máquina A lança uma conta a pagar pro fornecedor
  await pageA.selectOption('#fin-type-select', 'pagar');
  await pageA.fill('#fin-description', 'Nota fiscal — Distribuidora Cimento Forte');
  await pageA.fill('#fin-amount', '720');
  await pageA.fill('#fin-duedate', '2026-10-15');
  await pageA.click('#add-finance-btn');
  await pageA.waitForTimeout(500);

  // Máquina B paga uma parte
  await pageB.click('[data-pay-entry]');
  await pageB.waitForTimeout(300);
  await pageB.fill('#fin-payment-amount', '300');
  await pageB.selectOption('#fin-payment-method', 'Pix');
  await pageB.click('#confirm-fin-payment-btn');
  await pageB.waitForTimeout(600);

  // Máquina A vê a conta e o pagamento parcial em tempo real
  await pageA.waitForTimeout(700);
  await pageA.screenshot({ path: 'demo-financeiro-maquina-a.png' });

  console.log('screenshots salvos.');
  await browser.close();
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
