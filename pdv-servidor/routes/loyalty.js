// Fase 6 (fidelidade): pontos ganhos por venda (configurável, "X pontos por
// real gasto") e resgate — converte pontos em crédito de troca, gravado no
// extrato de `store_credits` do cliente (ver nota em db/schema.sql sobre a
// diferença pro modelo efêmero-por-sessão da extensão). O ganho de pontos em
// si acontece dentro de routes/sales.js#commitSale (mesma transação da
// venda); aqui só ficam config, leitura do extrato e o resgate.
import { Router } from 'express';
import { db } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';
import { getLoyaltyConfig } from '../lib/loyaltyConfig.js';
import { updateConfig } from '../lib/companyConfig.js';
import { pointsBalance, creditBalance, listLoyaltyLedger, listCreditLedger, insertLoyaltyStmt, insertCreditStmt } from '../lib/loyaltyLedger.js';

const router = Router();

const claimIdempotencyStmt = db.prepare('INSERT INTO idempotency_keys (key, created_at) VALUES (?, ?)');
const getCustomerStmt = db.prepare('SELECT data FROM customers WHERE id = ?');

router.get('/config', (req, res) => {
  res.json(getLoyaltyConfig());
});

router.put('/config', (req, res) => {
  const pointsPerReal = Number(req.body.pointsPerReal);
  const redemptionRate = Number(req.body.redemptionRate);
  if (!Number.isFinite(pointsPerReal) || pointsPerReal < 0) {
    return res.status(400).json({ error: 'Informe pontos por real gasto válido (0 desativa).' });
  }
  if (!Number.isFinite(redemptionRate) || redemptionRate <= 0) {
    return res.status(400).json({ error: 'Informe uma taxa de resgate válida (pontos por R$ 1,00).' });
  }
  updateConfig({ loyaltyPointsPerReal: pointsPerReal, loyaltyRedemptionRate: redemptionRate });
  const config = { pointsPerReal, redemptionRate };
  broadcast('loyalty-config-changed', config);
  res.json(config);
});

// Saldos de TODOS os clientes de uma vez (evita N consultas separadas na
// tela que lista todo mundo) — igual GET /api/customers/balances. Fica
// antes de '/:customerId' pra "balances" não ser capturado como um id.
router.get('/balances', (req, res) => {
  const pointsRows = db.prepare('SELECT data FROM loyalty_entries').all().map((r) => JSON.parse(r.data));
  const points = {};
  for (const e of pointsRows) {
    const delta = e.type === 'ganho' ? e.points : -e.points;
    points[e.customerId] = (points[e.customerId] || 0) + delta;
  }
  const creditRows = db.prepare('SELECT data FROM store_credits').all().map((r) => JSON.parse(r.data));
  const credit = {};
  for (const e of creditRows) {
    const delta = e.type === 'uso' ? -e.amount : e.amount;
    credit[e.customerId] = (credit[e.customerId] || 0) + delta;
  }
  res.json({ points, credit });
});

router.get('/:customerId', (req, res) => {
  const row = getCustomerStmt.get(req.params.customerId);
  if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });
  res.json({
    points: pointsBalance(req.params.customerId),
    ledger: listLoyaltyLedger(req.params.customerId),
    credit: creditBalance(req.params.customerId),
    creditLedger: listCreditLedger(req.params.customerId),
  });
});

/** Mesma trava atômica do resto do sistema (fiado, caixa, financeiro):
 * checar o saldo de pontos e gravar o resgate (+ o crédito de troca
 * correspondente) precisam estar na MESMA transação — senão dois resgates
 * quase simultâneos liam o mesmo saldo "antes" e os dois passavam,
 * resgatando mais pontos do que o cliente tinha de verdade. dedupeKey só é
 * reivindicada DEPOIS da checagem de saldo passar. */
const commitRedemption = db.transaction((input) => {
  const points = Number(input.points);
  if (!Number.isFinite(points) || points <= 0) throw new Error('Informe uma quantidade de pontos maior que zero.');

  const balance = pointsBalance(input.customerId);
  if (points > balance) throw new Error(`O cliente só tem ${balance} pontos disponíveis.`);
  if (input.dedupeKey) {
    claimIdempotencyStmt.run(input.dedupeKey, Date.now());
  }

  const { redemptionRate } = getLoyaltyConfig();
  const amount = points / redemptionRate;
  const timestamp = Date.now();

  const loyaltyEntry = {
    id: crypto.randomUUID(), customerId: input.customerId, type: 'resgate', points,
    saleId: null, note: 'Resgate convertido em crédito de troca', userId: input.userId, userName: input.userName, timestamp,
  };
  insertLoyaltyStmt.run({ id: loyaltyEntry.id, customerId: input.customerId, timestamp, data: JSON.stringify(loyaltyEntry) });

  const creditEntry = {
    id: crypto.randomUUID(), customerId: input.customerId, type: 'resgate', amount,
    note: `Resgate de ${points} pontos de fidelidade`, userId: input.userId, userName: input.userName, timestamp,
  };
  insertCreditStmt.run({ id: creditEntry.id, customerId: input.customerId, timestamp, data: JSON.stringify(creditEntry) });

  return { amount, newPointsBalance: balance - points, newCreditBalance: creditBalance(input.customerId) };
});

router.post('/:customerId/resgatar', (req, res) => {
  const row = getCustomerStmt.get(req.params.customerId);
  if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });
  try {
    const result = commitRedemption({ ...req.body, customerId: req.params.customerId, userId: req.userId, userName: req.userName });
    broadcast('customers-changed', { reason: 'loyalty-redemption', id: req.params.customerId });
    res.status(201).json(result);
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed: idempotency_keys')) {
      return res.status(409).json({ error: 'Este resgate já foi registrado — evite reenviar.' });
    }
    res.status(400).json({ error: err.message });
  }
});

export default router;
