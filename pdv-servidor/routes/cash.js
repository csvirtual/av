// Fase 3 (caixa): mesma ideia de atomicidade de routes/sales.js, mas com uma
// decisão nova que a extensão single-machine não precisa tomar — "único" (uma
// gaveta pra loja inteira, qualquer terminal abre/fecha/movimenta) ou
// "porTerminal" (cada terminal tem sua própria sessão, abertas ao mesmo
// tempo). O modo fica salvo em `company` (linha id='config') e é lido a cada
// requisição — trocar o modo não mexe em sessões já abertas, só afeta a
// checagem "já existe uma aberta?" da PRÓXIMA abertura.
import { Router } from 'express';
import { db, claimIdempotencyKey } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';
import { getCaixaMode, resolveOpenSession } from '../lib/cashSession.js';
import { updateConfig } from '../lib/companyConfig.js';
import { requirePermission } from '../lib/permissions.js';
import { buildBackupPayload } from '../lib/backup.js';
import { encryptPayload } from '../lib/backupCrypto.js';
import { MIN_USER_PASSWORD_LENGTH } from '../lib/permissions.js';
import { verifyLogin } from '../lib/verifyLogin.js';

const router = Router();

const CREDIT_METHOD = 'Crédito de troca';
const FIADO_METHOD = 'Fiado';

// Etapa 5 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): SQL
// como texto, não mais prepared statements pré-montados — cada handler
// prepara contra `req.db`, sempre já resolvido pro banco certo (o da
// loja, ou o banco fixo do processo em modo legado) — server.js#tenant
// resolution middleware é a ÚNICA fonte dessa decisão agora, nenhuma
// rota mais precisa repetir o fallback.
const GET_OPEN_GLOBAL_SQL = "SELECT * FROM cash_sessions WHERE status = 'aberto' LIMIT 1";
const GET_OPEN_BY_TERMINAL_SQL = "SELECT * FROM cash_sessions WHERE status = 'aberto' AND terminal_id = ? LIMIT 1";
const GET_OPEN_BY_USER_SQL = "SELECT * FROM cash_sessions WHERE status = 'aberto' AND user_id = ? LIMIT 1";
const GET_SESSION_BY_ID_SQL = 'SELECT * FROM cash_sessions WHERE id = ?';
const INSERT_SESSION_SQL = `
  INSERT INTO cash_sessions (id, opened_at, status, terminal_id, user_id, data) VALUES (@id, @openedAt, 'aberto', @terminalId, @userId, @data)
`;
const UPDATE_SESSION_SQL = 'UPDATE cash_sessions SET status = @status, data = @data WHERE id = @id';
const LIST_SESSIONS_SQL = 'SELECT * FROM cash_sessions ORDER BY opened_at DESC LIMIT ?';
const INSERT_MOVEMENT_SQL = `
  INSERT INTO cash_movements (id, session_id, timestamp, data) VALUES (@id, @sessionId, @timestamp, @data)
`;
const LIST_MOVEMENTS_SQL = 'SELECT data FROM cash_movements WHERE session_id = ? ORDER BY timestamp DESC';
const LIST_ALL_SALES_SQL = 'SELECT data FROM sales';
const LIST_ALL_DEBTS_SQL = 'SELECT data FROM customer_debts';

function rowToSession(row) { return JSON.parse(row.data); }

router.get('/config', (req, res) => {
  res.json({ caixaMode: getCaixaMode(req.db) });
});

// Achado de auditoria (P2): sem isto, qualquer vendedor autenticado
// conseguia trocar o modo de operação do caixa (único ↔ por-terminal) da
// loja inteira a qualquer momento — inclusive pra atrapalhar de propósito
// uma conferência de caixa, abrindo uma sessão isolada antes de um
// fechamento. Mesma classe de política sensível já protegida em
// company.js e loyalty.js.
router.put('/config', requirePermission('empresa'), (req, res) => {
  const mode = req.body.caixaMode;
  if (mode !== 'unico' && mode !== 'porTerminal' && mode !== 'porOperador') {
    return res.status(400).json({ error: 'Modo de caixa inválido.' });
  }
  updateConfig({ caixaMode: mode }, req.db);
  broadcast('cash-config-changed', { caixaMode: mode }, req.tenantId);
  res.json({ caixaMode: mode });
});

