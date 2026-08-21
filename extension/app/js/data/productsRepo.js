// Catálogo de produtos (estoque). Cada produto tem um código de barras —
// de fábrica (escaneado) ou interno (gerado pelo sistema, ver
// utils/barcode.js) — usado tanto na venda quanto na busca.
import { dbGetAll, dbGet, dbPut, dbAdd, dbDelete, dbGetByIndex, dbUpdate, newId } from '../db.js';

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
    // Math.max(0, ...) em preço/estoque mínimo: um valor negativo aqui não
    // é só "esquisito" — preço negativo reduz o total de qualquer venda
    // que incluir o produto (linha do carrinho vira valor negativo).
    price: Math.max(0, Number(data.price) || 0),
    costPrice: Math.max(0, Number(data.costPrice) || 0),
    // Sempre começa em 0: se houver estoque inicial, quem chama (views/products.js)
    // aplica via stockRepo.recordMovement logo em seguida — é o único caminho que
    // ajusta quantidade, pra manter um único registro de origem (stockMovements) e
    // não contar o estoque inicial em dobro.
    quantity: 0,
    minStock: Math.max(0, Number(data.minStock) || 0),
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

// updateProduct/setProductActive usam dbUpdate (get+put na mesma
// transação) em vez de getProduct+dbPut separados — edição administrativa
// concorrente do MESMO produto é rara, mas sem isso duas edições quase
// juntas (ex: um admin corrige o preço enquanto outra aba estava com o
// formulário de edição aberto) apagam uma a outra silenciosamente
// (last-write-wins) em vez de uma delas pelo menos falhar de forma visível
// se checasse o código de barras contra um estado já desatualizado.
export async function updateProduct(id, data) {
  if (data.barcode) {
    const other = await getByBarcode(data.barcode);
    if (other && other.id !== id) throw new Error('Já existe um produto com esse código de barras.');
  }
  return dbUpdate('products', id, (product) => {
    if (!product) throw new Error('Produto não encontrado.');
    if (data.barcode && data.barcode !== product.barcode) {
      product.barcode = data.barcode.trim();
      product.barcodeIsInternal = !!data.barcodeIsInternal;
    }
    if (data.name !== undefined) {
      product.name = data.name.trim();
      product.nameLower = data.name.trim().toLowerCase();
    }
    if (data.category !== undefined) product.category = data.category;
    if (data.unit !== undefined) product.unit = data.unit;
    if (data.price !== undefined) product.price = Math.max(0, Number(data.price) || 0);
    if (data.costPrice !== undefined) product.costPrice = Math.max(0, Number(data.costPrice) || 0);
    if (data.minStock !== undefined) product.minStock = Math.max(0, Number(data.minStock) || 0);
    if (data.supplierId !== undefined) product.supplierId = data.supplierId || null;
    product.updatedAt = Date.now();
    return product;
  });
}

export async function setProductActive(id, active) {
  return dbUpdate('products', id, (product) => {
    if (!product) throw new Error('Produto não encontrado.');
    product.active = active;
    product.updatedAt = Date.now();
    return product;
  });
}

export async function deleteProduct(id) {
  await dbDelete('products', id);
}
