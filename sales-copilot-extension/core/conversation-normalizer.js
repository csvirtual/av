// ---------- Conversation Normalizer ----------
//
// Fase 1 da evolução do Copiloto (ver documento de arquitetura da sessão).
// Recebe o que o WhatsApp Adapter (fase 2+) vai extrair do DOM — formato
// possivelmente inconsistente entre versões do WhatsApp Web, e entre as
// próprias iterações do Adapter conforme o seletor precisar mudar — e
// devolve sempre a MESMA forma, pra todo o resto do sistema (Conversation
// Context Manager, Sales Engine) nunca precisar saber como o DOM foi lido.
//
// Nenhum arquivo existente carrega isto ainda — zero efeito no
// comportamento atual da extensão. Escrito e testado agora, antes do
// Adapter existir, porque o formato de saída é o contrato que o resto das
// fases vai depender — travá-lo cedo evita retrabalho em cascata depois.
//
// Forma canônica de uma mensagem: { id, from: 'lead'|'me', text, timestamp }

function copilotoNormalizarMensagem(bruta) {
  if (!bruta || typeof bruta !== 'object') return null;
  const texto = String(bruta.text ?? bruta.texto ?? '').trim();
  // Mensagem sem texto (áudio, imagem sem legenda, figurinha, mensagem
  // apagada) — fora de escopo por ora (ver seção "Leitura do WhatsApp" do
  // plano). Nunca vira string vazia pro resto do sistema: melhor descartar
  // aqui do que o Context Manager ter que filtrar isso mais adiante.
  if (!texto) return null;
  const deMim = bruta.from === 'me' || bruta.fromMe === true || bruta.enviadaPorMim === true;
  const timestamp = Number(bruta.timestamp) || Date.now();
  // Fallback de id quando o Adapter não conseguir um identificador estável
  // do DOM (ver seção "Não confie em seletores frágeis" do plano) — nunca
  // deixa a mensagem sem id, mesmo sem um vindo da extração.
  const id = String(bruta.id || bruta.dataId || `${timestamp}-${texto.slice(0, 20)}`);
  return { id, from: deMim ? 'me' : 'lead', text: texto, timestamp };
}

// `brutas`: array na ordem que o Adapter extraiu — NÃO garantida
// cronológica (a lista de mensagens do WhatsApp pode ser lida de baixo pra
// cima, ou vir de mutações fora de ordem). Devolve sempre em ordem
// cronológica crescente e sem id duplicado (mantém a primeira ocorrência —
// relevante quando o mesmo trecho do DOM é reprocessado por engano em
// mutações consecutivas).
function copilotoNormalizarConversa(brutas) {
  if (!Array.isArray(brutas)) return [];
  const vistos = new Set();
  const normalizadas = [];
  for (const bruta of brutas) {
    const msg = copilotoNormalizarMensagem(bruta);
    if (!msg || vistos.has(msg.id)) continue;
    vistos.add(msg.id);
    normalizadas.push(msg);
  }
  normalizadas.sort((a, b) => a.timestamp - b.timestamp);
  return normalizadas;
}
