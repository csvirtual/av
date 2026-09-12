// Fornecedores — versão multi-terminal, mesmo contrato de
// app/js/data/suppliersRepo.js da extensão single-machine. Leitura
// (listSuppliers/getSupplier) fica aberta a qualquer usuário autenticado
// — mesmo motivo de lá: Estoque também lê a lista pra preencher o
// fornecedor padrão de um produto, sem precisar da permissão 'compras'.
// Escrita (criar/editar/excluir) exige 'compras', re-conferida no
// servidor (ver routes/suppliers.js), nunca só aqui.
import { api } from './apiClient.js';

export async function listSuppliers() {
  const { suppliers } = await api('/api/suppliers');
  return suppliers;
}

export async function getSupplier(id) {
  const { supplier } = await api(`/api/suppliers/${encodeURIComponent(id)}`);
  return supplier;
}

export async function createSupplier(data) {
  const { supplier } = await api('/api/suppliers', { method: 'POST', body: JSON.stringify(data) });
  return supplier;
}

export async function updateSupplier(id, data) {
  const { supplier } = await api(`/api/suppliers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
  return supplier;
}

export async function setSupplierActive(id, active) {
  const { supplier } = await api(`/api/suppliers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ active }) });
  return supplier;
}

export async function deleteSupplier(id) {
  await api(`/api/suppliers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
