// A extensão roda como uma aba de verdade (dashboard.html), não como popup
// nem side panel — dá o espaço de tela que um "sistema" de gerar sistemas
// precisa (canvas, paleta, inspetor, tudo junto). Clicar no ícone reaproveita
// a aba do dashboard se ela já estiver aberta, em vez de abrir uma nova toda
// vez.

const DASHBOARD_PATH = 'dashboard/index.html';

async function openDashboard() {
  const url = chrome.runtime.getURL(DASHBOARD_PATH);
  const existing = await chrome.tabs.query({ url });
  if (existing.length > 0) {
    const tab = existing[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(openDashboard);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') openDashboard();
});
