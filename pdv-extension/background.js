// Service worker da extensão: abre a página do app numa aba normal do
// navegador quando o ícone é clicado. Toda a lógica de negócio (estoque,
// vendas, usuários, log) vive dentro da página do app (app/index.html),
// que usa IndexedDB para persistir tudo localmente no navegador.
const APP_URL = chrome.runtime.getURL('app/index.html');

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: APP_URL });
});

// Primeira instalação: já abre o app direto, pra ir para o cadastro da
// empresa sem precisar caçar o ícone.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: APP_URL });
  }
});
