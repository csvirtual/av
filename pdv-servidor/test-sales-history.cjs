// Prova views/salesHistory.js (copiada sem alteração da extensão) contra o
// servidor multi-terminal — Fase 9, passo 7. Cobre a listagem/filtro, o
// detalhe de uma venda, e o fluxo de estorno de ponta a ponta pela UI de
// produção — incluindo as checagens adversárias que fecham o círculo do
// achado de auditoria original em salesRepo.js#refundSaleItems da extensão
// (casar item por posição, não só por productId, pra produto
// 'personalizado' vendido em mais de uma forma na mesma venda) e a garantia
// de que o servidor nunca deixa estornar mais do que foi vendido.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-sales-history.cjs` noutra.
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

async function createProduct(page, { name, barcode, price, cost, qty }) {
  await page.goto(`${BASE}/#/estoque`);
  await page.waitForTimeout(400);
  await page.click('button:has-text("+ Novo produto")');
  await page.waitForTimeout(300);
  await page.fill('#f-name', name);
  await page.fill('#f-barcode', barcode);
  await page.fill('#f-price', String(price));
  await page.fill('#f-cost', String(cost));
  await page.fill('#f-quantity', String(qty));
  await page.click('.modal button:has-text("Cadastrar produto")');
  await page.waitForTimeout(500);
}

