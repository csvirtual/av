// Resolve "qual é o caixa aberto agora, pra este pedido" — usado tanto por
// routes/cash.js (pra abrir/fechar) quanto por routes/sales.js/customers.js
// (pra gravar cashSessionId em cada venda/estorno/pagamento de fiado, igual
// ao cashRepo.js#getOpenSession da extensão). A diferença pro modo
// single-machine é o "pra este pedido": no modo "único" é sempre a mesma
// sessão pra loja inteira; no modo "porTerminal" cada terminal tem a sua
// própria (precisa saber QUAL terminal está perguntando, ver X-Terminal-Id
// em server.js); no modo "porOperador" cada USUÁRIO autenticado tem a sua
// própria — pedido do usuário: quer poder deixar cada vendedor abrir e
// fechar o próprio caixa, com o estoque continuando compartilhado pela loja
// inteira (isso nunca muda — é sempre o mesmo banco, só a SESSÃO de caixa
// fica pessoal). Diferente de terminal_id (header não-autenticado, qualquer
// um pode alegar ser qualquer terminal), user_id vem sempre de req.userId —
// já resolvido pela sessão de login, nunca do que o cliente manda.
import { db } from '../db/index.js';
import { getConfig } from './companyConfig.js';

const GET_OPEN_GLOBAL_SQL = "SELECT * FROM cash_sessions WHERE status = 'aberto' LIMIT 1";
const GET_OPEN_BY_TERMINAL_SQL = "SELECT * FROM cash_sessions WHERE status = 'aberto' AND terminal_id = ? LIMIT 1";
const GET_OPEN_BY_USER_SQL = "SELECT * FROM cash_sessions WHERE status = 'aberto' AND user_id = ? LIMIT 1";

// `targetDb` opcional em todo este arquivo (etapa 5 do roteiro multi-tenant,
// ver artifact "PDV Multi-Tenant") — normalmente req.db, resolvido pelo
// tenant da requisição. Sem ele (todo call site de hoje), lê o banco fixo
// do processo, comportamento idêntico a sempre.
export function getCaixaMode(targetDb = db) {
  const mode = getConfig(targetDb).caixaMode;
  return mode === 'porTerminal' || mode === 'porOperador' ? mode : 'unico';
}

export function resolveOpenSession(terminalId, userId, targetDb = db) {
  const mode = getCaixaMode(targetDb);
  const row = mode === 'porTerminal'
    ? (terminalId ? targetDb.prepare(GET_OPEN_BY_TERMINAL_SQL).get(terminalId) : undefined)
    : mode === 'porOperador'
      ? (userId ? targetDb.prepare(GET_OPEN_BY_USER_SQL).get(userId) : undefined)
      : targetDb.prepare(GET_OPEN_GLOBAL_SQL).get();
  return row ? JSON.parse(row.data) : null;
}
