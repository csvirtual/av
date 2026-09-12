// Prova a Fase 9 por completo: Estoque e PDV REAIS (views/products.js e
// views/sale.js da extensão, portados sem reescrita — não mais
// public/test.html) rodando contra o servidor multi-terminal, com duas
// máquinas de verdade (contextos de navegador isolados, sem cookie
// compartilhado) vendo o mesmo catálogo/venda em tempo real — mesma
// metodologia de validação da Fase 1 (test-multi-terminal.cjs), agora com
// a interface de produção.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-real-ui.cjs` noutra.
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

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // Duas "máquinas" de verdade — contextos separados, sem cookie
  // compartilhado, cada uma faz o próprio login (mesmo raciocínio de
  // test-multi-terminal.cjs).
  const ctxA = await browser.newContext();
  const machineA = await ctxA.newPage();
  const ctxB = await browser.newContext();
  const machineB = await ctxB.newPage();

  const errorsA = []; const errorsB = [];
  const trackErrors = (page, bucket) => {
    page.on('pageerror', (e) => bucket.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) bucket.push('console.error: ' + m.text()); });
    page.on('response', (res) => { if (!res.ok() && res.status() !== 304 && !res.url().endsWith('/api/auth/me')) bucket.push(`HTTP ${res.status()} ${res.url()}`); });
  };
  trackErrors(machineA, errorsA);
  trackErrors(machineB, errorsB);

  await login(machineA);
  await login(machineB);

  // ---------- Máquina A: cadastra produto pela tela REAL de Estoque ----------
  await machineA.goto(`${BASE}/#/estoque`);
  await machineA.waitForTimeout(400);
  await machineA.click('button:has-text("+ Novo produto")');
  await machineA.waitForTimeout(300);
  await machineA.fill('#f-name', 'Cimento Multi-Terminal (UI real)');
  await machineA.fill('#f-barcode', 'REALUI-1111');
  await machineA.fill('#f-price', '32');
  await machineA.fill('#f-cost', '24');
  await machineA.fill('#f-quantity', '50');
  await machineA.click('.modal button:has-text("Cadastrar produto")');
  await machineA.waitForTimeout(500);
  check('Máquina A: produto aparece na própria lista de Estoque depois de cadastrar', (await machineA.locator('#view-root').innerText()).includes('Cimento Multi-Terminal (UI real)'));

  // ---------- Máquina B: vê o produto criado pela A (server real, não WS — recarrega) ----------
  // 800ms (não 400ms) de propósito: o login de B logo acima já disparou
  // seu próprio render do Painel (redundante — hash setado vazio dispara
  // hashchange sozinho, ver comentário em app.js#renderShell) que ainda
  // pode estar em voo (fetch de verdade, não IndexedDB) quando este goto
  // roda — dá folga suficiente pra essa navegação de Estoque também
  // terminar seus próprios awaits antes da checagem.
  await machineB.goto(`${BASE}/#/estoque`);
  await machineB.waitForTimeout(800);
  check('Máquina B: vê o produto cadastrado pela Máquina A (mesmo catálogo no servidor)', (await machineB.locator('#view-root').innerText()).includes('Cimento Multi-Terminal (UI real)'));

  // ---------- Máquina B: vende o produto pela tela REAL de PDV ----------
  await machineB.goto(`${BASE}/#/venda`);
  await machineB.waitForTimeout(400);
  await machineB.fill('input[placeholder*="Escaneie" i]', 'Cimento Multi-Terminal (UI real)');
  await machineB.waitForTimeout(400);
  await machineB.click('[data-pick]');
  await machineB.waitForTimeout(300);
  const cartText = await machineB.locator('#view-root').innerText();
  check('Máquina B: item no carrinho mostra estoque restante calculado pelo SERVIDOR (50-1=49)', /49\s*un/.test(cartText), cartText.match(/Estoque restante:.*un/)?.[0]);
  await machineB.click('#add-payment-btn');
  await machineB.waitForTimeout(300);
  await machineB.click('#finalize-btn');
  await machineB.waitForTimeout(800);
  check('Máquina B: modal de "Venda finalizada" aparece', (await machineB.locator('body').innerText()).includes('Venda finalizada'));
  await machineB.click('button:has-text("Fechar")');

  // ---------- Máquina A: vê o estoque baixado pela venda feita na B ----------
  // reload() de propósito, não goto() pro mesmo hash de novo: o roteador
  // deste shell mínimo (public/js/app.js) reage a `hashchange`, que o
  // navegador não dispara pra uma navegação pro MESMO hash — sem uma
  // atualização em tempo real por WebSocket ainda (fora do escopo desta
  // fatia, ver README.md), só um F5 de verdade busca o estado fresco do
  // servidor, exatamente como um vendedor faria na prática.
  await machineA.reload();
  await machineA.waitForTimeout(400);
  // Lê a própria linha da tabela do produto (não uma janela de texto solta),
  // pra não confundir com "50" de outro lugar da tela (ex: opção "50" do
  // seletor de itens por página).
  const productRowText = await machineA.locator('tr', { hasText: 'Cimento Multi-Terminal (UI real)' }).innerText();
  check('Máquina A: estoque reflete a venda feita na Máquina B (49, não mais 50)', /\b49\s*un\b/.test(productRowText) && !/\b50\s*un\b/.test(productRowText), productRowText);

  // ---------- Segurança: preço não é confiado, permanece o mesmo do catálogo ----------
  // (já provado a fundo em test-sale-repos.cjs contra a API direto — aqui só
  // confirma que a TELA em si nunca dá oportunidade de mandar um preço
  // diferente do que o servidor decidiu: o campo de preço no carrinho nunca
  // é editável pelo vendedor, só quantidade e desconto.)
  const priceEditable = await machineB.evaluate(() => !!document.querySelector('[data-cart-unit-price], input[name="unitPrice"]'));
  check('Tela de PDV não expõe nenhum campo pra editar o preço unitário do item (só quantidade/desconto)', priceEditable === false, priceEditable);

  check('Zero erros JS/rede na Máquina A durante todo o fluxo', errorsA.length === 0, JSON.stringify(errorsA));
  check('Zero erros JS/rede na Máquina B durante todo o fluxo', errorsB.length === 0, JSON.stringify(errorsB));

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
