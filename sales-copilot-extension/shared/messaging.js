// ---------- Contrato de mensagens: WhatsApp Adapter <-> background <-> painel ----------
//
// Fase 1 da evolução do Copiloto (ver documento de arquitetura da sessão).
// Fixa o FORMATO da comunicação entre os três contextos ANTES de escrever
// os dois lados (o WhatsApp Adapter só chega na fase 2/3) — pra content
// script, background.js e panel.js concordarem sobre o shape da mensagem
// desde o primeiro dia, em vez de cada lado inventar o próprio formato e
// precisar renegociar depois.
//
// Nada usa isto ainda — content_scripts nem existe no manifest.json até a
// fase 2. Zero efeito no comportamento atual da extensão.
//
// Toda mensagem trocada entre os três contextos segue o mesmo envelope:
// { tipo: <uma das constantes abaixo>, dados: {...}, quando: <timestamp> }
//
// AVISO DE SEGURANÇA (achado testando a fase 3, documentado aqui pra fase
// 4 não pular): chrome.runtime.sendMessage transmite pra TODO listener
// vivo da extensão ao mesmo tempo — não existe "só o background recebe
// primeiro, e ele decide se repassa". Quando panel.js (fase 4) registrar
// seu próprio chrome.runtime.onMessage.addListener pra estas mensagens,
// ele vai receber a transmissão BRUTA de qualquer chamador (não só a
// repassada por background.js#repassarParaPainel) — precisa validar
// `sender.tab.url` ele mesmo (mesma checagem de
// background.js#_copilotoOrigemEhWhatsApp) antes de tratar o conteúdo como
// vindo de verdade do WhatsApp.
const COPILOTO_MSG = {
  // Adapter -> background -> painel: a aba do WhatsApp mudou de conversa
  // (outro contato/grupo ficou em primeiro plano). dados: { contato }.
  CONVERSA_MUDOU: 'copilotoConversaMudou',

  // Adapter -> background -> painel: uma ou mais mensagens novas chegaram
  // na conversa atual, já agrupadas pelo debounce do Adapter (ver seção de
  // performance do plano de arquitetura — nunca uma mensagem por vez em
  // rajada). dados: { mensagens: [...] } no formato bruto que
  // copilotoNormalizarConversa (core/conversation-normalizer.js) sabe ler.
  MENSAGENS_NOVAS: 'copilotoMensagensNovas',

  // Adapter -> background -> painel: o Adapter não conseguiu ler a
  // conversa atual (nenhum nível de fallback de seletor bateu — ver seção
  // de detecção do plano). A UI deve cair pro fluxo manual (colar), nunca
  // ficar esperando dados que não vão chegar. dados: { motivo }.
  ADAPTER_DEGRADADO: 'copilotoAdapterDegradado',
};

function copilotoCriarMensagem(tipo, dados) {
  return { tipo, dados: dados || {}, quando: Date.now() };
}

// Confere se um objeto recebido (de chrome.runtime.onMessage, por exemplo)
// é uma mensagem válida deste contrato — usado pelos dois lados pra nunca
// processar uma mensagem de outra extensão ou de um evento inesperado como
// se fosse uma das constantes acima.
function copilotoEhMensagemValida(msg) {
  return !!(msg && typeof msg.tipo === 'string' && Object.values(COPILOTO_MSG).includes(msg.tipo));
}
