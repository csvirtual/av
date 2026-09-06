// Fornecedores — cadastro exige a permissão 'compras' (é gestão da loja,
// igual produto, não operação do dia a dia de venda como cliente é; admin
// sempre tem, um vendedor só se marcado no cadastro dele, ver
// utils/permissions.js).
import { dbGetAll, dbGet, dbAdd, dbDelete, dbUpdate, newId } from '../db.js';
// Achado de auditoria: "exclusivo do administrador" (comentário acima) só
// valia na tela (rota "compras" restrita a admin, ver app.js) — as funções
// de escrita abaixo não checavam nada, então reaproveita a mesma checagem
// de usersRepo.js pra fechar isso. listSuppliers/getSupplier continuam
// sem checagem de propósito: produtos.js (aberto a vendedor também) lê a
// lista pra preencher o fornecedor padrão de um produto — leitura não é
// gestão sensível, só a escrita é.
import { assertActingUserHasPermission } from './usersRepo.js';

export async function listSuppliers() {
  const suppliers = await dbGetAll('suppliers');
  return suppliers.sort((a, b) => a.nameLower.localeCompare(b.nameLower, 'pt-BR'));
}

export async function getSupplier(id) {
  return dbGet('suppliers', id);
}

export async function createSupplier(data) {
  await assertActingUserHasPermission('compras');
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
  await assertActingUserHasPermission('compras');
  return dbUpdate('suppliers', id, (supplier) => {
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
    return supplier;
  });
}

export async function setSupplierActive(id, active) {
  await assertActingUserHasPermission('compras');
  return dbUpdate('suppliers', id, (supplier) => {
    if (!supplier) throw new Error('Fornecedor não encontrado.');
    supplier.active = active;
    supplier.updatedAt = Date.now();
    return supplier;
  });
}

export async function deleteSupplier(id) {
  await assertActingUserHasPermission('compras');
  await dbDelete('suppliers', id);
}
