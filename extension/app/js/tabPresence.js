// Impede o sistema de operar em mais de uma aba do navegador ao mesmo
// tempo — achado do usuário: só avisar ("já está aberto em outra aba") não
// bastava, ele queria a segunda aba REALMENTE bloqueada, não só sinalizada,
// operando única e exclusivamente numa aba de cada vez.
//
// Sem permissão de `tabs` (o app não pede essa permissão, de propósito —
// ver README, "pedir o mínimo possível"), não dá pra perguntar ao Chrome
// quantas abas existem nem qual é a mais antiga. Em vez disso, cada aba
// registra um "batimento" periódico em chrome.storage.session
// (compartilhado entre todas as abas da extensão) com um id só dela — id
// esse que já embute o instante do registro (`Date.now()-aleatório`), então
// ordenar os ids em ordem alfabética também ordena por "quem abriu
// primeiro". Só a mais antiga viva no momento (a "vencedora" da eleição)
// tem permissão de rodar o app de verdade — as demais ficam bloqueadas.
const KEY = 'tabPresence';
const HEARTBEAT_MS = 300;
// Janela de confirmação: quando alguém aparenta ser mais antiga que eu,
// espero isso antes de aceitar — se o batimento dela não avançar nesse
// tempo, trato como morta. Precisa ser MAIOR que HEARTBEAT_MS (senão uma
// aba genuinamente viva, só ainda não teve a vez de bater de novo, seria
// acusada de morta por engano); a folga extra cobre variação normal de
// timing.
const PROBE_MS = 700;
const STALE_MS = 3000; // teto absoluto de segurança — ver comentário na função abaixo

/** Achado de auditoria (crítico — travaria a aba pra praticamente todo
 * mundo, mais cedo ou mais tarde): um id gerado do zero a cada carregamento
 * de página trata um F5, ou o Chrome "descartando" uma aba ociosa pra
 * economizar memória e recarregando sozinho ao voltar pra ela (comum,
 * automático, sem o usuário pedir) exatamente como se fosse uma aba
 * DIFERENTE — a entrada antiga desta MESMA aba ainda está "fresca" no mapa
 * compartilhado, então a aba recarregada se via "mais nova" que si mesma
 * e se bloqueava sozinha. `sessionStorage` (diferente de
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

/** Registra esta aba e liga o batimento periódico. Chama
 * `onChange(souAVencedora, existeOutraAbaViva)` uma vez logo de início e
 * depois a cada verificação, sempre que o resultado da eleição pode ter
 * mudado — quem chama decide o que fazer com isso (ver app.js: só a
 * vencedora roda o app de verdade).
 *
 * Achado de auditoria (grave, achado só depois de implementar o resto):
 * fechar esta aba e abrir OUTRA logo em seguida (ex: clicar no ícone da
 * extensão de novo alguns segundos depois de fechar a única aba aberta)
 * fazia a aba nova se bloquear sozinha à toa — a entrada antiga ainda não
 * tinha "envelhecido" o bastante (pela idade absoluta) pra sumir sozinha.
 * Tentei resolver só com um evento de fechamento (`pagehide`) apagando a
 * própria entrada na hora, mas isso sozinho não é suficiente — um
 * fechamento de aba automatizado (comprovado em teste; possivelmente
 * também algum cenário real) pode não disparar esse evento a tempo, ou
 * nunca. A correção de verdade é abaixo: em vez de confiar na IDADE
 * absoluta de uma entrada concorrente, quando alguém aparenta ser mais
 * antiga que eu, espero uma janela curta (`PROBE_MS`) e confiro se o
 * batimento dela REALMENTE avançou nesse meio-tempo — se não avançou, é
 * porque parou de bater de verdade (fechou), e trato como morta ali
 * mesmo, sem esperar o teto de idade `STALE_MS`. `pagehide` continua
 * como atalho de baixo custo pro caso comum (fechamento manual de
 * verdade, fora de teste automatizado), deixando esse caso ainda mais
 * rápido — mas não é mais a única linha de defesa. */
export function watchTabPresence(onChange) {
  let running = false; // evita duas execuções de tick() sobrepostas (o probe interno pode levar mais que HEARTBEAT_MS)

  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      let map = await readPresence();
      for (const [id, ts] of Object.entries(map)) {
        if (now - ts > STALE_MS) delete map[id]; // teto de segurança — normalmente a confirmação abaixo resolve bem mais rápido
      }
      map[myTabId] = now;
      await chrome.storage.session.set({ [KEY]: map });

      let liveIds = Object.keys(map).sort();
      if (liveIds[0] !== myTabId) {
        // Alguém aparenta ser mais antiga — confirma que ela ainda está
        // batendo de verdade antes de aceitar isso.
        const rivalId = liveIds[0];
        const rivalTsBefore = map[rivalId];
        await new Promise((r) => setTimeout(r, PROBE_MS));
        const mapAfterProbe = await readPresence();
        const rivalTsAfter = mapAfterProbe[rivalId];
        if (rivalTsAfter === undefined || rivalTsAfter === rivalTsBefore) {
          delete mapAfterProbe[rivalId]; // não bateu durante a espera — morta de verdade
        }
        mapAfterProbe[myTabId] = Date.now();
        await chrome.storage.session.set({ [KEY]: mapAfterProbe });
        map = mapAfterProbe;
        liveIds = Object.keys(map).sort();
      }

      onChange(liveIds.length === 0 || liveIds[0] === myTabId, liveIds.some((id) => id !== myTabId));
    } finally {
      running = false;
    }
  }
  tick();
  setInterval(tick, HEARTBEAT_MS);

  // Atalho de baixo custo (não é mais a garantia principal, ver acima):
  // tenta apagar a própria entrada já ao fechar/navegar pra fora desta
  // aba — funciona pra fechamentos "normais" de verdade e deixa esse
  // caso comum ainda mais rápido que esperar a confirmação por batimento.
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return; // só suspensa (cache de navegação), pode voltar — ver 'pageshow' abaixo
    chrome.storage.session.get(KEY).then((data) => {
      const map = data[KEY] || {};
      delete map[myTabId];
      return chrome.storage.session.set({ [KEY]: map });
    }).catch(() => {});
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) tick();
  });
}
