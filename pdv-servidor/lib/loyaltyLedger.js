// Saldo de pontos e de crédito de troca — sempre calculado do extrato
// (loyalty_entries / store_credits), nunca um número solto (mesmo
// princípio do saldo de fiado em routes/customers.js). Compartilhado entre
// routes/loyalty.js (config, extrato, resgate) e routes/sales.js (ganho de
// pontos e consumo de crédito de troca dentro da própria venda).
import { db } from '../db/index.js';

const listLoyaltyStmt = db.prepare('SELECT data FROM loyalty_entries WHERE customer_id = ? ORDER BY timestamp DESC');
const listCreditsStmt = db.prepare('SELECT data FROM store_credits WHERE customer_id = ? ORDER BY timestamp DESC');
export const insertLoyaltyStmt = db.prepare('INSERT INTO loyalty_entries (id, customer_id, timestamp, data) VALUES (@id, @customerId, @timestamp, @data)');
export const insertCreditStmt = db.prepare('INSERT INTO store_credits (id, customer_id, timestamp, data) VALUES (@id, @customerId, @timestamp, @data)');

export function listLoyaltyLedger(customerId) {
  return listLoyaltyStmt.all(customerId).map((r) => JSON.parse(r.data));
}

export function listCreditLedger(customerId) {
  return listCreditsStmt.all(customerId).map((r) => JSON.parse(r.data));
}

export function pointsBalance(customerId) {
  return listLoyaltyLedger(customerId).reduce((sum, e) => sum + (e.type === 'ganho' ? e.points : -e.points), 0);
}

export function creditBalance(customerId) {
  return listCreditLedger(customerId).reduce((sum, e) => sum + (e.type === 'uso' ? -e.amount : e.amount), 0);
}
