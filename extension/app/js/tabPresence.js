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
// tempo, trato como morta. Precisa ser bem MAIOR que HEARTBEAT_MS — não só
// pela variação normal de timing, mas porque o Chrome propositalmente
// "engorda" o intervalo de setInterval/setTimeout de uma aba em segundo
// plano (fora de foco) pra economizar bateria: o piso documentado é ~1
// batimento por segundo depois de poucos segundos sem foco (podendo ficar
// ainda mais espaçado se a aba ficar minutos parada em segundo plano). Uma
// aba original perfeitamente viva, só que em segundo plano nesse momento,
// PRECISA sobreviver a esta checagem — se PROBE_MS fosse curto demais, uma
// aba nova aberta em primeiro plano concluiria (errado) que a original
// morreu, e as duas ficariam operando ao mesmo tempo — voltando exatamente
// ao problema que esta função existe pra evitar. 2.5s dá folga de sobra
// acima do piso normal de 1s do Chrome, mantendo a detecção de uma aba
// REALMENTE fechada ainda muito mais rápida que os ~9-13s de antes.
const PROBE_MS = 2500;
const STALE_MS = 8000; // teto absoluto de segurança — bem acima de PROBE_MS, ver comentário na função abaixo

/** Achado de auditoria GRAVE (usuário reportou em produção): uma versão
 * anterior guardava este id em `sessionStorage` de propósito, pra uma aba
 * recarregada (F5) continuar "sendo ela mesma" em vez de se confundir com
 * um fantasma de si própria. Só que `sessionStorage` é justamente o que o
 * Chrome CLONA ao duplicar uma aba — então a aba duplicada nascia com o
 * MESMO id da original, as duas escreviam por cima da mesma entrada no
 * registro compartilhado, e o mecanismo inteiro ficava cego: nenhuma
 * aviso, nenhum bloqueio, exatamente o oposto do que deveria acontecer.
 * Voltou a ser um id novo, aleatório, a cada carregamento de página — o
 * problema original do F5 (a entrada antiga "fresca demais" bloqueando a
 * aba recarregada) já é resolvido pela confirmação por batimento em
 * watchTabPresence() logo abaixo, que não depende de nenhuma identidade
 * persistida: ela detecta sozinha, em poucos segundos, que a entrada antiga
 * parou de ser atualizada, não importa o motivo (reload, fechamento,
 * fantasma de duplicação ou qualquer outra coisa). */
const myTabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
