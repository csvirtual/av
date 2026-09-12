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

  // Máquina A cadastra fornecedor e produto
  await pageA.fill('#new-supplier-nome', 'Fornecedor Multi-Terminal');
  await pageA.click('#add-supplier-btn');
  await pageA.waitForTimeout(400);
  const bSupplierRows = await pageB.locator('#suppliers-tbody tr').count();
  check('máquina B vê o fornecedor cadastrado na A, em tempo real', bSupplierRows === 1, bSupplierRows);

  await pageA.fill('#f-barcode', 'COMPRA-MT-01');
  await pageA.fill('#f-name', 'Produto Compra Multi-Terminal');
  await pageA.fill('#f-price', '15');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(400);

  // Máquina A monta e cria o pedido de compra
  await pageA.selectOption('#order-supplier-select', { label: 'Fornecedor Multi-Terminal' });
  await pageA.selectOption('#order-item-product-select', { label: 'Produto Compra Multi-Terminal' });
  await pageA.fill('#order-item-qty', '20');
  await pageA.fill('#order-item-cost', '8');
  await pageA.click('#add-order-item-btn');
  await pageA.waitForTimeout(200);
  await pageA.click('#create-order-btn');
  await pageA.waitForTimeout(500);

  // Máquina B vê o pedido em tempo real, sem ter feito nada
  const bOrderRows = await pageB.locator('#orders-tbody tr').count();
  check('máquina B vê o pedido de compra criado na A, em tempo real', bOrderRows === 1, bOrderRows);

  // Máquina B recebe 12 das 20 unidades
  await pageB.click('[data-receive-order]');
  await pageB.waitForTimeout(300);
  await pageB.fill('[data-receive-qty]', '12');
  await pageB.click('#confirm-receive-btn');
  await pageB.waitForTimeout(600);

  // Máquina A vê o estoque subir (0+12=12) e o status do pedido mudar, em tempo real
  await pageA.waitForTimeout(700);
  const aStockText = await pageA.locator('#products-tbody tr td:nth-child(3)').first().textContent();
  check('máquina A vê o estoque subir pra 12 (recebimento feito na B), em tempo real', aStockText.trim() === '12', aStockText);
  const aOrderStatusText = await pageA.locator('#orders-tbody tr td').nth(1).textContent();
  check('máquina A vê o pedido como "Recebido parcial" em tempo real', aOrderStatusText.includes('Recebido parcial'), aOrderStatusText);

  // Máquina A lança uma conta a pagar
  await pageA.selectOption('#fin-type-select', 'pagar');
  await pageA.fill('#fin-description', 'Conta multi-terminal teste');
  await pageA.fill('#fin-amount', '300');
  await pageA.fill('#fin-duedate', '2026-12-31');
  await pageA.click('#add-finance-btn');
  await pageA.waitForTimeout(500);

  // Máquina B vê a conta em tempo real
  const bFinanceRows = await pageB.locator('#finance-tbody tr').count();
  check('máquina B vê a conta financeira lançada na A, em tempo real', bFinanceRows === 1, bFinanceRows);

  // Máquina B paga parcialmente
  await pageB.click('[data-pay-entry]');
  await pageB.waitForTimeout(300);
  await pageB.fill('#fin-payment-amount', '100');
  await pageB.click('#confirm-fin-payment-btn');
  await pageB.waitForTimeout(600);

  // Máquina A vê o restante e o status atualizados em tempo real
  await pageA.waitForTimeout(700);
  const aFinanceRowText = await pageA.locator('#finance-tbody tr').first().textContent();
  check('máquina A vê o restante (200) e status "Parcial" após pagamento feito na B, em tempo real', aFinanceRowText.includes('200,00') && aFinanceRowText.includes('Parcial'), aFinanceRowText.replace(/\s+/g, ' '));

  console.log('\nerros JS máquina A:', errorsA.length, JSON.stringify(errorsA));
  console.log('erros JS máquina B:', errorsB.length, JSON.stringify(errorsB));
  const ok = results.every(Boolean) && errorsA.length === 0 && errorsB.length === 0;
  console.log('\n' + (ok ? 'TUDO OK — COMPRAS/FINANCEIRO MULTI-TERMINAL FUNCIONANDO' : 'ALGO FALHOU'));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
