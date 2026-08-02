// Ao clicar no ícone, abrimos (ou focamos) uma ABA normal do Chrome com o Copiloto,
// em vez de janela flutuante ou side panel. Ela não encolhe nem afeta nenhuma outra aba.
importScripts('perfis.js');

const PANEL_TAB_KEY = 'panelTabInfo'; // { id, windowId } — guardado em chrome.storage.session
const OPTIONS_TAB_KEY = 'optionsTabInfo'; // mesma ideia, só que pra options.html (ver copilotoRegistrarOuChecarAba)

// O service worker do Manifest V3 é suspenso por inatividade (tipicamente em
// segundos) e reiniciado do zero na próxima vez que for acordado — o que
// zeraria qualquer variável em memória mesmo com a aba do painel continuando
// aberta. Por isso guardamos o id/janela da aba em chrome.storage.session
// (sobrevive ao reinício do service worker, só é limpo quando o navegador
// fecha de verdade — momento em que a aba também deixa de existir).
//
// Importante: esta extensão não declara a permissão "tabs" de propósito
// (permissão sensível, mostra aviso extra na instalação). Sem ela,
// chrome.tabs.query({url: ...}) não é uma opção viável: o campo "url" dos
// resultados vem sempre vazio e a filtragem por url não encontra nada,
// mesmo quando a aba existe (comportamento confirmado nesta versão do
// Chrome). Por isso a checagem de "a aba ainda existe?" é feita chamando
// chrome.tabs.update() direto no id guardado: se a aba não existir mais,
// a chamada falha (chrome.runtime.lastError) e caímos para abrir uma nova
// — sem nunca precisar ler a URL de nenhuma aba.
// Serializado pela mesma fila por chave usada em perfis.js
// (copilotoSerializarPorChave, disponível aqui via importScripts): sem
// isto, dois cliques rápidos no ícone da extensão (comum logo após a
// instalação, quando nada abre visivelmente na hora) podiam os dois ler
// "nenhuma aba guardada ainda" antes de qualquer um gravar, e cada um
// criava sua própria aba — abrindo o painel em duplicidade, com cada aba
// depois sobrescrevendo dados da outra em qualquer chave sem lock próprio.
async function openOrFocusPanel() {
  return copilotoSerializarPorChave(PANEL_TAB_KEY, async () => {
    const panelUrl = chrome.runtime.getURL('panel.html');
    const stored = await chrome.storage.session.get(PANEL_TAB_KEY);
    const info = stored[PANEL_TAB_KEY];

    if (info) {
      const focused = await new Promise((resolve) => {
        chrome.tabs.update(info.id, { active: true }, (tab) => {
          if (chrome.runtime.lastError || !tab) { resolve(false); return; }
          chrome.windows.update(info.windowId, { focused: true }, () => resolve(true));
        });
      });
      if (focused) return;
    }

    const created = await chrome.tabs.create({ url: panelUrl });
    await chrome.storage.session.set({ [PANEL_TAB_KEY]: { id: created.id, windowId: created.windowId } });
  });
}

chrome.action.onClicked.addListener(openOrFocusPanel);

chrome.tabs.onRemoved.addListener(async (id) => {
  const stored = await chrome.storage.session.get([PANEL_TAB_KEY, OPTIONS_TAB_KEY]);
  const chavesParaLimpar = [];
  if (stored[PANEL_TAB_KEY] && stored[PANEL_TAB_KEY].id === id) chavesParaLimpar.push(PANEL_TAB_KEY);
  if (stored[OPTIONS_TAB_KEY] && stored[OPTIONS_TAB_KEY].id === id) chavesParaLimpar.push(OPTIONS_TAB_KEY);
  if (chavesParaLimpar.length) await chrome.storage.session.remove(chavesParaLimpar);
});

// Trava de aba duplicada: panel.js e options.js chamam isto (via mensagem,
// logo ao carregar, antes de mostrar qualquer dado) pra perguntar "sou eu a
// aba oficial desta página?". Duas chaves SEPARADAS (uma por página) — de
// propósito, pra abrir Configurações não fazer o botão da extensão parar de
// achar a aba do painel principal (e vice-versa), já que são páginas
// diferentes que só por acaso podem estar na mesma aba (a navegação entre
// elas é sempre window.location.href, então o id da aba não muda). Cobre
// tanto o clique no ícone quanto qualquer outra forma de abrir uma cópia da
// página (duplicar aba, colar a URL, restaurar aba fechada): a resposta é
// sempre baseada em qual aba chegou primeiro.
// Uma aba conta como "já conhecida" se já é a oficial de QUALQUER UMA das
// duas páginas do Copiloto (painel ou configurações) — usado abaixo pra
// nunca travar por engano quem está navegando dentro do próprio app (ex.:
// já está no painel, clica em "Configurações", navega NA MESMA aba pra
// options.html). Sem isto: se um dia alguém abrisse Configurações direto
// (fora do fluxo normal — link "Opções da extensão" do Chrome, por
// exemplo) e deixasse aquela aba esquecida por aí, essa aba esquecida
// ficaria registrada como "a" oficial de Configurações pra sempre — e a
// aba de verdade que a pessoa está usando (painel, ao clicar em
// Configurações) seria travada como se fosse a cópia, quando é o oposto.
async function copilotoAbaJaConhecida(tabId) {
  const stored = await chrome.storage.session.get([PANEL_TAB_KEY, OPTIONS_TAB_KEY]);
  return (stored[PANEL_TAB_KEY] && stored[PANEL_TAB_KEY].id === tabId)
    || (stored[OPTIONS_TAB_KEY] && stored[OPTIONS_TAB_KEY].id === tabId);
}

async function copilotoRegistrarOuChecarAba(chave, tab) {
  if (!tab || typeof tab.id !== 'number') return true; // sem info da aba pra checar — não trava (mais seguro que travar sem certeza)
  return copilotoSerializarPorChave(chave, async () => {
    const stored = await chrome.storage.session.get(chave);
    const registrada = stored[chave];

    if (!registrada || registrada.id === tab.id) {
      await chrome.storage.session.set({ [chave]: { id: tab.id, windowId: tab.windowId } });
      return true;
    }

    if (await copilotoAbaJaConhecida(tab.id)) {
      await chrome.storage.session.set({ [chave]: { id: tab.id, windowId: tab.windowId } });
      return true;
    }

    // Existe outra aba registrada como oficial — confirma que ela ainda
    // existe de verdade antes de travar esta (evita travar por engano se a
    // aba antiga fechou e o onRemoved acima ainda não rodou).
    const aindaExiste = await new Promise((resolve) => {
      chrome.tabs.get(registrada.id, () => resolve(!chrome.runtime.lastError));
    });
    if (!aindaExiste) {
      await chrome.storage.session.set({ [chave]: { id: tab.id, windowId: tab.windowId } });
      return true;
    }

    return false; // é mesmo uma cópia — já existe outra aba oficial aberta
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.tipo === 'copilotoRegistrarAbaPainel') {
    const chave = message.pagina === 'options' ? OPTIONS_TAB_KEY : PANEL_TAB_KEY;
    copilotoRegistrarOuChecarAba(chave, sender.tab).then((ehOficial) => {
      sendResponse({ ehAbaOficial: ehOficial });
    });
    return true; // resposta assíncrona
  }
  return undefined;
});
