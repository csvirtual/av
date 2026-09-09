// ---------- Logger estruturado (DEBUG/INFO/WARN/ERROR) ----------
//
// Parte da Fase 1 da evolução do Copiloto pra ler o WhatsApp Web (ver
// documento de arquitetura da sessão). Existe ANTES do WhatsApp Adapter
// (fase 2+) de propósito: quando o Adapter começar a existir, ele já
// encontra um jeito único de logar em vez de inventar console.log solto
// espalhado, igual ao resto do projeto faz hoje (console.error dentro de
// try/catch, sem nível nem estrutura).
//
// Nenhum arquivo existente carrega isto ainda — zero efeito no
// comportamento atual da extensão.
//
// REGRA DE OURO (seção 15 do plano de arquitetura): `dados` deve ser
// sempre metadados técnicos (contagens, ids técnicos, nomes de estágio,
// duração em ms) — NUNCA texto de mensagem, nome, telefone, CPF ou
// qualquer campo listado em CAMPOS_LEAD_CIFRADOS (panel.js). O logger não
// tem como adivinhar o que é sensível dentro de um objeto arbitrário —
// essa responsabilidade é de quem chama copilotoLog.
const COPILOTO_LOG_NIVEIS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

// DEBUG fica ligado enquanto o WhatsApp Adapter e as camadas novas (Context
// Manager, Funnel State Machine) estão em desenvolvimento ativo (fases
// 2-8). Antes de qualquer publicação real, trocar pra 'INFO' ou 'WARN' —
// ver copilotoDefinirNivelDeLog abaixo.
let _copilotoLogNivelMinimo = COPILOTO_LOG_NIVEIS.DEBUG;

function copilotoDefinirNivelDeLog(nivel) {
  if (COPILOTO_LOG_NIVEIS[nivel] === undefined) return;
  _copilotoLogNivelMinimo = COPILOTO_LOG_NIVEIS[nivel];
}

function copilotoNivelDeLogAtual() {
  return Object.keys(COPILOTO_LOG_NIVEIS).find((k) => COPILOTO_LOG_NIVEIS[k] === _copilotoLogNivelMinimo);
}

// `tag`: identifica de onde veio (ex.: 'whatsapp-adapter', 'conversation-context').
// `dados`: metadados técnicos opcionais — ver REGRA DE OURO acima.
function copilotoLog(nivel, tag, dados) {
  const nivelNum = COPILOTO_LOG_NIVEIS[nivel];
  if (nivelNum === undefined || nivelNum < _copilotoLogNivelMinimo) return;
  const linha = `[copiloto:${nivel}] ${tag}`;
  const metodo = nivel === 'ERROR' ? console.error : nivel === 'WARN' ? console.warn : console.log;
  if (dados !== undefined) metodo(linha, dados);
  else metodo(linha);
}
