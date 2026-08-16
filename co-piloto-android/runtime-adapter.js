// Co-piloto Android — Fase 2: adaptador de runtime (substitui background.js).
//
// Mesmo princípio da Fase 1 (ver storage-adapter.js): reproduzir, em
// `window.chrome`, só a fatia da API que o código de negócio (aba-unica.js,
// auth.js, panel.js, chatbot.js) já chama hoje — pra esses arquivos
// chegarem na versão Android SEM mudar nenhuma linha de lógica.
//
// Carregue este arquivo DEPOIS de storage-adapter.js e ANTES de
// aba-unica.js/auth.js/perfis.js/panel.js/chatbot.js/options.js.
//
// O que este arquivo substitui, e por quê:
//
// 1) chrome.runtime.getManifest().version
//    Não existe manifest.json numa página web comum. A versão passa a vir
//    de uma <meta name="copiloto-versao" content="X.Y.Z"> no <head> da
//    página final — assim o script de build da Fase 4 só precisa atualizar
//    essa UMA linha, sem tocar em nenhum .js.
//
// 2) chrome.runtime.sendMessage({tipo: ...})
//    Na extensão, ia até o service worker (background.js) — o único
//    processo compartilhado por TODAS as abas, e por isso o único lugar
//    onde dava pra arbitrar com segurança "quem é a aba oficial" e "quem
//    ganha a corrida de gerar a credencial inicial". Uma página web comum
//    não tem esse processo central — o substituto nativo do navegador pra
//    exclusão mútua ENTRE ABAS é a Web Locks API (`navigator.locks`),
//    suportada no Chrome (inclusive Android) desde 2018. Os dois usos de
//    sendMessage que existem no código (aba-unica.js e auth.js) continuam
//    chamando exatamente a mesma função, com a mesma mensagem e a mesma
//    resposta — só o que roda por baixo mudou.
//
// O que fica de fora de propósito: chrome.tabs.*, chrome.windows.*,
// chrome.action.* — confirmado (grep) que só o próprio background.js usava
// isso, então não sobra nenhum chamador esperando por eles.

