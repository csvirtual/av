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
  await pageA.waitForTimeout(500);
  await pageB.waitForTimeout(500);
  await pageA.waitForSelector('#ws-status.connected');
  await pageB.waitForSelector('#ws-status.connected');

  // Máquina A cadastra um produto e dá entrada de estoque
  await pageA.fill('#f-barcode', 'MT-SALE-01');
  await pageA.fill('#f-name', 'Cimento Multi-Terminal Venda');
  await pageA.fill('#f-price', '40');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(400);
  for (let i = 0; i < 3; i++) {
    await pageA.click('[data-entrada]');
    await pageA.waitForTimeout(200);
  }
  await pageB.waitForTimeout(500);
  const stockB = await pageB.locator('#products-tbody tr td:nth-child(3)').first().textContent();
  check('máquina B já vê o estoque de 3 (entrada feita na A)', stockB.trim() === '3', stockB);

  // Máquina B faz a venda de 2 unidades (clica "Vender" duas vezes — addToCart
  // soma +1 no mesmo item, não duplica a linha)
  await pageB.click('[data-cart]');
  await pageB.waitForTimeout(200);
  await pageB.click('[data-cart]');
  await pageB.waitForTimeout(200);
  const cartQty = await pageB.locator('#cart-tbody td').nth(1).textContent();
  check('carrinho da máquina B tem 2 unidades', cartQty.trim() === '2', cartQty);
  await pageB.selectOption('#pay-method', 'Pix');
  await pageB.click('#finalize-btn');
  await pageB.waitForTimeout(500);

  const errB = await pageB.locator('#error').textContent();
  check('venda na máquina B não deu erro', !errB || errB.trim() === '', errB);

  // Máquina A (que nunca vendeu nada) deve ver o estoque cair pra 1 e a venda no histórico, sozinha
  await pageA.waitForTimeout(700);
  const stockA = await pageA.locator('#products-tbody tr td:nth-child(3)').first().textContent();
  check('máquina A vê o estoque cair pra 1 em tempo real (3-2=1)', stockA.trim() === '1', stockA);
  const salesRowsA = await pageA.locator('#sales-tbody tr').count();
  check('máquina A vê a venda no histórico em tempo real, sem ter feito nada', salesRowsA === 1, salesRowsA);
  const saleRowText = await pageA.locator('#sales-tbody tr').first().textContent();
  check('venda no histórico da A mostra o total certo (R$ 80,00)', saleRowText.includes('80,00'), saleRowText.replace(/\s+/g, ' '));

  // Máquina A estorna 1 unidade, máquina B precisa ver o estoque voltar e o status virar "Parcial"
  await pageA.click('#sales-tbody [data-view]');
  await pageA.waitForTimeout(300);
  await pageA.fill('[data-refund-qty="0"]', '1');
  await pageA.fill('#refund-reason', 'Teste multi-terminal de estorno');
  await pageA.click('#confirm-refund-btn');
  await pageA.waitForTimeout(500);

  await pageB.waitForTimeout(700);
  const stockAfterRefundB = await pageB.locator('#products-tbody tr td:nth-child(3)').first().textContent();
  check('máquina B vê o estoque voltar pra 2 após estorno feito na A (1+1=2)', stockAfterRefundB.trim() === '2', stockAfterRefundB);
  const saleRowAfterRefundB = await pageB.locator('#sales-tbody tr').first().textContent();
  check('máquina B vê o status "Parcial" e total líquido atualizado (R$ 40,00) em tempo real', saleRowAfterRefundB.includes('Parcial') && saleRowAfterRefundB.includes('40,00'), saleRowAfterRefundB.replace(/\s+/g, ' '));

  console.log('\nerros JS máquina A:', errorsA.length, JSON.stringify(errorsA));
  console.log('erros JS máquina B:', errorsB.length, JSON.stringify(errorsB));
  const ok = results.every(Boolean) && errorsA.length === 0 && errorsB.length === 0;
  console.log('\n' + (ok ? 'TUDO OK — VENDAS MULTI-TERMINAL FUNCIONANDO' : 'ALGO FALHOU'));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
