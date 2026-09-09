// Contas a pagar/receber — versão multi-terminal, mesmo contrato de
// app/js/data/financeRepo.js da extensão single-machine. Toda a
// atomicidade (pagamento reconfere o restante e a chave de dedupe na
// MESMA transação, conta só fecha quando a soma bate o total, exclusão de
// pagamento reabre a conta sozinha) já existia pronta no servidor desde a
// Fase 5 (ver routes/finance.js) — esta é só a camada de tradução HTTP,
// mesmo padrão de suppliersRepo.js/purchasesRepo.js. `entryStatus`,
// `paidTotal` e `remainingAmount` continuam funções PURAS, copiadas
// byte-a-byte da extensão — a view calcula em cima do que já tem em
// memória, sem round-trip, e o servidor tem sua própria cópia idêntica
// pra nunca confiar só no que o cliente calculou (ver routes/finance.js).
import { api } from './apiClient.js';

const PAYMENT_TOLERANCE = 0.01;

export async function listEntries() {
  const { entries } = await api('/api/finance');
  return entries.sort((a, b) => a.dueDate - b.dueDate);
}

/** userId/userName aceitos só pra bater a assinatura da extensão — o
 * servidor sempre resolve quem criou pela sessão de verdade (mesmo motivo
 * de auditRepo.js#logAction e purchasesRepo.js#createPurchaseOrder). */
export async function createEntry({ type, description, amount, dueDate, category = '', supplierId = null, notes = '', userId, userName }) {
  void userId; void userName;
  const { entry } = await api('/api/finance', {
    method: 'POST',
    body: JSON.stringify({ type, description, amount, dueDate, category, supplierId, notes }),
  });
  return entry;
}

export function paidTotal(entry) {
  if (Array.isArray(entry.payments)) {
    return entry.payments.reduce((sum, p) => sum + p.amount, 0);
  }
  return entry.status === 'pago' ? (Number(entry.paidAmount) || entry.amount) : 0;
}

export function remainingAmount(entry) {
  return Math.max(0, entry.amount - paidTotal(entry));
}

export async function registerPayment({ id, amount, paymentMethod, userId, userName, dedupeKey }) {
  void userId; void userName;
  const { entry } = await api(`/api/finance/${encodeURIComponent(id)}/pagamento`, {
    method: 'POST',
    body: JSON.stringify({ amount, paymentMethod, dedupeKey }),
  });
  return entry;
}

export async function deletePayment({ entryId, paymentId }) {
  const { entry } = await api(`/api/finance/${encodeURIComponent(entryId)}/pagamento/${encodeURIComponent(paymentId)}`, { method: 'DELETE' });
  return entry;
}

export async function cancelEntry(id) {
  const { entry } = await api(`/api/finance/${encodeURIComponent(id)}/cancelar`, { method: 'POST' });
  return entry;
}

export function entryStatus(entry) {
  if (entry.status === 'cancelado') return 'cancelado';
  if (entry.status === 'pago') return 'pago';
  if (paidTotal(entry) > PAYMENT_TOLERANCE) return 'parcial';
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (entry.dueDate < startOfToday.getTime()) return 'vencido';
  return 'pendente';
}