router.get('/open', (req, res) => {
  const mode = getCaixaMode(req.db);
  const session = resolveOpenSession(req.terminalId, req.userId, req.db);
  res.json({ mode, session });
});

router.get('/sessions', (req, res) => {
  const lim = Math.min(200, Number(req.query.limit) || 50);
  const rows = req.db.prepare(LIST_SESSIONS_SQL).all(lim);
  res.json({ items: rows.map(rowToSession) });
});

router.get('/sessions/:id', (req, res) => {
  const targetDb = req.db;
  const row = targetDb.prepare(GET_SESSION_BY_ID_SQL).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Caixa não encontrado.' });
  const session = rowToSession(row);
  const movements = targetDb.prepare(LIST_MOVEMENTS_SQL).all(req.params.id).map((r) => JSON.parse(r.data));
  // Pra sessão fechada o "esperado" já foi congelado em session.expectedAmounts
  // no momento do fechamento — recalcular aqui de novo poderia divergir (ex:
  // um estorno de outra venda registrado depois, já contra outra sessão).
  // Só recalcula "ao vivo" pra sessão ainda ABERTA, pra alimentar a prévia
  // no modal de fechamento antes de confirmar.
  const expected = session.status === 'aberto' ? computeExpectedAmounts(session, targetDb) : session.expectedAmounts;
  res.json({ session, movements, expected });
});

/** Abrir só é permitido se não houver nenhuma sessão aberta no escopo certo
 * (a loja inteira no modo "único", só este terminal no modo "porTerminal",
 * só este usuário no modo "porOperador"). A checagem e a gravação
 * acontecem na mesma transação — sem isso, um duplo-clique em "Abrir
 * caixa" (ou duas pessoas em terminais/contas diferentes num modo
 * compartilhado) podia ler "nenhuma aberta" duas vezes antes de qualquer
 * uma gravar, e abrir duas sessões ao mesmo tempo. */
function openCashSession(input, targetDb) {
  return targetDb.transaction(() => {
    const mode = getCaixaMode(targetDb);
    if (mode === 'porTerminal' && !input.terminalId) {
      throw new Error('Terminal não identificado — recarregue a página e tente de novo.');
    }
    const existing = mode === 'porTerminal'
      ? targetDb.prepare(GET_OPEN_BY_TERMINAL_SQL).get(input.terminalId)
      : mode === 'porOperador'
        ? targetDb.prepare(GET_OPEN_BY_USER_SQL).get(input.userId)
        : targetDb.prepare(GET_OPEN_GLOBAL_SQL).get();
    if (existing) {
      throw new Error(mode === 'porTerminal'
        ? 'Já existe um caixa aberto neste terminal. Feche-o antes de abrir um novo.'
        : mode === 'porOperador'
          ? 'Você já tem um caixa aberto. Feche-o antes de abrir um novo.'
          : 'Já existe um caixa aberto. Feche-o antes de abrir um novo.');
    }
    const parsedOpening = Number(input.openingAmount);
    if (!Number.isFinite(parsedOpening) || parsedOpening < 0) {
      throw new Error('Informe um valor de abertura válido.');
    }
    const terminalId = mode === 'porTerminal' ? input.terminalId : null;
    const userId = mode === 'porOperador' ? input.userId : null;
    const session = {
      id: crypto.randomUUID(),
      status: 'aberto',
      mode,
      terminalId,
      terminalName: mode === 'porTerminal' ? (input.terminalName || null) : null,
      openedBy: { userId: input.userId, userName: input.userName },
      openedAt: Date.now(),
      openingAmount: parsedOpening,
      closedBy: null,
      closedAt: null,
      countedAmounts: null,
      expectedAmounts: null,
      difference: null,
      closingNotes: '',
    };
    targetDb.prepare(INSERT_SESSION_SQL).run({ id: session.id, openedAt: session.openedAt, terminalId, userId, data: JSON.stringify(session) });
    return session;
  })();
}

