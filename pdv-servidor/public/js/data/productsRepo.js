// Catálogo de produtos — versão multi-terminal, mesmo contrato de
// app/js/data/productsRepo.js da extensão single-machine (mesmos nomes de
// função, mesmos parâmetros), só trocando IndexedDB por chamadas ao
// servidor (ver routes/products.js). É o que permite views/products.js
// ser portada depois sem reescrever a lógica da tela — ela só importa
// estas funções, nunca soube se por baixo é IndexedDB ou HTTP.
//
// Toda validação "de verdade" (permissão, código de barras duplicado,
// campos de personalizado, preço não-negativo) já é refeita no servidor,
// na fonte — mesmo princípio de "nunca confiar em quem está chamando" já
// aplicado em toda a extensão single-machine. Este módulo só formata a
// chamada e traduz a resposta.
import { api } from './apiClient.js';

export async function listProducts() {
  const { products } = await api('/api/products');
  return products;
}

export async function getProduct(id) {
  const { product } = await api(`/api/products/${encodeURIComponent(id)}`);
  return product;
}

export async function getByBarcode(barcode) {
  const { product } = await api(`/api/products/by-barcode/${encodeURIComponent((barcode || '').trim())}`);
  return product;
}

/** Busca por nome ou código de barras — mesmo espírito do
 * productsRepo.js da extensão ("catálogo de loja é pequeno o bastante
 * pra filtrar em memória"): busca a lista completa (já cacheada pelo
 * navegador entre chamadas próximas) e filtra no cliente, em vez de criar
 * uma rota de busca no servidor só pra isso. */
export async function searchProducts(term) {
  const all = await listProducts();
  const q = (term || '').trim().toLowerCase();
  if (!q) return all;
  return all.filter((p) => p.nameLower.includes(q) || p.barcode.toLowerCase().includes(q));
}

export async function createProduct(data) {
  const { product } = await api('/api/products', { method: 'POST', body: JSON.stringify(data) });
  return product;
}

export async function updateProduct(id, data) {
  const { product } = await api(`/api/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
  return product;
}

export async function setProductActive(id, active) {
  const { product } = await api(`/api/products/${encodeURIComponent(id)}/active`, { method: 'POST', body: JSON.stringify({ active }) });
  return product;
}

export async function deleteProduct(id) {
  await api(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
