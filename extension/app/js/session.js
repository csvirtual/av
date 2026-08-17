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

export async function clearSession() {
  await chrome.storage.session.remove(KEY);
}

// ---------- Crédito de troca pendente ----------
// Gerado ao estornar uma venda marcando "gerar crédito de troca". Fica
// disponível pra ser usado como forma de pagamento na próxima venda desse
// mesmo turno (efêmero como o resto da sessão — não sobrevive a reiniciar o
// navegador, então não vira uma dívida esquecida no sistema).
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
