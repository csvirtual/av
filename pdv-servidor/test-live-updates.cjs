// Prova a atualização em tempo real via WebSocket ligada em
// public/js/app.js: uma tela aberta reflete o que outro terminal fez sem
// precisar de F5 manual (fechando o gap que test-real-ui.cjs deixou
// documentado). Mesma metodologia de duas "máquinas" reais (contextos de
// navegador isolados) das fases anteriores.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-live-updates.cjs` noutra.
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

/** Espera até `fn()` devolver true, sem navegar nem recarregar a página —
 * é exatamente o comportamento que este teste está provando (a tela se
 * atualiza sozinha). Falha (devolve false) se o prazo estourar. */
async function waitFor(fn, { timeoutMs = 5000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  const ctxA = await browser.newContext();
  const machineA = await ctxA.newPage();
  const ctxB = await browser.newContext();
  const machineB = await ctxB.newPage();

  await login(machineA);
  await login(machineB);

  // ---------- Estoque se atualiza sozinho quando outro terminal cadastra ----------
  await machineA.goto(`${BASE}/#/estoque`);
  await machineA.waitForTimeout(500); // dá tempo do WebSocket abrir (connectLive())

  await machineB.goto(`${BASE}/#/estoque`);
  await machineB.waitForTimeout(400);
  await machineB.click('button:has-text("+ Novo produto")');
  await machineB.waitForTimeout(300);
  await machineB.fill('#f-name', 'Produto Tempo Real (WS)');
  await machineB.fill('#f-barcode', 'WSLIVE-1111');
  await machineB.fill('#f-price', '15');
  await machineB.fill('#f-cost', '10');
  await machineB.fill('#f-quantity', '20');
  await machineB.click('.modal button:has-text("Cadastrar produto")');
  await machineB.waitForTimeout(400);

  const sawNewProduct = await waitFor(async () => {
    const text = await machineA.locator('#view-root').innerText();
    return text.includes('Produto Tempo Real (WS)');
  });
  check('Máquina A: vê o produto cadastrado pela B na hora, sem F5/navegação', sawNewProduct);

  // ---------- Baixa de estoque de uma venda em B também aparece sozinha em A ----------
  await machineB.goto(`${BASE}/#/venda`);
  await machineB.waitForTimeout(400);
  await machineB.fill('input[placeholder*="Escaneie" i]', 'Produto Tempo Real (WS)');
  await machineB.waitForTimeout(400);
  await machineB.click('[data-pick]');
  await machineB.waitForTimeout(300);
  await machineB.click('#add-payment-btn');
  await machineB.waitForTimeout(300);
  await machineB.click('#finalize-btn');
  await machineB.waitForTimeout(600);
  await machineB.click('button:has-text("Fechar")'); // fecha o modal de "Venda finalizada" — ele fica em document.body, sobrevive a troca de rota se não for fechado
  await machineB.waitForTimeout(200);

  const sawStockDrop = await waitFor(async () => {
    const row = await machineA.locator('tr', { hasText: 'Produto Tempo Real (WS)' }).innerText().catch(() => '');
    return /\b19\s*un\b/.test(row);
  });
  const finalRow = await machineA.locator('tr', { hasText: 'Produto Tempo Real (WS)' }).innerText().catch(() => '(linha não encontrada)');
  check('Máquina A: estoque cai sozinho (20→19) depois da venda feita em B, sem F5', sawStockDrop, finalRow);

  // ---------- Um modal aberto em A não é derrubado por um refresh ao vivo ----------
  await machineA.click('button:has-text("+ Novo produto")');
  await machineA.waitForTimeout(300);
  await machineA.fill('#f-name', 'Rascunho não deve sumir');
  // machineB terminou a venda na tela de PDV — volta pro Estoque antes de
  // cadastrar o próximo produto de teste.
  await machineB.goto(`${BASE}/#/estoque`);
  await machineB.waitForTimeout(400);
  await machineB.click('button:has-text("+ Novo produto")');
  await machineB.waitForTimeout(300);
  await machineB.fill('#f-name', 'Outro produto qualquer');
  await machineB.fill('#f-barcode', 'WSLIVE-2222');
  await machineB.fill('#f-price', '5');
  await machineB.fill('#f-cost', '3');
  await machineB.fill('#f-quantity', '1');
  await machineB.click('.modal button:has-text("Cadastrar produto")');
  await machineA.waitForTimeout(1200); // além do debounce de 500ms do refresh ao vivo
  const draftStillThere = await machineA.locator('.modal #f-name').inputValue().catch(() => null);
  check('Máquina A: modal aberto (rascunho de outro produto) sobrevive a um refresh ao vivo chegando ao mesmo tempo', draftStillThere === 'Rascunho não deve sumir', draftStillThere);
  await machineA.keyboard.press('Escape');
  await machineA.waitForTimeout(200);

  // ---------- Tela de PDV, de propósito, não se auto-recarrega em cima de um carrinho ----------
  await machineA.goto(`${BASE}/#/venda`);
  await machineA.waitForTimeout(400);
  await machineA.fill('input[placeholder*="Escaneie" i]', 'Produto Tempo Real (WS)');
  await machineA.waitForTimeout(400);
  await machineA.click('[data-pick]');
  await machineA.waitForTimeout(300);
  const cartBefore = await machineA.locator('#view-root').innerText();
  await machineB.click('button:has-text("+ Novo produto")');
  await machineB.waitForTimeout(300);
  await machineB.fill('#f-name', 'Mais um produto (não deve mexer no PDV de A)');
  await machineB.fill('#f-barcode', 'WSLIVE-3333');
  await machineB.fill('#f-price', '7');
  await machineB.fill('#f-cost', '4');
  await machineB.fill('#f-quantity', '1');
  await machineB.click('.modal button:has-text("Cadastrar produto")');
  await machineA.waitForTimeout(1200);
  const cartAfter = await machineA.locator('#view-root').innerText();
  check('Máquina A: carrinho do PDV continua intacto (não recarrega sozinho por produto novo em outro terminal)', cartBefore === cartAfter);

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