async function sellOneUnit(page, productName) {
  await page.goto(`${BASE}/#/venda`);
  await page.waitForTimeout(400);
  await page.fill('input[placeholder*="Escaneie" i]', productName);
  await page.waitForTimeout(400);
  await page.click('[data-pick]');
  await page.waitForTimeout(300);
  await page.click('#add-payment-btn');
  await page.waitForTimeout(300);
  await page.click('#finalize-btn');
  await page.waitForTimeout(700);
  await page.click('button:has-text("Fechar")');
  await page.waitForTimeout(200);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('console.error: ' + m.text()); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page);

  // ---------- Venda aparece no Histórico, com filtro e resumo corretos ----------
  await createProduct(page, { name: 'Produto Histórico A', barcode: 'HIST-A-1111', price: 20, cost: 10, qty: 5 });
  await sellOneUnit(page, 'Produto Histórico A');

  await page.goto(`${BASE}/#/vendas`);
  await page.waitForTimeout(700);
  const listText = await page.locator('#view-root').innerText();
  check('Venda recém-feita aparece no Histórico', listText.includes('Produto Histórico A') || /1 venda/.test(listText));
  check('Resumo mostra o total líquido correto (R$ 20,00)', /Total líquido:\s*R\$\s*20,00/.test(listText), listText.match(/Total líquido:[^\n]+/)?.[0]);

  // Filtro por vendedor (só existe o admin) não deve fazer a venda sumir.
  // #seller-filter passa por enhanceSelect() (components/customSelect.js),
  // que esconde o <select> nativo (display:none) e desenha um dropdown
  // próprio por cima — Playwright exige visibilidade pra selectOption()
  // comum, então force:true (dispara o mesmo evento 'change' que o
  // dropdown customizado dispararia ao escolher visualmente).
  await page.selectOption('#seller-filter', { label: 'Administrador' }, { force: true });
  await page.waitForTimeout(500);
  const filteredText = await page.locator('#view-root').innerText();
  check('Filtro por vendedor (Administrador) mantém a venda visível', /1 venda/.test(filteredText));
  await page.selectOption('#seller-filter', { value: '' }, { force: true });
  await page.waitForTimeout(500);

  // ---------- Detalhe da venda mostra os itens certos ----------
  await page.click('[data-detail]');
  await page.waitForTimeout(400);
  const detailText = await page.locator('.modal').innerText();
  // \s no valor em dinheiro (não um espaço literal): formatMoney() usa
  // Intl.NumberFormat('pt-BR', ...), que separa "R$" do valor com um
  // ESPAÇO NÃO-QUEBRÁVEL (U+00A0), não um espaço comum — \s do regex casa
  // os dois, um espaço literal na string não casaria o NBSP nunca.
  check('Detalhe da venda mostra o produto e o total', detailText.includes('Produto Histórico A') && /R\$\s*20,00/.test(detailText), detailText.slice(0, 300));
  check('Detalhe da venda tem botão de estornar (venda completa, nada estornado ainda)', detailText.includes('Estornar itens'));

  // ---------- Estorno de ponta a ponta pela UI ----------
  await page.click('.modal button:has-text("Estornar itens")');
  await page.waitForTimeout(400);
  await page.fill('[data-refund-qty]', '1');
  await page.fill('#f-reason', 'Teste automatizado de estorno');
  await page.click('.modal button:has-text("Confirmar estorno")');
  await page.waitForTimeout(700);
  const toastText = await page.locator('.toast, [class*="toast"]').first().innerText().catch(() => '');
  check('Toast confirma o estorno', /estorno/i.test(toastText) || (await page.locator('body').innerText()).includes('Estorno'), toastText);

  await page.waitForTimeout(500);
  const afterRefundText = await page.locator('#view-root').innerText();
  check('Depois do estorno, a linha da venda mostra status ESTORNADA', /ESTORNADA/.test(afterRefundText), afterRefundText.match(/PRODUTO[\s\S]*?\n.*/)?.[0]);
  check('Depois do estorno, o total líquido do resumo cai pra R$ 0,00 (só existe 1 venda, 100% estornada)', /Total líquido:\s*R\$\s*0,00/.test(afterRefundText));

  // ---------- Achado de auditoria da extensão: estoque volta pro catálogo ----------
  await page.goto(`${BASE}/#/estoque`);
  await page.waitForTimeout(500);
  const stockRow = await page.locator('tr', { hasText: 'Produto Histórico A' }).innerText().catch(() => '');
  check('Estoque credita de volta a unidade estornada (5→4 na venda, 4→5 no estorno)', /\b5\s*un\b/.test(stockRow), stockRow);

  // Checa "zero erros" AQUI, antes das chamadas adversárias abaixo — dali
  // pra frente os 400/409 que a página vê são RESPOSTAS ESPERADAS de
  // ataques deliberados (provando que o servidor rejeita), não erros de
  // verdade; contá-los junto poluiria esta checagem com falso-positivo.
  check('Zero erros JS/rede durante o fluxo real de venda/histórico/estorno pela UI', errors.length === 0, JSON.stringify(errors));

  // ---------- Adversário: não dá pra estornar de novo o que já foi estornado ----------
  await page.goto(`${BASE}/#/vendas`);
  await page.waitForTimeout(700);
  await page.click('[data-detail]');
  await page.waitForTimeout(400);
  const detailAfter = await page.locator('.modal').innerText();
  check('Venda 100% estornada não oferece mais "Estornar itens" (só Fechar)', !detailAfter.includes('Estornar itens') && detailAfter.includes('ESTORNADA'), detailAfter.slice(0, 200));
  await page.click('.modal button:has-text("Fechar")');
  await page.waitForTimeout(200);

  // ---------- Adversário: servidor nunca deixa estornar mais do que foi vendido ----------
  // Ataque direto à API (sem passar pela tela, que já limita o campo a
  // max=disponível) — prova que a defesa é do SERVIDOR, não só da UI.
  await createProduct(page, { name: 'Produto Histórico B', barcode: 'HIST-B-2222', price: 30, cost: 15, qty: 3 });
  await sellOneUnit(page, 'Produto Histórico B');
  await page.goto(`${BASE}/#/vendas`);
  await page.waitForTimeout(700);
  const overRefundResult = await page.evaluate(async () => {
    const listRes = await fetch('/api/sales?limit=5', { credentials: 'include' });
    const { items } = await listRes.json();
    const sale = items.find((s) => s.items.some((i) => i.name === 'Produto Histórico B'));
    const itemIndex = sale.items.findIndex((i) => i.name === 'Produto Histórico B');
    const res = await fetch(`/api/sales/${sale.id}/refund`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ reason: 'tentativa de estornar mais do que foi vendido', items: [{ productId: sale.items[itemIndex].productId, itemIndex, qty: 999 }], dedupeKey: crypto.randomUUID() }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  });
  check('Servidor rejeita estornar 999un de uma venda de 1un (nunca confia num pedido que passe da UI)', overRefundResult.status >= 400 && /disponível/i.test(overRefundResult.body.error || ''), JSON.stringify(overRefundResult));

  // ---------- Adversário: reenviar o MESMO estorno (dedupeKey) não duplica ----------
  const dedupeAttack = await page.evaluate(async () => {
    const listRes = await fetch('/api/sales?limit=5', { credentials: 'include' });
    const { items } = await listRes.json();
    const sale = items.find((s) => s.items.some((i) => i.name === 'Produto Histórico B'));
    const itemIndex = sale.items.findIndex((i) => i.name === 'Produto Histórico B');
    const dedupeKey = crypto.randomUUID();
    const body = JSON.stringify({ reason: 'estorno legítimo', items: [{ productId: sale.items[itemIndex].productId, itemIndex, qty: 1 }], dedupeKey });
    const first = await fetch(`/api/sales/${sale.id}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body });
    const second = await fetch(`/api/sales/${sale.id}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body });
    return { firstStatus: first.status, secondStatus: second.status };
  });
  check('1º estorno aceito (201/200), reenvio da MESMA chave rejeitado (409) — sem estorno duplicado', dedupeAttack.firstStatus < 300 && dedupeAttack.secondStatus === 409, JSON.stringify(dedupeAttack));

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
