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

// Serializado por chave (mesma fila usada por openOrFocusPanel e
// copilotoRegistrarOuChecarAba abaixo) — sem isto, fechar a aba oficial de
// uma página exatamente no instante em que outra chamada está gravando um
// id novo pra essa mesma chave (ex.: reabrindo pelo ícone) podia ler o
// registro ANTIGO aqui, e o remove() concluir DEPOIS da escrita nova —
// apagando o registro da aba nova e legítima, não da que de fato fechou.
chrome.tabs.onRemoved.addListener((id) => {
  [PANEL_TAB_KEY, OPTIONS_TAB_KEY].forEach((chave) => {
    copilotoSerializarPorChave(chave, async () => {
      const stored = await chrome.storage.session.get(chave);
      if (stored[chave] && stored[chave].id === id) {
        await chrome.storage.session.remove(chave);
      }
    });
  });
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
async function copilotoRegistrarOuChecarAba(chave, tab) {
  if (!tab || typeof tab.id !== 'number') return true; // sem info da aba pra checar — não trava (mais seguro que travar sem certeza)
  return copilotoSerializarPorChave(chave, async () => {
    const stored = await chrome.storage.session.get(chave);
    const registrada = stored[chave];

    // Sem registro ainda, ou já é esta mesma aba (ex.: recarregou, ou está
    // navegando dentro do próprio app — já está no painel, clica em
    // "Configurações", navega NA MESMA aba pra options.html) — sempre
    // registra/confirma, nunca trava.
    if (!registrada || registrada.id === tab.id) {
      await chrome.storage.session.set({ [chave]: { id: tab.id, windowId: tab.windowId } });
      return true;
    }

    // Existe outra aba registrada como oficial — confirma que ela ainda
    // existe de verdade antes de travar esta (evita travar por engano se a
    // aba antiga fechou e o onRemoved acima ainda não rodou).
    //
    // De propósito NÃO existe mais aqui um atalho de "esta aba já é oficial
    // da OUTRA página do Copiloto, então pode assumir esta também" — havia
    // um antes (copilotoAbaJaConhecida), removido porque cedia a chave pra
    // esta aba mesmo quando a aba registrada continuava genuinamente aberta
    // em outra janela (ex.: painel na aba B, Configurações na aba A; volta
    // ao painel pela aba A) — órfãzinha a aba B, que era a legítima, como
    // se fosse cópia da aba que a substituiu. Sem esse atalho, esse cenário
    // agora resolve do jeito mais seguro: a aba B continua sendo a oficial
    // do painel, e a aba A (que só estava de passagem) vê a tela de "esta
    // aba é uma cópia" ao tentar assumir uma chave que já tem dona viva —
    // pior caso é uma tela a mais pra fechar, nunca uma aba legítima perdida.
    const aindaExiste = await new Promise((resolve) => {
      chrome.tabs.get(registrada.id, () => resolve(!chrome.runtime.lastError));
    });
    if (!aindaExiste) {
      await chrome.storage.session.set({ [chave]: { id: tab.id, windowId: tab.windowId } });
      return true;
    }

    return false; // é mesmo uma cópia — já existe outra aba oficial aberta e viva
  });
}

// ---------- Reivindicação da geração da credencial inicial ----------
//
// panel.html e options.html são páginas DIFERENTES — cada uma com sua
// própria trava de aba duplicada acima (chaves separadas: PANEL_TAB_KEY /
// OPTIONS_TAB_KEY) — então nada impede as duas de estarem oficialmente
// abertas ao mesmo tempo (o Chrome restaura as duas ao reabrir, ou alguém
// abre Configurações numa aba nova bem no instante em que o painel também
// está carregando pela primeira vez). Se as duas páginas gerassem a
// credencial inicial cada uma na sua própria aba, nada as impediria de
// lerem "ainda não existe" ao mesmo tempo e gerarem senhas DIFERENTES — a
// pessoa guardaria a de uma aba enquanto a outra, escrevendo por último,
// já teria invalidado aquela senha sem ninguém perceber. Confirmado com um
// teste automatizado antes desta correção: nas duas abas, cada uma
// mostrava/copiava uma senha que não era a gravada de fato.
//
// chrome.storage não tem uma trava atômica entre abas. O service worker,
// porém, é o único ponto que as duas páginas realmente compartilham — é
// um só, nunca dois rodando ao mesmo tempo — e a fila por chave de
// perfis.js SERIALIZA de verdade dentro dele (não é "quase ao mesmo
// tempo": é uma de cada vez). Por isso a DECISÃO de quem gera mora aqui;
// a criptografia em si (PBKDF2, geração da senha) continua na página, em
// auth.js, que já tinha tudo isso.
const COPILOTO_CRED_INICIAL_CLAIM_KEY = 'copilotoCredencialInicialClaim';
// Generoso de propósito: PBKDF2 com 210 mil iterações mais a gravação não
// deveria chegar nem perto disso. Existe só pra destravar sozinho se uma
// aba reivindicar e travar no meio (fechada, crashou) antes de terminar —
// sem isto, uma falha rara naquela aba trancaria a geração da credencial
// PARA SEMPRE nesta instalação, o que seria pior que a corrida original.
const COPILOTO_CRED_INICIAL_CLAIM_EXPIRA_MS = 10000;

async function copilotoReivindicarGeracaoCredencialInicial(){
  return copilotoSerializarPorChave(COPILOTO_CRED_INICIAL_CLAIM_KEY, async () => {
    const dados = await chrome.storage.local.get([
      COPILOTO_CREDENCIAL_INICIAL_GERADA_KEY, COPILOTO_CREDENCIAIS_HASH_V2_KEY,
      COPILOTO_CREDENCIAIS_PERSONALIZADAS_KEY, COPILOTO_CRED_INICIAL_CLAIM_KEY
    ]);
    if (dados[COPILOTO_CREDENCIAL_INICIAL_GERADA_KEY] || dados[COPILOTO_CREDENCIAIS_HASH_V2_KEY] || dados[COPILOTO_CREDENCIAIS_PERSONALIZADAS_KEY]) {
      return { vencedor: false }; // já existe credencial — nada a gerar
    }
    const reivindicadaEm = dados[COPILOTO_CRED_INICIAL_CLAIM_KEY];
    if (reivindicadaEm && (Date.now() - reivindicadaEm) < COPILOTO_CRED_INICIAL_CLAIM_EXPIRA_MS) {
      return { vencedor: false }; // outra aba já reivindicou há pouco — está gerando agora
    }
    await chrome.storage.local.set({ [COPILOTO_CRED_INICIAL_CLAIM_KEY]: Date.now() });
    return { vencedor: true };
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
  if (message && message.tipo === 'copilotoReivindicarGeracaoCredencialInicial') {
    copilotoReivindicarGeracaoCredencialInicial().then(sendResponse);
    return true; // resposta assíncrona
  }
  return undefined;
});
