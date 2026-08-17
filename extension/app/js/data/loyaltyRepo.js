// Pontos de fidelidade. Segue o mesmo padrão de extrato usado no fiado
// (customerDebts) — o saldo de pontos nunca é um número solto, é sempre a
// soma dos lançamentos (ganho de venda, resgate), o que preserva o
// histórico completo de como o cliente chegou naquele saldo.
import { dbGetAll, dbAdd, dbGetAllByIndex, newId } from '../db.js';

export async function listCustomerLoyaltyLedger(customerId) {
  const entries = await dbGetAllByIndex('loyaltyEntries', 'byCustomerId', customerId);
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getCustomerPoints(customerId) {
  const entries = await listCustomerLoyaltyLedger(customerId);
  return entries.reduce((sum, e) => sum + (e.type === 'ganho' ? e.points : -e.points), 0);
}

/** Ganho automático de pontos — chamado pelo salesRepo quando a venda tem
 * cliente selecionado e o programa de fidelidade está ligado (ver
 * companyRepo policies.loyaltyPointsPerReal). */
export async function recordEarn({ customerId, points, saleId, userId, userName }) {
  if (points <= 0) return null;
  const entry = {
    id: newId(), customerId, type: 'ganho', points, saleId,
    note: '', userId, userName, timestamp: Date.now(),
  };
  await dbAdd('loyaltyEntries', entry);
  return entry;
}

/** Resgate de pontos — converte em crédito de troca (mesma sessão usada
 * pelo estorno), pra reaproveitar o fluxo que já existe no PDV em vez de
 * inventar uma segunda forma de pagamento só pra pontos. */
export async function recordRedemption({ customerId, points, note = '', userId, userName }) {
  const value = Number(points) || 0;
  if (value <= 0) throw new Error('Informe uma quantidade de pontos maior que zero.');
  const balance = await getCustomerPoints(customerId);
  if (value > balance) throw new Error(`O cliente só tem ${balance} pontos disponíveis.`);
  const entry = {
    id: newId(), customerId, type: 'resgate', points: value,
    saleId: null, note: note.trim(), userId, userName, timestamp: Date.now(),
  };
  await dbAdd('loyaltyEntries', entry);
  return entry;
}

export async function getAllPointsBalances() {
  const all = await dbGetAll('loyaltyEntries');
  const balances = {};
  for (const e of all) {
    const delta = e.type === 'ganho' ? e.points : -e.points;
    balances[e.customerId] = (balances[e.customerId] || 0) + delta;
  }
  return balances;
}
