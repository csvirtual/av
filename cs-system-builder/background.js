// Service worker mínimo: só garante que clicar no ícone da extensão abre o
// side panel (comportamento que não é o padrão do Chrome — precisa ser
// habilitado explicitamente por código, não só pelo manifest).
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
