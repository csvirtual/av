// Impede o sistema de rodar em mais de uma aba do MESMO NAVEGADOR ao mesmo
// tempo — mesmo mecanismo e mesmo motivo do tabPresence.js da extensão
// (só avisar "já está aberto em outra aba" não bastava, o usuário queria a
// segunda aba REALMENTE bloqueada), só que o registro compartilhado entre
// abas aqui é `localStorage` em vez de `chrome.storage.session` — mesmo
// raciocínio já usado em session.js (é uma trava "deste navegador", não da
// loja: dois TERMINAIS diferentes continuam rodando ao mesmo tempo o dia
// inteiro, sem problema nenhum — isso aqui só impede duas ABAS do MESMO
// terminal operando juntas).
//
// A extensão precisa desse mecanismo porque não pede a permissão `tabs`
// (não dá pra perguntar ao Chrome quantas abas existem); aqui a mesma
// lógica de "eleição por batimento" se aplica igual, mas com uma vantagem:
// localStorage é síncrono, então não existe a mesma janela de corrida por
// I/O assíncrono que `chrome.storage.session.get/set` tinha — só a espera
// de confirmação (PROBE_MS) proposital continua existindo.
const KEY = 'tabPresence';
const HEARTBEAT_MS = 300;
// Janela de confirmação: quando alguém aparenta ser mais antiga que eu,
// espero isso antes de aceitar — mesmo raciocínio da extensão (uma aba
// original em segundo plano pode ter seu timer "engordado" pelo navegador
// pra economizar bateria, precisa de folga pra não ser julgada morta à toa).
const PROBE_MS = 2500;
const STALE_MS = 8000; // teto absoluto de segurança — bem acima de PROBE_MS

// Novo a cada carregamento de página (nunca persistido) — mesmo raciocínio
// do achado de auditoria original da extensão: um id persistido em
// sessionStorage seria CLONADO por uma aba duplicada (Ctrl+duplicar
// aba/F5 com restauração), fazendo duas abas reivindicarem a mesma
// identidade e cegando o mecanismo inteiro.
const myTabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function readPresence() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function writePresence(map) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* localStorage indisponível (aba privada sem storage, cota) — sem batimento, esta aba nunca vence a eleição sozinha, fica bloqueada com segurança */ }
}

/** Registra esta aba e liga o batimento periódico. Chama
 * `onChange(souAVencedora, existeOutraAbaViva)` uma vez logo de início e
 * depois a cada verificação, sempre que o resultado da eleição pode ter
 * mudado — quem chama decide o que fazer com isso (ver app.js: só a
 * vencedora roda o app de verdade). */
export function watchTabPresence(onChange) {
  let running = false; // evita duas execuções de tick() sobrepostas (o probe interno leva mais que HEARTBEAT_MS)

  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      let map = readPresence();
      for (const [id, ts] of Object.entries(map)) {
        if (now - ts > STALE_MS) delete map[id]; // teto de segurança — normalmente a confirmação abaixo resolve bem mais rápido
      }
      map[myTabId] = now;
      writePresence(map);

      let liveIds = Object.keys(map).sort();
      if (liveIds[0] !== myTabId) {
        // Alguém aparenta ser mais antiga — confirma que ela ainda está
        // batendo de verdade antes de aceitar isso.
        const rivalId = liveIds[0];
        const rivalTsBefore = map[rivalId];
        await new Promise((r) => setTimeout(r, PROBE_MS));
        const mapAfterProbe = readPresence();
        const rivalTsAfter = mapAfterProbe[rivalId];
        if (rivalTsAfter === undefined || rivalTsAfter === rivalTsBefore) {
          delete mapAfterProbe[rivalId]; // não bateu durante a espera — morta de verdade
        }
        mapAfterProbe[myTabId] = Date.now();
        writePresence(mapAfterProbe);
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

  // Atalho de baixo custo (não é a garantia principal, ver acima): tenta
  // apagar a própria entrada já ao fechar/navegar pra fora desta aba —
  // deixa o caso comum (fechamento manual de verdade) ainda mais rápido
  // que esperar a confirmação por batimento.
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return; // só suspensa (cache de navegação), pode voltar — ver 'pageshow' abaixo
    const map = readPresence();
    delete map[myTabId];
    writePresence(map);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) tick();
  });
}
