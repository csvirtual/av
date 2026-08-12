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

  // Teto de quantas trocas (usuário+IA) do CHAT ATUAL entram no contexto
  // enviado pra IA a cada nova pergunta (ver buildChatDynamicContext, mais
  // abaixo) — nunca afeta o que fica visível na tela (as bolhas do chat
  // ficam no DOM, renderMensagem só as acrescenta; isto aqui só limita o
  // que é REENVIADO como contexto). Sem teto, uma conversa longa e
  // continuada com o mesmo lead (chatHistorico só zera ao trocar de lead,
  // nunca durante a própria conversa) reenviava o histórico INTEIRO a cada
  // mensagem nova — custo crescendo a cada troca, sem limite e sem aviso
  // nenhum pra atendente. 24 entradas = 12 idas e voltas completas, o
  // suficiente pra manter o fio de uma negociação sem deixar o contexto
  // crescer pra sempre.
  const CHAT_HISTORICO_LIMITE = 24;
  function empurrarChatHistorico(entrada){
    chatHistorico.push(entrada);
    if(chatHistorico.length > CHAT_HISTORICO_LIMITE){
      chatHistorico.splice(0, chatHistorico.length - CHAT_HISTORICO_LIMITE);
    }
  }

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
  // Nome (Central de mensagens, @csvirtual) associado à conversa de chat em
  // andamento — comparado a cada envio (ver enviarMensagemChat) pra detectar
  // sozinho quando a pessoa mudou sem trocar de lead na lista, e então
  // limpar a conversa/contexto automaticamente (mesmo reset do "/cls",
  // ver executarComandoLimpar), sem depender de ninguém lembrar de digitar
  // o comando. Fica vazio fora da Central (lead normal, sem lead, ou após
  // trocar de lead) — só compara o suficiente pra detectar troca DENTRO da
  // mesma sessão da Central, nunca contra sessões antigas.
  let ultimaPessoaChatCentral = '';

  // Histórico do Bot: guarda as conversas já tidas neste chat rápido COM O
  // LEAD ATUALMENTE SELECIONADO (ver seção mais abaixo) — sobrevive a
  // fechar o modal e a recarregar a página, e troca de conteúdo sozinho ao
  // trocar de lead no painel.
  let botHistorico = [];
  let botHistorySearchQuery = '';
  // Paginação do Histórico do Bot (ver renderBotHistoryList) — mesmo
  // motivo/mesmo padrão do histórico de respostas em panel.js
  // (renderHistoryList/paginacaoHtml): a Central de mensagens fixa em
  // especial acumula conversas de VÁRIAS pessoas diferentes num só balde,
  // e sem paginação a lista inteira era recriada no DOM a cada render.
  let botHistoryCurrentPage = 1;
  const BOT_HISTORY_PAGE_SIZE = 15;
  const BOT_HISTORY_PAGE_WINDOW = 7;

  // ---------- "Memória" — trechos do Histórico do Bot marcados pra entrar
  // no contexto da PRÓXIMA mensagem de IA (ver "/find" e "usar-memoria" mais
  // abaixo) ----------
  //
  // Nunca automático: só existe aqui o que a atendente encontrou com "/find"
  // e clicou em "📌 Usar no contexto" — sem isso, um trecho de uma conversa
  // de semanas atrás nunca entra sozinho numa resposta nova. Consumido uma
  // única vez (a próxima mensagem enviada) e esvaziado depois — ver
  // enviarMensagemChat — pra não crescer sem limite feito o
  // chatHistorico faria se persistisse entre sessões. Limitado a
  // MEMORIA_LIMITE_TRECHOS de propósito: cada trecho vai inteiro (pergunta +
  // resposta) pro contexto DINÂMICO (nunca cacheado, sempre preço cheio de
  // entrada), então mais que uns poucos por vez pesaria no custo à toa.
  let _memoriaAtivada = [];
  const MEMORIA_LIMITE_TRECHOS = 3;

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
    if(_memoriaAtivada.length){
      // "vai"/"vão" é verbo irregular — não dá pra formar o plural
      // concatenando um sufixo (era "vai"+"ão" = "vaião", errado); a
      // palavra toda precisa trocar.
      const verboIr = _memoriaAtivada.length === 1 ? 'vai' : 'vão';
      partes.push(`🧠 ${_memoriaAtivada.length} trecho${_memoriaAtivada.length===1?'':'s'} do histórico anexado${_memoriaAtivada.length===1?'':'s'} (/find) — ${verboIr} junto na próxima mensagem`);
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
  // seguir pro próximo. Trechos marcados com "/find" (ver _memoriaAtivada)
  // também são sobre o lead que estava aberto — trocar de lead sem enviá-los
  // ainda os esvazia, pelo mesmo motivo: não fazem sentido "vazando" pro
  // contexto de um lead diferente daquele de onde vieram.
  function resetEstagioManual(){
    chatEstagioManual = '';
    chatEstagioDetectado = null;
    chatEmocaoDetectada = null;
    chatEstagioDetectadoOrigemTexto = '';
    _memoriaAtivada = [];
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

LIMITE DE AÇÃO — NUNCA FINJA TER FEITO ALGO: você é só uma conversa de texto. Sozinho, respondendo em linguagem natural, você NÃO tem nenhum poder de ativar, desativar, ligar, desligar, criar, excluir ou mudar absolutamente nada de real no Co-piloto — nem campanha, nem chave de API, nem perfil, nem funil, nem qualquer configuração. A única coisa que executa de verdade é um comando explícito e determinístico digitado literalmente (ex.: "/campanha ativar", que é processado pelo próprio app, não por você interpretando a frase) ou uma ação manual da pessoa na tela (clicar num botão, marcar um checkbox). Se pedirem pra você "ativar", "desligar", "mudar" ou "configurar" algo em linguagem natural, SEM o comando exato, NUNCA diga que já fez, já ativou ou já mudou isso — seria mentira, mesmo que pareça útil responder assim. Em vez disso, diga com honestidade que você não consegue fazer isso sozinho pela conversa, e indique o caminho real pra fazer de verdade (o comando exato, se existir, ou a tela/botão certo em Configurações).

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

  // Pontua todas as seções pra uma mensagem e devolve a de maior pontuação
  // (ou null, se nenhuma palavra relevante foi digitada) — sem aplicar
  // nenhum limiar aqui; quem chama decide o quão exigente ser (ver
  // encontrarSecaoAjudaRelevante, que aplica LIMIAR_RELEVANCIA pra leitura
  // automática, e acharSecaoPorComando, mais abaixo, que não aplica nenhum —
  // um pedido explícito via /help não precisa da mesma exigência de uma
  // leitura automática tentando adivinhar se a pergunta era mesmo sobre o
  // Co-piloto).
  function melhorSecaoAjudaPara(mensagem){
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

    return { secao: melhor, pontuacao: melhorPontuacao };
  }

  // Usada em toda mensagem de chat que não for um comando "/help" (ver
  // enviarMensagemChat) — decide, sem gastar IA nenhuma, SE a pergunta
  // parece ser sobre o próprio Co-piloto o bastante pra valer a pena
  // injetar aquela seção no contexto da chamada de IA que vem a seguir (ver
  // pedirRespostaIA/buildChatDynamicContext). Não responde nada sozinha:
  // quem lê o conteúdo encontrado e formula a resposta de verdade é sempre
  // a IA — este casamento de palavras-chave só evita mandar o guia inteiro
  // (ou nada) em toda mensagem.
  function encontrarSecaoAjudaRelevante(mensagem){
    const resultado = melhorSecaoAjudaPara(mensagem);
    if(!resultado) return null;
    return resultado.pontuacao >= LIMIAR_RELEVANCIA ? resultado.secao : null;
  }

  // Mesmo casamento de palavras-chave acima, só que com um limiar bem mais
  // alto — usada SÓ por pedirRespostaIA, pra decidir se confia o bastante
  // pra FORÇAR o nível econômico da IA por "isso parece pergunta sobre o
  // Co-piloto". LIMIAR_RELEVANCIA (3) já é suficiente pra INJETAR aquela
  // seção como pano de fundo na resposta — uma palavra batendo sozinha no
  // título já vale a pena mostrar como possível fonte, é barato e
  // inofensivo errar pra mais aqui. Mas essa mesma coincidência de uma
  // palavra só (ex.: "pagamento"/"custo" batendo com a seção "Custo por
  // token" numa pergunta que na real é sobre uma venda, tipo "como conduzo
  // o pagamento com a lead?") não deveria bastar sozinha pra cortar o nível
  // de custo de uma conversa que pode ser uma venda de verdade — aí o erro
  // sai caro, não barato. Exige uma pontuação bem mais alta (título + mais
  // alguma coisa, nunca uma palavra solta) antes de confiar o suficiente
  // pra isso.
  const LIMIAR_RELEVANCIA_PARA_CUSTO = 6;
  function perguntaClaramenteSobreCoPiloto(mensagem){
    const resultado = melhorSecaoAjudaPara(mensagem);
    return !!(resultado && resultado.pontuacao >= LIMIAR_RELEVANCIA_PARA_CUSTO);
  }

  // ---------- Comando "/help" (menu completo dos assuntos, sem IA) ----------
  //
  // A leitura automática acima (encontrarSecaoAjudaRelevante) só decide se
  // vale a pena injetar UMA seção no contexto de uma pergunta em linguagem
  // natural — boa pra uma pergunta certeira ("como funciona a lixeira?"),
  // mas não ajuda quem não sabe nem por onde começar, e continua exigindo
  // IA (e uma chave configurada) pra responder de fato. "/help" (ou
  // "/ajuda") resolve os dois problemas: lista TODOS os assuntos do "Como
  // usar"/Privacidade, numerados — e "/help <número ou palavra>" abre um
  // deles direto, sem precisar do mesmo limiar da leitura automática (é um
  // pedido explícito, não uma adivinhação) — e é o único caminho de ajuda
  // que continua funcionando sem IA nenhuma, mesmo sem nenhuma chave de API
  // configurada.
  const COMANDOS_HELP = ['/help', '/ajuda'];

  // Devolve '' se a mensagem for só o comando ("/help"), o texto depois dele
  // ("lixeira", "3") se vier algo junto, ou null se a mensagem não é um
  // comando de ajuda (segue pro fluxo normal).
  function argumentoComandoHelp(mensagem){
    const normalizado = normalizarTextoAjuda((mensagem || '').trim());
    for(const cmd of COMANDOS_HELP){
      if(normalizado === cmd) return '';
      if(normalizado.startsWith(cmd + ' ')) return mensagem.trim().slice(cmd.length).trim();
    }
    return null;
  }

  function montarMenuAjudaHtml(){
    const porOrigem = new Map();
    coletarSecoesAjuda().forEach((secao, i) => {
      const numero = i + 1;
      if(!porOrigem.has(secao.origem)) porOrigem.set(secao.origem, []);
      porOrigem.get(secao.origem).push(`<li><code>/help ${numero}</code> — ${escapeHtml(secao.titulo)}</li>`);
    });
    let html = '<p><b>📚 Tudo que dá pra perguntar aqui, sem gastar IA</b></p>' +
      '<p>Digite o comando de um item abaixo, ou pergunte sobre o assunto com suas próprias palavras. Este menu também abre com <code>/ajuda</code> (mesma coisa que <code>/help</code>).</p>';
    porOrigem.forEach((itens, origem) => {
      html += `<p><b>${escapeHtml(origem)}</b></p><ul>${itens.join('')}</ul>`;
    });
    html += '<p>💡 Quer procurar algo já conversado com ESTE lead (não sobre o app)? Use <code>/find &lt;palavra&gt;</code> — ou, se preferir, <code>/buscar &lt;palavra&gt;</code>/<code>/localizar &lt;palavra&gt;</code>, é o mesmo comando.</p>';
    html += '<p>🎯 Quer ver, ativar ou desativar a campanha ativa sem abrir Configurações? Use <code>/campanha</code>.</p>';
    html += '<p>🧹 Quer limpar a tela e o contexto desta conversa, como se tivesse acabado de abrir o chat? Use <code>/cls</code> — ou <code>/limpar</code>, é o mesmo comando.</p>';
    return html;
  }

  function montarMenuAjudaTexto(){
    let texto = 'Tudo que dá pra perguntar aqui, sem gastar IA (este menu também abre com "/ajuda", mesma coisa que "/help"):\n';
    coletarSecoesAjuda().forEach((secao, i) => {
      texto += `${i + 1}. [${secao.origem}] ${secao.titulo}\n`;
    });
    texto += '\n💡 Quer procurar algo já conversado com ESTE lead (não sobre o app)? Use "/find <palavra>" — ou, se preferir, "/buscar <palavra>"/"/localizar <palavra>", é o mesmo comando.';
    texto += '\n🎯 Quer ver, ativar ou desativar a campanha ativa sem abrir Configurações? Use "/campanha".';
    texto += '\n🧹 Quer limpar a tela e o contexto desta conversa, como se tivesse acabado de abrir o chat? Use "/cls" — ou "/limpar", é o mesmo comando.';
    return texto.trim();
  }

  // "/help 3" (número da lista acima) ou "/help lixeira" (palavra do
  // assunto) — sem limiar mínimo de pontuação (ver melhorSecaoAjudaPara):
  // um pedido explícito já é intenção suficiente, mesmo que o casamento de
  // palavras seja fraco.
  function acharSecaoPorComando(argumento){
    const secoes = coletarSecoesAjuda();
    const numero = parseInt(argumento, 10);
    if(!isNaN(numero) && numero >= 1 && numero <= secoes.length) return secoes[numero - 1];
    const resultado = melhorSecaoAjudaPara(argumento);
    return resultado ? resultado.secao : null;
  }

  // ---------- Comando "/find" (busca no Histórico do Bot deste lead, sem IA) ----------
  //
  // Um "Ctrl+F" pro Histórico do Bot: acha, por palavra-chave (mesmo
  // casamento de melhorSecaoAjudaPara acima — zero custo, zero IA), trechos
  // JÁ CONVERSADOS com o lead atual em sessões anteriores deste mesmo chat.
  // Existe porque a alternativa (a IA "lembrar" sozinha, injetando o
  // histórico inteiro ou um resumo dele em toda mensagem nova) ou cresce sem
  // limite de custo, ou decide relevância por conta própria — nos dois
  // casos, silenciosamente. Aqui é o oposto: um pedido explícito, que devolve
  // exatamente os trechos batidos (nunca inventa nem resume), e cada um
  // ganha um botão "📌 Usar no contexto" — só se a atendente clicar nele é
  // que aquele trecho específico entra na PRÓXIMA chamada de IA (ver
  // _memoriaAtivada/adicionarTrechoNaMemoria, mais abaixo). Nunca escreve no
  // Histórico do Bot (diferente do "/help") — uma busca não é uma conversa
  // nova, não faz sentido virar mais uma entrada pesquisável nela mesma.
  const COMANDOS_FIND = ['/find', '/buscar', '/localizar'];

  // Mesma forma de argumentoComandoHelp — '' pro comando sozinho, o termo
  // buscado se vier algo junto, ou null se não é um comando de busca.
  function argumentoComandoFind(mensagem){
    const normalizado = normalizarTextoAjuda((mensagem || '').trim());
    for(const cmd of COMANDOS_FIND){
      if(normalizado === cmd) return '';
      if(normalizado.startsWith(cmd + ' ')) return mensagem.trim().slice(cmd.length).trim();
    }
    return null;
  }

  const FIND_LIMITE_RESULTADOS = 8;

  // Pontua cada entrada do Histórico do Bot do lead atual pelas palavras do
  // termo buscado (título/corpo não existem aqui — é tudo "corpo": pergunta
  // + resposta pesam igual, ao contrário de melhorSecaoAjudaPara, que
  // favorece o título de uma seção fixa). Sem limiar mínimo — mesmo
  // raciocínio de acharSecaoPorComando: é um pedido explícito, uma palavra
  // batendo já é motivo suficiente pra aparecer na lista, a atendente que
  // julga se serve. `personNameFiltro` restringe à mesma pessoa (ver
  // enviarMensagemChat): na central de mensagens (@csvirtual) o Histórico do
  // Bot mistura conversas de gente diferente, sem isso a busca vazaria
  // trecho de uma pessoa pra outra. Entradas ainda cifradas (sem DEK
  // disponível agora) são puladas — não têm texto legível pra bater com
  // nada.
  function buscarNoHistoricoBot(termo, personNameFiltro){
    const palavrasQuery = palavrasRelevantes(termo);
    if(!palavrasQuery.length) return [];
    return botHistorico
      .filter(h => !pareceCifrado(h.pergunta) && !pareceCifrado(h.resposta))
      .filter(h => !personNameFiltro || h.pessoa === personNameFiltro)
      .map(h => {
        const corpo = normalizarTextoAjuda(`${h.pergunta || ''} ${h.resposta || ''}`);
        let pontuacao = 0;
        palavrasQuery.forEach(p => { if(corpo.includes(p)) pontuacao += 1; });
        return { entry: h, pontuacao };
      })
      .filter(r => r.pontuacao > 0)
      .sort((a, b) => b.pontuacao - a.pontuacao || new Date(b.entry.quando) - new Date(a.entry.quando))
      .slice(0, FIND_LIMITE_RESULTADOS)
      .map(r => r.entry);
  }

  // Texto puro dos resultados — só pro botão "Copiar" da bolha (ver
  // renderMensagem); a exibição de verdade é montarResultadoFindHtml, logo
  // abaixo, com os botões "Usar no contexto".
  function montarResultadoFindTexto(termo, resultados){
    if(!resultados.length) return `Não encontrei nada no Histórico do Bot deste lead sobre "${termo}".`;
    let texto = `${resultados.length} resultado${resultados.length === 1 ? '' : 's'} no Histórico do Bot deste lead sobre "${termo}":\n`;
    resultados.forEach((h, i) => {
      texto += `\n${i + 1}. [${formatDataHora(h.quando)}]\nVocê perguntou: ${h.pergunta}\nC&S - BOT respondeu: ${h.resposta}\n`;
    });
    return texto.trim();
  }

  // corpoHistoricoBotHtml vive mais abaixo (seção "Histórico do Bot") —
  // function declaration, então já está disponível aqui mesmo definida
  // depois no arquivo (hoisting), sem duplicar o mesmo HTML de exibição.
  function montarResultadoFindHtml(termo, resultados){
    if(!resultados.length){
      return `<p>Não encontrei nada no Histórico do Bot deste lead sobre "<b>${escapeHtml(termo)}</b>".</p>`;
    }
    let html = `<p><b>🔎 ${resultados.length} resultado${resultados.length === 1 ? '' : 's'}</b> no Histórico do Bot deste lead sobre "${escapeHtml(termo)}":</p>`;
    resultados.forEach(h => {
      html += `<div class="chat-find-item">
        <div class="hist-date">🕒 ${formatDataHora(h.quando)}</div>
        ${corpoHistoricoBotHtml(h)}
        <button type="button" class="chat-copy-btn" data-acao="usar-memoria" data-find-id="${escapeHtml(h.id)}">📌 Usar no contexto</button>
      </div>`;
    });
    return html;
  }

  // Marca um trecho encontrado por "/find" pra entrar na PRÓXIMA chamada de
  // IA (ver blocoMemoria em buildChatDynamicContext) — chamado pelo clique
  // delegado em [data-acao="usar-memoria"] (ver init(), mais abaixo).
  // Consumido (esvaziado) uma única vez, logo depois do próximo envio bem
  // sucedido — ver enviarMensagemChat — pra nunca ficar "grudado" em
  // mensagens futuras sem a atendente pedir de novo.
  function adicionarTrechoNaMemoria(entry, btn){
    if(_memoriaAtivada.some(t => t.id === entry.id)){
      toast('Esse trecho já está marcado pra entrar na próxima mensagem');
      return;
    }
    if(_memoriaAtivada.length >= MEMORIA_LIMITE_TRECHOS){
      // "Fechar e reabrir o chat" NÃO libera espaço aqui de propósito — os
      // trechos marcados sobrevivem a fechar o modal (mesmo padrão de
      // chatEstagioManual), só esvaziam depois de um envio bem-sucedido ou
      // ao trocar de lead (ver enviarMensagemChat/resetEstagioManual). Por
      // isso o aviso só menciona esses dois caminhos reais.
      toast(`Só dá pra marcar até ${MEMORIA_LIMITE_TRECHOS} trechos por vez — envie a mensagem (ou troque de lead) antes de marcar outro`);
      return;
    }
    _memoriaAtivada.push(entry);
    if(btn){ btn.disabled = true; btn.textContent = '✓ Marcado'; }
    atualizarBarraDeContexto();
    toast('Trecho anexado — vai junto na próxima mensagem que você enviar 🧠');
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

    // Vale SEMPRE — lead normal selecionado, Central de mensagens
    // (@csvirtual) ou nenhum lead selecionado — a pergunta costuma ser
    // sobre estratégia de venda, o mesmo tipo de pergunta que "Sugerir
    // abordagem ou Follow-up" (buildFollowupPrompt, panel.js) responde com
    // uma análise de verdade (situação + timing + mensagem pronta), não com
    // um parágrafo corrido qualquer. O bloco cacheado (buildChatCachedSystem,
    // acima) manda responder curto de propósito — bom padrão pra dúvida
    // rápida, raso demais pra estratégia de venda de verdade, em qualquer um
    // dos três cenários. Como isto entra no contexto DINÂMICO (não no
    // cacheado — sem isso o cache do prompt variaria por lead e perderia a
    // economia), dá pra destravar mais profundidade só quando fizer
    // sentido, sem mexer no texto cacheado nem pagar esse custo em toda
    // mensagem. Na Central, a "situação" que a IA lê vem do bloco de
    // isolamento logo acima (nome da pessoa + estágio desta mensagem) —
    // ela já é tratada separadamente ali, então a profundidade aqui só
    // acrescenta análise em cima do que já está isolado, nunca mistura com
    // outra pessoa.
    const modoConsultoriaBloco = `\n\nPROFUNDIDADE DA RESPOSTA: quando a pergunta for sobre estratégia de venda — como abordar, responder, conduzir a conversa ou lidar com uma objeção — e não sobre o Co-piloto em si, responda com a MESMA profundidade que "Sugerir abordagem ou Follow-up" daria: uma leitura objetiva da situação (do lead ou da pessoa descrita no contexto acima, se houver — ou da situação descrita na própria pergunta, se nenhum lead estiver selecionado), quando fizer sentido uma recomendação de timing/melhor momento pra agir, e a mensagem pronta pra copiar, se for isso que a pergunta pedir. Ignore aqui o limite de "resposta curta" das instruções gerais acima — pode (e deve) ser mais completo quando o assunto for estratégia de venda, sempre em texto corrido e natural de conversa, nunca JSON nem markdown. Sem nenhum lead selecionado, baseie-se só no que a própria pergunta descrever — nunca invente dados de um lead que não existe. Pra qualquer outra pergunta (sobre o Co-piloto, ou papo sem relação com venda), continue respondendo curto e direto, como de costume.`;

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

    // Trechos de conversas ANTERIORES (de sessões passadas do chat, não
    // desta) que a atendente achou com "/find" e marcou explicitamente com
    // "📌 Usar no contexto" — ver _memoriaAtivada/adicionarTrechoNaMemoria,
    // mais acima, e enviarMensagemChat, mais abaixo. Nunca entra sozinho:
    // só existe aqui o que foi marcado à mão pra ESTA mensagem.
    const blocoMemoria = _memoriaAtivada.length
      ? `\n\nTRECHOS DE CONVERSAS ANTERIORES QUE A ATENDENTE MARCOU COMO RELEVANTES PRA ESTA PERGUNTA (achados com /find no Histórico do Bot deste lead — são conversas de verdade já tidas com ele antes, use como memória real, não invente continuidade além do que está escrito):\n${_memoriaAtivada.map((h, i) => `${i + 1}. [${formatDataHora(h.quando)}] Pergunta: ${h.pergunta}\nResposta: ${h.resposta}`).join('\n\n')}`
      : '';

    if(!chatHistorico.length) return base + modoConsultoriaBloco + deteccao + blocoAjuda + blocoMemoria;

    const historicoTexto = chatHistorico
      .map(m => `${m.role === 'user' ? 'Atendente' : 'Você'}: ${m.texto}`)
      .join('\n');
    return `${base}${modoConsultoriaBloco}${deteccao}${blocoAjuda}${blocoMemoria}\n\nHISTÓRICO DESTA CONVERSA DE CHAT (mais antigas primeiro):\n${historicoTexto}`;
  }

  async function pedirRespostaIA(mensagemUsuario, secaoAjudaConhecida, resultadoMelhorSecaoAjudaConhecido){
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
    // callClaudeComTier/callGeminiComTier esperam um objeto com .estagio pra
    // decidir o tier (ver escolherTierPorEstagio em panel.js) — a ordem de
    // prioridade abaixo decide QUAL estágio usar pra isso:
    //  1) Estágio fixado MANUALMENTE nesta conversa (chatEstagioManual) —
    //     decisão humana explícita, o sinal mais forte que existe: a
    //     atendente escolheu à mão, agora, que esta conversa está numa
    //     etapa específica. Vale mesmo sem nenhum lead selecionado (antes
    //     ficava travado sempre no econômico ali, sem nenhuma forma de
    //     escapar), vale por cima do estágio salvo no lead (que pode estar
    //     desatualizado pra esta conversa específica), e vale até por cima
    //     da detecção automática do item 2 abaixo — decisão humana
    //     deliberada sempre pesa mais que palpite automático, mesmo o mais
    //     bem-intencionado, mesmo aquele que existe justamente pra
    //     economizar: um falso positivo do detector de palavra-chave nunca
    //     deveria conseguir derrubar uma escolha explícita da atendente.
    //  2) Pergunta sobre o próprio Co-piloto, com ALTA confiança (nenhum
    //     estágio fixado manualmente, e a pontuação do casamento de
    //     palavras-chave passa do limiar mais rígido — ver
    //     LIMIAR_RELEVANCIA_PARA_CUSTO/perguntaClaramenteSobreCoPiloto,
    //     acima) — nível econômico: consultar o próprio guia não é uma
    //     resposta que decide venda nenhuma, não faz sentido pagar o nível
    //     mais caro só porque o lead selecionado agora por acaso está numa
    //     etapa de risco. Uma coincidência de palavra solta (ex.:
    //     "pagamento" numa pergunta de venda real, batendo o título de
    //     "Custo por token") não é confiança suficiente pra isso — só ainda
    //     entra como fonte de contexto (ver secaoAjudaConhecida/
    //     buildChatDynamicContext abaixo), nunca força o nível sozinha.
    //  3) Estágio do lead selecionado, se houver — o de sempre.
    //  4) Nada disso: objeto mínimo equivalente a "Primeiro contato" (nível
    //     econômico, sem lead selecionado e papo livre).
    //
    // resultadoMelhorSecaoAjudaConhecido, quando informado por quem chama
    // (ver enviarMensagemChat), evita rodar o mesmo casamento de
    // palavras-chave de novo só pra aplicar o limiar mais rígido — sem ele
    // (chamada eventual de outro lugar no futuro), recalcula na hora.
    const perguntaSobreCoPilotoComConfianca = !!secaoAjudaConhecida && (
      resultadoMelhorSecaoAjudaConhecido
        ? resultadoMelhorSecaoAjudaConhecido.pontuacao >= LIMIAR_RELEVANCIA_PARA_CUSTO
        : perguntaClaramenteSobreCoPiloto(mensagemUsuario)
    );
    const leadParaTier = chatEstagioManual
      ? { fixo: false, estagio: chatEstagioManual }
      : perguntaSobreCoPilotoComConfianca
        ? { fixo: false, estagio: 'Primeiro contato' }
        : (lead || { fixo: false, estagio: 'Primeiro contato' });

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
      // Só usado por "/help" e "/find" (nunca pela resposta da IA nem pela
      // mensagem digitada, que continuam texto puro via textContent, abaixo)
      // — dois HTMLs possíveis, os dois sempre escapados antes de chegar
      // aqui, nunca innerHTML bruto: o do guia "Como usar"/"Privacidade" via
      // serializarHtmlSeguroAjuda (allowlist de tags, a partir do NOSSO
      // próprio HTML estático — ver montarMenuAjudaHtml/acharSecaoPorComando)
      // e o de "/find" via escapeHtml direto em cima de h.pergunta/h.resposta
      // (ver corpoHistoricoBotHtml/montarResultadoFindHtml) — ali sim vindo
      // de texto digitado pela atendente e gerado pela IA, por isso escapado
      // explicitamente em vez de restrito por allowlist.
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
  // cancelar se a pessoa fechar o chat antes dos 15s acabarem (sem isso, ela
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

  // Interrompe a contagem regressiva do aviso "sem chave" (se estiver
  // rodando) e deixa uma mensagem estática no lugar — usada tanto pelo
  // botão "Permanecer nesta página" quanto por qualquer caractere
  // digitado/apagado na caixa (ver init(), mais abaixo): a pessoa
  // claramente decidiu continuar aqui, então redirecionar sozinho não faz
  // mais sentido. "Ir agora" continua ali (só some "Permanecer nesta
  // página", que já cumpriu o papel dela) — a pessoa pode ter cancelado o
  // redirecionamento automático sem querer abrir mão de ir configurar a
  // chave manualmente quando quiser. Sai calada se não houver nenhum
  // contador rodando agora (ex.: digitar a próxima pergunta depois que uma
  // resposta anterior já chegou normalmente, sem nenhum aviso na tela).
  function pararRedirecionamentoSemChave(){
    if(!_avisoSemChaveIntervalId) return;
    cancelarAvisoSemChave();
    const div = document.getElementById('chatAvisoSemChaveMsg');
    if(!div) return;
    const textoEl = div.querySelector('div');
    if(textoEl) textoEl.textContent = '🔑 Nenhuma chave de API configurada ainda. Configure quando quiser em Configurações → Provedor de IA.';
    const ficarBtn = div.querySelector('[data-acao="ficar"]');
    if(ficarBtn) ficarBtn.remove();
  }

  // Mostra o aviso de "nenhuma chave configurada" com contagem regressiva
  // de 15s antes de redirecionar sozinho pra Configurações → Provedor de IA
  // — em vez do redirecionamento imediato de antes (que não dava nem tempo
  // da pessoa ler a mensagem de erro). "Ir agora" pula a espera pra quem
  // não quiser contar; "Permanecer nesta página" (ou simplesmente digitar
  // algo na caixa, ver init()) cancela o redirecionamento de vez, sem sair
  // do chat.
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
    // Os dois botões (ver chat-msg-botoes, styles.css) ficam lado a lado
    // com espaço entre eles — sem esse wrapper, dois <button> seguidos
    // (nenhum texto/espaço em branco entre eles no DOM, só appendChild)
    // colam um no outro, tipo "Ir agoraPermanecer nesta página".
    const botoesRow = document.createElement('div');
    botoesRow.className = 'chat-msg-botoes';
    div.appendChild(botoesRow);
    const irAgoraBtn = document.createElement('button');
    irAgoraBtn.type = 'button';
    irAgoraBtn.className = 'chat-copy-btn';
    irAgoraBtn.textContent = 'Ir agora';
    botoesRow.appendChild(irAgoraBtn);
    // "Permanecer nesta página": cancela o redirecionamento automático sem
    // sair do chat — pra quem só quer terminar de ler a resposta, copiar
    // algo, ou configurar a chave depois, sem ser empurrado pra
    // Configurações no meio do que estava fazendo.
    const ficarBtn = document.createElement('button');
    ficarBtn.type = 'button';
    ficarBtn.className = 'chat-copy-btn';
    ficarBtn.textContent = 'Permanecer nesta página';
    // Marcado pra pararRedirecionamentoSemChave() saber qual dos dois
    // botões remover (só este) e qual manter ("Ir agora").
    ficarBtn.dataset.acao = 'ficar';
    botoesRow.appendChild(ficarBtn);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;

    let restante = 15;
    const atualizarTexto = () => {
      textoEl.textContent = `🔑 Nenhuma chave de API configurada ainda — te levando para Configurações → Provedor de IA em ${restante}s...`;
    };
    atualizarTexto();

    const ir = () => {
      cancelarAvisoSemChave();
      abrirConfiguracoesNaSecaoProvedor();
    };
    irAgoraBtn.addEventListener('click', ir);
    ficarBtn.addEventListener('click', pararRedirecionamentoSemChave);

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

  // Sequência final comum a QUALQUER turno do chat que não segue pro fluxo
  // de IA (cancela um aviso de "sem chave" pendente, libera a caixa de novo)
  // — compartilhada por finalizarRespostaSemIA ("/help") e
  // finalizarBuscaSemIA ("/find"), logo abaixo.
  function encerrarTurnoChat(input){
    cancelarAvisoSemChave();
    chatOcupado = false;
    elSend().disabled = false;
    input.focus();
  }

  // Fecha o turno de uma resposta de "/help" (nunca chama IA — ver
  // argumentoComandoHelp/acharSecaoPorComando acima) — mostra a bolha,
  // guarda no Histórico do Bot persistente (pra aparecer depois na tela
  // principal do lead), e encerra o turno (ver encerrarTurnoChat acima).
  //
  // De propósito NUNCA entra em `chatHistorico` (o que é reenviado pra IA
  // como contexto a cada NOVA mensagem desta mesma conversa — ver
  // buildChatDynamicContext): "/help" e sua resposta são navegação de tela,
  // não conversa — se entrasse, o menu inteiro (ou o texto de uma seção
  // inteira) ficaria "andando junto", sendo reenviado (e cobrado) em TODA
  // chamada de IA seguinte desta mesma conversa, mesmo sem nenhuma relação
  // com o que estiver sendo perguntado dali pra frente. Uma pergunta em
  // linguagem natural sobre o Co-piloto, diferente de "/help", passa pela
  // IA normalmente (ver enviarMensagemChat/pedirRespostaIA) e por isso
  // entra em chatHistorico como qualquer outra troca da conversa.
  function finalizarRespostaSemIA(perguntaOriginal, respostaTexto, respostaHtml, legenda, leadIdDoEnvio, input){
    renderMensagem('ai', respostaTexto, { legenda, html: respostaHtml });
    registrarTrocaNoHistoricoBot(perguntaOriginal, respostaTexto, leadIdDoEnvio);
    encerrarTurnoChat(input);
  }

  // Fecha o turno de um resultado de "/find" (ver COMANDOS_FIND acima) —
  // igual a finalizarRespostaSemIA, MAS de propósito NUNCA chama
  // registrarTrocaNoHistoricoBot: uma busca não é uma conversa nova, e
  // salvá-la faria futuras buscas acharem a si mesmas (o texto "resultado
  // sobre X" bate com a próxima busca por "X"), poluindo os resultados com
  // o tempo. "/find" nunca deixa rastro no Histórico do Bot — é consulta,
  // não conteúdo.
  function finalizarBuscaSemIA(respostaTexto, respostaHtml, legenda, input){
    renderMensagem('ai', respostaTexto, { legenda, html: respostaHtml });
    encerrarTurnoChat(input);
  }

  // ---------- Comando "/campanha" (ver/ativar/desativar/definir, sem IA) ----------
  //
  // A campanha ativa já entra sozinha no contexto de toda resposta de IA —
  // Gerar resposta, Follow-up e este chat, todos usam a mesma
  // buildBlocoEstaticoFunil()/buildCampanhaBloco() (panel.js), então não
  // precisa de nada especial pra o bot SABER e USAR a campanha. Isto aqui
  // é só o CONTROLE dela pelo chat, sem precisar abrir Configurações.
  //
  // De propósito não usa IA nenhuma pra interpretar a intenção ("acho que
  // ela quis ativar?") — mesma decisão de design do resto do app (o
  // checkbox de campanha em Configurações, "/find", troca de perfil):
  // nenhuma ação que muda um dado real do negócio acontece por
  // adivinhação de linguagem natural, só por um comando explícito e
  // determinístico. Grava na MESMA chave (campanhaAtiva/campanhaTexto) que
  // o checkbox de Configurações usa — uma fonte só de verdade — e chama
  // renderCampanhaBadge() (panel.js) igual o checkbox já faz, pra o selo
  // "🎯 Campanha ativa" no topo do painel atualizar na hora, sem esperar
  // o listener de chrome.storage.onChanged (que existe pra sincronizar
  // OUTRA aba/página, não esta).
  const COMANDOS_CAMPANHA = ['/campanha'];

  // Mesma forma de argumentoComandoHelp/argumentoComandoFind — '' pro
  // comando sozinho, o texto depois dele se vier algo junto, ou null se a
  // mensagem não é um comando de campanha (segue pro fluxo normal).
  function argumentoComandoCampanha(mensagem){
    const normalizado = normalizarTextoAjuda((mensagem || '').trim());
    for(const cmd of COMANDOS_CAMPANHA){
      if(normalizado === cmd) return '';
      if(normalizado.startsWith(cmd + ' ')) return mensagem.trim().slice(cmd.length).trim();
    }
    return null;
  }

  function statusCampanhaTexto(){
    return (campanhaAtiva && campanhaTexto && campanhaTexto.trim())
      ? `🎯 Campanha ativa: "${campanhaTexto.trim()}"`
      : '🚫 Nenhuma campanha ativa no momento.';
  }

  // Executa a ação pedida e devolve o texto de confirmação — nunca falha
  // silenciosamente, sempre confirma de volta exatamente o que mudou (ou
  // explica por que não mudou nada, ex: "ativar" sem nenhum texto salvo
  // ainda).
  async function executarComandoCampanha(argumento){
    if(!argumento){
      return `${statusCampanhaTexto()}\n\nUse "/campanha ativar", "/campanha desativar" ou "/campanha <texto novo>" pra mudar.`;
    }

    const normalizado = normalizarTextoAjuda(argumento);
    if(['ativar', 'ligar', 'on'].includes(normalizado)){
      if(!campanhaTexto || !campanhaTexto.trim()){
        return 'Ainda não existe nenhum texto de campanha salvo pra ativar. Digite "/campanha <texto>" pra definir e ativar de uma vez, ou preencha em Configurações → Funil de vendas → Campanha ativa.';
      }
      campanhaAtiva = true;
      await copilotoStorage.local.set({ campanhaAtiva });
      renderCampanhaBadge();
      return `✅ Campanha ativada: "${campanhaTexto.trim()}"`;
    }

    if(['desativar', 'desligar', 'off'].includes(normalizado)){
      campanhaAtiva = false;
      await copilotoStorage.local.set({ campanhaAtiva });
      renderCampanhaBadge();
      return '✅ Campanha desativada.';
    }

    // Qualquer outro texto vira o novo conteúdo da campanha, já ativado —
    // mesma gravação de saveCampanhaNow/onCampanhaAtivaChange (panel.js).
    campanhaTexto = argumento;
    campanhaAtiva = true;
    await copilotoStorage.local.set({ campanhaTexto, campanhaAtiva });
    renderCampanhaBadge();
    return `✅ Campanha definida e ativada: "${campanhaTexto.trim()}"`;
  }

  // ---------- Comando "/cls" (limpa a tela e o contexto desta conversa, sem IA) ----------
  //
  // Motivo de existir: na central de mensagens fixa (@csvirtual), o chat NÃO
  // é reaberto do zero sozinho (ver abrirChatModal acima, que só mostra o
  // overlay de novo — quem zera chatHistorico/a tela é carregarHistoricoBotChat,
  // chamado ao TROCAR de lead na lista, não ao fechar/reabrir o modal). Então
  // dá pra: preencher "Nome da pessoa" com o paciente A, conversar, fechar o
  // chat, trocar o nome pro paciente B (mesmo lead fixo) e reabrir o chat —
  // sem nada no meio, a conversa e o contexto do paciente A continuam ali,
  // agora "por baixo" do nome do paciente B. "/cls" existe pra resolver
  // exatamente isso na mão, preparando o chat pra ser usado como se
  // tivesse acabado de ser aberto, sem precisar sair e voltar pro lead —
  // e, desde a checagem em enviarMensagemChat (ver ultimaPessoaChatCentral),
  // o mesmo reset também dispara SOZINHO ao detectar troca de pessoa na
  // Central, sem precisar digitar nada.
  const COMANDOS_LIMPAR = ['/cls', '/limpar'];

  function ehComandoLimpar(mensagem){
    const normalizado = normalizarTextoAjuda((mensagem || '').trim());
    return COMANDOS_LIMPAR.includes(normalizado);
  }

  // Mesmo reset de estágio/emoção/memória que carregarHistoricoBotChat já
  // faz ao trocar de lead (resetEstagioManual) + zera chatHistorico (o
  // contexto reenviado pra IA a cada mensagem) e a tela de bolhas. De
  // propósito NÃO mexe no Histórico do Bot persistido (botHistorico) nem na
  // paginação/busca dele (botHistoryCurrentPage/botHistoryQuery) — isso é o
  // registro salvo do lead, não "o que está na tela agora", e continua
  // intacto pra consulta por "/find" mesmo depois do "/cls". Chamada tanto
  // pelo comando "/cls"/"/limpar" (na mão) quanto automaticamente por
  // enviarMensagemChat ao detectar troca de pessoa na Central — nos dois
  // casos o efeito é idêntico.
  function executarComandoLimpar(){
    chatHistorico = [];
    resetEstagioManual();
    cancelarAvisoSemChave();
    elMessages().innerHTML = '';
    atualizarBarraDeContexto();
    return '🧹 Conversa e contexto limpos — o chat está pronto pra começar do zero, como se tivesse acabado de ser aberto.';
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
    const leadDoEnvio = leadAtualParaChat();

    // Troca de pessoa na Central, sem trocar de lead na lista: limpa a
    // conversa/contexto sozinho, antes de processar esta mensagem — mesmo
    // reset que "/cls" já fazia na mão (ver executarComandoLimpar acima).
    // Comparado contra QUEM foi a última mensagem de chat de verdade nesta
    // sessão da Central (não contra o valor cru do campo "Nome da pessoa",
    // que se limpa sozinho depois de cada "Gerar resposta" — comparar
    // contra isso geraria falso alarme na segunda mensagem da MESMA
    // pessoa). Fora da Central, só mantém a marcação zerada pra não
    // comparar contra uma sessão antiga quando voltar pra lá depois.
    //
    // Se a própria mensagem já for "/cls"/"/limpar" (ver ehComandoLimpar
    // acima), o despacho de comando logo abaixo já vai limpar sozinho —
    // pular a limpeza automática aqui evita rodar executarComandoLimpar()
    // duas vezes seguidas à toa pela mesma mensagem. A marcação de "quem é
    // a pessoa agora" ainda é atualizada normalmente nos dois casos.
    const eComandoDeLimparExplicito = ehComandoLimpar(texto);
    if(leadDoEnvio && leadDoEnvio.fixo){
      const pessoaDoEnvio = nomeParaExibir(leadDoEnvio);
      if(pessoaDoEnvio && ultimaPessoaChatCentral && pessoaDoEnvio !== ultimaPessoaChatCentral && !eComandoDeLimparExplicito){
        executarComandoLimpar();
        renderMensagem('ai', '🧹 Nome da pessoa mudou — conversa e contexto limpos automaticamente, pra não misturar com quem foi atendido antes.', { legenda: '🧹 Automático' });
      }
      if(pessoaDoEnvio) ultimaPessoaChatCentral = pessoaDoEnvio;
    }else{
      ultimaPessoaChatCentral = '';
    }

    chatOcupado = true;
    elSend().disabled = true;
    input.value = '';
    input.style.height = 'auto';

    renderMensagem('user', texto);

    // "/help" (lista completa dos assuntos) ou "/help <número ou palavra>"
    // (abre um deles direto) — ver argumentoComandoHelp/acharSecaoPorComando
    // acima. Único caminho de ajuda que continua respondendo sem IA (rápido,
    // literal, funciona mesmo sem nenhuma chave configurada) — de propósito
    // NÃO entra em chatHistorico (nem o comando, nem a resposta), ver o
    // comentário de finalizarRespostaSemIA. Sem nenhum await até aqui, não
    // há risco de troca de lead no meio do caminho.
    const argumentoHelp = argumentoComandoHelp(texto);
    if(argumentoHelp !== null){
      if(!argumentoHelp){
        finalizarRespostaSemIA(texto, montarMenuAjudaTexto(), montarMenuAjudaHtml(),
          '📖 Menu de ajuda — sem usar IA', leadIdDoEnvio, input);
      }else{
        const secao = acharSecaoPorComando(argumentoHelp);
        if(secao){
          const respostaTexto = `${secao.titulo}\n\n${secao.texto}`;
          const respostaHtml = `<p><b>${escapeHtml(secao.titulo)}</b></p>${secao.html}`;
          finalizarRespostaSemIA(texto, respostaTexto, respostaHtml,
            `📖 Direto de "${secao.origem}" — sem usar IA`, leadIdDoEnvio, input);
        }else{
          finalizarRespostaSemIA(texto,
            `Não encontrei nada sobre "${argumentoHelp}". Digite só "/help" pra ver a lista completa de assuntos.`,
            null, '📖 Sem usar IA', leadIdDoEnvio, input);
        }
      }
      return;
    }

    // "/find <termo>", "/buscar <termo>" ou "/localizar <termo>" — busca no Histórico do Bot
    // (persistente, entre sessões) do lead atual, sem gastar IA — ver
    // COMANDOS_FIND/buscarNoHistoricoBot acima. Mesmo raciocínio do "/help"
    // acima: checado antes de qualquer await, de propósito NÃO entra em
    // chatHistorico (ver finalizarBuscaSemIA), e nunca é salvo no próprio
    // Histórico do Bot.
    const argumentoFind = argumentoComandoFind(texto);
    if(argumentoFind !== null){
      if(!argumentoFind){
        finalizarBuscaSemIA('Use "/find <palavra ou trecho>" pra procurar no Histórico do Bot deste lead. Ex.: /find preço',
          null, '🔎 Sem usar IA', input);
      }else{
        const leadAtual = leadAtualParaChat();
        // Na central de mensagens (@csvirtual), o Histórico do Bot mistura
        // conversas de várias pessoas diferentes — sem o nome preenchido, a
        // busca vazaria trecho de uma pessoa pra outra (mesma guarda que
        // sugerirEstagioComIA/analyzeAndSuggest já fazem, panel.js).
        const personName = leadAtual && leadAtual.fixo
          ? document.getElementById('personNameInput').value.trim() : '';
        if(leadAtual && leadAtual.fixo && !personName){
          finalizarBuscaSemIA('Preencha "Nome da pessoa desta mensagem" antes de buscar — é a central de mensagens compartilhada, e a busca precisa saber de quem é a conversa.',
            null, '🔎 Sem usar IA', input);
        }else{
          const resultados = buscarNoHistoricoBot(argumentoFind, leadAtual && leadAtual.fixo ? personName : null);
          finalizarBuscaSemIA(montarResultadoFindTexto(argumentoFind, resultados), montarResultadoFindHtml(argumentoFind, resultados),
            '🔎 Busca no Histórico do Bot — sem usar IA', input);
        }
      }
      return;
    }

    // "/campanha" (status), "/campanha ativar"/"desativar" ou
    // "/campanha <texto>" (define e ativa) — ver COMANDOS_CAMPANHA acima.
    // Mesmo raciocínio do "/find": de propósito NÃO entra em
    // chatHistorico nem no Histórico do Bot (finalizarBuscaSemIA) — é
    // controle de uma configuração do negócio inteiro, não uma conversa
    // sobre este lead específico.
    const argumentoCampanha = argumentoComandoCampanha(texto);
    if(argumentoCampanha !== null){
      const respostaCampanha = await executarComandoCampanha(argumentoCampanha);
      finalizarBuscaSemIA(respostaCampanha, null, '🎯 Sem usar IA', input);
      return;
    }

    // "/cls" ou "/limpar" — ver COMANDOS_LIMPAR acima. A bolha do próprio
    // comando (renderMensagem('user', texto) logo acima) chega a aparecer
    // por um instante e some junto no elMessages().innerHTML = '' de
    // executarComandoLimpar — de propósito: sobra só a confirmação na tela,
    // igual a um chat recém-aberto. Mesmo raciocínio de "/find"/"/campanha":
    // nunca entra em chatHistorico nem no Histórico do Bot persistido.
    if(ehComandoLimpar(texto)){
      const respostaLimpar = executarComandoLimpar();
      finalizarBuscaSemIA(respostaLimpar, null, '🧹 Sem usar IA', input);
      return;
    }

    empurrarChatHistorico({ role: 'user', texto });

    // Pergunta em linguagem natural (não um comando "/help") SEMPRE passa
    // pela IA — inclusive quando é sobre o próprio Co-piloto. A resposta
    // "direta do guia, sem gastar IA" que existia aqui foi removida: fora do
    // "/help" (que resolve bem o caso de quem já sabe o assunto exato), esse
    // atalho só acertava quando a pergunta batia MUITO com o título/corpo de
    // uma única seção — qualquer coisa parafraseada, mais vaga ou mais
    // conversacional caía fora do limiar e ia pra IA do mesmo jeito, só que
    // SEM o conteúdo de ajuda no contexto (só a leitura automática decidia
    // se algo entrava ou não). Calcula UMA vez só aqui (melhorSecaoAjudaPara)
    // e repassa o resultado adiante — pedirRespostaIA/buildChatDynamicContext
    // usam a MESMA pontuação pra decidir SE injeta a seção como fonte
    // (limiar normal, LIMIAR_RELEVANCIA) e SE isso é confiança suficiente
    // pra também forçar o nível econômico (limiar mais rígido,
    // LIMIAR_RELEVANCIA_PARA_CUSTO — ver perguntaClaramenteSobreCoPiloto)
    // — sem escanear as seções de ajuda de novo pra cada decisão.
    const resultadoMelhorSecaoAjuda = melhorSecaoAjudaPara(texto);
    const secaoAjudaConhecida = (resultadoMelhorSecaoAjuda && resultadoMelhorSecaoAjuda.pontuacao >= LIMIAR_RELEVANCIA)
      ? resultadoMelhorSecaoAjuda.secao : null;

    const loadingEl = renderMensagem('ai', 'digitando...', { loading: true, id: 'chatLoadingMsg' });

    try{
      // Garante uma leitura de estágio/emoção pra ESTA mensagem antes de
      // gerar a resposta (automática, lendo a própria mensagem — ou a fixada
      // manualmente no seletor) — ver garantirLeituraEstagioParaEnvio.
      await garantirLeituraEstagioParaEnvio(texto);
      atualizarBarraDeContexto();

      // secaoAjudaConhecida/resultadoMelhorSecaoAjuda já foram calculados
      // logo acima — repassa em vez de deixar pedirRespostaIA varrer as
      // seções de ajuda de novo pra chegar no mesmo resultado.
      const { texto: resposta, meta: metaRoteamento } = await pedirRespostaIA(texto, secaoAjudaConhecida, resultadoMelhorSecaoAjuda);
      loadingEl.remove();
      // Resposta da IA veio com sucesso — se havia um aviso de "sem chave"
      // de uma pergunta anterior ainda contando, não faz mais sentido
      // nenhum ele navegar pra Configurações sozinho daqui a pouco.
      cancelarAvisoSemChave();

      // Os trechos marcados com "/find" (se houver) já foram usados nesta
      // chamada (ver blocoMemoria em buildChatDynamicContext) — esvazia
      // agora, só em caso de SUCESSO: se a chamada tivesse falhado (ex.:
      // sem chave configurada), os trechos continuam marcados pra não se
      // perder quando a atendente corrigir o problema e reenviar. A barra
      // de contexto atualiza sozinha no finally, mais abaixo.
      _memoriaAtivada = [];

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
        empurrarChatHistorico({ role: 'ai', texto: resposta });
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
    // Registra "o chat está aberto agora" (salvarUltimaTelaNaSessao vive em
    // panel.js, que carrega ANTES deste arquivo — chamada global direta,
    // sem precisar expor nada) — sobrevive a um F5 dentro da mesma sessão.
    if(typeof salvarUltimaTelaNaSessao === 'function') salvarUltimaTelaNaSessao();
  }

  function fecharChatModal(){
    elOverlay().style.display = 'none';
    document.body.classList.remove('modal-open');
    // Sem isto, fechar o chat antes dos 15s do aviso "sem chave" acabar
    // (ver mostrarAvisoSemChave) ainda redirecionava pra Configurações
    // alguns segundos depois — "do nada", já que a pessoa nem estava mais
    // olhando pro chat.
    cancelarAvisoSemChave();
    if(typeof salvarUltimaTelaNaSessao === 'function') salvarUltimaTelaNaSessao();
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
    // Também interrompe o redirecionamento automático do aviso "sem chave"
    // (ver pararRedirecionamentoSemChave) — qualquer caractere digitado ou
    // apagado aqui já mostra que a pessoa está fazendo algo nesta página,
    // não faz sentido navegar sozinho pra Configurações no meio disso.
    elInput().addEventListener('input', () => {
      pararRedirecionamentoSemChave();
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

    // Botão "📌 Usar no contexto" de cada resultado do "/find" (ver
    // montarResultadoFindHtml) — delegado no container inteiro das
    // mensagens, já que os resultados são inseridos como HTML depois deste
    // init() rodar (nunca existem no DOM na hora de registrar o listener).
    elMessages().addEventListener('click', (e) => {
      const btn = e.target.closest('[data-acao="usar-memoria"]');
      if(!btn) return;
      const entry = botHistorico.find(h => h.id === btn.dataset.findId);
      if(!entry) return;
      adicionarTrechoNaMemoria(entry, btn);
    });

    const clearBotHistBtn = document.getElementById('clearBotHistoryBtn');
    if(clearBotHistBtn) clearBotHistBtn.addEventListener('click', clearBotHistory);
    const botHistorySearchInput = document.getElementById('botHistorySearchInput');
    if(botHistorySearchInput){
      botHistorySearchInput.addEventListener('input', (e) => {
        botHistorySearchQuery = e.target.value;
        botHistoryCurrentPage = 1; // toda busca nova recomeça da primeira página
        renderBotHistoryList();
      });
    }
    const botHistoryPaginationBox = document.getElementById('botHistoryPagination');
    if(botHistoryPaginationBox){
      botHistoryPaginationBox.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-page]');
        if(!btn) return;
        botHistoryCurrentPage = parseInt(btn.dataset.page, 10);
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
    botHistoryCurrentPage = 1;
    // Estágio fixado manualmente (se houver) era sobre a conversa com o
    // lead anterior — não deve seguir pro próximo (ver resetEstagioManual).
    resetEstagioManual();
    // Troca de LEAD (não só de pessoa dentro da Central) — zera a marcação
    // de "última pessoa da Central" também, defesa extra além da checagem
    // em enviarMensagemChat: sem isto, sair da Central pra outro lead sem
    // nunca enviar mensagem nele e depois voltar pra Central manteria a
    // marcação antiga, arriscando não detectar a próxima troca de pessoa.
    ultimaPessoaChatCentral = '';
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
    const pageBox = document.getElementById('botHistoryPagination');
    if(!box) return;
    const filtered = getFilteredBotHistory();
    if(countEl) countEl.textContent = botHistorico.length ? `(${botHistorico.length})` : '';
    if(!botHistorico.length){
      box.innerHTML = '<div class="hist-empty">Nenhuma conversa registrada ainda no chat rápido com o C&S - BOT para este lead.</div>';
      if(pageBox) pageBox.innerHTML = '';
      return;
    }
    if(!filtered.length){
      box.innerHTML = '<div class="hist-empty">Nenhuma conversa do histórico do bot bate com essa busca.</div>';
      if(pageBox) pageBox.innerHTML = '';
      return;
    }

    const ordenado = filtered.slice().reverse(); // mais recente primeiro, como sempre foi
    const totalPages = Math.max(1, Math.ceil(ordenado.length / BOT_HISTORY_PAGE_SIZE));
    if(botHistoryCurrentPage > totalPages) botHistoryCurrentPage = totalPages;
    if(botHistoryCurrentPage < 1) botHistoryCurrentPage = 1;
    const startIdx = (botHistoryCurrentPage-1) * BOT_HISTORY_PAGE_SIZE;
    const pageItems = ordenado.slice(startIdx, startIdx + BOT_HISTORY_PAGE_SIZE);

    box.innerHTML = '';
    pageItems.forEach(h => {
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
    if(pageBox) pageBox.innerHTML = paginacaoHtml(botHistoryCurrentPage, totalPages, BOT_HISTORY_PAGE_WINDOW);
  }

  // Mesmo destino do histórico de respostas (deleteHistoryEntry, panel.js):
  // vai pra lixeira (item.type === 'botHistoryEntry'), cifrada, recuperável
  // por 30 dias, e a exclusão fica registrada no log de auditoria — antes
  // esta exclusão era direta e definitiva, sem nenhuma rede de segurança
  // nem rastro, inconsistente com o resto do produto. Mexe só na chave do
  // lead atualmente carregado (botHistoricoLeadId), nunca nas de outros leads.
  async function deleteBotHistoryEntry(entryId){
    const leadId = botHistoricoLeadId;
    const historicoOriginal = botHistorico;
    const entry = historicoOriginal.find(h => h.id === entryId);
    if(!entry) return;
    const confirmado = await copilotoConfirmar('Mover esta conversa do Histórico do Bot para os excluídos?',
      { titulo: 'Mover para excluídos?', textoConfirmar: 'Mover para excluídos' });
    if(!confirmado) return;

    const lead = (typeof leads !== 'undefined' && Array.isArray(leads)) ? leads.find(l => l.id === leadId) : null;
    const dek = await obterDekAtivo();
    // Cifra antes de guardar na lixeira — mesmo motivo de deleteHistoryEntry
    // (panel.js): sem isso, a pergunta feita e a resposta do bot ficariam em
    // texto puro por até 30 dias na lixeira, mesmo já protegidas na origem.
    const [entryCifrada] = await cifrarHistoricoParaSalvar([entry], dek);
    const nomeParaLog = entry.leadNome || (lead ? lead.nome : '') || '(sem lead)';
    if(typeof addToTrash === 'function'){
      await addToTrash({
        id: 'trash_' + Date.now(),
        type: 'botHistoryEntry',
        deletedAt: new Date().toISOString(),
        leadId: leadId,
        leadNome: nomeParaLog,
        entryData: entryCifrada
      });
    }

    botHistorico = historicoOriginal.filter(h => h.id !== entryId);
    // Se este trecho estava marcado com "/find" pra entrar na próxima
    // mensagem de IA (ver _memoriaAtivada) — possível mesmo com o chat
    // fechado, já que marcar não exige o modal aberto e não se esvazia ao
    // fechá-lo — remove a marca também: não faz sentido enviar pra IA um
    // trecho que a pessoa acabou de mandar pros excluídos.
    if(_memoriaAtivada.some(t => t.id === entryId)){
      _memoriaAtivada = _memoriaAtivada.filter(t => t.id !== entryId);
      atualizarBarraDeContexto();
    }
    try{
      const paraSalvar = await cifrarHistoricoParaSalvar(botHistorico, dek);
      await copilotoStorage.local.set({ [botHistoryKey(leadId)]: paraSalvar });
    }catch(err){ console.error(err); }
    renderBotHistoryList();
    if(typeof updateTrashCountBadge === 'function') await updateTrashCountBadge();
    if(typeof copilotoRegistrarEventoLog === 'function' && typeof copilotoObterPerfilAtivo === 'function'){
      try{
        await copilotoRegistrarEventoLog('bot_conversa_excluida', await copilotoObterPerfilAtivo(),
          `Conversa do C&S - BOT com ${nomeParaLog} movida para os excluídos`);
      }catch(e){}
    }
    toast('Conversa movida para os excluídos 🗑️');
  }

  async function clearBotHistory(){
    if(!botHistorico.length){ toast('Não há histórico do bot para limpar'); return; }
    const confirmado = await copilotoConfirmar('Mover todo o Histórico do Bot deste lead (chat rápido com o C&S - BOT) para os excluídos?',
      { titulo: 'Mover tudo para excluídos?', textoConfirmar: 'Mover tudo' });
    if(!confirmado) return;

    const leadId = botHistoricoLeadId;
    const historicoOriginal = botHistorico;
    const lead = (typeof leads !== 'undefined' && Array.isArray(leads)) ? leads.find(l => l.id === leadId) : null;
    const nomeParaLog = (historicoOriginal[0] && historicoOriginal[0].leadNome) || (lead ? lead.nome : '') || '(sem lead)';
    const dek = await obterDekAtivo();
    const now = new Date().toISOString();
    if(typeof mutarTrash === 'function'){
      await mutarTrash(async (trash) => {
        for(let i = 0; i < historicoOriginal.length; i++){
          const entry = historicoOriginal[i];
          const [entryCifrada] = await cifrarHistoricoParaSalvar([entry], dek);
          trash.push({
            id: 'trash_' + Date.now() + '_' + i,
            type: 'botHistoryEntry',
            deletedAt: now,
            leadId: leadId,
            leadNome: entry.leadNome || nomeParaLog,
            entryData: entryCifrada
          });
        }
        await copilotoStorage.local.set({ trash });
      });
    }

    botHistorico = [];
    // Idem deleteBotHistoryEntry: qualquer trecho deste lead marcado com
    // "/find" pra entrar na próxima mensagem também deixou de existir aqui.
    if(_memoriaAtivada.length){
      _memoriaAtivada = [];
      atualizarBarraDeContexto();
    }
    try{
      await copilotoStorage.local.set({ [botHistoryKey(leadId)]: [] });
    }catch(err){ console.error(err); }
    renderBotHistoryList();
    if(typeof updateTrashCountBadge === 'function') await updateTrashCountBadge();
    if(typeof copilotoRegistrarEventoLog === 'function' && typeof copilotoObterPerfilAtivo === 'function'){
      try{
        await copilotoRegistrarEventoLog('bot_conversa_excluida', await copilotoObterPerfilAtivo(),
          `${historicoOriginal.length} conversa${historicoOriginal.length===1?'':'s'} do C&S - BOT com ${nomeParaLog} movida${historicoOriginal.length===1?'':'s'} para os excluídos`);
      }catch(e){}
    }
    toast('Histórico do Bot movido para os excluídos 🗑️');
  }

  // Usada por restoreTrashItem (panel.js) pra devolver uma conversa da
  // lixeira pro Histórico do Bot — mesma ideia de saveHistoryEntry
  // (panel.js) pro histórico de respostas: reaproveita
  // salvarEntradaHistoricoBot (já serializada por chave) pra gravar a
  // entrada JÁ decifrada (recebida em texto puro), e só atualiza a tela se
  // o chat rápido deste MESMO lead estiver carregado agora.
  window.restaurarEntradaHistoricoBot = async function(leadId, entradaDecifrada){
    const arr = await salvarEntradaHistoricoBot(leadId, entradaDecifrada);
    if(botHistoricoLeadId === leadId){
      botHistorico = arr;
      renderBotHistoryList();
    }
  };

  // Exposta pra panel.js chamar depois do painel desbloqueado (mesmo
  // momento em que os leads e o resto dos dados do perfil ativo são
  // carregados — ver liberarPainel) — sem isso, o card ficaria sempre
  // vazio na tela principal até o modal do chat ser aberto pelo menos uma
  // vez.
  window.carregarHistoricoBotChat = carregarHistoricoBotChat;

  // Exposta pra panel.js reabrir o chat ao restaurar a última tela depois
  // de um F5 (ver restaurarUltimaTelaDaSessao, panel.js).
  window.abrirChatModal = abrirChatModal;
})();
