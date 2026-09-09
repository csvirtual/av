// ---------- Conversation Context Manager ----------
//
// Fase 1 da evolução do Copiloto (ver documento de arquitetura da sessão,
// seção "Estratégia de contexto"). Generaliza, pra mensagens vindas do
// WhatsApp Adapter (fase 2+), a mesma ideia que panel.js#analyzeAndSuggest
// já implementa hoje pra texto colado manualmente (ver "Detecção de
// duplicata + contexto incremental" em panel.js): nunca reenviar pra IA o
// que já foi processado, só o que é realmente novo.
//
// Diferença deliberada em relação à versão atual (paste manual): lá a
// detecção é por PREFIXO DE STRING (o texto colado de novo começa
// exatamente igual ao anterior?) — a única opção possível quando a entrada
// é um blob de texto sem fronteira entre mensagens. Aqui, como o Adapter
// entrega mensagens DISCRETAS com timestamp (via
// core/conversation-normalizer.js), a mesma ideia fica mais simples e mais
// confiável: guardamos até QUANDO já processamos, e o "pendente" é
// qualquer mensagem do lead mais nova que isso. Isto é uma evolução, não
// uma divergência de comportamento — o fluxo de paste manual
// (prepararGeracaoIA/analyzeAndSuggest em panel.js) continua existindo e
// intocado como caminho alternativo (fase 5 é quem decide, por lead, qual
// fonte usar).
//
// Nenhum arquivo existente carrega isto ainda — zero efeito no
// comportamento atual da extensão.

// `tamanhoJanela`: quantas mensagens recentes (lead + atendente) ficam
// disponíveis pra copilotoContextoJanela — não limita quantas mensagens o
// contexto GUARDA no total (isso é papel de uma estratégia de resumo, ainda
// não implementada — ver seção J do plano de arquitetura), só quanto é
// exposto de uma vez pra montar prompt.
function copilotoContextoCriar(leadId, tamanhoJanela) {
  return {
    leadId,
    tamanhoJanela: tamanhoJanela || 20,
    mensagens: [],
    ultimoProcessadoAte: 0, // timestamp da última mensagem já enviada pra IA com sucesso
  };
}

// Mescla mensagens novas (formato bruto do Adapter) no contexto —
// normaliza, deduplica por id e mantém ordem cronológica. Idempotente:
// reprocessar a mesma mensagem (id repetido) nunca duplica.
function copilotoContextoAdicionarMensagens(contexto, mensagensBrutas) {
  const normalizadas = copilotoNormalizarConversa(mensagensBrutas);
  if (!normalizadas.length) return contexto;
  const idsExistentes = new Set(contexto.mensagens.map((m) => m.id));
  for (const msg of normalizadas) {
    if (!idsExistentes.has(msg.id)) contexto.mensagens.push(msg);
  }
  contexto.mensagens.sort((a, b) => a.timestamp - b.timestamp);
  return contexto;
}

// Texto que efetivamente iria pra IA na próxima chamada: só mensagens do
// LEAD (nunca as que o próprio atendente já mandou) chegadas depois da
// última vez que uma resposta foi gerada com sucesso pra este contexto.
// Devolve null quando não há nada pendente — sinal pra quem chama de que
// não vale a pena (nem custa) disparar uma chamada de IA agora.
function copilotoContextoTextoPendente(contexto) {
  const pendentes = contexto.mensagens.filter(
    (m) => m.from === 'lead' && m.timestamp > contexto.ultimoProcessadoAte
  );
  if (!pendentes.length) return null;
  return pendentes.map((m) => m.text).join('\n');
}

// Chamada depois que uma resposta é gerada com sucesso pra este contexto —
// marca até onde já foi processado. Sem isto, copilotoContextoTextoPendente
// reenviaria a mesma mensagem em toda chamada seguinte.
function copilotoContextoMarcarProcessado(contexto) {
  if (!contexto.mensagens.length) return;
  contexto.ultimoProcessadoAte = contexto.mensagens[contexto.mensagens.length - 1].timestamp;
}

// Últimas `tamanhoJanela` mensagens (lead + atendente), em ordem
// cronológica — o que entraria num futuro bloco "histórico recente da
// conversa" no prompt (fase 5), em vez de só a última mensagem pendente.
function copilotoContextoJanela(contexto) {
  const n = contexto.tamanhoJanela || 20;
  return contexto.mensagens.slice(-n);
}
