// Impede o sistema de operar em mais de uma aba do navegador ao mesmo
// tempo — achado do usuário: só avisar ("já está aberto em outra aba") não
// bastava, ele queria a segunda aba REALMENTE bloqueada, não só sinalizada,
// operando única e exclusivamente numa aba de cada vez.
//
// Sem permissão de `tabs` (o app não pede essa permissão, de propósito —
// ver README, "pedir o mínimo possível"), não dá pra perguntar ao Chrome
// quantas abas existem nem que aba é a mais antiga. Em vez disso, cada aba
// registra um "batimento" periódico em chrome.storage.session
// (compartilhado entre todas as abas da extensão) com um id só dela — id
// esse que já embute o instante do registro (`Date.now()-aleatório`), então
// ordenar os ids em ordem alfabética também ordena por "quem abriu
// primeiro". Uma aba fechada simplesmente para de bater e some da lista
// sozinha depois de alguns segundos sem batimento (não depende de nenhum
// evento de fechamento — beforeunload não é confiável pra escrita
// assíncrona).
//
// A cada batimento, cada aba reavalia sozinha (olhando o mesmo mapa
// compartilhado) se ELA é a mais antiga viva no momento — só essa, a
// "vencedora" da eleição, tem permissão de rodar o app de verdade. Como
// todas as abas fazem essa mesma conta determinística sobre o mesmo dado
// compartilhado, todas concordam sempre em qual é a vencedora, mesmo com
// 3+ abas abertas ao mesmo tempo — e se a vencedora fechar, a próxima mais
// antiga assume sozinha no batimento seguinte, sem qualquer aba ficar
// "travada" achando pra sempre que ainda tem outra aberta.
const KEY = 'tabPresence';
const HEARTBEAT_MS = 4000;
const STALE_MS = 9000; // ~2 batimentos perdidos = considera a aba fechada

/** Achado de auditoria (crítico — travaria a aba pra praticamente todo
 * mundo, mais cedo ou mais tarde): um id gerado do zero a cada carregamento
 * de página trata um F5, ou o Chrome "descartando" uma aba ociosa pra
 * economizar memória e recarregando sozinho ao voltar pra ela (comum,
 * automático, sem o usuário pedir) exatamente como se fosse uma aba
 * DIFERENTE — a entrada antiga desta MESMA aba ainda está "fresca" no mapa
 * compartilhado (poucos segundos, não deu tempo de ficar obsoleta), então
 * a aba recarregada se via "mais nova" que si mesma e se bloqueava
 * sozinha por até ~9s. `sessionStorage` (diferente de
 * chrome.storage.session) é por ABA de verdade — sobrevive a recarregar a
 * mesma aba, mas nasce vazio numa aba nova de verdade (inclusive
 * duplicada) ou ao reabrir a aba depois de fechada. Guardando o id ali,
 * uma aba recarregada continua sendo "ela mesma" pro resto do mecanismo,
 * nunca se confunde com um fantasma de si própria. */
const myTabId = (() => {
  try {
    let id = sessionStorage.getItem('tabPresenceId');
    if (!id) {
      id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('tabPresenceId', id);
    }
    return id;
  } catch {
    // sessionStorage indisponível por algum motivo raro (modo de
    // navegação restrito, storage bloqueado) — degrada pro comportamento
    // antigo (id novo a cada carregamento) em vez de quebrar o app inteiro.
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
})();

async function readPresence() {
  const data = await chrome.storage.session.get(KEY);
  return data[KEY] || {};
}

/** Ids ordenados alfabeticamente == ordenados por instante de registro
 * (Date.now() no início de cada id, sempre com a mesma quantidade de
 * dígitos hoje em dia — um empate exato no mesmo milissegundo, quase
 * impossível na prática, ainda desempata de forma estável pelo sufixo
 * aleatório). O primeiro da lista é sempre a aba mais antiga viva. */
function iAmTheOldestAlive(liveIds) {
  return liveIds.length === 0 || [...liveIds].sort()[0] === myTabId;
}

/** Registra esta aba e liga o batimento periódico (roda pra sempre — a aba
 * fechando para o batimento sozinha, sem precisar de limpeza explícita).
 * Chama `onChange(souAVencedora, existeOutraAbaViva)` uma vez logo de
 * início e depois a cada batimento, sempre que o resultado da eleição
 * pode ter mudado — quem chama decide o que fazer com isso (ver app.js:
 * só a vencedora roda o app de verdade). */
export function watchTabPresence(onChange) {
  async function tick() {
    const now = Date.now();
    const map = await readPresence();
    for (const [id, ts] of Object.entries(map)) {
      if (now - ts > STALE_MS) delete map[id]; // limpa abas mortas — qualquer aba viva faz essa faxina sozinha
    }
    const otherTabAlive = Object.keys(map).some((id) => id !== myTabId);
    map[myTabId] = now;
    await chrome.storage.session.set({ [KEY]: map });
    onChange(iAmTheOldestAlive(Object.keys(map)), otherTabAlive);
  }
  tick();
  setInterval(tick, HEARTBEAT_MS);
}
