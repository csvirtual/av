// Prova views/compras.js (copiada sem alteração da extensão) contra o
// servidor multi-terminal — Fase 9, passo 13. Fornecedores (CRUD com
// leitura aberta, escrita exigindo 'compras') e pedidos de compra (aberto
// a 'compras' inteiro, recebimento total/parcial credita estoque+custo na
// mesma transação, cancelamento só antes de qualquer recebimento,
// sugestão automática agrupada por fornecedor). Toda a lógica de negócio
// já existia pronta no servidor desde a Fase 5 (routes/suppliers.js,
// routes/purchases.js) — este passo só ligou a tela real por cima.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-compras.cjs` noutra.
const { chromium } = require('playwright');

const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login(page, username, password) {
  await page.goto(BASE);
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(600);
}

async function apiCall(page, path, opts = {}) {
  const res = await page.request.fetch(`${BASE}${path}`, {
    method: opts.method || 'GET',
    data: opts.body,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('console.error: ' + m.text()); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page, 'admin', 'admin123');

  // Dois produtos: um normal (recebimento credita quantity+costPrice) e um
  // 'personalizado' (achado de auditoria da extensão: costPrice desse tipo
  // fica travado em 0 pra sempre — recebimento não pode corromper isso).
  const prodRes = await apiCall(page, '/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: '7891111111111', name: 'Arroz 5kg', unit: 'un', price: 25, costPrice: 15, minStock: 5 }),
  });
  const productId = prodRes.body.product.id;
  check('Produto normal criado (pra receber no pedido)', prodRes.status === 201, prodRes.status);

  const customProdRes = await apiCall(page, '/api/products', {
    method: 'POST', body: JSON.stringify({
      barcode: '7892222222222', name: 'Corda (metro/rolo)', unit: 'personalizado',
      customUnitLabel: 'metro', customForms: [{ forma: 'Metro avulso', valor: 3, custo: 0, fator: 1 }], minStock: 2,
    }),
  });
  const customProductId = customProdRes.body.product && customProdRes.body.product.id;
  check('Produto personalizado criado (achado: costPrice travado em 0)', customProdRes.status === 201 && customProdRes.body.product.costPrice === 0, JSON.stringify(customProdRes));

  // Vendedor sem a permissão 'compras' — pra provar o gate.
  const vendorSetup = await apiCall(page, '/api/users', {
    method: 'POST', body: JSON.stringify({ nome: 'Vendedor Sem Compras', username: 'vendedor.sem.compras', password: 'senhaVendedor1', permissions: {} }),
  });
  check('Vendedor sem "compras" criado', vendorSetup.status === 201, vendorSetup.status);

  // ---------- Fornecedores: fluxo real ----------
  await page.goto(`${BASE}/#/compras`);
  await page.waitForTimeout(600);
  let viewText = await page.locator('#view-root').innerText();
  check('Tela abre na aba Pedidos, sem fornecedor nenhum ainda', viewText.includes('0 pedido(s)'));

  await page.click('#tab-fornecedores');
  await page.waitForTimeout(400);
  await page.click('#new-supplier-btn');
  await page.waitForTimeout(300);
  await page.fill('#f-nome', 'Fornecedor Teste');
  await page.fill('#f-telefone', '11987654321');
  await page.fill('#f-email', 'fornecedor@teste.com');
  await page.fill('#f-documento', '11144477735'); // CPF válido (dígitos verificadores corretos)
  await page.click('.modal button:has-text("Cadastrar fornecedor")');
  await page.waitForTimeout(600);
  viewText = await page.locator('#view-root').innerText();
  check('Fornecedor cadastrado aparece na lista, ativo', viewText.includes('Fornecedor Teste') && /ATIVO/i.test(viewText), viewText.slice(0, 300));

  // Adversária de validação client-side: e-mail inválido barrado ANTES de chamar o servidor.
  await page.click('#new-supplier-btn');
  await page.waitForTimeout(300);
  await page.fill('#f-nome', 'Fornecedor Invalido');
  await page.fill('#f-email', 'nao-e-email');
  await page.click('.modal button:has-text("Cadastrar fornecedor")');
  await page.waitForTimeout(300);
  let modalErr = await page.locator('.modal #modal-error').innerText().catch(() => '');
  check('E-mail inválido barrado no formulário (não chega a chamar o servidor)', /e-mail inválido/i.test(modalErr), modalErr);
  await page.click('.modal button:has-text("Cancelar")');
  await page.waitForTimeout(300);

  // Inativar / reativar (via menu "Opções", que agrupa Inativar/Reativar + Excluir).
  await page.click('tr:has-text("Fornecedor Teste") [data-options]');
  await page.waitForTimeout(200);
  await page.locator('.row-options-item:has-text("Inativar")').click();
  await page.waitForTimeout(300);
  await page.click('[data-action="ok"]');
  await page.waitForTimeout(600);
  viewText = await page.locator('#view-root').innerText();
  check('Inativar fornecedor muda status pra INATIVO', /INATIVO/i.test(viewText), viewText.slice(0, 300));
  await page.click('tr:has-text("Fornecedor Teste") [data-options]');
  await page.waitForTimeout(200);
  await page.locator('.row-options-item:has-text("Reativar")').click();
  await page.waitForTimeout(300);
  await page.click('[data-action="ok"]');
  await page.waitForTimeout(600);
  viewText = await page.locator('#view-root').innerText();
  check('Reativar volta status pra ATIVO', /\bATIVO\b/i.test(viewText) && !/INATIVO/i.test(viewText));

  const supplierList = await apiCall(page, '/api/suppliers');
  const supplierId = supplierList.body.suppliers.find((s) => s.nome === 'Fornecedor Teste').id;

  // Marca o produto normal com este fornecedor padrão, pra alimentar a sugestão automática depois.
  await apiCall(page, `/api/products/${productId}`, { method: 'PUT', body: JSON.stringify({ supplierId }) });

  // ---------- Pedidos: criar, receber parcial, receber o resto, detalhe ----------
  await page.click('#tab-pedidos');
  await page.waitForTimeout(400);
  await page.click('#new-order-btn');
  await page.waitForTimeout(300);
  await page.fill('[data-item-search="0"]', 'Arroz');
  await page.waitForTimeout(400);
  await page.click('[data-pick-product]');
  await page.waitForTimeout(200);
  await page.fill('[data-item-qty="0"]', '20');
  await page.fill('[data-item-cost="0"]', '16');
  await page.click('.modal button:has-text("Criar pedido")');
  await page.waitForTimeout(600);
  viewText = await page.locator('#view-root').innerText();
  check('Pedido de compra criado aparece na lista, status ABERTO', viewText.includes('Fornecedor Teste') && /ABERTO/i.test(viewText), viewText.slice(0, 300));

  const ordersAfterCreate = await apiCall(page, '/api/purchases');
  const orderId = ordersAfterCreate.body.orders[0].id;
  check('Pedido tem 20 unidades pedidas, custo unit. R$ 16', ordersAfterCreate.body.orders[0].items[0].qtyOrdered === 20 && ordersAfterCreate.body.orders[0].items[0].unitCost === 16);

  // Detalhe + recebimento parcial (12 de 20).
  await page.click('[data-detail]');
  await page.waitForTimeout(300);
  await page.click('.modal button:has-text("Receber mercadoria")');
  await page.waitForTimeout(300);
  await page.fill('[data-recv-qty]', '12');
  await page.click('.modal button:has-text("Confirmar recebimento")');
  await page.waitForTimeout(700);
  viewText = await page.locator('#view-root').innerText();
  check('Recebimento parcial (12/20) muda status pra RECEBIDO PARCIALMENTE', /RECEBIDO PARCIALMENTE/i.test(viewText), viewText.slice(0, 300));

  const productAfterPartial = await apiCall(page, `/api/products/${productId}`);
  check('Estoque do produto creditado com os 12 recebidos (0 → 12)', productAfterPartial.body.product.quantity === 12, productAfterPartial.body.product.quantity);
  check('Custo do produto atualizado pro custo do recebimento (R$ 16)', productAfterPartial.body.product.costPrice === 16, productAfterPartial.body.product.costPrice);

  // Recebe o restante (8 de 20) — status vira RECEBIDO.
  await page.click('[data-detail]');
  await page.waitForTimeout(300);
  await page.click('.modal button:has-text("Receber mercadoria")');
  await page.waitForTimeout(300);
  await page.click('.modal button:has-text("Confirmar recebimento")'); // já vem pré-preenchido com o restante
  await page.waitForTimeout(700);
  viewText = await page.locator('#view-root').innerText();
  check('Recebimento do restante (8/8 pendentes) fecha o pedido: status RECEBIDO', /(?<!PARCIALMENTE\s)\bRECEBIDO\b/i.test(viewText), viewText.slice(0, 300));

  const productAfterFull = await apiCall(page, `/api/products/${productId}`);
  check('Estoque do produto com os 20 completos (12 → 20)', productAfterFull.body.product.quantity === 20, productAfterFull.body.product.quantity);

  // ---------- Adversária: não dá pra receber além do pedido ----------
  const overReceive = await apiCall(page, `/api/purchases/${orderId}/receber`, {
    method: 'POST', body: JSON.stringify({ items: [{ productId, qty: 1 }], dedupeKey: crypto.randomUUID() }),
  });
  check('Servidor rejeita receber mais do que o pedido já fechado permite', overReceive.status === 400, JSON.stringify(overReceive));

  // ---------- Adversária: reenvio duplicado (dedupeKey) num recebimento novo ----------
  const dupeOrderRes = await apiCall(page, '/api/purchases', {
    method: 'POST', body: JSON.stringify({ supplierId, items: [{ productId, qty: 5, unitCost: 10 }] }),
  });
  const dupeOrderId = dupeOrderRes.body.order.id;
  const dedupeKey = 'dupe-receive-key';
  const firstReceive = await apiCall(page, `/api/purchases/${dupeOrderId}/receber`, {
    method: 'POST', body: JSON.stringify({ items: [{ productId, qty: 5 }], dedupeKey }),
  });
  const secondReceive = await apiCall(page, `/api/purchases/${dupeOrderId}/receber`, {
    method: 'POST', body: JSON.stringify({ items: [{ productId, qty: 5 }], dedupeKey }),
  });
  check('Primeiro recebimento com dedupeKey passa', firstReceive.status === 200, firstReceive.status);
  check('Reenvio do MESMO recebimento (mesma dedupeKey) é rejeitado', secondReceive.status === 409, secondReceive.status);

  // ---------- Adversária: cancelar pedido sem recebimento funciona, com recebimento é bloqueado ----------
  const cancelableOrderRes = await apiCall(page, '/api/purchases', {
    method: 'POST', body: JSON.stringify({ supplierId, items: [{ productId, qty: 3, unitCost: 10 }] }),
  });
  const cancelableOrderId = cancelableOrderRes.body.order.id;
  const cancelOk = await apiCall(page, `/api/purchases/${cancelableOrderId}/cancelar`, { method: 'POST' });
  check('Cancelar pedido sem recebimento nenhum funciona', cancelOk.status === 200 && cancelOk.body.order.status === 'cancelado', JSON.stringify(cancelOk));

  const cancelBlocked = await apiCall(page, `/api/purchases/${dupeOrderId}/cancelar`, { method: 'POST' });
  check('Cancelar pedido que já teve recebimento é bloqueado', cancelBlocked.status === 400, JSON.stringify(cancelBlocked));

  // ---------- Adversária: recebimento de produto 'personalizado' não corrompe costPrice travado em 0 ----------
  const customOrderRes = await apiCall(page, '/api/purchases', {
    method: 'POST', body: JSON.stringify({ supplierId, items: [{ productId: customProductId, name: 'Corda', unit: 'personalizado', qty: 10, unitCost: 7.5 }] }),
  });
  const customOrderId = customOrderRes.body.order.id;
  const customReceive = await apiCall(page, `/api/purchases/${customOrderId}/receber`, {
    method: 'POST', body: JSON.stringify({ items: [{ productId: customProductId, qty: 10, unitCost: 7.5 }], dedupeKey: crypto.randomUUID() }),
  });
  check('Recebimento de produto personalizado funciona', customReceive.status === 200, customReceive.status);
  const customProductAfter = await apiCall(page, `/api/products/${customProductId}`);
  check(
    'costPrice do produto personalizado continua travado em 0 mesmo depois de receber com custo unitário informado (achado de auditoria da extensão)',
    customProductAfter.body.product.costPrice === 0,
    customProductAfter.body.product.costPrice,
  );
  check('Mas a quantidade dele foi creditada normalmente (0 → 10)', customProductAfter.body.product.quantity === 10, customProductAfter.body.product.quantity);

  check('Zero erros JS/rede durante o fluxo real (fornecedor/pedido/recebimento parcial+total)', errors.length === 0, JSON.stringify(errors));

  // ---------- Sugestão automática: produto abaixo do mínimo, agrupado pelo fornecedor padrão ----------
  // Depois de tudo recebido, zera o estoque do produto normal pra forçar
  // ele abaixo do mínimo (5) e aparecer na sugestão. O sinal de `qty` é
  // quem decide somar/subtrair (ver routes/products.js#commitMovement:
  // `product.quantity + input.qty`) — `type` é só rótulo descritivo, não
  // muda o sinal sozinho.
  const productBeforeZero = await apiCall(page, `/api/products/${productId}`);
  await apiCall(page, `/api/products/${productId}/movimentos`, {
    method: 'POST', body: JSON.stringify({ type: 'saida', qty: -productBeforeZero.body.product.quantity, note: 'zerando pra teste de sugestão', dedupeKey: crypto.randomUUID() }),
  });
  await page.click('#suggest-btn');
  await page.waitForTimeout(500);
  const suggestionText = await page.locator('.modal').innerText();
  check('Sugestão automática agrupa o produto abaixo do mínimo pelo fornecedor padrão', suggestionText.includes('Fornecedor Teste') && suggestionText.includes('Arroz 5kg'), suggestionText.slice(0, 300));
  await page.click('.modal button:has-text("Fechar")');
  await page.waitForTimeout(300);

  // ---------- Adversária: vendedor sem 'compras' toma 403 no gate certo ----------
  const vendorLogin = await apiCall(page, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'vendedor.sem.compras', password: 'senhaVendedor1' }) });
  check('Login do vendedor sem "compras" funciona', vendorLogin.status === 200, vendorLogin.status);

  const vendorReadSuppliers = await apiCall(page, '/api/suppliers');
  check('Vendedor sem "compras" AINDA lê a lista de fornecedores (leitura é aberta, Estoque também precisa)', vendorReadSuppliers.status === 200, vendorReadSuppliers.status);

  const vendorWriteSupplier = await apiCall(page, '/api/suppliers', { method: 'POST', body: JSON.stringify({ nome: 'Fornecedor Pirata' }) });
  check('Vendedor sem "compras" toma 403 tentando CRIAR fornecedor', vendorWriteSupplier.status === 403, vendorWriteSupplier.status);

  const vendorReadPurchases = await apiCall(page, '/api/purchases');
  check('Vendedor sem "compras" toma 403 até pra LER pedidos de compra (rota inteira exige a permissão, igual a extensão)', vendorReadPurchases.status === 403, vendorReadPurchases.status);

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
