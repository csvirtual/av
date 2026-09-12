// Caixa — versão multi-terminal. `getOpenSession` (Fase 9, passo 1) é o
// que views/sale.js lê (pra saber se existe caixa aberto, quando a
// política "exigir caixa aberto pra vender" estiver ligada). O resto
// (Fase 9, ao ligar views/caixa.js) é o que essa tela precisa: abrir,
// sangria/suprimento, retificação, fechamento e histórico.
import { api } from './apiClient.js';

/** Devolve a sessão de caixa aberta NESTE terminal (ou `null`) — mesmo
 * contrato de app/js/data/cashRepo.js#getOpenSession() da extensão
 * (single-machine sempre tinha um caixa só pra loja toda; aqui pode ser
 * "só deste terminal" dependendo do modo configurado, ver routes/cash.js
 * — a rota já resolve isso pelo cabeçalho X-Terminal-Id, ver
 * apiClient.js). */
export async function getOpenSession() {
  const { session } = await api('/api/cash/open');
  return session;
}

/** Histórico de caixas (abertos e fechados), mais recente primeiro —
 * mesmo contrato de listSessions() da extensão. */
export async function listSessions() {
  const { items } = await api('/api/cash/sessions');
  return items;
}

/** userId/userName aceitos só pra bater a assinatura da extensão — o
 * servidor sempre resolve quem abriu pela sessão de verdade (mesmo motivo
 * de auditRepo.js#logAction e stockRepo.js#recordMovement), nunca pelo
 * que o cliente afirma. */
export async function openSession({ userId, userName, openingAmount }) {
  void userId; void userName;
  const { session } = await api('/api/cash/open', {
    method: 'POST',
    body: JSON.stringify({ openingAmount }),
  });
  return session;
}

/** Movimentos (sangria/suprimento/ajuste) da sessão, mais recente primeiro
 * — mesmo contrato de listSessionMovements() da extensão. GET
 * /sessions/:id devolve movimentos E o esperado juntos (ver
 * computeExpectedAmounts abaixo) — duas chamadas em paralelo pro mesmo
 * endpoint (a view sempre pede os dois via Promise.all) é redundante, mas
 * simples e barato o bastante pra não valer a complexidade de cachear. */
export async function listSessionMovements(sessionId) {
  const { movements } = await api(`/api/cash/sessions/${encodeURIComponent(sessionId)}`);
  return movements;
}

/** Quanto DEVERIA ter em caixa por forma de pagamento agora — mesmo
 * contrato de computeExpectedAmounts() da extensão, mas calculado no
 * servidor (routes/cash.js), não localmente: a versão multi-terminal
 * precisa ver vendas/estornos/pagamentos de fiado feitos em QUALQUER
 * terminal, não só o de memória local. */
export async function computeExpectedAmounts(session) {
  const { expected } = await api(`/api/cash/sessions/${encodeURIComponent(session.id)}`);
  return expected;
}

export async function recordCashMovement({ sessionId, type, amount, reason, userId, userName, dedupeKey }) {
  void userId; void userName;
  const { movement } = await api(`/api/cash/sessions/${encodeURIComponent(sessionId)}/movimento`, {
    method: 'POST',
    body: JSON.stringify({ type, amount, reason, dedupeKey }),
  });
  return movement;
}

/** Mesma função PURA de cashRepo.js#effectiveAmount da extensão — não bate
 * na rede, só soma em cima da lista de movimentos que a tela já tem em
 * memória, pra alimentar a prévia do modal de retificação sem round-trip.
 * O servidor tem sua própria cópia idêntica (ver routes/cash.js) pra
 * reconferir isso de novo, com dado fresco, dentro da transação de
 * retificação — nunca confia só no que o navegador calculou aqui. */
export function effectiveAmount(targetType, baseAmount, movements, targetMovementId = null) {
  const totalDelta = movements
    .filter((m) => m.type === 'ajuste' && m.targetType === targetType
      && (targetType === 'abertura' || m.targetMovementId === targetMovementId))
    .reduce((sum, m) => sum + m.amount, 0);
  return targetType === 'sangria' ? baseAmount - totalDelta : baseAmount + totalDelta;
}

export async function recordCashAdjustment({
  sessionId, targetType, targetMovementId = null, originalAmount, correctedAmount, reason, userId, userName, dedupeKey,
}) {
  void userId; void userName;
  const { movement } = await api(`/api/cash/sessions/${encodeURIComponent(sessionId)}/retificar`, {
    method: 'POST',
    body: JSON.stringify({ targetType, targetMovementId, originalAmount, correctedAmount, reason, dedupeKey }),
  });
  return movement;
}

// Achado de auditoria (P1, Red Team): `confirmUsername`/`confirmPassword`
// agora viajam até o SERVIDOR (ver routes/cash.js#POST /sessions/:id/fechar)
// — antes, a tela já pedia essa senha (confirmUserPassword em
// views/caixa.js) mas nunca mandava pra rota conferir de novo, então
// chamar a API direto (fora da tela) fechava o caixa sem senha nenhuma.
export async function closeSession({ sessionId, userId, userName, countedAmounts, closingNotes = '', confirmUsername, confirmPassword }) {
  void userId; void userName;
  const { session } = await api(`/api/cash/sessions/${encodeURIComponent(sessionId)}/fechar`, {
    method: 'POST',
    body: JSON.stringify({ countedAmounts, closingNotes, confirmUsername, confirmPassword }),
  });
  return session;
}
