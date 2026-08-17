// Fornecedores — cadastro exclusivo do administrador, é gestão da loja
// (igual produto), não operação do dia a dia de venda como cliente é.
import { dbGetAll, dbGet, dbPut, dbAdd, dbDelete, newId } from '../db.js';

export async function listSuppliers() {
  const suppliers = await dbGetAll('suppliers');
  return suppliers.sort((a, b) => a.nameLower.localeCompare(b.nameLower, 'pt-BR'));
}

export async function getSupplier(id) {
  return dbGet('suppliers', id);
}

export async function createSupplier(data) {
  const nome = (data.nome || '').trim();
  if (!nome) throw new Error('Nome do fornecedor é obrigatório.');
  const record = {
    id: newId(),
    nome,
    nameLower: nome.toLowerCase(),
    telefone: (data.telefone || '').trim(),
    email: (data.email || '').trim(),
    documento: (data.documento || '').trim(),
    endereco: (data.endereco || '').trim(),
    observacoes: (data.observacoes || '').trim(),
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await dbAdd('suppliers', record);
  return record;
}

export async function updateSupplier(id, data) {
  const supplier = await getSupplier(id);
  if (!supplier) throw new Error('Fornecedor não encontrado.');
  if (data.nome !== undefined) {
    const nome = data.nome.trim();
    if (!nome) throw new Error('Nome do fornecedor é obrigatório.');
    supplier.nome = nome;
    supplier.nameLower = nome.toLowerCase();
  }
  if (data.telefone !== undefined) supplier.telefone = data.telefone.trim();
  if (data.email !== undefined) supplier.email = data.email.trim();
  if (data.documento !== undefined) supplier.documento = data.documento.trim();
  if (data.endereco !== undefined) supplier.endereco = data.endereco.trim();
  if (data.observacoes !== undefined) supplier.observacoes = data.observacoes.trim();
  supplier.updatedAt = Date.now();
  await dbPut('suppliers', supplier);
  return supplier;
}

export async function setSupplierActive(id, active) {
  const supplier = await getSupplier(id);
  if (!supplier) return null;
  supplier.active = active;
  supplier.updatedAt = Date.now();
  await dbPut('suppliers', supplier);
  return supplier;
}

export async function deleteSupplier(id) {
  await dbDelete('suppliers', id);
}
