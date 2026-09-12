// Catálogo de produtos (estoque) + histórico de movimentações — repo de
// verdade, substituindo o CRUD simplificado da Fase 1 (que provava só que
// duas máquinas viam o mesmo estoque, sem permissão granular nem
// movimentações). Espelha app/js/data/productsRepo.js e
// app/js/data/stockRepo.js da extensão single-machine: mesmos campos,
// mesmas validações "na fonte" (nunca só na tela), mesmo raciocínio de
// idempotência pra ajuste manual de estoque.
//
// Diferente de suppliers/purchases/finance/users/audit/company/backup (que
// exigem UMA permissão fixa pro sub-router inteiro, montada em server.js),
// produto tem ações com permissões DIFERENTES entre si (ver lista/permissão
// abaixo) — por isso os `requirePermission(...)` ficam aqui dentro, rota a
// rota, em vez de no mount de server.js.
import { Router } from 'express';
import { db } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';
import { requirePermission } from '../lib/permissions.js';

const router = Router();

const insertStmt = db.prepare(`
  INSERT INTO products (id, barcode, name_lower, active, updated_at, data)
  VALUES (@id, @barcode, @nameLower, @active, @updatedAt, @data)
`);
const updateStmt = db.prepare(`
  UPDATE products SET barcode = @barcode, name_lower = @nameLower, active = @active, updated_at = @updatedAt, data = @data
  WHERE id = @id
`);
const getByIdStmt = db.prepare('SELECT * FROM products WHERE id = ?');
const getByBarcodeStmt = db.prepare('SELECT * FROM products WHERE barcode = ?');
const listStmt = db.prepare('SELECT * FROM products ORDER BY name_lower ASC');
const deleteStmt = db.prepare('DELETE FROM products WHERE id = ?');
const insertMovementStmt = db.prepare('INSERT INTO stock_movements (id, product_id, timestamp, data) VALUES (@id, @productId, @timestamp, @data)');
const listMovementsStmt = db.prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY timestamp DESC');
const claimIdempotencyStmt = db.prepare('INSERT INTO idempotency_keys (key, created_at) VALUES (?, ?)');

function rowToProduct(row) {
  return JSON.parse(row.data);
}

