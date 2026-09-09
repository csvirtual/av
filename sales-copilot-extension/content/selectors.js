// ---------- Tabela de seletores do WhatsApp Web ----------
//
// Fase 2 da evolução do Copiloto (ver documento de arquitetura da sessão,
// seção "Não confie em seletores frágeis"). Cada CONCEITO (painel de
// mensagens, bolha de mensagem, nome do contato...) tem uma lista de
// seletores candidatos em ordem de preferência — content/whatsapp-adapter.js
// tenta cada um até achar, nunca depende de um seletor único.
//
// AVISO EXPLÍCITO, NÃO ESCONDIDO (ver seção de riscos do plano): estes
// seletores foram escritos com base em conhecimento geral da estrutura do
// WhatsApp Web (data-testid, classes semânticas como .message-in/.message-out,
// atributos ARIA) — NÃO foram verificados contra a versão real e atual
// rodando no navegador de quem instalar isto. Não há como certificar que
// batem sem esse teste ao vivo, porque o WhatsApp Web é um app fechado,
// sem API pública, versionado pela Meta sem aviso.
//
// Depois de carregar a extensão com o WhatsApp Web aberto e logado, rode
// no console da aba do WhatsApp:
//   copilotoWhatsAppDiagnostico()
// Isso mostra, pra cada conceito abaixo, qual seletor bateu (e em que
// posição da lista) ou se nenhum bateu (MISS). Qualquer MISS ou "bateu só
// no último fallback" é sinal de que este arquivo precisa de ajuste — cole
// o resultado de volta pra quem estiver mantendo isto calibrar a tabela.
const COPILOTO_WA_SELETORES = {
  // Container que envolve a lista de mensagens da conversa aberta.
  painelMensagens: [
    '[data-testid="conversation-panel-messages"]',
    '[data-testid="conversation-panel-wrapper"]',
    'div[role="application"]',
  ],

  // Cada bolha de mensagem individual, recebida ou enviada.
  bolhaMensagem: [
    '.message-in, .message-out',
    'div[role="row"]',
  ],

  // Marca se uma bolha é ENVIADA (pelo atendente) — usado só pra decidir
  // from: 'me' vs 'lead' (ver copilotoWaClassificarOrigem). Não é um
  // conceito com fallback de busca — é checado sobre o elemento já achado
  // via bolhaMensagem, por isso fica separado (classList.contains, não
  // querySelector).
  classeMensagemEnviada: 'message-out',

  // Texto legível dentro de uma bolha.
  textoDaMensagem: [
    '.selectable-text.copyable-text',
    'span.selectable-text',
  ],

  // Elemento que carrega, num atributo (não no texto visível), metadado
  // "[HH:MM, DD/MM/AAAA] Nome: " da mensagem — quando existe, é a fonte
  // mais rica de timestamp+remetente; nunca é a ÚNICA fonte usada (ver
  // copilotoWaExtrairMetadados, que sempre tem um fallback pra Date.now()).
  metadadosMensagem: ['[data-pre-plain-text]'],

  // Cabeçalho da conversa aberta (nome/telefone do contato).
  cabecalhoConversa: [
    '[data-testid="conversation-info-header"]',
    'header',
  ],
  nomeContato: [
    '[data-testid="conversation-info-header"] span[dir="auto"][title]',
    'header span[dir="auto"][title]',
  ],

  // Caixa de digitação — usada só pra decisão futura (fase 8+) de "o
  // atendente está com o foco aqui, é seguro sugerir preencher"; a Fase 2
  // não escreve nada nela, só localiza pra diagnóstico.
  caixaDeTexto: [
    '[data-testid="conversation-compose-box-input"]',
    'div[role="textbox"][contenteditable="true"]',
  ],
};
