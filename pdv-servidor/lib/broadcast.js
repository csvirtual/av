// Canal simples de avisos em tempo real pros terminais conectados — cada
// rota que muda dado chama broadcast(...) depois de gravar no banco, e todo
// terminal com a tela aberta recebe o aviso por WebSocket e recarrega a
// tela atual (reaproveitando a própria função refresh() de cada view, do
// lado do cliente — o servidor só avisa "mudou algo em X", não manda o dado
// pronto, mantém o servidor simples).
const clients = new Set();

export function registerClient(ws) {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
}

export function broadcast(topic, payload = {}) {
  const message = JSON.stringify({ topic, ...payload, at: Date.now() });
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(message);
  }
}
