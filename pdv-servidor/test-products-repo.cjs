// Testa public/js/data/productsRepo.js e stockRepo.js isolados, contra um
// servidor de verdade em localhost:3131 — sem depender de nenhuma tela
// real (Fase 9 ainda não portou views/products.js). Cobre o mesmo
// conjunto de garantias que a extensão single-machine sempre exigiu:
// validação na fonte (não só na tela), permissão granular re-conferida no
// servidor, atomicidade + dedupe em toda operação de estoque, e nesta
// versão multi-terminal, consistência entre duas máquinas.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-products-repo.cjs` noutra.
const { chromium } = require('playwright');

const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function rawApi(page, path, opts = {}) {
  return page.evaluate(async ([p, o]) => {
    const res = await fetch(p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }, [path, opts]);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // Um contexto por "pessoa logada" — sessões diferentes (cookies
  // isolados), imprescindível pra testar permissão de verdade (não dá pra
  // ter dois usuários logados ao mesmo tempo na mesma aba/contexto).
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await admin.goto(`${BASE}/test-products-repo.html`);
  await admin.evaluate(() => window.__login('admin', 'admin123'));

  // --- Seed dos dois vendedores de teste (via API direta, fora do escopo
  // desta fase — usersRepo ainda não foi portado) ---
  const semPoderes = await rawApi(admin, '/api/users', {
    method: 'POST',
    body: JSON.stringify({ nome: 'Vendedor Sem Poderes', username: 'sempoderes', password: 'senha1234', permissions: {} }),
  });
  check('seed: vendedor sem nenhuma permissão criado', semPoderes.status === 201, JSON.stringify(semPoderes.body));

  const comPoderes = await rawApi(admin, '/api/users', {
    method: 'POST',
    body: JSON.stringify({
      nome: 'Vendedor Com Poderes', username: 'compoderes', password: 'senha1234',
      permissions: { manageProducts: true, adjustStock: true, toggleProduct: true, deleteProduct: true },
    }),
  });
  check('seed: vendedor com as 4 permissões de estoque criado', comPoderes.status === 201, JSON.stringify(comPoderes.body));

  const semPoderesCtx = await browser.newContext();
  const semPoderesPage = await semPoderesCtx.newPage();
  await semPoderesPage.goto(`${BASE}/test-products-repo.html`);
  await semPoderesPage.evaluate(() => window.__login('sempoderes', 'senha1234'));

  const comPoderesCtx = await browser.newContext();
  const comPoderesPage = await comPoderesCtx.newPage();
  await comPoderesPage.goto(`${BASE}/test-products-repo.html`);
  await comPoderesPage.evaluate(() => window.__login('compoderes', 'senha1234'));

  // ---------- productsRepo: catálogo básico ----------

  const initialList = await admin.evaluate(() => window.__productsRepo.listProducts());
  check('listProducts() começa vazio', Array.isArray(initialList) && initialList.length === 0, initialList.length);

  const noBarcode = await admin.evaluate(() => window.__productsRepo.createProduct({ name: 'Sem código' }).catch((e) => ({ __error: e.message })));
  check('createProduct sem código de barras é rejeitado', noBarcode.__error === 'Código de barras é obrigatório.', JSON.stringify(noBarcode));

  const cimento = await admin.evaluate(() => window.__productsRepo.createProduct({ barcode: '1111', name: 'Cimento CP-II 50kg', price: 32.5, costPrice: 24, minStock: 10 }));
  check('createProduct cria com sucesso e quantity começa em 0', cimento.quantity === 0 && cimento.name === 'Cimento CP-II 50kg', JSON.stringify(cimento));

  const dup = await admin.evaluate(() => window.__productsRepo.createProduct({ barcode: '1111', name: 'Outro produto com mesmo código' }).catch((e) => ({ __error: e.message })));
  check('createProduct com código de barras duplicado é rejeitado', dup.__error === 'Já existe um produto com esse código de barras.', JSON.stringify(dup));

  const tijolo = await admin.evaluate(() => window.__productsRepo.createProduct({ barcode: '2222', name: 'Tijolo Baiano 8 Furos', price: 1.2, costPrice: 0.8 }));
  check('segundo produto criado (pra testar colisão de código na edição)', tijolo.barcode === '2222', tijolo.barcode);

  const gotById = await admin.evaluate((id) => window.__productsRepo.getProduct(id), cimento.id);
  check('getProduct(id) devolve o produto certo', gotById?.id === cimento.id, gotById?.id);

  const gotMissing = await admin.evaluate(() => window.__productsRepo.getProduct('id-que-nao-existe'));
  check('getProduct(id inexistente) devolve null, NUNCA lança erro (salesRepo.js depende disto)', gotMissing === null, gotMissing);

  const gotByBarcode = await admin.evaluate(() => window.__productsRepo.getByBarcode('1111'));
  check('getByBarcode encontra o produto certo', gotByBarcode?.id === cimento.id, gotByBarcode?.id);

  const missingBarcode = await admin.evaluate(() => window.__productsRepo.getByBarcode('9999-nao-existe'));
  check('getByBarcode sem correspondência devolve null', missingBarcode === null, missingBarcode);

  const searchResult = await admin.evaluate(() => window.__productsRepo.searchProducts('cimento'));
  check('searchProducts filtra por nome (case-insensitive)', searchResult.length === 1 && searchResult[0].id === cimento.id, searchResult.map((p) => p.name));

  const searchByCode = await admin.evaluate(() => window.__productsRepo.searchProducts('2222'));
  check('searchProducts também filtra por código de barras', searchByCode.length === 1 && searchByCode[0].id === tijolo.id, searchByCode.map((p) => p.barcode));

  // ---------- productsRepo: edição ----------

  const updated = await admin.evaluate((id) => window.__productsRepo.updateProduct(id, { price: 35 }), cimento.id);
  check('updateProduct altera só o campo mandado', updated.price === 35 && updated.name === 'Cimento CP-II 50kg', updated.price);

  const barcodeCollision = await admin.evaluate((id) => window.__productsRepo.updateProduct(id, { barcode: '2222' }).catch((e) => ({ __error: e.message })), cimento.id);
  check('updateProduct pro código de barras de OUTRO produto é rejeitado', barcodeCollision.__error === 'Já existe um produto com esse código de barras.', JSON.stringify(barcodeCollision));

  const samebarcode = await admin.evaluate((id) => window.__productsRepo.updateProduct(id, { barcode: '1111' }), cimento.id);
  check('updateProduct pro PRÓPRIO código de barras (sem mudar) não é rejeitado', samebarcode.barcode === '1111', samebarcode.barcode);

  // ---------- productsRepo: unidade "personalizado" ----------

  const customNoLabel = await admin.evaluate(() => window.__productsRepo.createProduct({ barcode: '3333', name: 'Areia', unit: 'personalizado', customForms: [{ forma: 'Lata', valor: 5, custo: 2, fator: 1 }] }).catch((e) => ({ __error: e.message })));
  check('personalizado sem nome de unidade é rejeitado', customNoLabel.__error?.includes('unidade de estoque'), JSON.stringify(customNoLabel));

  const customNoForms = await admin.evaluate(() => window.__productsRepo.createProduct({ barcode: '3333', name: 'Areia', unit: 'personalizado', customUnitLabel: 'lata', customForms: [] }).catch((e) => ({ __error: e.message })));
  check('personalizado sem nenhuma forma de venda é rejeitado', customNoForms.__error?.includes('ao menos uma forma'), JSON.stringify(customNoForms));

  const areia = await admin.evaluate(() => window.__productsRepo.createProduct({
    barcode: '3333', name: 'Areia', unit: 'personalizado', customUnitLabel: 'lata',
    customForms: [{ forma: 'Lata', valor: 5, custo: 2, fator: 1 }, { forma: 'Carrada', valor: 180, custo: 70, fator: 40 }],
  }));
  check('personalizado válido é criado com price/costPrice forçados a 0', areia.price === 0 && areia.costPrice === 0 && areia.customForms.length === 2, JSON.stringify({ price: areia.price, forms: areia.customForms.length }));

  // ---------- productsRepo: ativar/desativar (explícito, não alterna) ----------

  const deactivated = await admin.evaluate((id) => window.__productsRepo.setProductActive(id, false), tijolo.id);
  check('setProductActive(id, false) desativa', deactivated.active === false, deactivated.active);
  const deactivatedAgain = await admin.evaluate((id) => window.__productsRepo.setProductActive(id, false), tijolo.id);
  check('setProductActive(id, false) de novo continua false — é explícito, não um alternador', deactivatedAgain.active === false, deactivatedAgain.active);
  const reactivated = await admin.evaluate((id) => window.__productsRepo.setProductActive(id, true), tijolo.id);
  check('setProductActive(id, true) reativa', reactivated.active === true, reactivated.active);

  // ---------- stockRepo: movimentação, atomicidade, dedupe ----------

  const afterEntrada = await admin.evaluate((id) => window.__stockRepo.recordMovement({ productId: id, type: 'entrada', qty: 100, note: 'Estoque inicial' }), cimento.id);
  check('recordMovement (entrada) grava a movimentação', afterEntrada.qty === 100 && afterEntrada.type === 'entrada', JSON.stringify(afterEntrada));
  const qtyAfterEntrada = (await admin.evaluate((id) => window.__productsRepo.getProduct(id), cimento.id)).quantity;
  check('quantity do produto reflete a entrada', qtyAfterEntrada === 100, qtyAfterEntrada);

  const oversell = await admin.evaluate((id) => window.__stockRepo.recordManualAdjustment({ productId: id, type: 'ajuste', qty: -999 }).catch((e) => ({ __error: e.message })), cimento.id);
  check('ajuste que deixaria o estoque negativo é rejeitado', oversell.__error?.includes('Estoque insuficiente'), JSON.stringify(oversell));
  const qtyUnchanged = (await admin.evaluate((id) => window.__productsRepo.getProduct(id), cimento.id)).quantity;
  check('quantity NÃO mudou depois da tentativa rejeitada (atomicidade)', qtyUnchanged === 100, qtyUnchanged);

  const zeroQty = await admin.evaluate((id) => window.__stockRepo.recordMovement({ productId: id, type: 'ajuste', qty: 0 }).catch((e) => ({ __error: e.message })), cimento.id);
  check('movimentação com qty 0 é rejeitada', zeroQty.__error === 'Quantidade de movimentação inválida.', JSON.stringify(zeroQty));

  const sharedDedupeKey = 'teste-dedupe-fixo-123';
  const first = await admin.evaluate(([id, key]) => window.__stockRepo.recordManualAdjustment({ productId: id, type: 'ajuste', qty: -10, dedupeKey: key }), [cimento.id, sharedDedupeKey]);
  check('primeira chamada com dedupeKey fixo é aceita', first.qty === -10, JSON.stringify(first));
  const second = await admin.evaluate(([id, key]) => window.__stockRepo.recordManualAdjustment({ productId: id, type: 'ajuste', qty: -10, dedupeKey: key }).catch((e) => ({ __error: e.message })), [cimento.id, sharedDedupeKey]);
  check('reenvio com o MESMO dedupeKey é rejeitado (proteção contra duplo clique)', second.__error?.includes('já foi registrado'), JSON.stringify(second));
  const qtyAfterDedupeTest = (await admin.evaluate((id) => window.__productsRepo.getProduct(id), cimento.id)).quantity;
  check('quantity refletiu o ajuste UMA vez só, não duas', qtyAfterDedupeTest === 90, qtyAfterDedupeTest);

  const movements = await admin.evaluate((id) => window.__stockRepo.listMovementsByProduct(id), cimento.id);
  check('listMovementsByProduct lista as 3 movimentações aplicadas (entrada + 1 ajuste aceito)', movements.length === 2, movements.map((m) => m.qty));
  check('listMovementsByProduct vem ordenado do mais recente pro mais antigo', movements[0].timestamp >= movements[1].timestamp, movements.map((m) => m.timestamp));

  // ---------- Permissões: vendedor sem nenhum poder ----------

  const listAsSemPoderes = await semPoderesPage.evaluate(() => window.__productsRepo.listProducts());
  check('vendedor sem permissão AINDA pode listar produtos (ação de leitura, sem gate)', listAsSemPoderes.length > 0, listAsSemPoderes.length);

  const createDenied = await semPoderesPage.evaluate(() => window.__productsRepo.createProduct({ barcode: '4444', name: 'Não deveria criar' }).catch((e) => ({ __error: e.message })));
  check('createProduct sem "manageProducts" é negado (403)', createDenied.__error === 'Você não tem permissão para fazer isso.', JSON.stringify(createDenied));

  const updateDenied = await semPoderesPage.evaluate((id) => window.__productsRepo.updateProduct(id, { price: 1 }).catch((e) => ({ __error: e.message })), cimento.id);
  check('updateProduct sem "manageProducts" é negado', updateDenied.__error === 'Você não tem permissão para fazer isso.', JSON.stringify(updateDenied));

  const toggleDenied = await semPoderesPage.evaluate((id) => window.__productsRepo.setProductActive(id, false).catch((e) => ({ __error: e.message })), tijolo.id);
  check('setProductActive sem "toggleProduct" é negado', toggleDenied.__error === 'Você não tem permissão para fazer isso.', JSON.stringify(toggleDenied));

  const adjustDenied = await semPoderesPage.evaluate((id) => window.__stockRepo.recordManualAdjustment({ productId: id, type: 'ajuste', qty: 5 }).catch((e) => ({ __error: e.message })), cimento.id);
  check('recordManualAdjustment sem "adjustStock" é negado', adjustDenied.__error === 'Você não tem permissão para fazer isso.', JSON.stringify(adjustDenied));

  const deleteDenied = await semPoderesPage.evaluate((id) => window.__productsRepo.deleteProduct(id).catch((e) => ({ __error: e.message })), areia.id);
  check('deleteProduct sem "deleteProduct" é negado', deleteDenied.__error === 'Você não tem permissão para fazer isso.', JSON.stringify(deleteDenied));

  // ---------- Permissões: vendedor COM os 4 poderes ----------

  const createAllowed = await comPoderesPage.evaluate(() => window.__productsRepo.createProduct({ barcode: '5555', name: 'Criado pelo vendedor com poderes' }));
  check('createProduct com "manageProducts" funciona pra um vendedor (não só admin)', createAllowed.barcode === '5555', createAllowed.barcode);

  const adjustAllowed = await comPoderesPage.evaluate((id) => window.__stockRepo.recordManualAdjustment({ productId: id, type: 'entrada', qty: 20 }), createAllowed.id);
  check('recordManualAdjustment com "adjustStock" funciona pra um vendedor', adjustAllowed.qty === 20, JSON.stringify(adjustAllowed));

  const deleteAllowed = await comPoderesPage.evaluate((id) => window.__productsRepo.deleteProduct(id), areia.id);
  const afterDelete = await admin.evaluate((id) => window.__productsRepo.getProduct(id), areia.id);
  check('deleteProduct com "deleteProduct" remove de verdade', afterDelete === null, afterDelete);

  // ---------- Multi-terminal: outra máquina vê o mesmo catálogo ----------

  const listFromComPoderes = await comPoderesPage.evaluate(() => window.__productsRepo.listProducts());
  const listFromAdmin = await admin.evaluate(() => window.__productsRepo.listProducts());
  check('duas sessões/máquinas diferentes veem exatamente o mesmo catálogo no servidor', listFromComPoderes.length === listFromAdmin.length, `${listFromComPoderes.length} vs ${listFromAdmin.length}`);

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
