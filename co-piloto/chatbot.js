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
  async function classificarEstagioEmocao(texto){
    if(!texto) return null;
    if(typeof ESTAGIO_ORDER === 'undefined' || typeof estagioFunilValido !== 'function') return null;

    const cachedClassificador = `Você classifica em qual etapa de um funil de vendas consultivas por WhatsApp uma conversa está, e lê a emoção predominante do cliente nela, com base só no trecho mandado. Responda SOMENTE com um JSON válido (sem markdown, sem texto fora do JSON):
{
  "estagio_sugerido": "uma exatamente destas opções: ${ESTAGIO_ORDER.join(' | ')}",
  "emocao_cliente": "1 a 3 palavras descrevendo a emoção predominante do cliente nesta mensagem (ex: animado, hesitante, frustrado, confiante, ansioso, neutro), ou null se não der pra perceber nenhuma"
}
Guia rápido do que cada etapa significa: Primeiro contato = ainda sem sondagem; Sondagem = descobrindo a dor/objetivo; Validação da dor = já entendeu a dor, ainda não apresentou solução; Apresentação da solução = já explicou o que oferece; Condução ao valor = falando de preço/investimento; Objeção = o lead levantou uma objeção (preço, tempo, confiança, "vou pensar"); Fechamento = perto de confirmar/agendar; Follow-up = lead sumiu, retomando contato; Perdido = recusou claramente ou encerrou sem interesse.`;

    if(typeof resolverCredenciaisGemini === 'function' && typeof callGemini === 'function'){
      const credenciais = resolverCredenciaisGemini('basico');
      if(credenciais.apiKey){
        try{
          const resultado = await callGemini(cachedClassificador, '', texto, credenciais.apiKey, credenciais.model);
          return {
            estagio: estagioFunilValido(resultado.estagio_sugerido) || null,
            emocao: textoDaIA(resultado.emocao_cliente, 40) || null
          };
        }catch(err){
          console.error(err);
          return null; // Gemini configurado mas falhou agora — não insiste no Claude, mesma postura silenciosa de sempre
        }
      }
    }

    // Sem nenhuma chave do Gemini: cai pro Claude, se a instalação tiver uma
    // configurada — no modelo econômico quando existir um definido, senão o
    // principal (mesma regra de custo de callClaudeComTier).
    if(typeof providerSettings !== 'undefined' && providerSettings.claudeKey && typeof callClaude === 'function'){
      const modeloClassificacao = providerSettings.claudeModeloBasico || providerSettings.claudeModel || 'claude-sonnet-5';
      try{
        const resultado = await callClaude(cachedClassificador, '', texto, modeloClassificacao);
        return {
          estagio: estagioFunilValido(resultado.estagio_sugerido) || null,
          emocao: textoDaIA(resultado.emocao_cliente, 40) || null
        };
      }catch(err){
        console.error(err);
        return null;
      }
    }

    return null; // nenhum provedor configurado — silencioso, mesmo comportamento de sempre
  }

  // Dispara sozinha assim que um texto é COLADO na caixa deste chat — é só
  // um preview antecipado (roda de novo, com garantia, no momento do envio
  // — ver garantirLeituraEstagioParaEnvio), então aqui pode simplesmente
  // descartar o resultado se a pessoa já mudou de ideia enquanto classificava.
  async function detectarEstagioEmocaoChat(texto){
    if(!texto || chatEstagioManual) return; // com estágio fixado manualmente, não há o que detectar
    const resultado = await classificarEstagioEmocao(texto);
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
    const resultado = await classificarEstagioEmocao(texto);
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

IDENTIDADE DESTE CHAT: aqui (só neste chat rápido, não nas mensagens que você sugere pro WhatsApp) você é o "C&S - BOT", o assistente de IA deste copiloto de vendas — trate-se sempre no masculino ("estou", "pronto", "certeza disso" etc, nunca "estou pronta" ou variação no feminino). Se a atendente perguntar seu nome, quem você é, ou pedir sua versão, responda como C&S - BOT${versaoAtual() ? ` (versão ${versaoAtual()})` : ''} — sem inventar outro nome. Se perguntarem quem te desenvolveu, quem te criou, ou quem é o desenvolvedor, responda que foi Samuel D S Teixeira, CEO da C&S — sem inventar outro nome.`;
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
  // conversa pode ter várias idas e voltas.
  function buildChatDynamicContext(lead){
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

    if(!chatHistorico.length) return base + deteccao;

    const historicoTexto = chatHistorico
      .map(m => `${m.role === 'user' ? 'Atendente' : 'Você'}: ${m.texto}`)
      .join('\n');
    return `${base}${deteccao}\n\nHISTÓRICO DESTA CONVERSA DE CHAT (mais antigas primeiro):\n${historicoTexto}`;
  }

  async function pedirRespostaIA(mensagemUsuario){
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
    const dynamicContext = buildChatDynamicContext(lead);

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
    div.textContent = texto;
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

      // Legenda pequena com qual chave/modelo respondeu (ver
      // labelRoteamentoIA/anexarMetaRoteamento, panel.js) — mesma
      // visibilidade que "Gerar resposta"/"Sugerir follow-up" ganharam no
      // painel principal.
      if(opts.meta && typeof labelRoteamentoIA === 'function'){
        const label = labelRoteamentoIA(opts.meta);
        if(label){
          const legenda = document.createElement('div');
          legenda.className = 'chat-roteamento-info';
          legenda.textContent = label;
          box.appendChild(legenda);
        }
      }
    }

    box.scrollTop = box.scrollHeight;
    return div;
  }

  async function enviarMensagemChat(){
    if(chatOcupado) return;
    const input = elInput();
    const texto = input.value.trim();
    if(!texto) return;

    chatOcupado = true;
    elSend().disabled = true;
    input.value = '';
    input.style.height = 'auto';

    renderMensagem('user', texto);
    chatHistorico.push({ role: 'user', texto });

    const loadingEl = renderMensagem('ai', 'digitando...', { loading: true, id: 'chatLoadingMsg' });

    try{
      // Garante uma leitura de estágio/emoção pra ESTA mensagem antes de
      // gerar a resposta (automática, lendo a própria mensagem — ou a fixada
      // manualmente no seletor) — ver garantirLeituraEstagioParaEnvio.
      await garantirLeituraEstagioParaEnvio(texto);
      atualizarBarraDeContexto();

      const { texto: resposta, meta: metaRoteamento } = await pedirRespostaIA(texto);
      loadingEl.remove();
      renderMensagem('ai', resposta, { meta: metaRoteamento });
      chatHistorico.push({ role: 'ai', texto: resposta });
      if(typeof incrementUsage === 'function') await incrementUsage();

      // Registra esta troca no Histórico do Bot deste lead (persistente) —
      // junto com a leitura automática de estágio/emoção, se houve alguma
      // pra esta mensagem (ver detectarEstagioEmocaoChat).
      const lead = leadAtualParaChat();
      const leadIdDaTroca = lead ? lead.id : null;
      const entry = {
        id: 'bothist_' + Date.now(),
        quando: new Date().toISOString(),
        pergunta: texto,
        resposta: resposta,
        leadNome: lead ? nomeParaExibir(lead) : '',
        estagio: chatEstagioDetectado || '',
        emocao: chatEmocaoDetectada || ''
      };
      botHistorico.push(entry);
      renderBotHistoryList();
      salvarEntradaHistoricoBot(leadIdDaTroca, entry).catch(err => console.error(err));
    }catch(err){
      loadingEl.remove();
      renderMensagem('ai', 'Erro: ' + err.message, { erro: true });
      console.error(err);
      if(err.semChave && typeof openOptions === 'function'){
        openOptions();
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
    botHistoricoLeadId = leadId || null;
    chatHistorico = [];
    // Estágio fixado manualmente (se houver) era sobre a conversa com o
    // lead anterior — não deve seguir pro próximo (ver resetEstagioManual).
    resetEstagioManual();
    const box = elMessages();
    if(box) box.innerHTML = '';
    try{
      botHistorico = await loadBotHistory(botHistoricoLeadId);
    }catch(err){
      console.error(err);
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
