// Contas a pagar/receber. Deliberadamente simples nesta primeira versão:
// não mexe automaticamente no caixa quando uma conta é paga (diferente do
// fiado, que sempre acontece via venda) — quem lança aqui decide se aquele
// pagamento também deve virar uma sangria/suprimento manual no caixa, se
// for o caso. Cada conta pode opcionalmente ficar vinculada a um
// fornecedor, pra facilitar achar "quanto devo pra fulano".
import { dbGetAll, dbAdd, dbUpdate, dbTransaction, claimIdempotencyKey, newId } from '../db.js';
// Achado de auditoria: create/registrar pagamento/cancelar aqui eram
// protegidos só pela TELA (rota "financeiro" restrita a admin, ver
// app.js) — reaproveita a mesma checagem de usersRepo.js pra não deixar
// essas funções aceitarem chamada direta de um vendedor com acesso ao
// console.
import { assertActingUserHasPermission } from './usersRepo.js';

const PAYMENT_TOLERANCE = 0.01; // arredondamento de centavos, mesmo padrão de data/salesRepo.js

export async function listEntries() {
  const entries = await dbGetAll('financialEntries');
  return entries.sort((a, b) => a.dueDate - b.dueDate);
}

export async function createEntry({ type, description, amount, dueDate, category = '', supplierId = null, notes = '', userId, userName }) {
  await assertActingUserHasPermission('financeiro');
  if (type !== 'pagar' && type !== 'receber') throw new Error('Tipo de conta inválido.');
  if (!description || !description.trim()) throw new Error('Descrição é obrigatória.');
  // Achado de auditoria (P1): `Number(amount) || 0` bloqueia negativo e
  // NaN, mas não `Infinity` — sem teto nenhum depois, essa conta ficaria
  // com `remainingAmount()`/`paidTotal()` corrompidos pra sempre (nenhum
  // pagamento jamais bate um total Infinity).
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Informe um valor maior que zero.');
  if (!dueDate) throw new Error('Informe a data de vencimento.');

  const entry = {
    id: newId(),
    type,
    description: description.trim(),
    amount: value,
    dueDate, // timestamp (meia-noite do dia de vencimento)
    category: category.trim(),
    supplierId,
    status: 'pendente', // 'pendente' | 'pago' | 'cancelado' — 'vencido' e 'parcial' são calculados, ver entryStatus()
    // Extrato de pagamentos — nunca sobrescrito, só cresce (registerPayment)
    // ou perde uma entrada específica (deletePayment). O quanto já foi pago
    // é SEMPRE a soma disto, nunca um campo solto que alguém possa esquecer
    // de manter em dia — mesmo princípio já usado no fiado de clientes
    // (customerDebts) e no estoque (stockMovements).
    payments: [],
    notes: notes.trim(),
    createdBy: { userId, userName },
    createdAt: Date.now(),
  };
  await dbAdd('financialEntries', entry);
  return entry;
}

/** Quanto já foi pago desta conta até agora — soma do extrato de
 * pagamentos. Contas pagas por uma versão anterior deste sistema (antes de
 * existir `payments`, quando só havia um campo `paidAmount` único) não têm
 * o array — cai no valor cheio da conta nesse caso, pra uma conta já
 * fechada antes desta atualização continuar aparecendo como paga, nunca
 * "voltando a dever" sozinha por causa de uma mudança de formato. */
export function paidTotal(entry) {
  if (Array.isArray(entry.payments)) {
    return entry.payments.reduce((sum, p) => sum + p.amount, 0);
  }
  return entry.status === 'pago' ? (Number(entry.paidAmount) || entry.amount) : 0;
}

/** Quanto ainda falta pagar — nunca negativo (um pagamento não pode passar
 * do total, ver registerPayment). */
export function remainingAmount(entry) {
  return Math.max(0, entry.amount - paidTotal(entry));
}

/** Registra UM pagamento contra a conta — parcial ou o suficiente pra
 * fechá-la, o valor quem decide é quem chama. Nunca sobrescreve pagamento
 * nenhum já registrado, sempre ACRESCENTA ao extrato (`entry.payments`); o
 * status só vira 'pago' quando a SOMA de tudo bate (ou passa) o valor total
 * da conta — enquanto sobrar saldo, a conta continua 'pendente' por dentro
 * (a tela mostra "Pago parcialmente" calculando isso na hora, ver
 * entryStatus()/remainingAmount() logo acima).
 *
 * Achado de auditoria corrigido aqui — grave: a função anterior
 * (markAsPaid) sempre gravava status:'pago' não importa o valor informado.
 * Registrar R$200 de pagamento numa conta de R$500 fazia ela sumir da lista
 * de pendentes e do resumo de "a pagar/receber" como se os R$300 restantes
 * nunca tivessem existido — só o log de auditoria mostrava o valor real
 * pago, e mesmo assim sem nenhum jeito de voltar e cobrar/pagar o resto
 * depois (a conta já estava "fechada"). Corrigido: a conta só fecha quando
 * o valor bate de verdade, e continua disponível pra novos pagamentos
 * (parciais ou não) até lá. */
