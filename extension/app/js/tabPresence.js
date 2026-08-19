// Detecta se o sistema já está aberto em OUTRA aba deste navegador — pra
// mostrar um aviso, não pra travar nada. Rodar em duas abas ao mesmo tempo
// não corrompe dado nenhum (o resto do app já é protegido contra escrita
// concorrente, ver db.js/dbUpdate), mas pode confundir quem esquece uma
// aba antiga aberta e começa a mexer em outra sem perceber.
//
// Sem permissão de `tabs` (o app não pede essa permissão, de propósito —
// ver README, "pedir o mínimo possível"), não dá pra perguntar ao Chrome
// quantas abas existem. Em vez disso, cada aba registra um "batimento"
// periódico em chrome.storage.session (compartilhado entre todas as abas)
// com um id só dela; uma aba fechada simplesmente para de bater, e some da
// lista sozinha depois de alguns segundos sem batimento — não depende de
// nenhum evento de fechamento (beforeunload não é confiável pra escrita
// assíncrona).
const KEY = 'tabPresence';
const HEARTBEAT_MS = 4000;
const STALE_MS = 9000; // ~2 batimentos perdidos = considera a aba fechada
const myTabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function readPresence() {
  const data = await chrome.storage.session.get(KEY);
  return data[KEY] || {};
}

/** Registra esta aba e devolve se JÁ havia outra aba viva no momento do
 * registro (antes desta própria entrada ser somada) — chamar uma vez, no
 * carregamento da página. Também liga o batimento periódico, que roda
 * pra sempre (a aba fechando para o batimento sozinha, sem precisar de
 * limpeza explícita). */
export async function registerTabAndCheckDuplicate() {
  const now = Date.now();
  const map = await readPresence();
  const otherTabAlreadyOpen = Object.entries(map).some(([id, ts]) => id !== myTabId && now - ts < STALE_MS);

  map[myTabId] = now;
  await chrome.storage.session.set({ [KEY]: map });

  setInterval(async () => {
    const current = await readPresence();
    const fresh = Date.now();
    for (const [id, ts] of Object.entries(current)) {
      if (fresh - ts > STALE_MS) delete current[id]; // limpa abas mortas — qualquer aba viva pode fazer essa faxina
    }
    current[myTabId] = fresh;
    await chrome.storage.session.set({ [KEY]: current });
  }, HEARTBEAT_MS);

  return otherTabAlreadyOpen;
}
