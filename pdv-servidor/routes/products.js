// Fase 1 (prova de conceito): CRUD simples de produtos, o suficiente pra
// provar que duas máquinas na mesma rede veem o MESMO estoque em tempo
// real. Regras de negócio mais finas (unidade personalizada com várias
// formas de venda, preço promocional por validade etc. — ver
// app/js/data/productsRepo.js na extensão) ainda não foram portadas aqui;
// isso é trabalho da fase seguinte, quando esta rota vira o repo de
// verdade.
import { Router } from 'express';
import { db } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';

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

function rowToProduct(row) {
  return JSON.parse(row.data);
}

router.get('/', (req, res) => {
  const rows = listStmt.all();
  res.json({ products: rows.map(rowToProduct) });
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const barcode = String(body.barcode || '').trim();
  const name = String(body.name || '').trim();
  if (!barcode) return res.status(400).json({ error: 'Código de barras é obrigatório.' });
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  if (getByBarcodeStmt.get(barcode)) {
    return res.status(409).json({ error: 'Já existe um produto com esse código de barras.' });
  }
  const price = Number(body.price);
  const costPrice = Number(body.costPrice);
  const minStock = Number(body.minStock);
  const product = {
    id: crypto.randomUUID(),
    barcode,
    barcodeIsInternal: !!body.barcodeIsInternal,
    name,
    nameLower: name.toLowerCase(),
    category: body.category || 'material',
    unit: body.unit || 'un',
    price: Number.isFinite(price) && price >= 0 ? price : 0,
    costPrice: Number.isFinite(costPrice) && costPrice >= 0 ? costPrice : 0,
    quantity: 0,
    minStock: Number.isFinite(minStock) && minStock >= 0 ? minStock : 0,
    supplierId: body.supplierId || null,
    expiryDate: body.expiryDate || null,
    expiryPromoDays: body.expiryPromoDays ?? null,
    expiryPromoPercent: body.expiryPromoPercent ?? null,
    active: true,
    createdAt: Date.now(),
  };
  insertStmt.run({
    id: product.id, barcode: product.barcode, nameLower: product.nameLower,
    active: 1, updatedAt: Date.now(), data: JSON.stringify(product),
  });
  broadcast('products-changed', { reason: 'created', id: product.id });
  res.status(201).json({ product });
});

router.put('/:id', (req, res) => {
  const row = getByIdStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produto não encontrado.' });
  const existing = rowToProduct(row);
  const body = req.body || {};
  const name = String(body.name ?? existing.name).trim();
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const price = Number(body.price ?? existing.price);
  const costPrice = Number(body.costPrice ?? existing.costPrice);
  const minStock = Number(body.minStock ?? existing.minStock);
  const updated = {
    ...existing,
    name,
    nameLower: name.toLowerCase(),
    category: body.category ?? existing.category,
    unit: body.unit ?? existing.unit,
    price: Number.isFinite(price) && price >= 0 ? price : existing.price,
    costPrice: Number.isFinite(costPrice) && costPrice >= 0 ? costPrice : existing.costPrice,
    minStock: Number.isFinite(minStock) && minStock >= 0 ? minStock : existing.minStock,
    supplierId: body.supplierId ?? existing.supplierId,
  };
  updateStmt.run({
    id: updated.id, barcode: updated.barcode, nameLower: updated.nameLower,
    active: updated.active ? 1 : 0, updatedAt: Date.now(), data: JSON.stringify(updated),
  });
  broadcast('products-changed', { reason: 'updated', id: updated.id });
  res.json({ product: updated });
});

router.post('/:id/toggle', (req, res) => {
  const row = getByIdStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produto não encontrado.' });
  const existing = rowToProduct(row);
  const updated = { ...existing, active: !existing.active };
  updateStmt.run({
    id: updated.id, barcode: updated.barcode, nameLower: updated.nameLower,
    active: updated.active ? 1 : 0, updatedAt: Date.now(), data: JSON.stringify(updated),
  });
  broadcast('products-changed', { reason: 'toggled', id: updated.id });
  res.json({ product: updated });
});

// Ajuste manual de quantidade (entrada/saída) — versão simplificada da
// fase 1; a extensão single-machine também grava um stockMovements pra
// cada ajuste (histórico por produto), ainda não portado aqui.
router.post('/:id/ajustar-estoque', (req, res) => {
  const row = getByIdStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produto não encontrado.' });
  const existing = rowToProduct(row);
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta) || delta === 0) {
    return res.status(400).json({ error: 'Informe uma quantidade válida (positiva pra entrada, negativa pra saída).' });
  }
  const newQty = existing.quantity + delta;
  if (newQty < 0) return res.status(400).json({ error: 'Estoque não pode ficar negativo.' });
  const updated = { ...existing, quantity: newQty };
  updateStmt.run({
    id: updated.id, barcode: updated.barcode, nameLower: updated.nameLower,
    active: updated.active ? 1 : 0, updatedAt: Date.now(), data: JSON.stringify(updated),
  });
  broadcast('products-changed', { reason: 'stock-adjusted', id: updated.id });
  res.json({ product: updated });
});

router.delete('/:id', (req, res) => {
  const row = getByIdStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produto não encontrado.' });
  deleteStmt.run(req.params.id);
  broadcast('products-changed', { reason: 'deleted', id: req.params.id });
  res.json({ ok: true });
});

export default router;