router.post('/open', (req, res) => {
  try {
    const session = openCashSession({ ...req.body, userId: req.userId, userName: req.userName, terminalId: req.terminalId }, req.db);
    broadcast('cash-changed', { reason: 'opened', id: session.id }, req.tenantId);
    res.status(201).json({ session });
  } catch (err) {
    // Achado de auditoria (P3): traduz o índice único parcial de
    // db/schema.sql (defesa em profundidade contra duas aberturas no mesmo
    // terminal) pra mensagem amigável — a checagem de openCashSession já
    // cobre o caso normal, isto só evita um "UNIQUE constraint failed" cru
    // se algum dia a colisão passar por ela mesmo assim.
    if (String(err.message).includes('idx_cashsessions_open_terminal_unique')) {
      return res.status(400).json({ error: 'Já existe um caixa aberto neste terminal. Feche-o antes de abrir um novo.' });
    }
    if (String(err.message).includes('idx_cashsessions_open_user_unique')) {
      return res.status(400).json({ error: 'Você já tem um caixa aberto. Feche-o antes de abrir um novo.' });
    }
    res.status(400).json({ error: err.message });
  }
});

/** Pedido do usuário: no modo "por operador", cada um mexe só no PRÓPRIO
 * caixa — sangria/suprimento/retificação/fechamento. Admin sempre pode
 * (mesmo raciocínio já usado em toda a tela de Usuários: admin cobre
 * qualquer situação, ex: vendedor esqueceu de fechar e já foi embora).
 * Nos outros dois modos (único/porTerminal) não muda nada — sempre foi
 * "qualquer um mexe", e continua sendo. */
function assertCanOperateSession(req, session) {
  if (session.mode !== 'porOperador') return;
  if (req.userRole === 'admin') return;
  if (session.openedBy.userId === req.userId) return;
  throw Object.assign(new Error('Este caixa é de outro operador — só quem abriu (ou um administrador) pode mexer nele.'), { status: 403 });
}

function commitMovement(input, targetDb) {
  return targetDb.transaction(() => {
    // Achado de auditoria (P2): dedupeKey agora é obrigatória — ver
    // routes/deliveries.js#commitDelivery pro raciocínio completo.
    claimIdempotencyKey(input.dedupeKey, targetDb);
    const row = targetDb.prepare(GET_SESSION_BY_ID_SQL).get(input.sessionId);
    if (!row) throw new Error('Caixa não encontrado.');
    const session = rowToSession(row);
    assertCanOperateSession(input, session);
    if (session.status !== 'aberto') throw new Error('Este caixa não está mais aberto.');
    if (input.type !== 'sangria' && input.type !== 'suprimento') throw new Error('Tipo de movimento inválido.');
    if (!input.reason || !input.reason.trim()) throw new Error('Informe o motivo do movimento de caixa.');
    const value = Number(input.amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error('Informe um valor maior que zero.');

    const movement = {
      id: crypto.randomUUID(), sessionId: session.id, type: input.type, amount: value,
      reason: input.reason.trim(), userId: input.userId, userName: input.userName, timestamp: Date.now(),
    };
    targetDb.prepare(INSERT_MOVEMENT_SQL).run({ id: movement.id, sessionId: session.id, timestamp: movement.timestamp, data: JSON.stringify(movement) });
    return movement;
  })();
}

router.post('/sessions/:id/movimento', (req, res) => {
  try {
    const movement = commitMovement({ ...req.body, sessionId: req.params.id, userId: req.userId, userName: req.userName, userRole: req.userRole }, req.db);
    broadcast('cash-changed', { reason: 'movement', id: movement.sessionId }, req.tenantId);
    res.status(201).json({ movement });
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: err.message });
    if (String(err.message).includes('UNIQUE constraint failed: idempotency_keys')) {
      return res.status(409).json({ error: 'Este movimento já foi registrado — evite reenviar.' });
    }
    res.status(400).json({ error: err.message });
  }
});

/** Retificação de um erro em lançamento já feito no caixa aberto — troco
 * inicial, uma sangria ou um suprimento específico. NUNCA edita ou apaga o
 * lançamento original — grava um movimento tipo 'ajuste' por cima, com a
 * DIFERENÇA entre o valor efetivo atual e o valor corrigido. Mesma lógica
 * de cashRepo.js#recordCashAdjustment da extensão, incluindo a
 * reconferência de concorrência: `originalAmount` vem do NAVEGADOR
 * (calculado com a lista de movimentos que a tela tinha em memória quando
 * o modal abriu) — se outra retificação for lançada nesse meio-tempo
 * sobre o MESMO lançamento, o valor efetivo lido de novo AQUI DENTRO da
 * transação (dado mais fresco possível) não vai mais bater com o que o
 * navegador achava, e a retificação é rejeitada em vez de aplicada sobre
 * base desatualizada. */
