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
