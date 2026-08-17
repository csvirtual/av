// Caixa da loja: abertura, sangria/suprimento e fechamento com conferência.
// Modelo de caixa único (uma sessão aberta por vez pra loja toda, não por
// vendedor) — combina com uma loja com uma frente de caixa física, onde
// quem está de turno abre e fecha antes de passar pro próximo.
import { dbGetAll, dbGet, dbPut, dbAdd, dbGetAllByIndex, newId } from '../db.js';
import { listSales } from './salesRepo.js';
import { listPaymentsForCashSession } from './customersRepo.js';

const CREDIT_METHOD = 'Crédito de troca';
const FIADO_METHOD = 'Fiado';

export async function getOpenSession() {
  const sessions = await dbGetAllByIndex('cashSessions', 'byStatus', 'aberto');
  return sessions[0] || null;
}

export async function listSessions() {
  const sessions = await dbGetAll('cashSessions');
  return sessions.sort((a, b) => b.openedAt - a.openedAt);
}

export async function getSession(id) {
  return dbGet('cashSessions', id);
}

export async function openSession({ userId, userName, openingAmount }) {
  const existing = await getOpenSession();
  if (existing) throw new Error('Já existe um caixa aberto. Feche-o antes de abrir um novo.');
  const session = {
    id: newId(),
    status: 'aberto',
    openedBy: { userId, userName },
    openedAt: Date.now(),
    openingAmount: Number(openingAmount) || 0,
    closedBy: null,
    closedAt: null,
    countedAmounts: null,
    expectedAmounts: null,
    difference: null,
    closingNotes: '',
  };
  await dbAdd('cashSessions', session);
  return session;
}

export async function listSessionMovements(sessionId) {
  const movements = await dbGetAllByIndex('cashMovements', 'bySessionId', sessionId);
  return movements.sort((a, b) => b.timestamp - a.timestamp);
}

/** Sangria (retirada) ou suprimento (reforço) de dinheiro no caixa aberto —
 * sempre em espécie, é o que muda fisicamente a gaveta. */
export async function recordCashMovement({ sessionId, type, amount, reason, userId, userName }) {
  if (!reason || !reason.trim()) throw new Error('Informe o motivo do movimento de caixa.');
  const value = Number(amount) || 0;
  if (value <= 0) throw new Error('Informe um valor maior que zero.');
  const session = await getSession(sessionId);
  if (!session || session.status !== 'aberto') throw new Error('Este caixa não está mais aberto.');

  const movement = {
    id: newId(),
    sessionId,
    type, // 'sangria' | 'suprimento'
    amount: value,
    reason: reason.trim(),
    userId, userName,
    timestamp: Date.now(),
  };
  await dbAdd('cashMovements', movement);
  return movement;
}

/** Calcula quanto DEVERIA ter em caixa por forma de pagamento, a partir do
 * valor de abertura, das vendas feitas durante a sessão e das sangrias
 * /suprimentos. Só "Dinheiro" corresponde a espécie física na gaveta —
 * outras formas (cartão, pix) são só conferência informativa contra o
 * extrato da maquininha depois, não entram na sangria/suprimento.
 *
 * Simplificação assumida: um estorno que NÃO gerou crédito de troca é
 * tratado como devolução em dinheiro (reduz o esperado em espécie) — é o
 * caso mais comum numa loja pequena sem controle de qual forma original foi
 * usada no reembolso. Estorno que gerou crédito não mexe em caixa (a loja
 * ficou com o dinheiro, o cliente ficou com o crédito). Venda com pagamento
 * em "Fiado" também não entra aqui (é dívida, não dinheiro agora) — só
 * conta quando o cliente vier pagar de verdade (ver listPaymentsForCashSession). */
export async function computeExpectedAmounts(session) {
  const allSales = await listSales();
  const sessionSales = allSales.filter((s) => s.cashSessionId === session.id);
  const movements = await listSessionMovements(session.id);
  const debtPayments = await listPaymentsForCashSession(session.id);

  const expected = { Dinheiro: session.openingAmount };
  const ensure = (method) => { if (!(method in expected)) expected[method] = 0; };

  for (const sale of sessionSales) {
    for (const payment of sale.payments) {
      if (payment.method === CREDIT_METHOD || payment.method === FIADO_METHOD) continue; // não é dinheiro novo entrando
      ensure(payment.method);
      expected[payment.method] += payment.amount;
    }
    for (const refund of sale.refunds) {
      if (refund.creditGenerated) continue; // virou crédito, não saiu dinheiro da gaveta
      expected.Dinheiro -= refund.totalRefunded;
    }
  }

  for (const payment of debtPayments) {
    ensure(payment.paymentMethod);
    expected[payment.paymentMethod] += payment.amount;
  }

  for (const m of movements) {
    if (m.type === 'suprimento') expected.Dinheiro += m.amount;
    if (m.type === 'sangria') expected.Dinheiro -= m.amount;
  }

  return expected;
}

export async function closeSession({ sessionId, userId, userName, countedAmounts, closingNotes = '' }) {
  const session = await getSession(sessionId);
  if (!session || session.status !== 'aberto') throw new Error('Este caixa não está mais aberto.');

  const expectedAmounts = await computeExpectedAmounts(session);
  const counted = {};
  for (const [method, value] of Object.entries(countedAmounts || {})) {
    counted[method] = Number(value) || 0;
  }
  const difference = (counted.Dinheiro ?? 0) - (expectedAmounts.Dinheiro ?? 0);

  const updated = {
    ...session,
    status: 'fechado',
    closedBy: { userId, userName },
    closedAt: Date.now(),
    expectedAmounts,
    countedAmounts: counted,
    difference,
    closingNotes: closingNotes.trim(),
  };
  await dbPut('cashSessions', updated);
  return updated;
}
