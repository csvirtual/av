// Catálogo de produtos (estoque). Cada produto tem um código de barras —
// de fábrica (escaneado) ou interno (gerado pelo sistema, ver
// utils/barcode.js) — usado tanto na venda quanto na busca.
import { dbGetAll, dbGet, dbPut, dbAdd, dbDelete, dbGetByIndex, newId } from '../db.js';

export async function listProducts() {
  const products = await dbGetAll('products');
  return products.sort((a, b) => a.nameLower.localeCompare(b.nameLower, 'pt-BR'));
}

export async function getProduct(id) {
  return dbGet('products', id);
}

export async function getByBarcode(barcode) {
  return dbGetByIndex('products', 'byBarcode', (barcode || '').trim());
}

/** Busca simples por nome ou código de barras (catálogo de loja é pequeno o
 * bastante para filtrar em memória — não justifica um índice full-text). */
export async function searchProducts(term) {
  const all = await listProducts();
  const q = (term || '').trim().toLowerCase();
  if (!q) return all;
  return all.filter((p) => p.nameLower.includes(q) || p.barcode.toLowerCase().includes(q));
}

export async function createProduct(data) {
  const barcode = (data.barcode || '').trim();
  if (!barcode) throw new Error('Código de barras é obrigatório.');
  if (await getByBarcode(barcode)) {
    throw new Error('Já existe um produto com esse código de barras.');
  }
  const record = {
    id: newId(),
    barcode,
    barcodeIsInternal: !!data.barcodeIsInternal,
    name: (data.name || '').trim(),
    nameLower: (data.name || '').trim().toLowerCase(),
    category: data.category || 'material', // 'material' | 'mercearia'
    unit: data.unit || 'un',
    price: Number(data.price) || 0,
    costPrice: Number(data.costPrice) || 0,
    // Sempre começa em 0: se houver estoque inicial, quem chama (views/products.js)
    // aplica via stockRepo.recordMovement logo em seguida — é o único caminho que
    // ajusta quantidade, pra manter um único registro de origem (stockMovements) e
    // não contar o estoque inicial em dobro.
    quantity: 0,
    minStock: Number(data.minStock) || 0,
    // Fornecedor padrão (opcional) — usado pra agrupar a sugestão de compra
    // automática por fornecedor (ver data/purchasesRepo.js).
    supplierId: data.supplierId || null,
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await dbAdd('products', record);
  return record;
}

export async function updateProduct(id, data) {
  const product = await getProduct(id);
  if (!product) throw new Error('Produto não encontrado.');
  if (data.barcode && data.barcode !== product.barcode) {
    const other = await getByBarcode(data.barcode);
    if (other && other.id !== id) throw new Error('Já existe um produto com esse código de barras.');
    product.barcode = data.barcode.trim();
    product.barcodeIsInternal = !!data.barcodeIsInternal;
  }
  if (data.name !== undefined) {
    product.name = data.name.trim();
    product.nameLower = data.name.trim().toLowerCase();
  }
  if (data.category !== undefined) product.category = data.category;
  if (data.unit !== undefined) product.unit = data.unit;
  if (data.price !== undefined) product.price = Number(data.price) || 0;
  if (data.costPrice !== undefined) product.costPrice = Number(data.costPrice) || 0;
  if (data.minStock !== undefined) product.minStock = Number(data.minStock) || 0;
  if (data.supplierId !== undefined) product.supplierId = data.supplierId || null;
  product.updatedAt = Date.now();
  await dbPut('products', product);
  return product;
}

export async function setProductActive(id, active) {
  const product = await getProduct(id);
  if (!product) return null;
  product.active = active;
  product.updatedAt = Date.now();
  await dbPut('products', product);
  return product;
}

export async function deleteProduct(id) {
  await dbDelete('products', id);
}

/** Ajusta a quantidade em estoque por uma diferença (positiva = entrada,
 * negativa = saída/venda). Não grava o movimento em si — isso é
 * responsabilidade de quem chama (stockRepo.recordMovement), pra manter o
 * registro do produto e o histórico de movimentações desacoplados. */
export async function adjustQuantity(id, delta) {
  const product = await getProduct(id);
  if (!product) throw new Error('Produto não encontrado.');
  const newQuantity = product.quantity + delta;
  if (newQuantity < 0) throw new Error(`Estoque insuficiente de "${product.name}".`);
  product.quantity = newQuantity;
  product.updatedAt = Date.now();
  await dbPut('products', product);
  return product;
}
