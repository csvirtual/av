// Canal de atualização em tempo real do lado do cliente — conecta uma vez
// no WebSocket que o servidor já expõe em /ws (lib/broadcast.js manda um
// aviso {topic, ...} depois de qualquer rota gravar no banco; mesmo padrão
// já usado por public/test.html desde a Fase 1). Aqui só a conexão +
// reconexão com backoff e um pub/sub simples por cima — quem decide o que
// fazer com cada aviso é public/js/app.js, não este módulo.
let ws = null;
const listeners = new Set();

/** Registra um handler(msg) chamado a cada aviso recebido. Devolve uma
 * função pra cancelar o registro. */
export function onLiveMessage(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

/** Idempotente — chamar de novo com uma conexão já aberta não faz nada. */
export function connectLive() {
  if (ws) return;
  open();
}

function open() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.addEventListener('close', () => {
    ws = null;
    setTimeout(open, 2000);
  });
  ws.addEventListener('error', () => ws?.close());
  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    for (const handler of listeners) handler(msg);
  });
}
