// Saldo de pontos e de crédito de troca — sempre calculado do extrato
// (loyalty_entries / store_credits), nunca um número solto (mesmo
// princípio do saldo de fiado em routes/customers.js). Compartilhado entre
// routes/loyalty.js (config, extrato, resgate) e routes/sales.js (ganho de
// pontos e consumo de crédito de troca dentro da própria venda).
import { db } from '../db/index.js';

const LIST_LOYALTY_SQL = 'SELECT data FROM loyalty_entries WHERE customer_id = ? ORDER BY timestamp DESC';
const LIST_CREDITS_SQL = 'SELECT data FROM store_credits WHERE customer_id = ? ORDER BY timestamp DESC';
const INSERT_LOYALTY_SQL = 'INSERT INTO loyalty_entries (id, customer_id, timestamp, data) VALUES (@id, @customerId, @timestamp, @data)';
const INSERT_CREDIT_SQL = 'INSERT INTO store_credits (id, customer_id, timestamp, data) VALUES (@id, @customerId, @timestamp, @data)';

// `targetDb` opcional em todas as funções abaixo (etapa 5 do roteiro
// multi-tenant, ver artifact "PDV Multi-Tenant") — normalmente req.db,
// resolvido pelo tenant da requisição. Sem ele (todo call site de hoje),
// opera no banco fixo do processo, comportamento idêntico a sempre.
// insertLoyaltyEntry/insertCreditEntry substituem os antigos
// insertLoyaltyStmt/insertCreditStmt (statements crus pré-montados) agora
// que routes/sales.js e routes/loyalty.js, os únicos dois call sites,
// também foram convertidos nesta mesma fatia.
export function insertLoyaltyEntry(record, targetDb = db) {
  targetDb.prepare(INSERT_LOYALTY_SQL).run({ id: record.id, customerId: record.customerId, timestamp: record.timestamp, data: JSON.stringify(record) });
}

export function insertCreditEntry(record, targetDb = db) {
  targetDb.prepare(INSERT_CREDIT_SQL).run({ id: record.id, customerId: record.customerId, timestamp: record.timestamp, data: JSON.stringify(record) });
}
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
