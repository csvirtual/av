// Service worker da extensão: só cuida de abrir/focar a aba do app quando o
// ícone é clicado. Toda a lógica de negócio (estoque, vendas, usuários, log)
// vive dentro da página do app (app/index.html), que roda como uma aba comum
// e usa IndexedDB para persistir tudo localmente no navegador.
const APP_URL = chrome.runtime.getURL('app/index.html');

async function openOrFocusAppTab() {
  const tabs = await chrome.tabs.query({ url: APP_URL });
  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: APP_URL });
}

chrome.action.onClicked.addListener(() => {
  openOrFocusAppTab();
});

// Primeira instalação: já abre o app direto, pra ir para o cadastro da
// empresa sem precisar caçar o ícone.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    openOrFocusAppTab();
  }
});