function commitAdjustment(input, targetDb) {
  return targetDb.transaction(() => {
    // Achado de auditoria (P2): dedupeKey agora é obrigatória — ver
    // routes/deliveries.js#commitDelivery pro raciocínio completo.
    claimIdempotencyKey(input.dedupeKey, targetDb);
    if (!['abertura', 'sangria', 'suprimento'].includes(input.targetType)) {
      throw new Error('Tipo de retificação inválido.');
    }
    if (input.targetType !== 'abertura' && !input.targetMovementId) {
      throw new Error('Selecione qual lançamento está sendo corrigido.');
    }
    if (!input.reason || !input.reason.trim()) throw new Error('Informe o motivo da retificação.');
    const original = Number(input.originalAmount);
    const corrected = Number(input.correctedAmount);
    if (!Number.isFinite(original) || !Number.isFinite(corrected) || corrected < 0) {
      throw new Error('Informe um valor corrigido válido.');
    }
    if (corrected === original) throw new Error('O valor corrigido é igual ao valor atual — nada a retificar.');

    const row = targetDb.prepare(GET_SESSION_BY_ID_SQL).get(input.sessionId);
    if (!row) throw new Error('Caixa não encontrado.');
    const session = rowToSession(row);
    assertCanOperateSession(input, session);
    if (session.status !== 'aberto') throw new Error('Este caixa não está mais aberto.');

    const currentMovements = targetDb.prepare(LIST_MOVEMENTS_SQL).all(session.id).map((r) => JSON.parse(r.data));
    const currentEffective = input.targetType === 'abertura'
      ? effectiveAmount('abertura', session.openingAmount, currentMovements)
      : (() => {
          const base = currentMovements.find((m) => m.id === input.targetMovementId && (m.type === 'sangria' || m.type === 'suprimento'));
          if (!base) return null;
          return effectiveAmount(input.targetType, base.amount, currentMovements, input.targetMovementId);
        })();
    if (currentEffective === null) {
      throw new Error('O lançamento que você está corrigindo não foi encontrado — pode já ter sido retificado por outra pessoa. Atualize a tela e tente de novo.');
    }
    if (Math.abs(currentEffective - original) > 0.005) {
      throw new Error('O valor mudou desde que essa correção foi aberta (outra retificação pode ter sido lançada nesse meio-tempo). Atualize a tela e tente de novo.');
    }

    const dinheiroDelta = input.targetType === 'sangria' ? -(corrected - original) : (corrected - original);
    const movement = {
      id: crypto.randomUUID(), sessionId: session.id, type: 'ajuste', amount: dinheiroDelta,
      targetType: input.targetType, targetMovementId: input.targetType === 'abertura' ? null : input.targetMovementId,
      originalAmount: original, correctedAmount: corrected, reason: input.reason.trim(),
      userId: input.userId, userName: input.userName, timestamp: Date.now(),
    };
    targetDb.prepare(INSERT_MOVEMENT_SQL).run({ id: movement.id, sessionId: session.id, timestamp: movement.timestamp, data: JSON.stringify(movement) });
    return movement;
  })();
}

router.post('/sessions/:id/retificar', (req, res) => {
  try {
    const movement = commitAdjustment({ ...req.body, sessionId: req.params.id, userId: req.userId, userName: req.userName, userRole: req.userRole }, req.db);
    broadcast('cash-changed', { reason: 'adjustment', id: movement.sessionId }, req.tenantId);
    res.status(201).json({ movement });
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: err.message });
    if (String(err.message).includes('UNIQUE constraint failed: idempotency_keys')) {
      return res.status(409).json({ error: 'Esta retificação já foi registrada — evite reenviar.' });
    }
    res.status(400).json({ error: err.message });
  }
});

/** Quanto DEVERIA ter em caixa por forma de pagamento, a partir da abertura +
 * vendas da sessão + sangria/suprimento - estornos em espécie feitos durante
 * a sessão (de qualquer venda, não só das de hoje — ver nota no estorno em
 * routes/sales.js) + pagamentos de dívida de fiado recebidos durante a
 * sessão (de qualquer cliente, não só de vendas de hoje — quitar uma dívida
 * antiga põe dinheiro na gaveta de HOJE do mesmo jeito). Mesma lógica de
 * cashRepo.js#computeExpectedAmounts da extensão. */
