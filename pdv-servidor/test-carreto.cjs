// Prova views/carreto.js (copiada sem alteração da extensão) contra o
// servidor multi-terminal — Fase 9, passo 10. Cobre cadastro de carreto
// (item de estoque + item avulso), detalhe, marcar como entregue,
// cancelar, e as adversárias que fecham o círculo: o servidor nunca deixa
// agir duas vezes sobre um carreto que já saiu do estado "pendente".
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-carreto.cjs` noutra.
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
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('console.error: ' + m.text()); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page);

  // ---------- Setup: cliente + produto pro item de estoque ----------
  await page.goto(`${BASE}/#/clientes`);
  await page.waitForTimeout(500);
  await page.click('#new-customer-btn');
  await page.waitForTimeout(300);
  await page.fill('#f-nome', 'Cliente Carreto Teste');
  await page.click('.modal button:has-text("Cadastrar cliente")');
  await page.waitForTimeout(500);

  await page.goto(`${BASE}/#/estoque`);
  await page.waitForTimeout(400);
  await page.click('button:has-text("+ Novo produto")');
  await page.waitForTimeout(300);
  await page.fill('#f-name', 'Produto Carreto Teste');
  await page.fill('#f-barcode', 'CARRETO-1111');
  await page.fill('#f-price', '30');
  await page.fill('#f-cost', '15');
  await page.fill('#f-quantity', '20');
  await page.click('.modal button:has-text("Cadastrar produto")');
  await page.waitForTimeout(500);

  // ---------- Cadastro de carreto (item de estoque + item avulso) ----------
  await page.goto(`${BASE}/#/carreto`);
  await page.waitForTimeout(500);
  await page.click('#new-delivery-btn');
  await page.waitForTimeout(300);

  await page.fill('#customer-search', 'Cliente Carreto Teste');
  await page.waitForTimeout(400);
  await page.click('[data-pick-customer]');
  await page.waitForTimeout(300);

  // linha 0 já vem pronta como item de estoque (addRow('estoque') no mount)
  await page.fill('[data-item-search="0"]', 'Produto Carreto Teste');
  await page.waitForTimeout(400);
  await page.click('[data-pick-product]');
  await page.waitForTimeout(300);
  await page.fill('[data-item-qty="0"]', '3');

  await page.click('#add-avulso-row-btn');
  await page.waitForTimeout(200);
  await page.fill('[data-item-name-input="1"]', 'Carga de areia');
  await page.fill('[data-item-qty="1"]', '2');

  await page.fill('#f-responsible', 'João Motorista');
  await page.click('.modal button:has-text("Cadastrar carreto")');
  await page.waitForTimeout(600);

  let listText = await page.locator('#view-root').innerText();
  check('Carreto recém-cadastrado aparece na lista (filtro Pendentes, padrão)', listText.includes('Cliente Carreto Teste') && listText.includes('João Motorista'), listText.slice(0, 300));
  check('Coluna "Itens" mostra 2 (estoque + avulso)', /\bCliente Carreto Teste[\s\S]{0,120}\b2\b/.test(listText), listText.match(/Cliente Carreto Teste[\s\S]{0,120}/)?.[0]);

  // ---------- Detalhe mostra os 2 itens certos ----------
  await page.click('[data-detail]');
  await page.waitForTimeout(400);
  const detailText = await page.locator('.modal').innerText();
  // Os badges de origem (Estoque/Avulso) têm text-transform:uppercase no
  // CSS — innerText() reflete o texto VISUAL renderizado (ESTOQUE/AVULSO),
  // não o texto original do HTML, então a checagem precisa ser
  // case-insensitive (mesma pegadinha de "R$ 20,00" com NBSP na Fase
  // anterior: sempre olhar o texto de verdade que o navegador mostra).
  check('Detalhe mostra o item de estoque (3un, badge "Estoque")', detailText.includes('Produto Carreto Teste') && /3\s*un/.test(detailText) && /estoque/i.test(detailText), detailText.slice(0, 400));
  check('Detalhe mostra o item avulso (2un, badge "Avulso")', detailText.includes('Carga de areia') && /avulso/i.test(detailText));
  check('Detalhe tem botão "Marcar como entregue" (ainda pendente)', detailText.includes('Marcar como entregue'));

  // ---------- Marca como entregue ----------
  await page.click('.modal button:has-text("Marcar como entregue")');
  await page.waitForTimeout(600);

  await page.selectOption('#status-filter', 'entregue', { force: true });
  await page.waitForTimeout(500);
  listText = await page.locator('#view-root').innerText();
  check('Depois de "Marcar como entregue", o carreto aparece no filtro "Entregues"', listText.includes('Cliente Carreto Teste') && /ENTREGUE/i.test(listText), listText.slice(0, 300));

  await page.selectOption('#status-filter', 'pendente', { force: true });
  await page.waitForTimeout(500);
  listText = await page.locator('#view-root').innerText();
  check('E some do filtro "Pendentes"', !listText.includes('Cliente Carreto Teste'));

  check('Zero erros JS/rede durante o fluxo real (cadastro/detalhe/entrega)', errors.length === 0, JSON.stringify(errors));

  // ---------- Segundo carreto, pra testar cancelamento ----------
  await page.click('#new-delivery-btn');
  await page.waitForTimeout(300);
  await page.fill('#customer-search', 'Cliente Carreto Teste');
  await page.waitForTimeout(400);
  await page.click('[data-pick-customer]');
  await page.waitForTimeout(300);
  await page.click('#add-avulso-row-btn');
  await page.waitForTimeout(200);
  // remove a linha 0 (estoque, vazia) pra sobrar só o avulso preenchido
  await page.click('[data-remove-row="0"]');
  await page.fill('[data-item-name-input="1"]', 'Carga de tijolos');
  await page.fill('[data-item-qty="1"]', '1');
  await page.click('.modal button:has-text("Cadastrar carreto")');
  await page.waitForTimeout(600);

  await page.click('[data-detail]');
  await page.waitForTimeout(400);
  await page.click('#cancel-delivery-btn');
  await page.waitForTimeout(300);
  // O confirmDialog reusa o mesmo texto "Cancelar carreto" no botão de
  // confirmar, mas dentro de um SEGUNDO .modal-backdrop empilhado por
  // cima do primeiro — has-text("Cancelar carreto") sozinho casa os dois
  // (o #cancel-delivery-btn original também bate), e um clique ambíguo
  // reabre o mesmo confirmDialog em vez de confirmar. modal.js#confirmDialog
  // sempre marca o botão de confirmar com data-action="ok" (openModal usa
  // "submit"/"cancel") — único no DOM enquanto só um confirmDialog está
  // aberto por vez.
  await page.click('[data-action="ok"]');
  await page.waitForTimeout(600);

  await page.selectOption('#status-filter', 'cancelado', { force: true });
  await page.waitForTimeout(500);
  listText = await page.locator('#view-root').innerText();
  check('Segundo carreto aparece como CANCELADO no filtro certo', /CANCELADO/i.test(listText), listText.slice(0, 300));

  // ---------- Adversário: não dá pra marcar como entregue um carreto já cancelado ----------
  const deliverCancelledResult = await page.evaluate(async () => {
    const listRes = await fetch('/api/deliveries?status=cancelado', { credentials: 'include' });
    const { deliveries } = await listRes.json();
    const delivery = deliveries.find((d) => d.items.some((i) => i.name === 'Carga de tijolos'));
    const res = await fetch(`/api/deliveries/${delivery.id}/entregar`, { method: 'POST', credentials: 'include' });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  });
  check('Servidor rejeita marcar como entregue um carreto já cancelado', deliverCancelledResult.status >= 400 && /não está mais pendente/i.test(deliverCancelledResult.body.error || ''), JSON.stringify(deliverCancelledResult));

  // ---------- Adversário: não dá pra cancelar um carreto já entregue ----------
  const cancelDeliveredResult = await page.evaluate(async () => {
    const listRes = await fetch('/api/deliveries?status=entregue', { credentials: 'include' });
    const { deliveries } = await listRes.json();
    const delivery = deliveries.find((d) => d.customerName === 'Cliente Carreto Teste');
    const res = await fetch(`/api/deliveries/${delivery.id}/cancelar`, { method: 'POST', credentials: 'include' });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  });
  check('Servidor rejeita cancelar um carreto já entregue', cancelDeliveredResult.status >= 400 && /só é possível cancelar um carreto pendente/i.test(cancelDeliveredResult.body.error || ''), JSON.stringify(cancelDeliveredResult));

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
