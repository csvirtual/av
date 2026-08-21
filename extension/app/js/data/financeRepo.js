// Contas a pagar/receber. Deliberadamente simples nesta primeira versão:
// não mexe automaticamente no caixa quando uma conta é paga (diferente do
// fiado, que sempre acontece via venda) — quem lança aqui decide se aquele
// pagamento também deve virar uma sangria/suprimento manual no caixa, se
// for o caso. Cada conta pode opcionalmente ficar vinculada a um
// fornecedor, pra facilitar achar "quanto devo pra fulano".
import { dbGetAll, dbAdd, dbUpdate, newId } from '../db.js';
// Achado de auditoria: create/marcar-pago/cancelar aqui eram protegidos só
// pela TELA (rota "financeiro" restrita a admin, ver app.js) — reaproveita
// a mesma checagem de usersRepo.js pra não deixar essas funções aceitarem
// chamada direta de um vendedor com acesso ao console.
import { assertActingUserIsAdmin } from './usersRepo.js';

export async function listEntries() {
  const entries = await dbGetAll('financialEntries');
  return entries.sort((a, b) => a.dueDate - b.dueDate);
}

export async function createEntry({ type, description, amount, dueDate, category = '', supplierId = null, notes = '', userId, userName }) {
  await assertActingUserIsAdmin();
  if (type !== 'pagar' && type !== 'receber') throw new Error('Tipo de conta inválido.');
  if (!description || !description.trim()) throw new Error('Descrição é obrigatória.');
  const value = Number(amount) || 0;
  if (value <= 0) throw new Error('Informe um valor maior que zero.');
  if (!dueDate) throw new Error('Informe a data de vencimento.');

  const entry = {
    id: newId(),
    type,
    description: description.trim(),
    amount: value,
    dueDate, // timestamp (meia-noite do dia de vencimento)
    category: category.trim(),
    supplierId,
    status: 'pendente', // 'pendente' | 'pago' | 'cancelado' ('vencido' é calculado, ver entryStatus)
    paidAt: null,
    paidAmount: null,
    paymentMethod: null,
    notes: notes.trim(),
    createdBy: { userId, userName },
    createdAt: Date.now(),
  };
  await dbAdd('financialEntries', entry);
  return entry;
}

// markAsPaid/cancelEntry usam dbUpdate — a checagem de status ("já paga?
// já cancelada?") e a gravação da transição acontecem na mesma transação,
// pra duas abas (ou duplo clique, embora openModal já proteja contra isso)
// não conseguirem os dois passar na checagem antes de qualquer um gravar.
export async function markAsPaid({ id, paidAmount, paymentMethod, userId, userName }) {
  await assertActingUserIsAdmin();
  const value = Number(paidAmount);
  if (!(value > 0)) throw new Error('Informe um valor pago maior que zero.');
  return dbUpdate('financialEntries', id, (entry) => {
    if (!entry) throw new Error('Conta não encontrada.');
    if (entry.status === 'pago') throw new Error('Esta conta já está paga.');
    if (entry.status === 'cancelado') throw new Error('Esta conta foi cancelada.');
    entry.status = 'pago';
    entry.paidAt = Date.now();
    entry.paidAmount = value;
    entry.paymentMethod = paymentMethod;
    entry.paidBy = { userId, userName };
    return entry;
  });
}

export async function cancelEntry(id) {
  await assertActingUserIsAdmin();
  return dbUpdate('financialEntries', id, (entry) => {
    if (!entry) throw new Error('Conta não encontrada.');
    if (entry.status === 'pago') throw new Error('Não é possível cancelar uma conta já paga.');
    entry.status = 'cancelado';
    return entry;
  });
}

/** Status pra exibição: 'vencido' não é gravado, é calculado comparando o
 * vencimento com hoje — assim uma conta pendente vira "vencida" sozinha
 * sem precisar de nenhum job rodando em segundo plano. */
export function entryStatus(entry) {
  if (entry.status === 'pago') return 'pago';
  if (entry.status === 'cancelado') return 'cancelado';
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (entry.dueDate < startOfToday.getTime()) return 'vencido';
  return 'pendente';
}