function computeExpectedAmounts(session, targetDb = db) {
  const allSales = targetDb.prepare(LIST_ALL_SALES_SQL).all().map((r) => JSON.parse(r.data));
  const sessionSales = allSales.filter((s) => s.cashSessionId === session.id);
  const movements = targetDb.prepare(LIST_MOVEMENTS_SQL).all(session.id).map((r) => JSON.parse(r.data));
  const debtPayments = targetDb.prepare(LIST_ALL_DEBTS_SQL).all().map((r) => JSON.parse(r.data))
    .filter((e) => e.type === 'pagamento' && e.cashSessionId === session.id);

  const expected = { Dinheiro: session.openingAmount };
  const ensure = (method) => { if (!(method in expected)) expected[method] = 0; };

  for (const sale of sessionSales) {
    for (const payment of sale.payments) {
      if (payment.method === CREDIT_METHOD || payment.method === FIADO_METHOD) continue;
      ensure(payment.method);
      expected[payment.method] += payment.amount;
    }
  }

  for (const sale of allSales) {
    if (!sale.refunds || sale.refunds.length === 0) continue;
    const fiadoTotal = sale.payments.filter((p) => p.method === FIADO_METHOD).reduce((sum, p) => sum + p.amount, 0);
    const fiadoRatio = sale.total > 0 ? fiadoTotal / sale.total : 0;
    for (const refund of sale.refunds) {
      if (refund.cashSessionId !== session.id) continue;
      if (refund.creditGenerated) continue;
      expected.Dinheiro -= refund.totalRefunded * (1 - fiadoRatio);
    }
  }

  for (const payment of debtPayments) {
    ensure(payment.paymentMethod);
    expected[payment.paymentMethod] += payment.amount;
  }

  for (const m of movements) {
    if (m.type === 'suprimento') expected.Dinheiro += m.amount;
    if (m.type === 'sangria') expected.Dinheiro -= m.amount;
    // 'ajuste' (retificação, ver POST /sessions/:id/retificar abaixo) já
    // guarda a DIFERENÇA pronta em `amount`, sinal incluído — soma direto,
    // sem repetir a lógica de sinal de sangria/suprimento aqui. Mesma
    // lógica de cashRepo.js#computeExpectedAmounts da extensão.
    if (m.type === 'ajuste') expected.Dinheiro += m.amount;
  }

  return expected;
}

/** Valor "efetivo" atual do troco inicial ou de uma sangria/suprimento
 * específico, depois de aplicar toda retificação ('ajuste') já lançada em
 * cima dele — mesma função pura de cashRepo.js#effectiveAmount da
 * extensão (também copiada pro cliente, ver public/js/data/cashRepo.js,
 * pra alimentar a prévia da tela sem round-trip). Usada aqui só pra
 * RECONFERIR, dentro da transação de retificação, que o valor que o
 * navegador achava que era "o atual" ainda bate com o que realmente é. */
function effectiveAmount(targetType, baseAmount, movements, targetMovementId = null) {
  const totalDelta = movements
    .filter((m) => m.type === 'ajuste' && m.targetType === targetType
      && (targetType === 'abertura' || m.targetMovementId === targetMovementId))
    .reduce((sum, m) => sum + m.amount, 0);
  return targetType === 'sangria' ? baseAmount - totalDelta : baseAmount + totalDelta;
}

