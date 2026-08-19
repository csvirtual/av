// Sessão do usuário logado. Usa chrome.storage.session (efêmero, some ao
// fechar o navegador — nunca sobrevive num disco) em vez de localStorage,
// então cada dia de trabalho começa com a tela de login de novo, o que é o
// comportamento certo pra um sistema de controle de loja compartilhado por
// vários vendedores na mesma máquina.
const KEY = 'session.userId';

export async function getSessionUserId() {
  const data = await chrome.storage.session.get(KEY);
  return data[KEY] || null;
}

export async function setSessionUserId(userId) {
  await chrome.storage.session.set({ [KEY]: userId });
}

/** Chama `callback()` toda vez que o usuário logado mudar — em QUALQUER
 * aba da extensão. chrome.storage.session é um único armazenamento
 * compartilhado por todas as abas, não um por aba: se a loja usa duas abas
 * (ou dois vendedores revezando o mesmo computador com abas antigas
 * esquecidas abertas), logar/deslogar numa aba não avisava a outra — ela
 * continuava com o usuário antigo "preso" na memória do JS até alguém
 * navegar ou recarregar. Usado por app.js pra re-renderizar a aba inteira
 * quando isso acontece, inclusive na própria aba que fez a mudança (chamar
 * boot() de novo é seguro/idempotente, o pior efeito é um re-render extra
 * que já ia acontecer de propósito mesmo). Devolve uma função pra remover
 * o listener, se algum dia precisar. */
export function onSessionUserIdChanged(callback) {
  const listener = (changes, areaName) => {
    if (areaName === 'session' && KEY in changes) callback();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// Desloga: some com o usuário logado E qualquer crédito de troca pendente
// que não foi usado. O crédito é descrito como "válido nesse mesmo turno"
// (ver comentário abaixo) — sem limpar os dois juntos, um crédito gerado
// por um vendedor (do estorno da venda de UM cliente) continuaria
// disponível pro PRÓXIMO vendedor que logasse nessa mesma aba/sessão do
// Chrome, e ele poderia aplicá-lo na venda de um cliente completamente
// diferente sem perceber a origem — o logout precisa ser o limite real do
// turno, não só o userId.
export async function clearSession() {
  await chrome.storage.session.remove([KEY, CREDIT_KEY]);
}

// ---------- Crédito de troca pendente ----------
// Gerado ao estornar uma venda marcando "gerar crédito de troca". Fica
// disponível pra ser usado como forma de pagamento na próxima venda desse
// mesmo turno (efêmero como o resto da sessão — não sobrevive a reiniciar o
// navegador nem a um logout, então não vira uma dívida esquecida no
// sistema nem "vaza" pro próximo turno).
const CREDIT_KEY = 'session.pendingCredit';

export async function getPendingCredit() {
  const data = await chrome.storage.session.get(CREDIT_KEY);
  return data[CREDIT_KEY] || null; // { amount, sourceSaleId, sourceRefundId, reason }
}

export async function setPendingCredit(credit) {
  await chrome.storage.session.set({ [CREDIT_KEY]: credit });
}

export async function clearPendingCredit() {
  await chrome.storage.session.remove(CREDIT_KEY);
}

/** Soma um crédito novo (de um estorno, de um resgate de pontos etc.) ao
 * que já estiver pendente, em vez de sobrescrever — sem isso, gerar um
 * segundo crédito de troca antes do primeiro ser usado apagaria o
 * primeiro sem aviso nenhum. Quem só precisa AJUSTAR o crédito já
 * existente (uso parcial, devolver ao remover um pagamento) continua
 * usando setPendingCredit diretamente. */
export async function addPendingCredit({ amount, sourceSaleId = null, sourceRefundId = null, reason }) {
  const existing = await getPendingCredit();
  const credit = existing && existing.amount > 0
    ? {
      amount: existing.amount + amount,
      sourceSaleId: sourceSaleId ?? existing.sourceSaleId,
      sourceRefundId: sourceRefundId ?? existing.sourceRefundId,
      reason: `${existing.reason} + ${reason}`,
    }
    : { amount, sourceSaleId, sourceRefundId, reason };
  await setPendingCredit(credit);
  return credit;
}

// ---------- Expiração por inatividade ----------
// Encerra a sessão sozinha depois de 30 minutos sem nenhuma interação —
// proteção pra quem sai do balcão/computador e esquece o sistema logado.
// Guardado em chrome.storage.session (mesmo motivo do resto deste arquivo:
// efêmero, some ao fechar o navegador) e, por ser compartilhado entre
// todas as abas, funciona certo com mais de uma aba aberta: mexer numa aba
// já conta como atividade pras outras também — só expira de verdade quando
// NENHUMA aba teve interação nos últimos 30 minutos, não quando uma aba
// específica ficou parada. Quem dispara os eventos de mouse/teclado e roda
// a checagem periódica é app.js — este módulo só guarda e lê o timestamp.
const ACTIVITY_KEY = 'session.lastActivityAt';
export const IDLE_LIMIT_MS = 30 * 60 * 1000;

export async function touchActivity() {
  await chrome.storage.session.set({ [ACTIVITY_KEY]: Date.now() });
}

/** Quanto tempo (ms) faz desde a última atividade registrada em QUALQUER
 * aba. Sem nenhum registro ainda (login muito recente, antes da primeira
 * chamada a touchActivity) devolve 0 — trata como "acabou de ficar ativo",
 * nunca como já ocioso. */
export async function getIdleMs() {
  const data = await chrome.storage.session.get(ACTIVITY_KEY);
  const last = data[ACTIVITY_KEY];
  return last ? Date.now() - last : 0;
}