/** Achado de auditoria (P2, dinheiro não pode ter brecha): o `dbUpdate`
 * original já era atômico contra LOST UPDATE (duas chamadas concorrentes
 * nunca liam o mesmo saldo "antes"), mas isso só protege contra passar do
 * limite — não contra uma submissão DUPLICADA e legítima (ex: uma chamada
 * repetida sem passar pela tela). `dedupeKey` (opcional, gerada uma vez por
 * abertura do modal de pagamento) fecha essa segunda classe: a mesma chave
 * só pode ser usada uma vez, verificado dentro da MESMA transação atômica
 * que grava o pagamento (ver db.js#claimIdempotencyKey). Trocado de
 * `dbUpdate` (um store só) pra `dbTransaction` (dois stores) só por causa
 * disso — a lógica de get+put continua idêntica. */
export async function registerPayment({ id, amount, paymentMethod, userId, userName, dedupeKey }) {
  await assertActingUserHasPermission('financeiro');
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Informe um valor pago maior que zero.');

  let opError = null;
  let updatedEntry;
  try {
    await dbTransaction(['financialEntries', 'idempotencyKeys'], 'readwrite', (transaction) => {
      const fail = (message) => {
        opError = message;
        try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
      };
      claimIdempotencyKey(transaction, dedupeKey, () => fail('Este pagamento já foi registrado — evite reenviar.'));
      const store = transaction.objectStore('financialEntries');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const entry = getReq.result;
        if (!entry) { fail('Conta não encontrada.'); return; }
        if (entry.status === 'pago') { fail('Esta conta já está totalmente paga.'); return; }
        if (entry.status === 'cancelado') { fail('Esta conta foi cancelada.'); return; }
        const remaining = remainingAmount(entry);
        if (value > remaining + PAYMENT_TOLERANCE) {
          fail(`O valor informado (${value.toFixed(2)}) é maior que o restante a pagar (${remaining.toFixed(2)}).`);
          return;
        }
        const payment = { id: newId(), amount: value, paymentMethod, paidAt: Date.now(), userId, userName };
        entry.payments = Array.isArray(entry.payments) ? [...entry.payments, payment] : [payment];
        if (paidTotal(entry) >= entry.amount - PAYMENT_TOLERANCE) {
          entry.status = 'pago';
        }
        updatedEntry = entry;
        store.put(entry);
      };
    });
  } catch (err) {
    throw new Error(opError || err.message);
  }
  return updatedEntry;
}

/** Exclui um pagamento já registrado (parcial ou o que tinha fechado a
 * conta) — pedido explícito de quem usa o sistema: acesso a Financeiro já é
 * restrito a admin/gente de alta confiança, e tudo continua rastreável no
 * log de auditoria (quem excluiu, quando, de qual conta), então não faz
 * sentido travar essa correção atrás de mais burocracia. Se a exclusão
 * tirar a conta de "totalmente paga" (ex: era um dos dois pagamentos que
 * completavam o valor), ela volta sozinha a aparecer como pendente/parcial
 * — nunca fica presa em status:'pago' com menos dinheiro registrado contra
 * ela do que o total exige. */
export async function deletePayment({ entryId, paymentId }) {
  await assertActingUserHasPermission('financeiro');
  return dbUpdate('financialEntries', entryId, (entry) => {
    if (!entry) throw new Error('Conta não encontrada.');
    const payments = Array.isArray(entry.payments) ? entry.payments : [];
    if (!payments.some((p) => p.id === paymentId)) throw new Error('Pagamento não encontrado.');
    entry.payments = payments.filter((p) => p.id !== paymentId);
    entry.status = paidTotal(entry) >= entry.amount - PAYMENT_TOLERANCE ? 'pago' : 'pendente';
    return entry;
  });
}

export async function cancelEntry(id) {
  await assertActingUserHasPermission('financeiro');
  return dbUpdate('financialEntries', id, (entry) => {
    if (!entry) throw new Error('Conta não encontrada.');
    if (entry.status === 'pago') throw new Error('Não é possível cancelar uma conta já paga.');
    if (paidTotal(entry) > PAYMENT_TOLERANCE) {
      throw new Error('Esta conta já tem pagamento(s) registrado(s) — exclua os pagamentos antes de cancelar.');
    }
    entry.status = 'cancelado';
    return entry;
  });
}

/** Status pra exibição: 'vencido' e 'parcial' não são gravados, são
 * calculados a cada leitura — 'vencido' comparando o vencimento com hoje,
 * 'parcial' comparando o que já foi pago com o total. Assim uma conta
 * pendente vira "vencida" ou "paga parcialmente" sozinha, sem precisar de
 * nenhum job rodando em segundo plano nem de lembrar de atualizar um campo
 * solto toda vez que um pagamento é registrado ou excluído. */
export function entryStatus(entry) {
  if (entry.status === 'cancelado') return 'cancelado';
  if (entry.status === 'pago') return 'pago';
  if (paidTotal(entry) > PAYMENT_TOLERANCE) return 'parcial';
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (entry.dueDate < startOfToday.getTime()) return 'vencido';
  return 'pendente';
}
