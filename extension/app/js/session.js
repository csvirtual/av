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
