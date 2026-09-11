// Fase 2 (vendas): diferente de products.js na Fase 1, aqui a atomicidade
// importa de verdade — dinheiro e estoque não podem corromper se duas
// máquinas venderem ao mesmo tempo. A saída: better-sqlite3 é SÍNCRONO, e
// o Node só processa uma requisição HTTP por vez (JS de thread única) —
// então uma função `db.transaction(...)` que faz tudo (conferir estoque,
// debitar, gravar a venda) sem nenhum `await` no meio nunca é interrompida
// por outra requisição chegando ao mesmo tempo. Isso substitui, de forma
// mais simples, a lógica de dbTransaction "manual" que a extensão
// single-machine precisa (ver salesRepo.js#createSale) porque lá o
// IndexedDB é assíncrono de verdade.
import { Router } from 'express';
import { db } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';
import { resolveOpenSession } from '../lib/cashSession.js';
import { getLoyaltyConfig } from '../lib/loyaltyConfig.js';
import { pointsBalance, creditBalance, listLoyaltyLedger, insertLoyaltyStmt, insertCreditStmt } from '../lib/loyaltyLedger.js';
import { getConfig } from '../lib/companyConfig.js';
import { verifyLogin } from '../lib/verifyLogin.js';
import { userCan } from '../lib/permissions.js';
import { resolveSaleItemPricing, computeCreditInterest, MAX_INSTALLMENTS } from '../lib/pricing.js';

const router = Router();

const getProductStmt = db.prepare('SELECT * FROM products WHERE id = ?');
const updateProductStmt = db.prepare(`
  UPDATE products SET name_lower = @nameLower, active = @active, updated_at = @updatedAt, data = @data WHERE id = @id
`);
const insertSaleStmt = db.prepare(`
  INSERT INTO sales (id, timestamp, user_id, customer_id, data) VALUES (@id, @timestamp, @userId, @customerId, @data)
`);
const getSaleStmt = db.prepare('SELECT * FROM sales WHERE id = ?');
const updateSaleStmt = db.prepare('UPDATE sales SET customer_id = @customerId, data = @data WHERE id = @id');
const claimIdempotencyStmt = db.prepare('INSERT INTO idempotency_keys (key, created_at) VALUES (?, ?)');
const insertDebtEntryStmt = db.prepare('INSERT INTO customer_debts (id, customer_id, timestamp, data) VALUES (@id, @customerId, @timestamp, @data)');

const FIADO_METHOD = 'Fiado';
const CREDIT_METHOD = 'Crédito de troca';
const CREDIT_CARD_METHOD = 'Cartão de crédito';
const CREDIT_TOLERANCE = 0.01;

function rowToSale(row) {
  return JSON.parse(row.data);
}
function rowToProduct(row) {
  return JSON.parse(row.data);
}
function saveProduct(product) {
  updateProductStmt.run({
    id: product.id, nameLower: product.nameLower, active: product.active ? 1 : 0,
    updatedAt: Date.now(), data: JSON.stringify(product),
  });
}

const PAYMENT_TOLERANCE = 0.01;

/** A venda inteira (conferir estoque de cada item, debitar, gravar) roda
 * dentro de UMA transação SQLite — se qualquer item não tiver estoque
 * suficiente, a transação inteira desfaz sozinha (nenhum produto fica
 * debitado pela metade). `db.transaction()` do better-sqlite3 já cuida
 * do BEGIN/COMMIT/ROLLBACK; só precisa lançar uma exceção pra abortar. */
