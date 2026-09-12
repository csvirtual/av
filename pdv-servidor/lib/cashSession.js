// Resolve "qual é o caixa aberto agora, pra este pedido" — usado tanto por
// routes/cash.js (pra abrir/fechar) quanto por routes/sales.js (pra gravar
// cashSessionId em cada venda/estorno, igual ao cashRepo.js#getOpenSession
// da extensão). A diferença pro modo single-machine é o "pra este pedido":
// no modo "único" é sempre a mesma sessão pra loja inteira; no modo
// "porTerminal" cada terminal tem a sua própria, então precisa saber QUAL
// terminal está perguntando (ver X-Terminal-Id em server.js).
import { db } from '../db/index.js';
import { getConfig } from './companyConfig.js';

const getOpenGlobalStmt = db.prepare("SELECT * FROM cash_sessions WHERE status = 'aberto' LIMIT 1");
const getOpenByTerminalStmt = db.prepare("SELECT * FROM cash_sessions WHERE status = 'aberto' AND terminal_id = ? LIMIT 1");

export function getCaixaMode() {
  return getConfig().caixaMode === 'porTerminal' ? 'porTerminal' : 'unico';
}

export function resolveOpenSession(terminalId) {
  const mode = getCaixaMode();
  const row = mode === 'porTerminal'
    ? (terminalId ? getOpenByTerminalStmt.get(terminalId) : undefined)
    : getOpenGlobalStmt.get();
  return row ? JSON.parse(row.data) : null;
}