router.post('/sessions/:id/fechar', async (req, res) => {
  try {
    const targetDb = req.db;
    // Achado de auditoria (P1, Red Team): a tela (views/caixa.js) já pede
    // "usuário e senha de qualquer conta ativa" antes de fechar — mas essa
    // senha nunca era enviada nem conferida por esta rota, só ficava presa
    // na UI. Reproduzido chamando esta rota direto (curl), sem nenhum
    // campo de senha: o caixa fechava normalmente. Diferente da aprovação
    // de desconto (routes/sales.js, que exige especificamente um ADMIN),
    // aqui vale QUALQUER conta ativa — mesma regra que a tela já descrevia
    // pro usuário, agora reforçada de verdade no servidor. namespace
    // 'confirmPassword' (mesmo de sales.js) pra não confundir com o
    // bloqueio por força bruta do login real (ver lib/loginLockout.js).
    const confirmUsername = req.body.confirmUsername;
    const confirmPassword = req.body.confirmPassword;
    if (!confirmUsername || !confirmPassword) {
      return res.status(400).json({ error: 'Informe usuário e senha pra confirmar o fechamento.' });
    }
    const confirmedUser = await verifyLogin(confirmUsername, confirmPassword, { namespace: 'confirmPassword' }, targetDb);
    if (!confirmedUser) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }

    const row = targetDb.prepare(GET_SESSION_BY_ID_SQL).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Caixa não encontrado.' });
    const session = rowToSession(row);
    assertCanOperateSession(req, session);
    if (session.status !== 'aberto') return res.status(400).json({ error: 'Este caixa não está mais aberto.' });

    // computeExpectedAmounts lê outras tabelas — fica fora da transação de
    // gravação (que precisa ser síncrona e rápida). A proteção contra
    // fechar a mesma sessão duas vezes concorrentemente é a re-checagem de
    // `status` dentro da transação abaixo, com o registro mais atual.
    const expectedAmounts = computeExpectedAmounts(session, targetDb);
    const counted = {};
    for (const [method, value] of Object.entries(req.body.countedAmounts || {})) {
      const parsed = Number(value);
      counted[method] = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }
    const difference = (counted.Dinheiro ?? 0) - (expectedAmounts.Dinheiro ?? 0);

    const closeCashSession = targetDb.transaction(() => {
      const current = rowToSession(targetDb.prepare(GET_SESSION_BY_ID_SQL).get(session.id));
      if (current.status !== 'aberto') throw new Error('Este caixa não está mais aberto.');
      const closed = {
        ...current,
        status: 'fechado',
        closedBy: { userId: req.userId, userName: req.userName },
        closedAt: Date.now(),
        expectedAmounts,
        countedAmounts: counted,
        difference,
        closingNotes: (req.body.closingNotes || '').trim(),
      };
      targetDb.prepare(UPDATE_SESSION_SQL).run({ id: closed.id, status: 'fechado', data: JSON.stringify(closed) });
      return closed;
    });
    const closed = closeCashSession();
    broadcast('cash-changed', { reason: 'closed', id: closed.id }, req.tenantId);
    res.json({ session: closed });
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});

/** Backup de segurança automático gerado ao fechar caixa (ver
 * views/caixa.js#openCloseModal, chamado logo depois de um fechamento bem-
 * sucedido, com a MESMA senha que acabou de confirmar o fechamento) — mesmo
 * núcleo de POST /api/backup/export (buildBackupPayload + encryptPayload),
 * mas DE PROPÓSITO fora daquele router (que exige a permissão 'backup' no
 * mount, ver server.js): montado só sob /api/cash, que como o resto deste
 * router só exige estar logado (mesmo `roles: ['admin', 'vendedor']`, sem
 * permissão própria, que a extensão já usa pra rota Caixa — ver app.js
 * dela). Mesmo raciocínio da extensão (data/backupRepo.js#
 * buildAutomaticCashCloseBackup): exigir 'backup' aqui não impediria nada —
 * qualquer vendedor já pode gerar o mesmo backup completo fechando um caixa
 * de verdade pela rota normal (POST /sessions/:id/fechar, sem gate de
 * permissão nenhum) — só quebraria essa rede de segurança de fim de turno
 * pra toda loja que não marcou 'backup' pro vendedor que fecha a caixa
 * todo dia, que é a maioria. */
router.post('/backup-fechamento', async (req, res) => {
  try {
    const password = req.body.password;
    // Achado de auditoria (P2): diferente de POST /api/backup/export (senha
    // ESCOLHIDA na hora, mínimo 8 igual à tela — ver lib/backupCrypto.js),
    // a senha aqui é sempre a mesma que acabou de confirmar o fechamento de
    // caixa (a senha de LOGIN de quem fechou — ver views/caixa.js), então o
    // piso real é o mesmo já aplicado a toda senha de usuário
    // (MIN_USER_PASSWORD_LENGTH). Exigir 8 aqui rejeitaria, sem motivo,
    // contas com senha de 6-7 caracteres que já passaram no cadastro.
    if (!password || password.length < MIN_USER_PASSWORD_LENGTH) throw new Error(`Informe uma senha com pelo menos ${MIN_USER_PASSWORD_LENGTH} caracteres pra proteger o backup.`);
    const payload = buildBackupPayload(req.db);
    const envelope = await encryptPayload(payload, password);
    updateConfig({ lastBackupAt: Date.now() }, req.db);
    res.json({ envelope });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