// Mesmo achado de auditoria (P4) do productsRepo.js da extensão: bloqueia
// negativo e NaN via `Math.max(0, Number(x) || 0)` não bastava — sobrevive
// Infinity, "verdadeiro" em JS. Number.isFinite fecha os dois lados.
function finiteNonNegative(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

const MAX_CUSTOM_FORMS = 7;

// Idêntico ao parseCustomForms/resolveCustomUnitFields de
// app/js/data/productsRepo.js — mesma validação, mesmos limites, mesma
// mensagem de erro (evita duas fontes de verdade divergindo com o tempo).
function parseCustomForms(rawForms) {
  const list = Array.isArray(rawForms) ? rawForms : [];
  if (list.length === 0) throw new Error('Cadastre ao menos uma forma de venda para um produto personalizado.');
  if (list.length > MAX_CUSTOM_FORMS) throw new Error(`No máximo ${MAX_CUSTOM_FORMS} formas de venda por produto.`);
  const seenNames = new Set();
  return list.map((f, i) => {
    const forma = (f?.forma || '').trim();
    if (!forma) throw new Error(`Preencha o nome da forma de venda na linha ${i + 1}.`);
    const key = forma.toLowerCase();
    if (seenNames.has(key)) throw new Error(`A forma de venda "${forma}" está repetida — cada uma precisa de um nome diferente.`);
    seenNames.add(key);
    const valor = Number(f?.valor);
    if (!Number.isFinite(valor) || valor <= 0) throw new Error(`Informe um valor de venda válido para "${forma}".`);
    const custo = Number(f?.custo);
    if (!Number.isFinite(custo) || custo < 0) throw new Error(`Informe um preço de custo válido para "${forma}".`);
    const fator = Number(f?.fator);
    if (!Number.isFinite(fator) || fator <= 0) throw new Error(`Informe um fator de conversão de estoque válido para "${forma}".`);
    return { forma, valor, custo, fator };
  });
}

function resolveCustomUnitFields(body) {
  if (body.unit !== 'personalizado') {
    return { customUnitLabel: null, customForms: null, price: finiteNonNegative(body.price), costPrice: finiteNonNegative(body.costPrice) };
  }
  const customUnitLabel = (body.customUnitLabel || '').trim();
  if (!customUnitLabel) throw new Error('Informe o nome da unidade de estoque (ex: lata) para um produto personalizado.');
  return { customUnitLabel, customForms: parseCustomForms(body.customForms), price: 0, costPrice: 0 };
}

router.get('/', (req, res) => {
  const rows = listStmt.all();
  res.json({ products: rows.map(rowToProduct) });
});

router.get('/by-barcode/:barcode', (req, res) => {
  const row = getByBarcodeStmt.get(String(req.params.barcode || '').trim());
  res.json({ product: row ? rowToProduct(row) : null });
});

// 200 com `product: null` quando não existe, NUNCA 404 — espelha
// getProduct(id) da extensão (dbGet do IndexedDB devolve undefined pra um
// id inexistente, sem lançar nada). salesRepo.js#pricePreview depende
// exatamente disso (`if (!product) {...}`, tratado como "sumiu do
// catálogo entre montar o carrinho e finalizar" em vez de erro) — um 404
// aqui viraria uma exceção não tratada quando essa tela for portada.
router.get('/:id', (req, res) => {
  const row = getByIdStmt.get(req.params.id);
  res.json({ product: row ? rowToProduct(row) : null });
});

router.post('/', requirePermission('manageProducts'), (req, res) => {
  const body = req.body || {};
  const barcode = String(body.barcode || '').trim();
  if (!barcode) return res.status(400).json({ error: 'Código de barras é obrigatório.' });
  if (getByBarcodeStmt.get(barcode)) {
    return res.status(409).json({ error: 'Já existe um produto com esse código de barras.' });
  }
  let unitFields;
  try {
    unitFields = resolveCustomUnitFields(body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const name = String(body.name || '').trim();
  const isPersonalizado = body.unit === 'personalizado';
  const product = {
    id: crypto.randomUUID(),
    barcode,
    barcodeIsInternal: !!body.barcodeIsInternal,
    name,
    nameLower: name.toLowerCase(),
    category: body.category || 'material',
    unit: body.unit || 'un',
    customUnitLabel: unitFields.customUnitLabel,
    customForms: unitFields.customForms,
    price: unitFields.price,
    costPrice: unitFields.costPrice,
    // Sempre 0 no cadastro: estoque inicial (se houver) entra por
    // POST /:id/movimentos logo em seguida, único caminho que ajusta
    // quantidade — mesmo motivo do productsRepo.js da extensão: evita
    // contar o estoque inicial em dobro e mantém um único registro de
    // origem em stock_movements.
    quantity: 0,
    minStock: finiteNonNegative(body.minStock),
    supplierId: body.supplierId || null,
    expiryDate: isPersonalizado ? null : (body.expiryDate || null),
    expiryPromoDays: !isPersonalizado && body.expiryDate && body.expiryPromoDays !== '' && body.expiryPromoDays != null
      ? Math.floor(finiteNonNegative(body.expiryPromoDays))
      : null,
    promoPrice: !isPersonalizado && body.expiryDate && body.promoPrice !== '' && body.promoPrice != null
      ? finiteNonNegative(body.promoPrice)
      : null,
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Achado de auditoria (P3): a checagem acima e este insert não têm
  // `await` nenhum entre os dois — como o resto do servidor (ver comentário
  // de commitMovement mais abaixo), isto já roda atômico contra qualquer
  // outra requisição neste processo único, então não existe corrida de
  // verdade aqui. O try/catch é defesa em profundidade: se algo ainda assim
  // colidir com o UNIQUE de `barcode` na tabela (db/schema.sql), devolve o
  // mesmo 409 amigável em vez de deixar o erro cru estourar como 500.
  try {
    insertStmt.run({
      id: product.id, barcode: product.barcode, nameLower: product.nameLower,
      active: 1, updatedAt: product.updatedAt, data: JSON.stringify(product),
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Já existe um produto com esse código de barras.' });
    }
    throw err;
  }
  broadcast('products-changed', { reason: 'created', id: product.id });
  res.status(201).json({ product });
});

router.put('/:id', requirePermission('manageProducts'), (req, res) => {
  const row = getByIdStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produto não encontrado.' });
  const existing = rowToProduct(row);
  const body = req.body || {};

  if (body.barcode) {
    const other = getByBarcodeStmt.get(String(body.barcode).trim());
    if (other) {
      const otherProduct = rowToProduct(other);
      if (otherProduct.id !== existing.id) return res.status(409).json({ error: 'Já existe um produto com esse código de barras.' });
    }
  }

  const updated = { ...existing };
  if (body.barcode && body.barcode !== existing.barcode) {
    updated.barcode = String(body.barcode).trim();
    updated.barcodeIsInternal = !!body.barcodeIsInternal;
  }
  if (body.name !== undefined) {
    updated.name = String(body.name).trim();
    updated.nameLower = updated.name.toLowerCase();
  }
  if (body.category !== undefined) updated.category = body.category;
  // Unidade e campos de personalizado sempre viajam juntos — mesmo motivo
  // do productsRepo.js da extensão: sem isso, editar pra 'personalizado'
  // deixaria price/costPrice do modo antigo "vazando", ou editar de volta
  // pra unidade normal manteria customForms fantasma.
  if (body.unit !== undefined) {
    let unitFields;
    try {
      unitFields = resolveCustomUnitFields(body);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    updated.unit = body.unit;
    updated.customUnitLabel = unitFields.customUnitLabel;
    updated.customForms = unitFields.customForms;
    updated.price = unitFields.price;
    updated.costPrice = unitFields.costPrice;
  } else {
    if (body.price !== undefined) updated.price = finiteNonNegative(body.price);
    if (body.costPrice !== undefined) updated.costPrice = finiteNonNegative(body.costPrice);
  }
  if (body.minStock !== undefined) updated.minStock = finiteNonNegative(body.minStock);
  if (body.supplierId !== undefined) updated.supplierId = body.supplierId || null;
  const isPersonalizado = updated.unit === 'personalizado';
  if (body.expiryDate !== undefined) updated.expiryDate = isPersonalizado ? null : (body.expiryDate || null);
  if (body.expiryPromoDays !== undefined) {
    updated.expiryPromoDays = !isPersonalizado && updated.expiryDate && body.expiryPromoDays !== '' && body.expiryPromoDays != null
      ? Math.floor(finiteNonNegative(body.expiryPromoDays))
      : null;
  }
  if (body.promoPrice !== undefined) {
    updated.promoPrice = !isPersonalizado && updated.expiryDate && body.promoPrice !== '' && body.promoPrice != null
      ? finiteNonNegative(body.promoPrice)
      : null;
  }
  updated.updatedAt = Date.now();

  // Achado de auditoria (P3): mesma defesa em profundidade do POST acima —
  // a checagem de duplicidade e este update também rodam sem `await` entre
  // os dois, então já são atômicos entre requisições; o try/catch só troca
  // um eventual 500 cru por um 409 amigável se o UNIQUE de `barcode` colidir
  // mesmo assim.
  try {
    updateStmt.run({
      id: updated.id, barcode: updated.barcode, nameLower: updated.nameLower,
      active: updated.active ? 1 : 0, updatedAt: updated.updatedAt, data: JSON.stringify(updated),
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Já existe um produto com esse código de barras.' });
    }
    throw err;
  }
  broadcast('products-changed', { reason: 'updated', id: updated.id });
  res.json({ product: updated });
});

// Explícito (`{ active }` no corpo) em vez de alternar sozinho — mesmo
// contrato de setProductActive(id, active) da extensão: quem chama decide o
// estado final, não "inverte o que estiver lá agora" (evita corrida entre
// duas abas clicando quase junto acabarem se cancelando).
router.post('/:id/active', requirePermission('toggleProduct'), (req, res) => {
  const row = getByIdStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produto não encontrado.' });
  const existing = rowToProduct(row);
  const updated = { ...existing, active: !!req.body?.active, updatedAt: Date.now() };
  updateStmt.run({
    id: updated.id, barcode: updated.barcode, nameLower: updated.nameLower,
    active: updated.active ? 1 : 0, updatedAt: updated.updatedAt, data: JSON.stringify(updated),
  });
  broadcast('products-changed', { reason: 'toggled', id: updated.id });
  res.json({ product: updated });
});

router.delete('/:id', requirePermission('deleteProduct'), (req, res) => {
  const row = getByIdStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produto não encontrado.' });
  deleteStmt.run(req.params.id);
  broadcast('products-changed', { reason: 'deleted', id: req.params.id });
  res.json({ ok: true });
});

// ---------- Movimentações de estoque ----------
// Espelha stockRepo.js#recordMovement da extensão: a baixa/alta de
// quantidade e o registro da movimentação vivem na MESMA transação (aqui,
// db.transaction() síncrono do better-sqlite3 — nenhum await no meio, então
// nenhuma outra requisição HTTP consegue "entrar no meio"), então nunca
// existe um estado onde o estoque mudou mas nada explica por quê.
//
// Achado de auditoria herdado da extensão: sem checagem numérica, um
// `qty: NaN` ou `Infinity` passaria pelo guard `newQuantity < 0` (NaN < 0 é
// false em JS) e corromperia o estoque pra sempre. Number.isFinite fecha os
// dois casos.
//
// Permissão: esta rota HTTP sempre exige 'adjustStock' — é o caminho da
// tela (Ajustar estoque / Fazer inventário em Estoque), equivalente a
// recordManualAdjustment() da extensão. recordMovement() em si, na
// extensão, não tem permissão própria (é chamada também por venda/estorno/
// recebimento de compra, cada um já gated na origem) — quando esses
// caminhos forem portados pro servidor (fases futuras), eles gravam direto
// na mesma tabela dentro da PRÓPRIA transação deles (como sales.js já faz
// hoje), sem passar por esta rota HTTP.
// Achado de auditoria (P1): `expectedQuantity`, quando mandado (hoje só o
// Inventário em lote manda — ver views/products.js#openInventoryModal),
// é o valor que o CLIENTE achava que era o estoque atual no momento em que
// calculou `input.qty` (o delta). Pra um ajuste manual comum ("+50 chegou
// mercadoria") isso não importa — o delta é sempre correto não importa o
// valor atual. Mas o Inventário em lote calcula o delta contra um SNAPSHOT
// tirado ao abrir o modal, e a contagem física de uma loja inteira pode
// levar minutos — tempo de sobra pra uma venda em outro terminal já ter
// debitado o mesmo produto nesse meio-tempo. Sem reconferir, o delta
// (calculado contra o número antigo) se aplicava sozinho sobre o número
// NOVO, apagando silenciosamente a baixa da venda concorrente — mesma
// classe de bug que cash.js#commitAdjustment já fecha pra retificação de
// caixa, replicado aqui.
const STOCK_RECONCILE_TOLERANCE = 0.0001;
const commitMovement = db.transaction((input) => {
  // Achado de auditoria (P2): dedupeKey agora é obrigatória — ver
  // routes/deliveries.js#commitDelivery pro raciocínio completo.
  if (!input.dedupeKey) throw new Error('Requisição sem identificador de deduplicação.');
  claimIdempotencyStmt.run(input.dedupeKey, Date.now()); // estoura (UNIQUE) se repetido
  const row = getByIdStmt.get(input.productId);
  if (!row) throw new Error('Produto não encontrado.');
  const product = rowToProduct(row);
  if (input.expectedQuantity !== null && input.expectedQuantity !== undefined) {
    const expected = Number(input.expectedQuantity);
    if (Number.isFinite(expected) && Math.abs(product.quantity - expected) > STOCK_RECONCILE_TOLERANCE) {
      throw new Error(`O estoque de "${product.name}" mudou desde que a contagem foi feita (outra venda ou ajuste aconteceu nesse meio-tempo) — recontar e reabrir o inventário.`);
    }
  }
  const newQuantity = product.quantity + input.qty;
  if (newQuantity < 0) throw new Error(`Estoque insuficiente de "${product.name}".`);
  product.quantity = newQuantity;
  product.updatedAt = Date.now();
  updateStmt.run({
    id: product.id, barcode: product.barcode, nameLower: product.nameLower,
    active: product.active ? 1 : 0, updatedAt: product.updatedAt, data: JSON.stringify(product),
  });
  const record = {
    id: crypto.randomUUID(), productId: input.productId, type: input.type,
    qty: input.qty, userId: input.userId, userName: input.userName,
    note: input.note || '', timestamp: Date.now(),
  };
  insertMovementStmt.run({ id: record.id, productId: record.productId, timestamp: record.timestamp, data: JSON.stringify(record) });
  return { product, record };
});

router.post('/:id/movimentos', requirePermission('adjustStock'), (req, res) => {
  const body = req.body || {};
  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty === 0) {
    return res.status(400).json({ error: 'Quantidade de movimentação inválida.' });
  }
  try {
    const { product, record } = commitMovement({
      productId: req.params.id, type: body.type || 'ajuste', qty, note: body.note || '',
      userId: req.userId, userName: req.userName, dedupeKey: body.dedupeKey || null,
      expectedQuantity: body.expectedQuantity ?? null,
    });
    broadcast('products-changed', { reason: 'stock-adjusted', id: product.id });
    res.status(201).json({ product, movement: record });
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed: idempotency_keys')) {
      return res.status(409).json({ error: 'Este ajuste já foi registrado — evite reenviar.' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/movimentos', (req, res) => {
  const rows = listMovementsStmt.all(req.params.id);
  res.json({ movements: rows.map((r) => JSON.parse(r.data)) });
});

export default router;
