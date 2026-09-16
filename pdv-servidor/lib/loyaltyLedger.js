// Saldo de pontos e de crédito de troca — sempre calculado do extrato
// (loyalty_entries / store_credits), nunca um número solto (mesmo
// princípio do saldo de fiado em routes/customers.js). Compartilhado entre
// routes/loyalty.js (config, extrato, resgate) e routes/sales.js (ganho de
// pontos e consumo de crédito de troca dentro da própria venda).
import { db } from '../db/index.js';

const LIST_LOYALTY_SQL = 'SELECT data FROM loyalty_entries WHERE customer_id = ? ORDER BY timestamp DESC';
const LIST_CREDITS_SQL = 'SELECT data FROM store_credits WHERE customer_id = ? ORDER BY timestamp DESC';
// insertLoyaltyStmt/insertCreditStmt continuam exportados como statements
// crus (não convertidos nesta fatia da etapa 5 do roteiro multi-tenant) —
// são importados e chamados direto (`insertLoyaltyStmt.run(...)`) por
// routes/sales.js e routes/loyalty.js, então dar a eles um `targetDb`
// opcional exigiria mudar esses dois call sites JUNTO, o que quebraria a
// promessa desta fatia de não tocar rota nenhuma ainda. Ficam pra quando
// essas duas rotas forem convertidas.
export const insertLoyaltyStmt = db.prepare('INSERT INTO loyalty_entries (id, customer_id, timestamp, data) VALUES (@id, @customerId, @timestamp, @data)');
export const insertCreditStmt = db.prepare('INSERT INTO store_credits (id, customer_id, timestamp, data) VALUES (@id, @customerId, @timestamp, @data)');

// `targetDb` opcional nas quatro funções abaixo (etapa 5 do roteiro
// multi-tenant, ver artifact "PDV Multi-Tenant") — normalmente req.db,
// resolvido pelo tenant da requisição. Sem ele (todo call site de hoje),
// lê o banco fixo do processo, comportamento idêntico a sempre.
export function listLoyaltyLedger(customerId, targetDb = db) {
  return targetDb.prepare(LIST_LOYALTY_SQL).all(customerId).map((r) => JSON.parse(r.data));
}

export function listCreditLedger(customerId, targetDb = db) {
  return targetDb.prepare(LIST_CREDITS_SQL).all(customerId).map((r) => JSON.parse(r.data));
}

export function pointsBalance(customerId, targetDb = db) {
  return listLoyaltyLedger(customerId, targetDb).reduce((sum, e) => sum + (e.type === 'ganho' ? e.points : -e.points), 0);
}

export function creditBalance(customerId, targetDb = db) {
  return listCreditLedger(customerId, targetDb).reduce((sum, e) => sum + (e.type === 'uso' ? -e.amount : e.amount), 0);
}