const commitSale = db.transaction((input) => {
  // Achado de auditoria (P2): dedupeKey agora é obrigatória — ver
  // routes/deliveries.js#commitDelivery pro raciocínio completo.
  if (!input.dedupeKey) throw new Error('Requisição sem identificador de deduplicação.');
  claimIdempotencyStmt.run(input.dedupeKey, Date.now()); // estoura se repetido (chave já existe)

  const items = [];
  let subtotal = 0;
  let itemsDiscountTotal = 0;

  for (const rawItem of input.items) {
    const row = getProductStmt.get(rawItem.productId);
    if (!row) throw new Error(`Produto não encontrado: ${rawItem.productId}`);
    const product = rowToProduct(row);
    if (!product.active) throw new Error(`Produto inativo: ${product.name}`);
    const qty = Number(rawItem.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Quantidade inválida para ${product.name}.`);

    // Achado de auditoria (venda não pode confiar no cliente pra dizer o
    // preço): a versão anterior aceitava `rawItem.unitPrice` quase sem
    // reconferir — só checava que era um número finito, nunca que batia
    // com o catálogo. Um cliente malicioso (ou um bug de UI) podia vender
    // qualquer produto por R$0,01 sem cair em NENHUMA das checagens de
    // desconto (que olham `discountType`/`discountValue`, não o preço
    // base em si) — diferente de um desconto de verdade, isso nunca
    // aparecia como desconto nenhum pro totalDiscountPercent, então nunca
    // acionava a exigência de senha de admin. Igual a
    // data/salesRepo.js#resolveSaleItemPricing da extensão: preço/custo/
    // fator sempre vêm de novo do PRODUTO lido agora, nunca do que o
    // pedido mandou — pra produto 'personalizado', da forma de venda
    // escolhida (`rawItem.formName`), reconferida no catálogo atual.
    const pricing = resolveSaleItemPricing(product, rawItem);
    const stockQty = qty * (pricing.formFator || 1);
    if (product.quantity < stockQty) throw new Error(`Estoque insuficiente para "${product.name}" (disponível: ${product.quantity}).`);

    const unitPrice = pricing.unitPrice;
    const lineSubtotal = unitPrice * qty;
    let discountAmount = 0;
    if (rawItem.discountType === 'percent') discountAmount = lineSubtotal * (Number(rawItem.discountValue) || 0) / 100;
    else if (rawItem.discountType === 'value') discountAmount = Number(rawItem.discountValue) || 0;
    discountAmount = Math.max(0, Math.min(discountAmount, lineSubtotal));
    const lineTotal = lineSubtotal - discountAmount;

    subtotal += lineSubtotal;
    itemsDiscountTotal += discountAmount;
    items.push({
      productId: product.id, name: product.name, unit: pricing.unitLabel,
      qty, qtyRefunded: 0, unitPrice,
      ...(pricing.costPrice !== undefined ? { costPrice: pricing.costPrice } : {}),
      ...(pricing.formFator !== undefined ? { formFator: pricing.formFator } : {}),
      discountType: rawItem.discountType || null, discountValue: Number(rawItem.discountValue) || 0,
      lineTotal,
    });

    product.quantity -= stockQty;
    saveProduct(product);
  }

  if (items.length === 0) throw new Error('A venda precisa ter ao menos um item.');

  const overallDiscountAmount = Math.max(0, Math.min(Number(input.overallDiscountAmount) || 0, subtotal - itemsDiscountTotal));
  const total = subtotal - itemsDiscountTotal - overallDiscountAmount;

  // Desconto acima do limite do vendedor exige autorização de um admin —
  // reconferida aqui de verdade (usuário+senha checados contra o hash
  // gravado, ver lib/verifyLogin.js), nunca só confiada de quem chamou. A
  // verificação da senha em si (assíncrona) já rodou ANTES desta transação
  // (ver router.post('/') abaixo) — só o RESULTADO (o id do admin que
  // aprovou, ou null) chega até aqui.
  const totalDiscountPercent = subtotal > 0 ? ((itemsDiscountTotal + overallDiscountAmount) / subtotal) * 100 : 0;
  const bypassDiscountCap = userCan(input.actingRole, input.actingPermissions, 'unlimitedDiscount');
  let discountApprovedBy = null;
  if (!bypassDiscountCap) {
    const maxPercent = Number(getConfig().vendorMaxDiscountPercent ?? 10);
    if (totalDiscountPercent > maxPercent + 0.001) {
      if (!input.discountApprovalProvided) {
        throw new Error(`Esse desconto passa do limite de ${maxPercent}% — peça a autorização de um administrador.`);
      }
      if (!input.approvedAdminId) {
        throw new Error('Usuário ou senha de administrador inválidos para autorizar o desconto.');
      }
      discountApprovedBy = input.approvedAdminId;
    }
  }

  // Achado de auditoria (mesma classe do unitPrice acima): a versão
  // anterior aceitava `p.interestAmount` direto do pedido, sem recalcular
  // nada — um cliente malicioso podia zerar o juro de um parcelamento
  // (perda de receita) ou inflar (cobrando mais do cliente do que a
  // política da loja manda) só mudando o número enviado. Igual a
  // utils/pricing.js#computeCreditInterest da extensão, o juro é sempre
  // recalculado aqui a partir da política gravada agora em Dados da loja
  // (getConfig(), nunca de nada que o pedido tenha mandado) — o valor que
  // a tela mostrou antes de finalizar era só uma prévia usando a mesma
  // fórmula, quem decide de verdade é sempre o servidor.
  const companyPolicies = getConfig();
  const payments = (input.payments || []).map((p) => {
    const amount = Number(p.amount) || 0;
    const installments = Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(Number(p.installments)) || 1));
    const interestAmount = p.method === CREDIT_CARD_METHOD
      ? computeCreditInterest(amount, installments, companyPolicies).interestAmount
      : 0;
    return { method: p.method, amount, installments: installments > 1 ? installments : undefined, interestAmount };
  });
  const paymentsSum = payments.reduce((s, p) => s + p.amount, 0);
  if (Math.abs(paymentsSum - total) > PAYMENT_TOLERANCE) {
    throw new Error(`Pagamento (${paymentsSum.toFixed(2)}) não bate com o total da venda (${total.toFixed(2)}).`);
  }

  const fiadoTotal = payments.filter((p) => p.method === FIADO_METHOD).reduce((s, p) => s + p.amount, 0);
  if (fiadoTotal > 0 && !input.customerId) {
    throw new Error('Selecione um cliente para vender fiado.');
  }

  // Crédito de troca é dinheiro que o cliente JÁ tem guardado (de um
  // resgate de pontos ou de um estorno anterior) — gastar mais do que ele
  // tem de crédito não pode passar, mesma checagem de saldo (e mesmo
  // raciocínio de atomicidade) do fiado/pagamento de dívida. A checagem e o
  // consumo do crédito (mais abaixo) ficam na MESMA transação da venda.
  const creditPayment = payments.filter((p) => p.method === CREDIT_METHOD).reduce((s, p) => s + p.amount, 0);
  if (creditPayment > 0) {
    if (!input.customerId) throw new Error('Selecione um cliente para usar crédito de troca.');
    const available = creditBalance(input.customerId);
    if (creditPayment > available + CREDIT_TOLERANCE) {
      throw new Error(`O cliente só tem ${available.toFixed(2)} de crédito de troca disponível.`);
    }
  }

  const openSession = resolveOpenSession(input.terminalId);
  const sale = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    userId: input.userId,
    userName: input.userName,
    customerId: input.customerId || null,
    items,
    payments,
    subtotal,
    itemsDiscountTotal,
    overallDiscountAmount,
    total,
    discountApprovedBy,
    refundedTotal: 0,
    creditInterestTotal: payments.reduce((s, p) => s + p.interestAmount, 0),
    refunds: [],
    cashSessionId: openSession ? openSession.id : null,
  };
  insertSaleStmt.run({ id: sale.id, timestamp: sale.timestamp, userId: sale.userId, customerId: sale.customerId, data: JSON.stringify(sale) });

  // Lança a dívida de fiado no MESMO commit da venda — uma venda com parte
  // em "Fiado" sem nenhuma dívida lançada no extrato do cliente seria
  // dinheiro (a crédito) que a loja deu e não tem como cobrar.
  if (fiadoTotal > 0) {
    const debtEntry = {
      id: crypto.randomUUID(), customerId: sale.customerId, type: 'fiado', amount: fiadoTotal,
      saleId: sale.id, paymentMethod: null, cashSessionId: sale.cashSessionId,
      note: '', userId: input.userId, userName: input.userName, timestamp: sale.timestamp,
    };
    insertDebtEntryStmt.run({ id: debtEntry.id, customerId: debtEntry.customerId, timestamp: debtEntry.timestamp, data: JSON.stringify(debtEntry) });
  }

  // Consome o crédito de troca usado nesta venda (extrato, não um saldo
  // solto — mesmo princípio do fiado).
  if (creditPayment > 0) {
    const creditEntry = {
      id: crypto.randomUUID(), customerId: sale.customerId, type: 'uso', amount: creditPayment,
      note: 'Usado como pagamento em venda', saleId: sale.id, userId: input.userId, userName: input.userName, timestamp: sale.timestamp,
    };
    insertCreditStmt.run({ id: creditEntry.id, customerId: creditEntry.customerId, timestamp: creditEntry.timestamp, data: JSON.stringify(creditEntry) });
  }

  // Pontos de fidelidade ganhos nesta venda (se configurado e a venda tiver
  // cliente) — mesma transação, mesmo raciocínio do fiado/crédito acima.
  const { pointsPerReal } = getLoyaltyConfig();
  if (sale.customerId && pointsPerReal > 0) {
    const loyaltyPoints = Math.floor(total * pointsPerReal);
    if (loyaltyPoints > 0) {
      const loyaltyEntry = {
        id: crypto.randomUUID(), customerId: sale.customerId, type: 'ganho', points: loyaltyPoints,
        saleId: sale.id, note: '', userId: input.userId, userName: input.userName, timestamp: sale.timestamp,
      };
      insertLoyaltyStmt.run({ id: loyaltyEntry.id, customerId: loyaltyEntry.customerId, timestamp: loyaltyEntry.timestamp, data: JSON.stringify(loyaltyEntry) });
    }
  }
  return sale;
});

router.post('/', async (req, res) => {
  try {
    // A verificação de senha (assíncrona — Web Crypto) precisa acontecer
    // ANTES da transação síncrona de commitSale; só o resultado (o id do
    // admin aprovador, se a senha bateu) entra nela.
    let approvedAdminId = null;
    const approval = req.body.discountApproval;
    const discountApprovalProvided = !!(approval && approval.username && approval.password);
    if (discountApprovalProvided) {
      // Achado de auditoria (Fase 9): namespace própria, separada do login
      // real — sem isso, um vendedor errando a senha do admin 2x aqui
      // (aprovação de desconto) bloqueava o LOGIN DE VERDADE daquele
      // admin por 60s, repetível à vontade (ver lib/loginLockout.js).
      const admin = await verifyLogin(approval.username, approval.password, { namespace: 'confirmPassword' });
      if (admin && admin.role === 'admin') approvedAdminId = admin.id;
    }
    const sale = commitSale({
      ...req.body, userId: req.userId, userName: req.userName, terminalId: req.terminalId,
      actingRole: req.userRole, actingPermissions: req.userPermissions,
      discountApprovalProvided, approvedAdminId,
    });
    broadcast('sales-changed', { reason: 'created', id: sale.id });
    broadcast('products-changed', { reason: 'sale' });
    if (sale.customerId) broadcast('customers-changed', { reason: 'sale', id: sale.customerId });
    res.status(201).json({ sale });
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed: idempotency_keys')) {
      return res.status(409).json({ error: 'Esta venda já foi registrada — evite reenviar.' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  const { sellerId, customerId, fromTs, toTs, limit = 50, afterTs, afterId } = req.query;
  const lim = Math.min(200, Number(limit) || 50);

  let sql = 'SELECT * FROM sales WHERE 1=1';
  const params = [];
  if (sellerId) { sql += ' AND user_id = ?'; params.push(sellerId); }
  if (customerId) { sql += ' AND customer_id = ?'; params.push(customerId); }
  if (fromTs) { sql += ' AND timestamp >= ?'; params.push(Number(fromTs)); }
  if (toTs) { sql += ' AND timestamp <= ?'; params.push(Number(toTs)); }
  if (afterTs && afterId) {
    sql += ' AND (timestamp < ? OR (timestamp = ? AND id < ?))';
    params.push(Number(afterTs), Number(afterTs), afterId);
  }
  sql += ' ORDER BY timestamp DESC, id DESC LIMIT ?';
  params.push(lim + 1);

  const rows = db.prepare(sql).all(...params);
  const hasMore = rows.length > lim;
  const page = rows.slice(0, lim).map(rowToSale);
  const last = page[page.length - 1];

  // Contagem/total líquido do filtro (sem paginar) — pro resumo da tela
  // bater mesmo só com a página carregada.
  let countSql = "SELECT COUNT(*) as count, COALESCE(SUM(json_extract(data, '$.total') - json_extract(data, '$.refundedTotal')), 0) as netTotal FROM sales WHERE 1=1";
  const countParams = [];
  if (sellerId) { countSql += ' AND user_id = ?'; countParams.push(sellerId); }
  if (customerId) { countSql += ' AND customer_id = ?'; countParams.push(customerId); }
  if (fromTs) { countSql += ' AND timestamp >= ?'; countParams.push(Number(fromTs)); }
  if (toTs) { countSql += ' AND timestamp <= ?'; countParams.push(Number(toTs)); }
  const summary = db.prepare(countSql).get(...countParams);

  res.json({
    items: page, hasMore,
    nextAfterTs: last ? last.timestamp : null, nextAfterId: last ? last.id : null,
    summary: { count: summary.count, netTotal: summary.netTotal },
  });
});

router.get('/:id', (req, res) => {
  const row = getSaleStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Venda não encontrada.' });
  res.json({ sale: rowToSale(row) });
});

/** Estorno (total ou parcial) — mesma ideia de atomicidade do commitSale:
 * conferir, marcar qtyRefunded e devolver ao estoque tudo dentro de uma
 * transação só. */
const commitRefund = db.transaction((input) => {
  // Achado de auditoria (P2): dedupeKey agora é obrigatória — ver
  // routes/deliveries.js#commitDelivery pro raciocínio completo.
  if (!input.dedupeKey) throw new Error('Requisição sem identificador de deduplicação.');
  claimIdempotencyStmt.run(input.dedupeKey, Date.now());
  const row = getSaleStmt.get(input.saleId);
  if (!row) throw new Error('Venda não encontrada.');
  const sale = rowToSale(row);
  if (!input.reason || !input.reason.trim()) throw new Error('Informe o motivo do estorno.');
  if (input.generateCredit && !sale.customerId) {
    throw new Error('Esta venda não tem cliente — não é possível gerar crédito de troca.');
  }
  // Achado de auditoria (P2): "gerar crédito de troca" transforma um
  // estorno em dinheiro NOVO (gasto depois como forma de pagamento em
  // qualquer terminal, ver POST /) sem nenhuma segunda aprovação — a
  // mesma classe de risco que o desconto acima do limite já fecha com
  // senha de admin (ver bypassDiscountCap/discountApprovedBy em
  // commitSale, acima). Réplica do mesmo mecanismo aqui: só o admin agindo
  // dispensa a confirmação; qualquer vendedor precisa da senha de um
  // administrador (checada de verdade em POST /:id/refund, antes desta
  // transação — ver ali o mesmo raciocínio já documentado em POST /).
  if (input.generateCredit && input.actingRole !== 'admin' && !input.approvedAdminId) {
    throw new Error('Estornar gerando crédito de troca passa do que um vendedor pode fazer sozinho — peça a autorização de um administrador.');
  }

  let totalRefunded = 0;
  const refundedItems = [];
  for (const reqItem of input.items) {
    const item = sale.items[reqItem.itemIndex];
    if (!item || item.productId !== reqItem.productId) throw new Error('Item da venda não encontrado.');
    const qty = Number(reqItem.qty);
    const available = item.qty - item.qtyRefunded;
    if (!Number.isFinite(qty) || qty <= 0 || qty > available + 0.0001) {
      throw new Error(`Quantidade de estorno inválida para "${item.name}" (disponível: ${available}).`);
    }
    item.qtyRefunded += qty;
    totalRefunded += (item.lineTotal / item.qty) * qty;
    refundedItems.push({ productId: item.productId, name: item.name, qty });

    const prodRow = getProductStmt.get(item.productId);
    if (prodRow) {
      const product = rowToProduct(prodRow);
      product.quantity += qty;
      saveProduct(product);
    }
  }
  if (refundedItems.length === 0) throw new Error('Marque ao menos um item para estornar.');

  // A sessão de caixa gravada aqui é a que está ABERTA agora, no momento do
  // estorno — não a sessão em que a venda original foi feita (podem ser
  // diferentes: um cliente pode devolver hoje algo comprado semana passada,
  // com o caixa de hoje aberto). computeExpectedAmounts (routes/cash.js) usa
  // isso pra saber em qual fechamento esse dinheiro que sai da gaveta entra
  // na conferência.
  const openSession = resolveOpenSession(input.terminalId);
  const refund = {
    id: crypto.randomUUID(), timestamp: Date.now(), userId: input.userId, userName: input.userName,
    reason: input.reason.trim(), totalRefunded, items: refundedItems,
    creditGenerated: !!input.generateCredit,
    creditApprovedBy: input.generateCredit ? (input.approvedAdminId || null) : null,
    cashSessionId: openSession ? openSession.id : null,
  };
  sale.refundedTotal += totalRefunded;
  sale.refunds.push(refund);
  updateSaleStmt.run({ id: sale.id, customerId: sale.customerId, data: JSON.stringify(sale) });

  // Estornar uma venda paga (total ou parcialmente) em fiado precisa reduzir
  // a dívida do cliente proporcionalmente — devolver a mercadoria mas
  // continuar cobrando o valor cheio de quem já devolveu o produto seria
  // errado. Lançamento de tipo 'estorno' (nunca reescreve a dívida
  // original) — não é 'pagamento' de propósito: não é dinheiro recebido,
  // então não deve inflar o "esperado em caixa" de nenhuma sessão (ver
  // routes/cash.js#computeExpectedAmounts, que só soma 'pagamento').
  let debtReduced = 0;
  if (sale.customerId && sale.total > 0) {
    const fiadoTotal = sale.payments.filter((p) => p.method === FIADO_METHOD).reduce((s, p) => s + p.amount, 0);
    if (fiadoTotal > 0) {
      debtReduced = fiadoTotal * (totalRefunded / sale.total);
      const debtEntry = {
        id: crypto.randomUUID(), customerId: sale.customerId, type: 'estorno', amount: debtReduced,
        saleId: sale.id, refundId: refund.id, paymentMethod: null, cashSessionId: null,
        note: 'Redução de dívida por estorno de venda', userId: input.userId, userName: input.userName, timestamp: Date.now(),
      };
      insertDebtEntryStmt.run({ id: debtEntry.id, customerId: debtEntry.customerId, timestamp: debtEntry.timestamp, data: JSON.stringify(debtEntry) });
    }
  }

  // "Gerar crédito de troca" — em vez de devolver em espécie (que sai do
  // caixa), o valor vira crédito no extrato do cliente, usável como forma
  // de pagamento em qualquer terminal na próxima venda dele.
  // routes/cash.js#computeExpectedAmounts já ignora refund.creditGenerated
  // (não reduz o "Dinheiro" esperado) — só faltava gravar o crédito de
  // verdade, que é este bloco.
  if (refund.creditGenerated) {
    const creditEntry = {
      id: crypto.randomUUID(), customerId: sale.customerId, type: 'estorno-credito', amount: totalRefunded,
      note: `Crédito de troca gerado pelo estorno de uma venda`, saleId: sale.id, refundId: refund.id,
      userId: input.userId, userName: input.userName, timestamp: Date.now(),
    };
    insertCreditStmt.run({ id: creditEntry.id, customerId: creditEntry.customerId, timestamp: creditEntry.timestamp, data: JSON.stringify(creditEntry) });
  }

  // Reverte proporcionalmente os pontos de fidelidade ganhos por esta
  // venda — sem isso, o cliente manteria pontos de compra que devolveu.
  // Fica negativo se ele já tiver resgatado esses pontos antes do estorno;
  // mesmo compromisso adotado por qualquer programa de fidelidade real.
  if (sale.customerId && sale.total > 0) {
    const pointsEarned = listLoyaltyLedger(sale.customerId)
      .filter((e) => e.saleId === sale.id && e.type === 'ganho')
      .reduce((s, e) => s + e.points, 0);
    if (pointsEarned > 0) {
      const pointsToReverse = Math.floor(pointsEarned * (totalRefunded / sale.total));
      if (pointsToReverse > 0) {
        const loyaltyEntry = {
          id: crypto.randomUUID(), customerId: sale.customerId, type: 'estorno', points: pointsToReverse,
          saleId: sale.id, note: '', userId: input.userId, userName: input.userName, timestamp: Date.now(),
        };
        insertLoyaltyStmt.run({ id: loyaltyEntry.id, customerId: loyaltyEntry.customerId, timestamp: loyaltyEntry.timestamp, data: JSON.stringify(loyaltyEntry) });
      }
    }
  }
  return { sale, debtReduced };
});

router.post('/:id/refund', async (req, res) => {
  try {
    // Achado de auditoria (P2): mesmo raciocínio de POST / (desconto acima
    // do limite) — a verificação de senha (assíncrona) roda ANTES da
    // transação síncrona de commitRefund; só o resultado (id do admin
    // aprovador, se a senha bateu) entra nela. Só exigido quando
    // `generateCredit` está marcado (é o que transforma o estorno em
    // dinheiro novo gastável em qualquer terminal — ver commitRefund).
    let approvedAdminId = null;
    const approval = req.body.creditApproval;
    if (req.body.generateCredit && req.userRole !== 'admin') {
      if (!approval || !approval.username || !approval.password) {
        return res.status(400).json({ error: 'Estornar gerando crédito de troca passa do que um vendedor pode fazer sozinho — peça a autorização de um administrador.' });
      }
      const admin = await verifyLogin(approval.username, approval.password, { namespace: 'confirmPassword' });
      if (!admin || admin.role !== 'admin') {
        return res.status(401).json({ error: 'Usuário ou senha de administrador inválidos para autorizar o crédito.' });
      }
      approvedAdminId = admin.id;
    }
    const { sale, debtReduced } = commitRefund({
      ...req.body, saleId: req.params.id, userId: req.userId, userName: req.userName, terminalId: req.terminalId,
      actingRole: req.userRole, approvedAdminId,
    });
    broadcast('sales-changed', { reason: 'refunded', id: sale.id });
    broadcast('products-changed', { reason: 'refund' });
    if (sale.customerId) broadcast('customers-changed', { reason: 'refund', id: sale.customerId });
    // `refund` não vem separado do estado interno da transação — é sempre o
    // último item de sale.refunds (foi acabado de dar push nele ali em
    // cima), então derivar daqui é seguro e evita duplicar o objeto na
    // resposta. views/salesHistory.js#openRefundModal usa refund.id e
    // refund.totalRefunded pro toast de confirmação; debtReduced, quando >
    // 0, também entra na mesma mensagem.
    const refund = sale.refunds[sale.refunds.length - 1];
    res.json({ sale, refund, debtReduced });
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed: idempotency_keys')) {
      return res.status(409).json({ error: 'Este estorno já foi registrado — evite reenviar.' });
    }
    res.status(400).json({ error: err.message });
  }
});

export default router;
