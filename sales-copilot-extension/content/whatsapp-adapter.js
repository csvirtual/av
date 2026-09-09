// ---------- WhatsApp Adapter ----------
//
// Fase 2 da evolução do Copiloto (ver documento de arquitetura da sessão).
// Único arquivo de todo o projeto que toca o DOM do WhatsApp Web — se o
// WhatsApp mudar o HTML, é aqui (e em content/selectors.js) que se
// conserta, nunca em panel.js.
//
// ESCOPO DESTA FASE (deliberadamente pequeno): só OBSERVAR e LOGAR
// (console + copilotoLog) o que consegue ler — conversa ativa e mensagens
// novas. NADA é enviado pro background/painel ainda (isso é a fase 3) e
// NENHUMA chamada de IA é disparada a partir daqui (isso nunca acontece
// automaticamente — só por clique humano no painel, ver plano de
// arquitetura). Objetivo desta fase é validar, com uso real, que a
// detecção funciona antes de conectar o resto do sistema nela.
//
// NUNCA escreve nada no DOM do WhatsApp, nunca clica em nada, nunca
// intercepta envio de mensagem — só leitura passiva.
//
// AVISO (repetido de selectors.js de propósito, é o ponto mais importante
// deste arquivo): os seletores usados aqui não foram verificados contra o
// WhatsApp Web ao vivo. Rode copilotoWhatsAppDiagnostico() no console desta
// aba pra conferir o que está batendo de verdade.
(function () {
  // Guarda contra dupla injeção (ex.: extensão recarregada com a página já
  // aberta, ou alguma condição do Chrome que injete o content script mais
  // de uma vez) — sem isto, dois observers rodando ao mesmo tempo
  // duplicariam toda mensagem detectada.
  if (window.__copilotoWaAdapterAtivo) return;
  window.__copilotoWaAdapterAtivo = true;

  const TAG = 'whatsapp-adapter';

  // ---------- Busca resiliente (ver content/selectors.js) ----------

  // Tenta cada seletor candidato em ordem; devolve o primeiro elemento
  // encontrado + em que posição da lista (0 = melhor caso). null se nenhum
  // bateu. `raiz`: de onde buscar (document por padrão, ou um elemento já
  // encontrado, pra busca relativa).
  function encontrar(chaveConceito, raiz) {
    const candidatos = COPILOTO_WA_SELETORES[chaveConceito];
    if (!candidatos) return null;
    const base = raiz || document;
    for (let i = 0; i < candidatos.length; i++) {
      const el = base.querySelector(candidatos[i]);
      if (el) return { elemento: el, tier: i };
    }
    return null;
  }

  function encontrarTodos(chaveConceito, raiz) {
    const candidatos = COPILOTO_WA_SELETORES[chaveConceito];
    if (!candidatos) return { elementos: [], tier: -1 };
    const base = raiz || document;
    for (let i = 0; i < candidatos.length; i++) {
      const els = base.querySelectorAll(candidatos[i]);
      if (els.length) return { elementos: Array.from(els), tier: i };
    }
    return { elementos: [], tier: -1 };
  }

  // Evita logar o mesmo aviso de degradação a cada mutação (o observer
  // pode disparar dezenas de vezes por segundo em uma lista virtualizada) —
  // só loga quando o resultado (achou/não achou, e em que tier) MUDA em
  // relação à última vez.
  const _ultimoResultadoPorConceito = {};
  function logarSeMudou(chaveConceito, tier) {
    if (_ultimoResultadoPorConceito[chaveConceito] === tier) return;
    _ultimoResultadoPorConceito[chaveConceito] = tier;
    if (tier === -1) {
      copilotoLog('WARN', TAG, { conceito: chaveConceito, resultado: 'MISS — nenhum seletor bateu' });
    } else if (tier > 0) {
      copilotoLog('INFO', TAG, { conceito: chaveConceito, resultado: `bateu no fallback tier ${tier}` });
    } else {
      copilotoLog('DEBUG', TAG, { conceito: chaveConceito, resultado: 'bateu no seletor principal (tier 0)' });
    }
  }

  // ---------- Extração ----------

  function obterNomeContatoAtivo() {
    const achado = encontrar('nomeContato');
    logarSeMudou('nomeContato', achado ? achado.tier : -1);
    return achado ? achado.elemento.getAttribute('title') || achado.elemento.textContent.trim() : null;
  }

  function classificarOrigem(bolha) {
    return bolha.classList.contains(COPILOTO_WA_SELETORES.classeMensagemEnviada) ? 'me' : 'lead';
  }

  // data-pre-plain-text costuma vir como "[HH:MM, DD/MM/AAAA] Nome: " —
  // parser tolerante: se o formato não bater exatamente (WhatsApp mudou o
  // formato, ou o atributo não existe nesta versão), devolve null pros dois
  // campos em vez de lançar erro — quem chama sempre tem um fallback
  // (Date.now() pro timestamp, "lead"/"me" via classe pra origem).
  function extrairMetadados(bolha) {
    // querySelector só busca DESCENDENTES — se o atributo estiver na
    // própria bolha (não num filho), checa isso primeiro à parte. Só depois
    // busca como descendente da bolha e, por fim, sobe um nível (o
    // atributo às vezes vive no wrapper pai) — nunca via closest(), que
    // incluiria a própria bolha de novo numa busca que já falhou nela.
    const elementoComAtributo = bolha.hasAttribute('data-pre-plain-text')
      ? bolha
      : (encontrar('metadadosMensagem', bolha) || (bolha.parentElement && encontrar('metadadosMensagem', bolha.parentElement)))?.elemento;
    const attr = elementoComAtributo && elementoComAtributo.getAttribute('data-pre-plain-text');
    if (!attr) return { timestamp: null, nomeRemetente: null };
    const match = attr.match(/^\[(\d{1,2}):(\d{2}),?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]\s*(.*?):\s*$/);
    if (!match) return { timestamp: null, nomeRemetente: null };
    const [, hh, mm, dd, mo, aa, nome] = match;
    const ano = aa.length === 2 ? 2000 + Number(aa) : Number(aa);
    const data = new Date(ano, Number(mo) - 1, Number(dd), Number(hh), Number(mm));
    const timestamp = Number.isNaN(data.getTime()) ? null : data.getTime();
    return { timestamp, nomeRemetente: nome || null };
  }

  function extrairTextoDaBolha(bolha) {
    const achado = encontrar('textoDaMensagem', bolha);
    return achado ? achado.elemento.textContent : '';
  }

  // Lê TODAS as bolhas visíveis no DOM agora (a lista do WhatsApp é
  // virtualizada — "visíveis no DOM" não é necessariamente "a conversa
  // inteira", ver limitação documentada no plano de arquitetura, seção
  // "Leitura do WhatsApp"). Devolve no formato bruto que
  // copilotoNormalizarConversa (core/conversation-normalizer.js, carregado
  // antes deste arquivo) sabe consumir.
  function extrairMensagensVisiveis(painel) {
    const { elementos: bolhas, tier } = encontrarTodos('bolhaMensagem', painel);
    logarSeMudou('bolhaMensagem', bolhas.length ? tier : -1);
    return bolhas.map((bolha, idx) => {
      const texto = extrairTextoDaBolha(bolha);
      const meta = extrairMetadados(bolha);
      return {
        // Sem um id estável de verdade do WhatsApp neste nível de DOM —
        // copilotoNormalizarMensagem (fase 1) já sabe gerar um fallback
        // determinístico a partir de timestamp+texto quando "id" vem
        // undefined, então não inventamos um id falso aqui.
        text: texto,
        timestamp: meta.timestamp || undefined,
        from: classificarOrigem(bolha),
        // Índice de leitura nesta varredura — só pra desempate de ordem
        // quando duas bolhas caem no mesmo timestamp arredondado (ex.:
        // metadadosMensagem não bateu pra nenhuma das duas, ambas usam
        // Date.now() como fallback quase simultâneo dentro de
        // copilotoNormalizarMensagem).
        _ordemDeLeitura: idx,
      };
    });
  }

  // ---------- Debounce de rajada (ver seção de performance do plano) ----------
  //
  // A lista do WhatsApp é virtualizada: o React monta/desmonta nós o tempo
  // todo, inclusive só de rolar a tela, sem mensagem nova nenhuma de
  // verdade. Reagir a CADA mutação individual seria caro à toa e geraria
  // "mensagens novas" fantasma a cada scroll. Em vez disso, qualquer
  // mutação só agenda uma reavaliação única, adiada — mutações seguintes
  // dentro da janela de espera cancelam e reagendam, então uma rajada
  // inteira (várias mensagens chegando em sequência, ou uma rolagem longa)
  // vira UMA reavaliação só, depois que tudo se aquieta.
  const DEBOUNCE_MS = 600;
  let debounceTimer = null;
  function agendarReavaliacao(fn) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fn, DEBOUNCE_MS);
  }

  // ---------- Estado por conversa ----------

  let conversaAtualNome = null;
  let idsJaVistos = new Set(); // reiniciado a cada troca de conversa

  function reavaliar() {
    const painelAchado = encontrar('painelMensagens');
    logarSeMudou('painelMensagens', painelAchado ? painelAchado.tier : -1);
    if (!painelAchado) {
      // Sem o painel de mensagens, não há o que ler — reporta degradação
      // (uma vez, via logarSeMudou) e não tenta mais nada neste ciclo.
      // Isto NUNCA impede o WhatsApp Web de funcionar normalmente: é só a
      // extensão que fica sem dado até o próximo ciclo achar o painel de
      // novo (ex.: página ainda carregando, ou nenhuma conversa aberta).
      return;
    }

    const nomeAtual = obterNomeContatoAtivo();
    if (nomeAtual !== conversaAtualNome) {
      copilotoLog('INFO', TAG, { evento: 'conversa_mudou' }); // nunca loga o nome em si (é PII) — só o evento
      conversaAtualNome = nomeAtual;
      idsJaVistos = new Set();
    }

    const brutas = extrairMensagensVisiveis(painelAchado.elemento);
    const normalizadas = copilotoNormalizarConversa(brutas);
    const novas = normalizadas.filter((m) => !idsJaVistos.has(m.id));
    if (!novas.length) return;

    novas.forEach((m) => idsJaVistos.add(m.id));
    // Fase 2: só loga. A fase 3 troca este log por
    // chrome.runtime.sendMessage(copilotoCriarMensagem(COPILOTO_MSG.MENSAGENS_NOVAS, {...})).
    copilotoLog('INFO', TAG, {
      evento: 'mensagens_novas_detectadas',
      quantidade: novas.length,
      origens: novas.map((m) => m.from), // só a origem (lead/me), nunca o texto
    });
  }

  // ---------- Observação ----------

  let observer = null;
  function conectarObserver() {
    const painelAchado = encontrar('painelMensagens');
    if (!painelAchado) return false;
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => agendarReavaliacao(reavaliar));
    // subtree:true é necessário (mensagens são nós profundos), mas o
    // observer fica restrito ao painel de mensagens — nunca em
    // document.body — pra não reagir a mutações do resto da página
    // (barra lateral, lista de conversas, etc.) que não interessam aqui.
    observer.observe(painelAchado.elemento, { childList: true, subtree: true });
    copilotoLog('DEBUG', TAG, { evento: 'observer_conectado' });
    return true;
  }

  // ---------- Bootstrap ----------
  //
  // O WhatsApp Web carrega de forma assíncrona (login por QR, depois o
  // app React monta aos poucos) — o painel de mensagens pode não existir
  // ainda no momento em que este content script roda. Tenta uma vez
  // IMEDIATAMENTE (caso comum: o script roda em document_idle, quando a
  // página já está pronta na maioria das aberturas normais — sem essa
  // tentativa imediata, toda conversa já aberta esperaria até 2s à toa
  // antes da primeira leitura) e só entra em polling se isso falhar. Poll
  // DELIBERADAMENTE pouco agressivo (a cada 2s, no máximo 30 tentativas =
  // 1 minuto) só pra esperar o app ainda montando; assim que o painel
  // aparece uma vez, o MutationObserver assume e o polling para de vez —
  // nunca fica rodando em paralelo com o observer.
  function tentarBootstrap() {
    if (!conectarObserver()) return false;
    reavaliar(); // primeira leitura, não espera a primeira mutação
    return true;
  }

  let intervaloBootstrap = null;
  if (!tentarBootstrap()) {
    let tentativas = 0;
    const MAX_TENTATIVAS = 30;
    intervaloBootstrap = setInterval(() => {
      tentativas++;
      if (tentarBootstrap()) {
        clearInterval(intervaloBootstrap);
        return;
      }
      if (tentativas >= MAX_TENTATIVAS) {
        clearInterval(intervaloBootstrap);
        copilotoLog('WARN', TAG, { evento: 'bootstrap_desistiu', tentativas });
      }
    }, 2000);
  }

  // Se o WhatsApp Web trocar de "página" internamente de um jeito que
  // desmonte o painel de mensagens inteiro (ex.: deslogou e logou de
  // novo), o observer antigo aponta pra um nó que já saiu da árvore — a
  // própria reavaliação detecta isso (encontrar() volta a falhar) e loga a
  // degradação; não há necessidade de um observer separado só pra "o
  // painel sumiu", o ciclo normal já cobre.

  window.addEventListener('pagehide', () => {
    clearInterval(intervaloBootstrap);
    clearTimeout(debounceTimer);
    if (observer) observer.disconnect();
  });

  // ---------- Diagnóstico manual (calibração dos seletores) ----------
  //
  // Exposta em window de propósito — é uma ferramenta de desenvolvimento
  // pra rodar no console da aba do WhatsApp Web, não algo usado pelo resto
  // da extensão. Mostra, pra cada conceito de content/selectors.js, se
  // achou e em que tier — sem imprimir nenhum conteúdo de mensagem/nome
  // (só contagens e tiers), então é seguro colar o resultado numa
  // conversa/relatório sem vazar dado de cliente nenhum.
  window.copilotoWhatsAppDiagnostico = function () {
    const resultado = {};
    Object.keys(COPILOTO_WA_SELETORES).forEach((chave) => {
      if (chave === 'classeMensagemEnviada') return; // não é seletor de busca
      if (chave === 'bolhaMensagem') {
        const r = encontrarTodos(chave);
        resultado[chave] = r.elementos.length ? { tier: r.tier, quantidadeEncontrada: r.elementos.length } : 'MISS';
        return;
      }
      const r = encontrar(chave);
      resultado[chave] = r ? { tier: r.tier } : 'MISS';
    });
    console.table(resultado);
    console.log(
      '[copiloto] Se algum conceito acima veio "MISS" ou num tier alto, ' +
        'mande este resultado pra quem mantém a extensão ajustar content/selectors.js.'
    );
    return resultado;
  };

  copilotoLog('INFO', TAG, { evento: 'adapter_carregado' });
})();
