// Co-piloto Android — Fase 3: gerenciador de telas.
//
// Dobra options.html (Configurações) pra dentro da MESMA página que
// panel.html, como uma segunda tela navegável — sem duplicar lógica: as
// duas telas continuam sendo o panel.js e o options.js originais, byte a
// byte (só as 3 linhas de navegação entre eles viram uma chamada pra cá em
// vez de um window.location.href — ver build.js).
//
// Por que não dá pra simplesmente mostrar as duas ao mesmo tempo com
// display:none numa e display:block na outra: panel.html e options.html
// reusam alguns dos MESMOS ids (toast, o aviso de "impersonando admin", o
// modal de palavra-chave de recuperação...) porque nunca precisaram
// conviver no mesmo documento antes — cada um era uma página À PARTE.
// document.getElementById() só encontra a PRIMEIRA ocorrência de um id;
// com as duas telas simultaneamente no DOM (mesmo que uma escondida), a
// tela que perdesse a corrida do id ficava com o toast, o aviso etc. da
// OUTRA tela por baixo dos panos. A solução: só a tela ativa fica de
// verdade no documento; a outra fica "estacionada" dentro de uma
// <template> (conteúdo inerte — não existe pra getElementById/
// querySelector enquanto está lá dentro). Trocar de tela MOVE os nós (não
// clona) entre o container vivo e a template — o mesmo elemento físico,
// com todo o estado que já tinha (valor de campo, listener, timer): nada é
// recriado, então nada precisa ser "religado".
//
// Carregar options.js pela primeira vez tem uma pegadinha: ele faz
// document.getElementById('configUnlockBtn').addEventListener(...) direto
// no nível mais alto do arquivo (roda na hora que o <script> é avaliado,
// não dentro de uma função chamada depois) — precisa que a tela de
// Configurações já esteja no documento vivo NESSE EXATO MOMENTO. Por isso
// options.js não é um <script src> comum: o código dele vai embutido,
// inerte, dentro de um <script type="text/plain"> (o navegador nunca
// executa isso sozinho), e só é injetado de verdade — como um <script> de
// verdade, criado na hora — na primeira vez que a pessoa abre
// Configurações, IMEDIATAMENTE depois da tela ter sido colocada no
// documento. Isso só acontece uma vez por sessão de uso: da segunda vez em
// diante, é só mover os nós de volta (que já têm tudo religado).
(function(){
  'use strict';

  const CONTAINER_ID = 'copilotoContainerAtivo';
  let telaAtual = 'painel'; // 'painel' | 'configuracoes'
  let optionsJaBootstrapped = false;

  function elContainer(){ return document.getElementById(CONTAINER_ID); }
  function templatePainel(){ return document.getElementById('templateTelaPainel'); }
  function templateConfiguracoes(){ return document.getElementById('templateTelaConfiguracoes'); }

  // Move (não clona) os filhos ATUAIS do container vivo pra dentro da
  // <template> informada — "estaciona" a tela.
  function estacionarContainerEm(template){
    const container = elContainer();
    while(container.firstChild){
      template.content.appendChild(container.firstChild);
    }
  }

  // Move (não clona) os filhos da <template> informada pra dentro do
  // container vivo — o oposto de estacionar.
  function restaurarContainerDe(template){
    const container = elContainer();
    while(template.content.firstChild){
      container.appendChild(template.content.firstChild);
    }
  }

  function irParaAncora(hash){
    if(!hash) return;
    const alvo = document.querySelector(hash);
    if(alvo) alvo.scrollIntoView({ block: 'start' });
  }

  // Cria um <script> de verdade a partir do texto inerte guardado em
  // #fonteOptionsJs e o anexa ao <head> — o navegador executa o conteúdo
  // IMEDIATAMENTE e de forma síncrona nesse anexar (scripts criados via
  // createElement + textContent rodam na hora, diferente de <script src>,
  // que é assíncrono por natureza). Só roda uma vez, na primeira visita.
  function executarFonteOptionsJsUmaVez(){
    const fonte = document.getElementById('fonteOptionsJs');
    if(!fonte){
      console.error('[screen-manager] #fonteOptionsJs não encontrado — options.js nunca vai rodar.');
      return;
    }
    const script = document.createElement('script');
    script.textContent = fonte.textContent;
    document.head.appendChild(script);
    document.head.removeChild(script); // já rodou; não precisa deixar sujando o head
  }

  // ---------- Proteção geral: callbacks de setTimeout/setInterval que
  // mexem em elementos de uma tela ESTACIONADA ----------
  //
  // panel.js e options.js têm vários pontos que agendam uma ação pro futuro
  // (foco automático 50ms depois de mostrar uma tela de senha, o timer de
  // inatividade que confere a sessão a cada 60s, etc.) presumindo — com
  // razão, quando cada tela era a PÁGINA INTEIRA — que os elementos deles
  // vão continuar existindo quando o timer disparar. Nesta página única, a
  // tela que agendou o timer pode ter sido estacionada (ver
  // estacionarContainerEm) antes dele disparar, e um
  // document.getElementById(...) que dava certo vira null — quem chamar
  // .focus()/.style/etc nisso sem checar lança um erro não tratado.
  //
  // Em vez de caçar e proteger cada ponto individualmente (frágil: um novo
  // setTimeout adicionado no futuro no código original ficaria
  // desprotegido até alguém lembrar de tratar aqui também), a rede de
  // segurança fica no nível mais baixo possível — window.setTimeout e
  // window.setInterval em si — pra cobrir automaticamente qualquer uso
  // futuro também. Preserva o id retornado (clearTimeout/clearInterval
  // continuam funcionando normalmente).
  function protegerTimersContraTelaEstacionada(){
    ['setTimeout', 'setInterval'].forEach(nomeFuncao => {
      const original = window[nomeFuncao];
      window[nomeFuncao] = function(callback, atraso, ...resto){
        if(typeof callback !== 'function') return original(callback, atraso, ...resto); // uso raro com string; não mexe
        const avisar = (e) => console.warn(`[screen-manager] callback de ${nomeFuncao} ignorado (a tela dele não está ativa agora):`, e && e.message);
        const callbackProtegido = function(...args){
          try{
            const resultado = callback.apply(this, args);
            // Callback assíncrono (async function): o erro vira uma
            // Promise REJEITADA, não uma exceção síncrona — o try/catch
            // sozinho não pega isso, precisa de um .catch() também.
            if(resultado && typeof resultado.catch === 'function') resultado.catch(avisar);
            return resultado;
          }catch(e){
            avisar(e);
          }
        };
        return original(callbackProtegido, atraso, ...resto);
      };
    });
  }

  // ---------- Bootstrap inicial ----------
  // Roda na hora (script normal, sem defer/async) — ANTES de panel.js
  // carregar, pra ele encontrar os elementos do painel já no documento
  // vivo, exatamente como aconteceria numa página comum.
  protegerTimersContraTelaEstacionada();
  restaurarContainerDe(templatePainel());

  // ---------- API pública (chamada pelas 3 linhas de navegação reescritas
  // em panel.js/chatbot.js/options.js — ver build.js) ----------

  window.copilotoIrParaConfiguracoes = async function(hash){
    if(telaAtual === 'configuracoes'){
      if(hash){ location.hash = hash; irParaAncora(hash); }
      return;
    }
    estacionarContainerEm(templatePainel());
    restaurarContainerDe(templateConfiguracoes());
    telaAtual = 'configuracoes';

    if(hash) location.hash = hash;

    if(!optionsJaBootstrapped){
      optionsJaBootstrapped = true;
      executarFonteOptionsJsUmaVez();
      // options.js, no próprio bootstrap dele, já lê location.hash e rola
      // até a âncora (ver liberarConfig() em options.js) — não precisa
      // repetir aqui na primeira visita.
    }else{
      // Sessão pode ter expirado enquanto a pessoa estava no painel.
      // copilotoIniciarChecagemInatividade (auth.js) só deixa UM callback
      // rodando por página inteira — premissa seguríssima quando painel e
      // Configurações eram documentos SEPARADOS (cada aba tinha o seu
      // próprio interval), mas nesta página única o painel chama essa
      // função primeiro (bootstrapa antes) e "vence" o singleton: o
      // callback das Configurações (bloquearConfigPorInatividade) nunca
      // chega a ser agendado de verdade. Sem depender dele, confere a
      // sessão direto aqui, sempre que a pessoa volta pra esta tela.
      if(typeof copilotoEstaAutenticado === 'function' && typeof bloquearConfigPorInatividade === 'function'){
        const autenticado = await copilotoEstaAutenticado();
        if(!autenticado) await bloquearConfigPorInatividade();
      }
      if(hash) irParaAncora(hash);
    }
  };

  window.copilotoVoltarAoPainel = function(){
    if(telaAtual === 'painel') return;
    estacionarContainerEm(templateConfiguracoes());
    restaurarContainerDe(templatePainel());
    telaAtual = 'painel';
  };
})();
