// Service worker da extensão: só cuida de abrir/focar a aba do app quando o
// ícone é clicado. Toda a lógica de negócio (estoque, vendas, usuários, log)
// vive dentro da página do app (app/index.html), que roda como uma aba comum
// e usa IndexedDB para persistir tudo localmente no navegador.
const APP_URL = chrome.runtime.getURL('app/index.html');

// Achado de auditoria: nenhuma das chamadas abaixo tinha tratamento de erro
// — se chrome.tabs.query/update/windows.update falhasse por qualquer
// motivo (referência a uma aba/janela que já não existe mais de verdade,
// um estado interno esquisito do Chrome), a Promise rejeitava sem
// ninguém escutar, e do ponto de vista de quem clicou no ícone: "não
// aconteceu nada", sem nenhuma pista do porquê nem uma segunda chance.
// Agora, qualquer falha ao focar uma aba já existente cai pra criar uma
// aba nova — sempre tenta terminar com uma aba do app aberta e em foco,
// em vez de desistir silenciosamente na primeira falha.
async function openOrFocusAppTab() {
  try {
    const tabs = await chrome.tabs.query({ url: APP_URL });
    if (tabs.length > 0) {
      const tab = tabs[0];
      try {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return;
      } catch (err) {
        // A aba encontrada pela query não é mais válida de verdade (ex:
        // fechada bem entre o query e o update, ou uma referência presa
        // por algum estado interno do Chrome) — não desiste, cai pro
        // caminho de criar uma aba nova abaixo.
        console.warn('[background] Não deu pra focar a aba existente, abrindo uma nova:', err);
      }
    }
    await chrome.tabs.create({ url: APP_URL });
  } catch (err) {
    // Última linha de defesa: se até criar uma aba nova falhar (bem raro),
    // ao menos fica registrado no console do service worker
    // (chrome://extensions → "Inspecionar views" → service worker) em vez
    // de desaparecer como uma rejeição não tratada sem rastro nenhum.
    console.error('[background] Não foi possível abrir nem focar a aba do app:', err);
  }
}

// Trava simples contra clique duplo/repetido rápido no ícone: sem isso,
// dois cliques quase juntos podiam os dois passar pela checagem "já existe
// uma aba?" antes de qualquer um terminar de criar a sua, abrindo duas
// abas do app de uma vez só por um clique picado.
let opening = false;
async function handleIconClick() {
  if (opening) return;
  opening = true;
  try {
    await openOrFocusAppTab();
  } finally {
    opening = false;
  }
}

chrome.action.onClicked.addListener(() => {
  handleIconClick();
});

// Primeira instalação: já abre o app direto, pra ir para o cadastro da
// empresa sem precisar caçar o ícone.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    handleIconClick();
  }
});