(function(){
  'use strict';

  if(typeof navigator === 'undefined' || !navigator.locks){
    console.error('[runtime-adapter] Web Locks API (navigator.locks) indisponível — precisa de Chrome recente em contexto seguro (https). A trava de aba duplicada e a proteção contra credencial inicial duplicada não vão funcionar.');
  }

  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || {};

  // ---------- 1) versão ----------
  const VERSAO_PADRAO = '0.0.0-dev'; // só aparece se a <meta> não existir — sinal claro de build incompleto, nunca some silenciosamente
  window.chrome.runtime.getManifest = function(){
    const meta = document.querySelector('meta[name="copiloto-versao"]');
    return { version: (meta && meta.content) || VERSAO_PADRAO };
  };

  // ---------- 2) trava de aba/instância duplicada (era PANEL_TAB_KEY /
  // OPTIONS_TAB_KEY + chrome.tabs.get em background.js) ----------
  //
  // Cada carregamento de página tenta segurar um lock exclusivo com o nome
  // da própria página ("painel" ou "options"). Quem consegue segurar é a
  // instância oficial; quem não consegue (alguém já segura) é cópia. O
  // navegador libera o lock sozinho quando o contexto que o segura é
  // destruído — fechar a aba, navegar pra outra URL, crash — então não
  // existe o problema que o código original tratava com cuidado (aba
  // fechou mas o registro antigo ainda não foi limpo): aqui não tem
  // registro nenhum pra ficar velho, o próprio lock JÁ é a fonte da
  // verdade, sempre em tempo real.
  //
  // `{ifAvailable: true}` faz o pedido nunca esperar na fila: se alguém já
  // segura o lock, o callback roda imediatamente com `lock === null`, em
  // vez de ficar pendurado esperando a vez (que nunca chegaria, já que
  // quem segura só solta ao fechar).
  // Na extensão real, esta resposta vem de um roundtrip de mensageria até o
  // service worker — sempre leva pelo menos alguns milissegundos de IPC de
  // verdade. Scripts que rodam no "DOMContentLoaded" (ex.: o init() do chat
  // rápido, em chatbot.js) contam com essa folga, mesmo sem saber disso:
  // DOMContentLoaded dispara bem antes desse roundtrip terminar, então eles
  // sempre têm a chance de rodar em cima de um DOM ainda vivo antes de
  // qualquer wipe de "aba duplicada" acontecer. Sem essa mesma folga aqui —
  // o Web Locks abaixo resolve rápido demais, sem IPC real —, esse mesmo
  // código podia rodar DEPOIS do wipe (confirmado com um teste de 2 abas:
  // TypeError em cima de elemento já removido). Esperar o documento pelo
  // menos terminar de parsear antes de responder recria a mesma folga, sem
  // mudar uma linha do código que conta com ela.
  async function esperarDocumentoAoMenosInterativo(){
    if(typeof document === 'undefined' || document.readyState !== 'loading') return;
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  async function registrarOuChecarInstanciaOficial(pagina){
    const nomeChave = pagina === 'options' ? 'copilotoInstanciaOficial:options' : 'copilotoInstanciaOficial:painel';
    await esperarDocumentoAoMenosInterativo();
    if(typeof navigator === 'undefined' || !navigator.locks){
      return true; // sem Web Locks não dá pra checar — não trava quem tem uso legítimo (mesmo princípio do catch original)
    }
    return new Promise(resolve => {
      navigator.locks.request(nomeChave, { ifAvailable: true }, (lock) => {
        if(!lock){
          resolve(false); // já existe outra instância segurando este nome — esta é cópia
          return; // callback termina na hora, não segura nada
        }
        resolve(true);
        // Segura o lock por tempo indefinido — só devolve quando a própria
        // Promise devolvida aqui resolver, o que só acontece se esta página
        // for destruída (fechar/navegar/crash). É assim, de propósito, que
        // se garante que nenhuma outra aba consiga o mesmo lock enquanto
        // esta continuar sendo a oficial.
        return new Promise(() => {});
      });
    });
  }

  // ---------- 3) reivindicação da geração da credencial inicial (era
  // COPILOTO_CRED_INICIAL_CLAIM_KEY em background.js) ----------
  //
  // Mesma lógica exata do background.js original (claim com expiração de
  // 10s pra nunca travar pra sempre se a aba que reivindicou cair no meio),
  // só que a atomicidade do check-then-set, que antes vinha de graça por
  // rodar dentro do único service worker, agora vem de um lock Web Locks
  // (fila normal, sem ifAvailable — quem chegar depois espera a vez, roda
  // só depois que quem está na frente terminar de ler+decidir+gravar).
  const COPILOTO_CRED_INICIAL_CLAIM_KEY = 'copilotoCredencialInicialClaim';
  const COPILOTO_CRED_INICIAL_CLAIM_EXPIRA_MS = 10000;

  async function reivindicarGeracaoCredencialInicial(){
    const executar = async () => {
      const dados = await chrome.storage.local.get([
        'copilotoCredencialInicialJaGerada', 'copilotoCredenciaisHashV2',
        'copilotoCredenciaisPersonalizadas', COPILOTO_CRED_INICIAL_CLAIM_KEY
      ]);
      if(dados.copilotoCredencialInicialJaGerada || dados.copilotoCredenciaisHashV2 || dados.copilotoCredenciaisPersonalizadas){
        return { vencedor: false };
      }
      const reivindicadaEm = dados[COPILOTO_CRED_INICIAL_CLAIM_KEY];
      if(reivindicadaEm && (Date.now() - reivindicadaEm) < COPILOTO_CRED_INICIAL_CLAIM_EXPIRA_MS){
        return { vencedor: false };
      }
      await chrome.storage.local.set({ [COPILOTO_CRED_INICIAL_CLAIM_KEY]: Date.now() });
      return { vencedor: true };
    };
    if(typeof navigator === 'undefined' || !navigator.locks){
      return executar(); // sem Web Locks, faz sem trava entre abas (mesmo risco residual documentado no original quando algo foge do normal)
    }
    return navigator.locks.request('copilotoCredencialInicialClaimLock', executar);
  }

  // ---------- chrome.runtime.sendMessage: mesmo formato de chamada/retorno
  // que aba-unica.js e auth.js já usam (await chrome.runtime.sendMessage({tipo, ...})
  // -> objeto de resposta), só que resolvido localmente em vez de ir até um
  // service worker que não existe mais aqui. ----------
  window.chrome.runtime.sendMessage = async function(message){
    if(message && message.tipo === 'copilotoRegistrarAbaPainel'){
      const ehOficial = await registrarOuChecarInstanciaOficial(message.pagina);
      return { ehAbaOficial: ehOficial };
    }
    if(message && message.tipo === 'copilotoReivindicarGeracaoCredencialInicial'){
      return reivindicarGeracaoCredencialInicial();
    }
    throw new Error('[runtime-adapter] mensagem desconhecida: ' + JSON.stringify(message));
  };
})();
