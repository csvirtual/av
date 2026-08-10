// ---------- Chat rápido flutuante ----------
//
// Botão ao lado do "voltar ao topo" que abre um chat em modal pra conversa
// livre com a IA ("como eu abordo esse lead?", "como responder essa
// objeção?" etc), sem precisar colar a mensagem do lead nem preencher os
// campos do fluxo principal.
//
// Reaproveita 100% da infraestrutura que panel.js já tem pro "Gerar
// resposta" / "Sugerir abordagem ou Follow-up":
// - providerSettings.provider decide Claude vs Gemini (mesma configuração,
//   nenhuma escolha nova pra fazer aqui);
// - callClaudeComTier()/callGeminiComTier() já resolvem sozinhos qual
//   chave/modelo usar (chave A/B do Gemini, ou o par principal/econômico do
//   Claude) — é exatamente o "reconhece automaticamente o modelo e o
//   provedor" pedido, sem duplicar essa lógica aqui;
// - buildBlocoEstaticoFunil()/buildContextoDinamicoBloco() já montam o
//   contexto do negócio e do lead selecionado (nome, estágio, notas) —
//   lidos automaticamente do lead ativo no painel, sem precisar digitar de
//   novo;
// - registrarUsoDeTokens (dentro de callClaude/callGemini) e incrementUsage
//   contam este uso nos mesmos contadores de billing/uso que os outros dois
//   botões já alimentam.
//
// Tudo isso já existe em panel.js (script carregado antes deste) — este
// arquivo só monta a conversa livre por cima, sem tocar no fluxo principal.
(function(){

  let chatHistorico = []; // { role: 'user'|'ai', texto: string }
  let chatOcupado = false;

  // Estágio/emoção "desta mensagem" — dois jeitos de chegar nele:
  // 1) AUTOMÁTICO (padrão): a IA lê a própria mensagem que está sendo
  //    enviada, a cada envio (ver garantirLeituraEstagioParaEnvio) — não
  //    depende mais de colar texto, roda pra qualquer mensagem digitada
  //    também. chatEstagioDetectado/chatEmocaoDetectada somem (voltam a
  //    null) depois de cada envio, pra nunca "vazar" uma leitura antiga pra
  //    uma pergunta sem relação com ela.
  // 2) MANUAL (chatEstagioManual): a atendente fixa um estágio pelo
  //    seletor da barra de contexto do chat, pra quando a leitura
  //    automática não bate — nesse caso NÃO chama a IA pra classificar, e o
  //    valor fica valendo pras próximas mensagens desta conversa até ela
  //    trocar de novo (ou trocar de lead).
  let chatEstagioDetectado = null;
  let chatEmocaoDetectada = null;
  let chatEstagioManual = ''; // '' = automático; senão, um valor de ESTAGIO_ORDER
  // A que texto pertence a leitura automática atual — evita reclassificar à
  // toa se a pessoa colou e enviou sem editar (a leitura do paste já serve).
  let chatEstagioDetectadoOrigemTexto = '';

  // Histórico do Bot: guarda as conversas já tidas neste chat rápido COM O
  // LEAD ATUALMENTE SELECIONADO (ver seção mais abaixo) — sobrevive a
  // fechar o modal e a recarregar a página, e troca de conteúdo sozinho ao
  // trocar de lead no painel.
  let botHistorico = [];
  let botHistorySearchQuery = '';

  function elBtn(){ return document.getElementById('chatFloatBtn'); }
  function elOverlay(){ return document.getElementById('chatModalOverlay'); }
  function elMessages(){ return document.getElementById('chatMessagesBox'); }
  function elInput(){ return document.getElementById('chatInputBox'); }
  function elSend(){ return document.getElementById('chatSendBtn'); }
  function elContextBar(){ return document.getElementById('chatContextBar'); }
  function elEstagioSelect(){ return document.getElementById('chatEstagioOverrideSelect'); }

  // Lead atualmente selecionado no painel (ou null, se nenhum) — lido
  // sempre no momento do envio, nunca guardado, pra nunca ficar
  // desatualizado se a pessoa trocar de lead com o chat aberto.
  function leadAtualParaChat(){
    if(typeof currentLeadId === 'undefined' || !currentLeadId) return null;
    if(typeof leads === 'undefined') return null;
    return leads.find(l => l.id === currentLeadId) || null;
  }

  // Busca um lead por id específico, independente de ser o selecionado
  // agora — usado por registrarTrocaNoHistoricoBot pra achar o nome do lead
  // de QUANDO a pergunta foi feita, mesmo que a pessoa já tenha trocado de
  // lead antes da resposta chegar.
  function leadPorId(id){
    if(!id || typeof leads === 'undefined') return null;
    return leads.find(l => l.id === id) || null;
  }

  function nomeParaExibir(lead){
    if(!lead) return '';
    if(lead.fixo){
      const personName = document.getElementById('personNameInput');
      return personName ? personName.value.trim() : '';
    }
    return (!pareceCifrado(lead.nome) && lead.nome) || '';
  }

  function atualizarBarraDeContexto(){
    const bar = elContextBar();
    if(!bar) return;
    const lead = leadAtualParaChat();
    const partes = [];
    if(lead){
      const nome = nomeParaExibir(lead);
      const estagio = lead.estagio || 'Primeiro contato';
      partes.push(nome
        ? `🎯 Contexto automático: ${nome} · ${estagio}`
        : `🎯 Contexto automático: lead selecionado · ${estagio}`);
    }
    if(chatEstagioManual){
      partes.push(`📌 Estágio fixado manualmente nesta conversa: ${chatEstagioManual}`);
    }else if(chatEstagioDetectado || chatEmocaoDetectada){
      // Leitura automática da própria mensagem (ver
      // garantirLeituraEstagioParaEnvio) — independente de haver ou não um
      // lead selecionado no painel.
      const bits = [];
      if(chatEstagioDetectado) bits.push(`estágio: ${chatEstagioDetectado}`);
      if(chatEmocaoDetectada) bits.push(`emoção do cliente: ${chatEmocaoDetectada}`);
      partes.push(`🔍 Leitura automática da mensagem — ${bits.join(' · ')}`);
    }
    if(!partes.length){
      bar.classList.remove('show');
      bar.textContent = '';
      return;
    }
    bar.textContent = partes.join('  ·  ');
    bar.classList.add('show');
  }

  // ---------- Leitura automática de estágio + emoção ----------
  //
  // Mesma classificação (mesmo prompt) que o botão "🔍 Sugerir estágio com
  // IA" já usa no fluxo principal (ver sugerirEstagioComIA, panel.js). Não
  // muda estágio salvo de nenhum lead — é só a leitura de apoio pra calibrar
  // a resposta deste chat e pra ficar registrada junto dela no Histórico do
  // Bot.
  //
  // Prioridade: nível básico/gratuito do Gemini (ver resolverCredenciaisGemini)
  // — é uma classificação simples, não precisa do modelo mais caro. MAS:
  // diferente do botão manual acima (que avisa e manda pra Configurações se
  // faltar chave, porque foi um clique explícito), esta leitura roda sozinha
  // a cada mensagem — sem provedor nenhum configurado, ela só teria que
  // ficar quieta pra sempre. Por isso, se não houver NENHUMA chave do Gemini
  // cadastrada, cai pro provedor principal que a instalação realmente tem
  // configurado (Claude, no modelo econômico se houver um definido) em vez
  // de desistir — uma instalação 100% Claude não perde este recurso só por
  // não ter Gemini cadastrado.
  // Delega inteiramente pra classificarEstagioEmocaoComIA (panel.js,
  // carregado antes deste arquivo) — é a MESMA classificação (mesmo
  // prompt, mesmo fallback Gemini→Claude) que o botão 🔍 "Sugerir estágio
  // com IA" do painel principal usa, só que aqui aplicada ao texto desta
  // mensagem do chat em vez do texto colado no painel. Ver
  // promptClassificadorEstagioEmocao/classificarEstagioEmocaoComIA em
  // panel.js pra não duplicar essa lógica em dois arquivos.
  async function classificarEstagioEmocao(texto){
    if(!texto) return null;
    if(typeof classificarEstagioEmocaoComIA !== 'function') return null;
    return classificarEstagioEmocaoComIA(texto);
  }

  // Classificação disparada pelo paste (ver detectarEstagioEmocaoChat) que
  // ainda está em voo — permite que garantirLeituraEstagioParaEnvio
  // reaproveite essa MESMA chamada, em vez de disparar uma segunda, se a
  // pessoa colar e apertar Enter rápido demais (antes do preview do paste
  // terminar). Sem isto, as duas rodam em paralelo pro mesmo texto e uma
  // delas é gasto de token jogado fora (o resultado dela é descartado de
  // qualquer forma, ver comentário abaixo).
  let _leituraEstagioEmVooTexto = '';
  let _leituraEstagioEmVooPromise = null;

  // Dispara sozinha assim que um texto é COLADO na caixa deste chat — é só
  // um preview antecipado (roda de novo, com garantia, no momento do envio
  // — ver garantirLeituraEstagioParaEnvio), então aqui pode simplesmente
  // descartar o resultado se a pessoa já mudou de ideia enquanto classificava.
  async function detectarEstagioEmocaoChat(texto){
    if(!texto || chatEstagioManual) return; // com estágio fixado manualmente, não há o que detectar
    _leituraEstagioEmVooTexto = texto;
    _leituraEstagioEmVooPromise = classificarEstagioEmocao(texto);
    const resultado = await _leituraEstagioEmVooPromise;
    if(_leituraEstagioEmVooTexto === texto) _leituraEstagioEmVooPromise = null;
    if(!resultado) return;
    // Se a pessoa já apagou/trocou o texto colado enquanto a classificação
    // rodava, a leitura não bate mais com o que está na caixa — descarta.
    if(elInput().value.trim() !== texto) return;
    chatEstagioDetectado = resultado.estagio;
    chatEmocaoDetectada = resultado.emocao;
    chatEstagioDetectadoOrigemTexto = texto;
    atualizarBarraDeContexto();
  }

  // Roda pra TODA mensagem enviada (digitada ou colada), pra garantir que a
  // resposta seja calibrada no estágio certo mesmo se a pessoa nunca colou
  // nada (só digitou a pergunta). Se já existe uma leitura automática fresca
  // pra este EXATO texto (ex.: acabou de colar e o preview acima já rodou),
  // não classifica de novo — evita gastar token à toa.
  async function garantirLeituraEstagioParaEnvio(texto){
    if(chatEstagioManual){
      chatEstagioDetectado = chatEstagioManual;
      return;
    }
    if(chatEstagioDetectadoOrigemTexto === texto) return;
    // Colar e enviar rápido demais: o preview do paste (detectarEstagioEmocaoChat)
    // ainda não terminou pra este mesmo texto — reaproveita a chamada já em
    // voo em vez de começar uma segunda igual.
    const resultado = (_leituraEstagioEmVooTexto === texto && _leituraEstagioEmVooPromise)
      ? await _leituraEstagioEmVooPromise
      : await classificarEstagioEmocao(texto);
    chatEstagioDetectado = resultado ? resultado.estagio : null;
    chatEmocaoDetectada = resultado ? resultado.emocao : null;
    chatEstagioDetectadoOrigemTexto = texto;
  }

  // Seletor manual na barra de contexto do chat: "🤖 Automático" (padrão) ou
  // um estágio fixo do funil, pra quando a leitura automática não bater e a
  // atendente quiser garantir a etapa certa sem precisar corrigir a cada
  // mensagem.
  function popularSeletorEstagio(){
    const select = elEstagioSelect();
    if(!select || typeof ESTAGIO_ORDER === 'undefined') return;
    select.innerHTML = '<option value="">🤖 Automático — a IA lê pela mensagem</option>' +
      ESTAGIO_ORDER.map(e => `<option value="${e}">${e}</option>`).join('');
  }

  function onEstagioManualChange(){
    const select = elEstagioSelect();
    chatEstagioManual = select ? (select.value || '') : '';
    if(chatEstagioManual){
      chatEstagioDetectado = chatEstagioManual;
      chatEmocaoDetectada = null; // sem leitura de emoção quando o estágio é fixado manualmente
    }else{
      chatEstagioDetectado = null;
      chatEmocaoDetectada = null;
      chatEstagioDetectadoOrigemTexto = '';
    }
    atualizarBarraDeContexto();
  }

  // Volta o seletor pro estado inicial ("Automático") — chamado ao trocar
  // de lead (ver carregarHistoricoBotChat), já que um estágio fixado
  // manualmente é sobre a CONVERSA com aquele lead específico, não deve
  // seguir pro próximo.
  function resetEstagioManual(){
    chatEstagioManual = '';
    chatEstagioDetectado = null;
    chatEmocaoDetectada = null;
    chatEstagioDetectadoOrigemTexto = '';
    const select = elEstagioSelect();
    if(select) select.value = '';
  }

  // Bloco estático da tarefa deste chat — reaproveita o mesmíssimo bloco de
  // negócio/funil (buildBlocoEstaticoFunil, de panel.js) que os outros dois
  // botões usam, então continua batendo com o MESMO cache de prompt já
  // aquecido por eles (ver comentário original em buildFollowupPrompt).
  function buildChatCachedSystem(){
    return `${buildBlocoEstaticoFunil()}

TAREFA:
Você está batendo um papo rápido e livre, em texto corrido, com a profissional/atendente que usa este copiloto — não é a mensagem de um lead colada do WhatsApp, é uma pergunta ou pedido DELA pra você (ex: "como eu abordo esse lead agora?", "como respondo essa objeção de preço?", "me dá uma ideia de follow-up"). Use o contexto do lead abaixo (se houver) pra calibrar a resposta às INSTRUÇÕES GERAIS DE COMO USAR O FUNIL definidas acima. Responda em texto corrido, direto e curto (no máximo 3 parágrafos curtos), SEM JSON e sem markdown. Quando fizer sentido, inclua dentro da própria resposta a mensagem pronta pra copiar e colar no WhatsApp.

IDENTIDADE DESTE CHAT: aqui (só neste chat rápido, não nas mensagens que você sugere pro WhatsApp) você é o "C&S - BOT", o assistente de IA deste copiloto de vendas — trate-se sempre no masculino ("estou", "pronto", "certeza disso" etc, nunca "estou pronta" ou variação no feminino). Se a atendente perguntar seu nome, quem você é, ou pedir sua versão, responda como C&S - BOT${versaoAtual() ? ` (versão ${versaoAtual()})` : ''} — sem inventar outro nome. Se perguntarem quem te desenvolveu, quem te criou, ou quem é o desenvolvedor, responda que foi Samuel D S Teixeira, CEO da C&S — sem inventar outro nome. Se perguntarem qual é o motor de inteligência por trás de você, qual IA te dá inteligência, ou qual modelo você usa, responda que roda sobre a API do ${providerSettings.provider === 'claude' ? 'Claude, da Anthropic' : 'Gemini, do Google'} — o provedor configurado agora nas Configurações deste Co-piloto (Configurações → Provedor de IA); se um dia o provedor for trocado lá, você passa a rodar sobre o outro — sem inventar outro nome de modelo nem de empresa.

DÚVIDAS SOBRE O CO-PILOTO (não sobre o lead/venda): se o contexto abaixo trouxer um bloco "CONTEÚDO DE AJUDA", ele veio do próprio guia "Como usar o copiloto" ou da tela de "Privacidade" desta extensão — é fonte confiável, responda a dúvida usando ele, sem inventar nada além do que está escrito ali. Se a pergunta for sobre como usar o Co-piloto ou sobre privacidade e NENHUM bloco desses vier no contexto, é sinal de que a busca automática não achou a seção certa — diga isso com honestidade e sugira abrir "📖 Como usar o copiloto" ou "🔒 Privacidade" na barra lateral, em vez de arriscar uma resposta inventada.`;
  }

  // ---------- Busca da seção certa em "Como usar"/"Privacidade" (sem IA) ----------
  //
  // Objetivo: deixar TODO o conteúdo de ajuda "consultável" pelo bot sem
  // colar o guia inteiro (~20 mil caracteres) e a Privacidade inteira (~10
  // mil) no prompt fixo de toda mensagem — isso quase dobraria o bloco hoje
  // cacheado (o funil já tem ~35 mil) e encareceria toda GRAVAÇÃO de cache
  // (a cada expiração de 1h), não só a mensagem que precisasse da ajuda.
  // Em vez disso: um casamento de palavras-chave, em JavaScript puro (zero
  // chamada de IA, zero custo), decide SE e QUAL seção entra — e só entra
  // no contexto DINÂMICO desta mensagem específica (nunca no bloco
  // cacheado), então perguntas sobre o lead/venda (a grande maioria) não
  // pagam nada por este recurso existir.
  //
  // Lê direto do DOM (accordion de #helpBody, divs .privacidade-secao de
  // #privacidadeModalOverlay) em vez de duplicar o texto aqui — uma fonte
  // só: editar a ajuda ou a privacidade na tela já atualiza o que o bot lê,
  // sem precisar lembrar de mexer em dois lugares.
  // Só formas SEM acento — palavrasRelevantes() já normaliza (tira acento)
  // antes de comparar, então uma entrada acentuada aqui nunca bateria com
  // nada.
  const STOPWORDS_AJUDA = new Set(['de','da','do','das','dos','e','o','a','os','as','um','uma','uns','umas','para','pra','pro','por','com','sem','que','se','no','na','nos','nas','ao','aos','e','sao','foi','ser','tem','seu','sua','seus','suas','meu','minha','este','esta','isso','isto','como','quando','onde','qual','quais','mais','muito','tambem','nao','sim','ou','mas','ja','ainda','entao','ai','ali','la','aqui','voce','vc','eu','ele','ela','eles','elas','nos','me','te','lhe','aquele','aquela','the','of']);

  function normalizarTextoAjuda(s){
    return (s || '')
      // tira acento (café -> cafe), pra "é"/"e" etc não atrapalharem o
      // casamento — \u0300-\u036f é a faixa Unicode dos acentos "soltos"
      // que o normalize('NFD') separa da letra base.
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function palavrasRelevantes(texto){
    return normalizarTextoAjuda(texto)
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 3 && !STOPWORDS_AJUDA.has(w));
  }

  // Tags que a resposta direta do guia (ver renderMensagem/opts.html) pode
  // exibir formatadas — negrito, parágrafos, listas, igual já aparece nos
  // modais de "Como usar"/"Privacidade". Qualquer outra tag encontrada (ex.:
  // os links internos "<a class=help-goto>" de navegação entre seções, que
  // não fazem sentido dentro do chat) tem só o envoltório descartado; o
  // conteúdo de dentro continua.
  const TAGS_PERMITIDAS_AJUDA = new Set(['P', 'B', 'STRONG', 'I', 'EM', 'UL', 'OL', 'LI', 'BR', 'CODE']);

  // Reconstrói o HTML de um nó só com as tags do allowlist acima, texto
  // sempre escapado — nunca copia innerHTML bruto nem qualquer atributo.
  // A origem é sempre o NOSSO próprio HTML estático (#helpBody/
  // #privacidadeModalOverlay, nunca lead/IA/texto digitado por alguém),
  // então isto é uma camada extra de segurança, não uma defesa contra
  // conteúdo hostil de verdade — mas evita que qualquer coisa fora do
  // esperado (um id, uma classe, um atributo) vaze pro innerHTML da bolha
  // do chat.
  function serializarNosHtmlSeguroAjuda(nos){
    let html = '';
    nos.forEach(filho => {
      if(filho.nodeType === Node.TEXT_NODE){
        const texto = filho.textContent.replace(/\s+/g, ' ');
        if(!texto.trim()) return; // espaço "decorativo" do HTML de origem entre tags, não é conteúdo
        html += escapeHtml(texto);
        return;
      }
      if(filho.nodeType !== Node.ELEMENT_NODE) return;
      const tag = filho.tagName;
      if(tag === 'BR'){ html += '<br>'; return; }
      if(TAGS_PERMITIDAS_AJUDA.has(tag)){
        const tagMin = tag.toLowerCase();
        html += `<${tagMin}>${serializarNosHtmlSeguroAjuda(Array.from(filho.childNodes))}</${tagMin}>`;
        return;
      }
      html += serializarNosHtmlSeguroAjuda(Array.from(filho.childNodes));
    });
    return html;
  }
  function serializarHtmlSeguroAjuda(node){
    return serializarNosHtmlSeguroAjuda(Array.from(node.childNodes));
  }

  // Memoizado: o conteúdo de #helpBody/#privacidadeModalOverlay não muda em
  // tempo de execução (só se a extensão for atualizada, o que já recarrega
  // a página) — não faz sentido varrer o DOM de novo a cada mensagem.
  let _secoesAjudaCache = null;
  function coletarSecoesAjuda(){
    if(_secoesAjudaCache) return _secoesAjudaCache;
    const secoes = [];

    document.querySelectorAll('#helpBody .accordion-item[id^="helpSecao"]').forEach(item => {
      const tituloEl = item.querySelector('.accordion-title');
      const corpoEl = item.querySelector('.accordion-panel');
      if(!tituloEl || !corpoEl) return;
      const titulo = tituloEl.textContent.trim();
      secoes.push({
        origem: 'Como usar o co-piloto',
        titulo,
        texto: corpoEl.textContent.replace(/\s+/g, ' ').trim(),
        // Mesmo conteúdo de `texto` acima, só que preservando negrito/
        // parágrafos/listas — usado pra exibir a resposta direta formatada
        // (ver renderMensagem/opts.html); `texto` continua sendo o que vai
        // pro histórico e pro prompt da IA (não precisa de HTML ali).
        html: serializarHtmlSeguroAjuda(corpoEl),
        palavrasTitulo: palavrasRelevantes(titulo)
      });
    });

    document.querySelectorAll('#privacidadeModalOverlay .privacidade-secao').forEach(item => {
      const titulo = (item.dataset.titulo || '').trim();
      if(!titulo) return;
      // O primeiro elemento de cada .privacidade-secao já é o próprio
      // título em negrito, repetido de propósito no HTML de origem (é a
      // mesma convenção nas 8 seções de Privacidade) — como o chat mostra
      // o título separado (a partir de data-titulo, acima), pula esse
      // primeiro elemento pra não repetir a mesma linha duas vezes na
      // resposta.
      const primeiroElemento = item.children[0];
      const nosSemTitulo = Array.from(item.childNodes).filter(n => n !== primeiroElemento);
      secoes.push({
        origem: 'Privacidade e proteção de dados',
        titulo,
        texto: nosSemTitulo.map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim(),
        html: serializarNosHtmlSeguroAjuda(nosSemTitulo),
        palavrasTitulo: palavrasRelevantes(titulo)
      });
    });

    _secoesAjudaCache = secoes;
    return secoes;
  }

  // Pontua cada seção pelas palavras da pergunta: bater no TÍTULO vale mais
  // (é o resumo do assunto da seção) do que bater espalhado no corpo do
  // texto. Só a seção de maior pontuação entra no contexto — e só se
  // passar de um mínimo (LIMIAR_RELEVANCIA), pra "oi" ou uma pergunta sobre
  // o lead não acabarem casando por acaso com alguma palavra solta de
  // alguma seção.
  const PESO_TITULO = 3;
  const PESO_CORPO = 1;
  const LIMIAR_RELEVANCIA = 3;

  function encontrarSecaoAjudaRelevante(mensagem){
    const palavrasQuery = palavrasRelevantes(mensagem);
    if(!palavrasQuery.length) return null;

    let melhor = null;
    let melhorPontuacao = 0;
    coletarSecoesAjuda().forEach(secao => {
      const corpoNormalizado = normalizarTextoAjuda(secao.texto);
      let pontuacao = 0;
      palavrasQuery.forEach(palavra => {
        if(secao.palavrasTitulo.includes(palavra)) pontuacao += PESO_TITULO;
        else if(corpoNormalizado.includes(palavra)) pontuacao += PESO_CORPO;
      });
      if(pontuacao > melhorPontuacao){
        melhorPontuacao = pontuacao;
        melhor = secao;
      }
    });

    return melhorPontuacao >= LIMIAR_RELEVANCIA ? melhor : null;
  }

  // Lê a versão direto do manifest.json (nunca hardcoded aqui), pra nunca
  // ficar desatualizada sozinha quando a extensão for atualizada — mesma
  // fonte usada no badge "Como usar o copiloto" (ver openHelpModal em
  // panel.js).
  function versaoAtual(){
    try{
      return chrome.runtime.getManifest().version;
    }catch(e){
      return '';
    }
  }

  // Contexto dinâmico: dados do lead selecionado (reaproveita
  // buildContextoDinamicoBloco, de panel.js) + o histórico desta conversa de
  // chat até agora, já que aqui — diferente do "Gerar resposta" — a
  // conversa pode ter várias idas e voltas. `mensagemUsuario` é usada só
  // pra buscar (ver encontrarSecaoAjudaRelevante acima) uma seção de ajuda
  // relevante pra ESTA mensagem — nunca entra no bloco cacheado, só aqui.
  function buildChatDynamicContext(lead, mensagemUsuario, secaoAjudaConhecida){
    const base = lead
      ? buildContextoDinamicoBloco(lead, nomeParaExibir(lead), '', '')
      : 'CONTEXTO ATUAL: nenhum lead está selecionado no painel agora — responda de forma genérica, sem inventar dados de um lead específico.';

    // Estágio desta mensagem: fixado manualmente pela atendente (ver
    // onEstagioManualChange) ou lido automaticamente pela IA na própria
    // mensagem que está sendo enviada agora (ver
    // garantirLeituraEstagioParaEnvio) — os dois casos usam
    // chatEstagioDetectado, só muda a instrução de quanto confiar nisso.
    const deteccao = chatEstagioManual
      ? `\n\nESTÁGIO DESTA CONVERSA (fixado manualmente pela atendente — siga como referência principal, não é palpite da IA): ${chatEstagioManual}.`
      : (chatEstagioDetectado || chatEmocaoDetectada)
        ? `\n\nLEITURA AUTOMÁTICA DESTA MENSAGEM: estágio identificado = ${chatEstagioDetectado || 'não identificado'}; emoção do cliente = ${chatEmocaoDetectada || 'não identificada'}. É uma leitura automática feita a partir do texto desta mensagem — use como apoio pra calibrar o tom e a etapa da sua resposta.`
        : '';

    // Só entra se a busca por palavra-chave achou uma seção de ajuda
    // relevante pra ESTA mensagem (ver encontrarSecaoAjudaRelevante) — na
    // maioria das mensagens (sobre o lead/venda, não sobre o Co-piloto em
    // si) isto fica vazio e não adiciona nenhum token. secaoAjudaConhecida
    // deixa reaproveitar um resultado já calculado por quem chamou (ver
    // enviarMensagemChat, que já roda esta mesma busca antes de decidir se
    // cai no fluxo de IA) em vez de varrer todas as seções de novo — usa
    // `undefined` (padrão) pra "ainda não sei, calcule agora".
    const secaoAjuda = secaoAjudaConhecida !== undefined ? secaoAjudaConhecida : encontrarSecaoAjudaRelevante(mensagemUsuario);
    const blocoAjuda = secaoAjuda
      ? `\n\nCONTEÚDO DE AJUDA (seção "${secaoAjuda.titulo}", de "${secaoAjuda.origem}" — use como fonte se a pergunta for sobre isso, ignore se não for):\n${secaoAjuda.texto}`
      : '';

    if(!chatHistorico.length) return base + deteccao + blocoAjuda;

    const historicoTexto = chatHistorico
      .map(m => `${m.role === 'user' ? 'Atendente' : 'Você'}: ${m.texto}`)
      .join('\n');
    return `${base}${deteccao}${blocoAjuda}\n\nHISTÓRICO DESTA CONVERSA DE CHAT (mais antigas primeiro):\n${historicoTexto}`;
  }

  async function pedirRespostaIA(mensagemUsuario, secaoAjudaConhecida){
    const provider = providerSettings.provider;
    const key = provider === 'claude'
      ? providerSettings.claudeKey
      : (providerSettings.geminiKeyBasico || providerSettings.geminiKeyAvancado);
    if(!key){
      const err = new Error('Configure sua chave de API primeiro (clique na engrenagem)');
      err.semChave = true;
      throw err;
    }

    const lead = leadAtualParaChat();
    // callClaudeComTier/callGeminiComTier esperam um lead com .fixo/.estagio
    // pra decidir o tier (ver escolherTierPorEstagio em panel.js) — sem
    // lead selecionado, usa um objeto mínimo equivalente a "Primeiro
    // contato", que sempre resolve pro nível econômico (o mais barato,
    // adequado pra um papo livre sem lead nenhum aberto).
    const leadParaTier = lead || { fixo: false, estagio: 'Primeiro contato' };

    const cachedSystem = buildChatCachedSystem();
    const dynamicContext = buildChatDynamicContext(lead, mensagemUsuario, secaoAjudaConhecida);

    const parsed = provider === 'claude'
      ? await callClaudeComTier(cachedSystem, dynamicContext, mensagemUsuario, leadParaTier)
      : await callGeminiComTier(cachedSystem, dynamicContext, mensagemUsuario, leadParaTier);

    // parseJsonSafely (panel.js) já devolve o texto puro em
    // resposta_sugerida quando a IA não manda JSON — que é o caso normal
    // aqui, já que o prompt acima pede texto corrido. `meta` (qual
    // chave/modelo respondeu — ver anexarMetaRoteamento em panel.js) vai
    // junto pra renderMensagem poder mostrar a legenda, mesma visibilidade
    // que o painel principal ganhou.
    return {
      texto: textoDaIA(parsed.resposta_sugerida) || '(a IA não retornou nenhum texto)',
      meta: parsed._roteamento || null
    };
  }

  function renderMensagem(role, texto, opts){
    opts = opts || {};
    const box = elMessages();
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (role === 'user' ? 'user' : 'ai') + (opts.erro ? ' error' : '') + (opts.loading ? ' loading' : '');
    if(opts.html){
      // Só usado pela resposta direta do guia "Como usar"/"Privacidade" (ver
      // enviarMensagemChat) — HTML sempre montado por
      // serializarHtmlSeguroAjuda a partir do NOSSO próprio HTML estático
      // (nunca de lead, IA ou texto digitado por alguém), restrito a uma
      // allowlist de tags. Todo o resto do chat (mensagem do usuário,
      // resposta da IA, erros) continua em texto puro via textContent — a
      // defesa contra XSS que o chat sempre teve não muda pra esses casos.
      div.innerHTML = opts.html;
    }else{
      div.textContent = texto;
    }
    if(opts.id) div.id = opts.id;
    box.appendChild(div);

    if(role === 'ai' && !opts.erro && !opts.loading){
      const copiarBtn = document.createElement('button');
      copiarBtn.type = 'button';
      copiarBtn.className = 'chat-copy-btn';
      copiarBtn.textContent = 'Copiar';
      copiarBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(texto)
          .then(() => toast('Copiado — cola no WhatsApp'))
          .catch(() => toast('Não consegui copiar — selecione e copie manualmente'));
      });
      box.appendChild(copiarBtn);

      // Legenda pequena embaixo da resposta — ou um texto fixo (opts.legenda,
      // ex.: "📖 Direto do guia — sem usar IA", ver enviarMensagemChat) ou,
      // na ausência dele, qual chave/modelo respondeu de verdade (ver
      // labelRoteamentoIA/anexarMetaRoteamento, panel.js) — mesma
      // visibilidade que "Gerar resposta"/"Sugerir follow-up" ganharam no
      // painel principal.
      const textoLegenda = opts.legenda || (opts.meta && typeof labelRoteamentoIA === 'function' ? labelRoteamentoIA(opts.meta) : '');
      if(textoLegenda){
        const legenda = document.createElement('div');
        legenda.className = 'chat-roteamento-info';
        legenda.textContent = textoLegenda;
        box.appendChild(legenda);
      }
    }

    box.scrollTop = box.scrollHeight;
    return div;
  }

  // Registra uma troca (pergunta + resposta) no Histórico do Bot — usada
  // tanto pela resposta gerada por IA quanto pela resposta direta do guia
  // (ver enviarMensagemChat), pra não duplicar essa lógica nos dois
  // caminhos. leadId é sempre recebido explícito de quem chama (nunca lido
  // de leadAtualParaChat() aqui dentro): entre o envio da pergunta e a
  // resposta chegar (chamada de IA, alguns segundos) a pessoa pode ter
  // trocado de lead — se essa função relesse o lead atual nesse momento,
  // salvaria a troca no histórico do lead ERRADO (ver leadIdDoEnvio em
  // enviarMensagemChat).
  function registrarTrocaNoHistoricoBot(pergunta, resposta, leadIdDaTroca, opts){
    opts = opts || {};
    const leadDaTroca = leadPorId(leadIdDaTroca);
    const entry = {
      id: 'bothist_' + Date.now(),
      quando: new Date().toISOString(),
      pergunta,
      resposta,
      leadNome: leadDaTroca ? nomeParaExibir(leadDaTroca) : '',
      estagio: opts.estagio || '',
      emocao: opts.emocao || ''
    };
    botHistorico.push(entry);
    renderBotHistoryList();
    salvarEntradaHistoricoBot(leadIdDaTroca, entry).catch(err => console.error(err));
  }

  // Timer da contagem regressiva do aviso "sem chave configurada" (ver
  // mostrarAvisoSemChave) — module-level pra fecharChatModal() poder
  // cancelar se a pessoa fechar o chat antes dos 5s acabarem (sem isso, ela
  // seria redirecionada pra Configurações "do nada" alguns segundos depois
  // de já ter saído do chat).
  let _avisoSemChaveIntervalId = null;

  function cancelarAvisoSemChave(){
    if(_avisoSemChaveIntervalId){
      clearInterval(_avisoSemChaveIntervalId);
      _avisoSemChaveIntervalId = null;
    }
  }

  // Vai direto pra seção "Provedor de IA" de Configurações (âncora no
  // próprio card — ver #cardProvedorIA em options.html) em vez de só abrir
  // a tela no topo, já que o problema específico é exatamente essa seção.
  function abrirConfiguracoesNaSecaoProvedor(){
    window.location.href = 'options.html#cardProvedorIA';
  }

  // Mostra o aviso de "nenhuma chave configurada" com contagem regressiva
  // de 5s antes de redirecionar sozinho pra Configurações → Provedor de IA
  // — em vez do redirecionamento imediato de antes (que não dava nem tempo
  // da pessoa ler a mensagem de erro). "Ir agora" pula a espera pra quem
  // não quiser contar.
  function mostrarAvisoSemChave(){
    const box = elMessages();
    // Se a pessoa mandar outra pergunta que também precise de IA enquanto o
    // aviso anterior ainda está contando (nada impede reenviar — chatOcupado
    // volta a false depois de um erro), remove o aviso antigo em vez de
    // empilhar um segundo: só o timer mais novo rodava mesmo (ver
    // cancelarAvisoSemChave logo abaixo), então o antigo ficava com o texto
    // da contagem congelado pra sempre.
    const avisoAntigo = document.getElementById('chatAvisoSemChaveMsg');
    if(avisoAntigo) avisoAntigo.remove();

    const div = document.createElement('div');
    div.id = 'chatAvisoSemChaveMsg';
    div.className = 'chat-msg ai error';
    const textoEl = document.createElement('div');
    div.appendChild(textoEl);
    const irAgoraBtn = document.createElement('button');
    irAgoraBtn.type = 'button';
    irAgoraBtn.className = 'chat-copy-btn';
    irAgoraBtn.textContent = 'Ir agora';
    div.appendChild(irAgoraBtn);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;

    let restante = 5;
    const atualizarTexto = () => {
      textoEl.textContent = `🔑 Nenhuma chave de API configurada ainda — te levando para Configurações → Provedor de IA em ${restante}s...`;
    };
    atualizarTexto();

    const ir = () => {
      cancelarAvisoSemChave();
      abrirConfiguracoesNaSecaoProvedor();
    };
    irAgoraBtn.addEventListener('click', ir);

    cancelarAvisoSemChave(); // nunca dois contadores rodando ao mesmo tempo
    _avisoSemChaveIntervalId = setInterval(() => {
      restante -= 1;
      if(restante <= 0){
        ir();
        return;
      }
      atualizarTexto();
    }, 1000);
  }

  async function enviarMensagemChat(){
    if(chatOcupado) return;
    const input = elInput();
    const texto = input.value.trim();
    if(!texto) return;

    // Lead a que ESTA pergunta pertence, capturado antes de qualquer
    // espera assíncrona. A resposta (chamada de IA, alguns segundos) pode
    // demorar mais que o tempo até a pessoa fechar o chat e trocar de
    // lead — sem isto, tanto a gravação no Histórico do Bot quanto a
    // renderização da resposta aconteceriam sob o lead ERRADO (ver
    // aindaNoMesmoLead mais abaixo e registrarTrocaNoHistoricoBot).
    const leadIdDoEnvio = (leadAtualParaChat() || {}).id || null;

    chatOcupado = true;
    elSend().disabled = true;
    input.value = '';
    input.style.height = 'auto';

    renderMensagem('user', texto);
    chatHistorico.push({ role: 'user', texto });

    // Pergunta claramente sobre o próprio Co-piloto (achou uma seção de
    // ajuda bem casada — ver encontrarSecaoAjudaRelevante) responde direto
    // do guia "Como usar"/"Privacidade", sem gastar IA nenhuma — funciona
    // mesmo sem nenhuma chave de API configurada. Só perguntas SEM uma
    // seção clara (a maioria: sobre o lead/venda) seguem pro fluxo de IA
    // normal, logo abaixo. Sem nenhum await entre o clique e este ponto,
    // não há risco de troca de lead no meio do caminho aqui.
    const secaoAjudaDireta = encontrarSecaoAjudaRelevante(texto);
    if(secaoAjudaDireta){
      // respostaDireta (texto puro) é o que vai pro histórico salvo e pro
      // contexto da conversa — respostaDiretaHtml (negrito/parágrafos/listas
      // preservados, ver serializarHtmlSeguroAjuda) é só pra exibição AGORA
      // na bolha do chat, mais fácil de ler. Mesmo conteúdo, duas
      // apresentações — nenhuma palavra muda entre as duas.
      const respostaDireta = `${secaoAjudaDireta.titulo}\n\n${secaoAjudaDireta.texto}`;
      const respostaDiretaHtml = `<p><b>${escapeHtml(secaoAjudaDireta.titulo)}</b></p>${secaoAjudaDireta.html}`;
      renderMensagem('ai', respostaDireta, { legenda: `📖 Direto de "${secaoAjudaDireta.origem}" — sem usar IA`, html: respostaDiretaHtml });
      chatHistorico.push({ role: 'ai', texto: respostaDireta });
      registrarTrocaNoHistoricoBot(texto, respostaDireta, leadIdDoEnvio);
      // Esta resposta não precisou de chave nenhuma — mas se um aviso de
      // "sem chave" de uma pergunta ANTERIOR ainda estiver contando (ver
      // mostrarAvisoSemChave), sem cancelar aqui ele dispararia sozinho
      // daqui a pouco e navegaria pra Configurações mesmo a pessoa
      // acabando de receber uma resposta útil, sem ter pedido isso.
      cancelarAvisoSemChave();
      chatOcupado = false;
      elSend().disabled = false;
      input.focus();
      return;
    }

    const loadingEl = renderMensagem('ai', 'digitando...', { loading: true, id: 'chatLoadingMsg' });

    try{
      // Garante uma leitura de estágio/emoção pra ESTA mensagem antes de
      // gerar a resposta (automática, lendo a própria mensagem — ou a fixada
      // manualmente no seletor) — ver garantirLeituraEstagioParaEnvio.
      await garantirLeituraEstagioParaEnvio(texto);
      atualizarBarraDeContexto();

      // secaoAjudaDireta já foi calculada logo acima (e é sempre null aqui —
      // se tivesse achado uma seção, já teria retornado antes) — repassa em
      // vez de deixar pedirRespostaIA/buildChatDynamicContext varrerem as
      // seções de ajuda de novo pra chegar no mesmo resultado.
      const { texto: resposta, meta: metaRoteamento } = await pedirRespostaIA(texto, secaoAjudaDireta);
      loadingEl.remove();
      // Resposta da IA veio com sucesso — se havia um aviso de "sem chave"
      // de uma pergunta anterior ainda contando, não faz mais sentido
      // nenhum ele navegar pra Configurações sozinho daqui a pouco.
      cancelarAvisoSemChave();

      // Depois dos awaits acima é que checamos se ainda estamos no mesmo
      // lead de quando a pergunta foi enviada — se a pessoa trocou de lead
      // nesse meio tempo, #chatMessagesBox/chatHistorico já são de OUTRA
      // conversa agora: gravamos a resposta no histórico do lead certo
      // (leadIdDoEnvio) mas não a despejamos na tela de quem está sendo
      // vista agora.
      const leadIdAgora = (leadAtualParaChat() || {}).id || null;
      const aindaNoMesmoLead = leadIdAgora === leadIdDoEnvio;

      if(aindaNoMesmoLead){
        renderMensagem('ai', resposta, { meta: metaRoteamento });
        chatHistorico.push({ role: 'ai', texto: resposta });
      }else if(typeof toast === 'function'){
        toast('Uma resposta pendente de outro lead chegou e foi salva no histórico dele');
      }
      if(typeof incrementUsage === 'function') await incrementUsage();

      // Registra esta troca no Histórico do Bot do lead a que ela pertence
      // (persistente) — junto com a leitura automática de estágio/emoção,
      // se houve alguma pra esta mensagem (ver detectarEstagioEmocaoChat).
      // Sempre usa leadIdDoEnvio, nunca o lead atual (ver comentário acima).
      registrarTrocaNoHistoricoBot(texto, resposta, leadIdDoEnvio, {
        estagio: chatEstagioDetectado || '',
        emocao: chatEmocaoDetectada || ''
      });
    }catch(err){
      loadingEl.remove();
      if(err.semChave){
        // Não é uma informação específica deste lead (é config da
        // extensão inteira) — continua valendo mostrar mesmo que a pessoa
        // já tenha trocado de lead enquanto isto rodava.
        mostrarAvisoSemChave();
      }else{
        const leadIdAgora = (leadAtualParaChat() || {}).id || null;
        if(leadIdAgora === leadIdDoEnvio){
          renderMensagem('ai', 'Erro: ' + err.message, { erro: true });
        }
        console.error(err);
      }
    }finally{
      // Automático: a leitura vale só pra pergunta que acabou de ser
      // enviada — some daqui pra frente até a próxima mensagem (nova
      // leitura roda de novo no próximo envio, ver
      // garantirLeituraEstagioParaEnvio). Manual: continua valendo pras
      // próximas mensagens desta conversa, até a atendente trocar no
      // seletor ou trocar de lead.
      if(!chatEstagioManual){
        chatEstagioDetectado = null;
        chatEmocaoDetectada = null;
        chatEstagioDetectadoOrigemTexto = '';
      }
      atualizarBarraDeContexto();
      chatOcupado = false;
      elSend().disabled = false;
      input.focus();
    }
  }

  function abrirChatModal(){
    atualizarBarraDeContexto();
    const badge = document.getElementById('chatVersionBadgeText');
    if(badge) badge.textContent = 'v' + (versaoAtual() || '—');
    elOverlay().style.display = 'flex';
    document.body.classList.add('modal-open');
    elInput().focus();
    elMessages().scrollTop = elMessages().scrollHeight;
  }

  function fecharChatModal(){
    elOverlay().style.display = 'none';
    document.body.classList.remove('modal-open');
    // Sem isto, fechar o chat antes dos 5s do aviso "sem chave" acabar
    // (ver mostrarAvisoSemChave) ainda redirecionava pra Configurações
    // alguns segundos depois — "do nada", já que a pessoa nem estava mais
    // olhando pro chat.
    cancelarAvisoSemChave();
  }

  function init(){
    elBtn().addEventListener('click', abrirChatModal);
    document.getElementById('chatModalCloseBtn').addEventListener('click', fecharChatModal);
    bindOverlayClose('chatModalOverlay', fecharChatModal);

    elSend().addEventListener('click', enviarMensagemChat);
    elInput().addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        enviarMensagemChat();
      }
    });
    // Cresce junto com o texto digitado, até o limite definido em CSS
    // (.chat-input{max-height}) — depois disso passa a rolar por dentro.
    elInput().addEventListener('input', () => {
      const el = elInput();
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    });

    // Leitura automática de estágio + emoção assim que algo é COLADO nesta
    // caixa (ver detectarEstagioEmocaoChat) — o evento 'paste' dispara
    // ANTES do texto colado entrar de fato no campo, então lê o valor um
    // instante depois (setTimeout 0), já com o conteúdo colado presente.
    elInput().addEventListener('paste', () => {
      setTimeout(() => {
        const texto = elInput().value.trim();
        if(texto) detectarEstagioEmocaoChat(texto);
      }, 0);
    });

    // Seletor manual de estágio, na barra de contexto do chat (ver
    // popularSeletorEstagio/onEstagioManualChange).
    popularSeletorEstagio();
    const estagioSelect = elEstagioSelect();
    if(estagioSelect) estagioSelect.addEventListener('change', onEstagioManualChange);

    const clearBotHistBtn = document.getElementById('clearBotHistoryBtn');
    if(clearBotHistBtn) clearBotHistBtn.addEventListener('click', clearBotHistory);
    const botHistorySearchInput = document.getElementById('botHistorySearchInput');
    if(botHistorySearchInput){
      botHistorySearchInput.addEventListener('input', (e) => {
        botHistorySearchQuery = e.target.value;
        renderBotHistoryList();
      });
    }
    const botHistoryListBox = document.getElementById('botHistoryList');
    if(botHistoryListBox){
      botHistoryListBox.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.hist-del-btn');
        if(!delBtn) return;
        deleteBotHistoryEntry(delBtn.dataset.id);
      });
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }

  // ---------- Histórico do Bot (persistente, POR LEAD) ----------
  //
  // Guarda toda troca (pergunta da atendente + resposta da IA) deste chat
  // rápido — mesma criptografia que "Histórico de respostas" já usa (ver
  // cifrarHistoricoParaSalvar / decifrarHistoricoEmMemoria, panel.js), só
  // que numa chave própria POR LEAD (mesmo padrão de historyKey em
  // panel.js) — cada lead só vê as conversas tidas sobre ele. Quando
  // nenhum lead está selecionado, cai num balde à parte (_sem_lead).
  // Sobrevive a fechar o modal e a recarregar a página, e troca de conteúdo
  // sozinho ao trocar de lead no painel (ver window.carregarHistoricoBotChat,
  // chamado por selectLead/goToHome/deleteLead em panel.js). Aparece na tela
  // principal, logo abaixo do card "Histórico de respostas" do lead
  // selecionado (inclusive do lead fixo @csvirtual).
  function botHistoryKey(leadId){
    return 'hist:bot_chat:' + (leadId || '_sem_lead');
  }

  // Qual lead (ou null) está carregado agora em botHistorico/na tela — usado
  // só pra saber contra qual chave salvar a próxima entrada.
  let botHistoricoLeadId = null;

  async function loadBotHistory(leadId){
    const key = botHistoryKey(leadId);
    const data = await copilotoStorage.local.get(key);
    const bruto = data[key] || [];
    return decifrarHistoricoEmMemoria(bruto, await obterDekAtivo());
  }

  // Serializado pela mesma trava usada no histórico por lead
  // (copilotoSerializarPorChave, perfis.js) — evita que dois envios quase
  // simultâneos neste chat (ex.: duas abas) pisem um no registro do outro.
  async function salvarEntradaHistoricoBot(leadId, entry){
    const key = botHistoryKey(leadId);
    return copilotoSerializarPorChave(key, async () => {
      const arr = await loadBotHistory(leadId);
      arr.push(entry);
      const dek = await obterDekAtivo();
      const paraSalvar = await cifrarHistoricoParaSalvar(arr, dek);
      await copilotoStorage.local.set({ [key]: paraSalvar });
      return arr;
    });
  }

  // Recarrega a lista exibida pro lead informado (ou pro lead atualmente
  // selecionado no painel, se nenhum id for passado — usado na primeira
  // carga, antes de qualquer seleção). Também zera a conversa em andamento
  // neste chat rápido (chatHistorico) e a tela de mensagens do modal: sem
  // isso, o contexto de um lead vazaria no prompt da IA depois de trocar de
  // lead, mesmo com o histórico salvo já correto.
  async function carregarHistoricoBotChat(leadId){
    if(typeof leadId === 'undefined'){
      const lead = leadAtualParaChat();
      leadId = lead ? lead.id : null;
    }
    leadId = leadId || null;
    botHistoricoLeadId = leadId;
    chatHistorico = [];
    // Estágio fixado manualmente (se houver) era sobre a conversa com o
    // lead anterior — não deve seguir pro próximo (ver resetEstagioManual).
    resetEstagioManual();
    // Defesa extra: se por algum caminho futuro isto rodar com o chat
    // ainda aberto e um aviso "sem chave" contando (ver mostrarAvisoSemChave),
    // não faz sentido redirecionar pra Configurações sobre uma pergunta que
    // já não está mais na tela.
    cancelarAvisoSemChave();
    const box = elMessages();
    if(box) box.innerHTML = '';
    try{
      const historico = await loadBotHistory(leadId);
      // Troca rápida de lead (duas chamadas desta função em sequência):
      // só aplica o resultado se este ainda for o lead pedido por último —
      // do contrário uma resposta antiga poderia sobrescrever a lista já
      // carregada pra um lead mais recente.
      if(botHistoricoLeadId !== leadId) return;
      botHistorico = historico;
    }catch(err){
      console.error(err);
      if(botHistoricoLeadId !== leadId) return;
      botHistorico = [];
    }
    renderBotHistoryList();
  }

  function corpoHistoricoBotHtml(h){
    if(pareceCifrado(h.pergunta) || pareceCifrado(h.resposta)){
      return '<div class="hist-block"><div class="hist-text">🔒 Protegido — sem acesso aos dados desta conversa agora.</div></div>';
    }
    return `<div class="hist-block"><span class="hist-tag">Você perguntou</span><div class="hist-text">${escapeHtml(h.pergunta||'')}</div></div>
      <div class="hist-block"><span class="hist-tag">C&S - BOT respondeu</span><div class="hist-text">${escapeHtml(h.resposta||'')}</div></div>`;
  }

  function getFilteredBotHistory(){
    const q = botHistorySearchQuery.trim().toLowerCase();
    if(!q) return botHistorico;
    return botHistorico.filter(h =>
      (h.pergunta||'').toLowerCase().includes(q) ||
      (h.resposta||'').toLowerCase().includes(q) ||
      (h.leadNome||'').toLowerCase().includes(q)
    );
  }

  function renderBotHistoryList(){
    const box = document.getElementById('botHistoryList');
    const countEl = document.getElementById('botHistoryCount');
    if(!box) return;
    const filtered = getFilteredBotHistory();
    if(countEl) countEl.textContent = botHistorico.length ? `(${botHistorico.length})` : '';
    if(!botHistorico.length){
      box.innerHTML = '<div class="hist-empty">Nenhuma conversa registrada ainda no chat rápido com o C&S - BOT para este lead.</div>';
      return;
    }
    if(!filtered.length){
      box.innerHTML = '<div class="hist-empty">Nenhuma conversa do histórico do bot bate com essa busca.</div>';
      return;
    }
    box.innerHTML = '';
    filtered.slice().reverse().forEach(h => {
      const div = document.createElement('div');
      div.className = 'hist-item';
      div.id = 'bot-hist-' + h.id;
      const chips = [];
      if(h.leadNome) chips.push(`<span class="chip teal">👤 ${escapeHtml(h.leadNome)}</span>`);
      if(h.estagio) chips.push(`<span class="chip teal">${escapeHtml(h.estagio)}</span>`);
      if(h.emocao) chips.push(`<span class="chip">😊 ${escapeHtml(h.emocao)}</span>`);
      div.innerHTML = `
        <div class="hist-head">
          <span class="hist-date">🕒 ${formatDataHora(h.quando)}</span>
          <span class="hist-chips">${chips.join('')}</span>
          <button class="hist-del-btn" data-id="${h.id}" title="Excluir esta conversa do histórico do bot">🗑</button>
        </div>
        ${corpoHistoricoBotHtml(h)}
      `;
      box.appendChild(div);
    });
  }

  // Diferente do histórico por lead, esta exclusão é direta (não passa
  // pelos "leads excluídos"/lixeira) — é um histórico de apoio da conversa
  // com a IA. Mexe só na chave do lead atualmente carregado
  // (botHistoricoLeadId), nunca nas de outros leads.
  async function deleteBotHistoryEntry(entryId){
    const confirmado = await copilotoConfirmar('Excluir esta conversa do Histórico do Bot?',
      { titulo: 'Excluir conversa?', textoConfirmar: 'Excluir' });
    if(!confirmado) return;
    botHistorico = botHistorico.filter(h => h.id !== entryId);
    try{
      const dek = await obterDekAtivo();
      const paraSalvar = await cifrarHistoricoParaSalvar(botHistorico, dek);
      await copilotoStorage.local.set({ [botHistoryKey(botHistoricoLeadId)]: paraSalvar });
    }catch(err){ console.error(err); }
    renderBotHistoryList();
    toast('Conversa excluída do Histórico do Bot 🗑️');
  }

  async function clearBotHistory(){
    if(!botHistorico.length){ toast('Não há histórico do bot para limpar'); return; }
    const confirmado = await copilotoConfirmar('Limpar todo o Histórico do Bot deste lead (chat rápido com o C&S - BOT)?',
      { titulo: 'Limpar tudo?', textoConfirmar: 'Limpar tudo' });
    if(!confirmado) return;
    botHistorico = [];
    try{
      await copilotoStorage.local.set({ [botHistoryKey(botHistoricoLeadId)]: [] });
    }catch(err){ console.error(err); }
    renderBotHistoryList();
    toast('Histórico do Bot limpo 🧹');
  }

  // Exposta pra panel.js chamar depois do painel desbloqueado (mesmo
  // momento em que os leads e o resto dos dados do perfil ativo são
  // carregados — ver liberarPainel) — sem isso, o card ficaria sempre
  // vazio na tela principal até o modal do chat ser aberto pelo menos uma
  // vez.
  window.carregarHistoricoBotChat = carregarHistoricoBotChat;
})();
