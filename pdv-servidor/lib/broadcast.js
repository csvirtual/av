// Canal simples de avisos em tempo real pros terminais conectados — cada
// rota que muda dado chama broadcast(...) depois de gravar no banco, e todo
// terminal com a tela aberta recebe o aviso por WebSocket e recarrega a
// tela atual (reaproveitando a própria função refresh() de cada view, do
// lado do cliente — o servidor só avisa "mudou algo em X", não manda o dado
// pronto, mantém o servidor simples).
//
// Etapa 6 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): um
// `Set` único avisava TODO terminal conectado ao processo, de qualquer
// loja — inofensivo até aqui porque cada rota ainda não sabia de tenant
// nenhum, mas exatamente o vazamento que faltava fechar depois da etapa 5
// (conversão de rota pra rota): sem isto, um terminal da Loja A recarregaria
// a tela sozinho toda vez que a Loja B vendesse algo. Vira um
// `Map<tenantKey, Set<ws>>` — uma "sala" por loja. `LEGACY_TENANT_KEY` é a
// mesma chave usada em db/index.js pro processo sem MULTI_TENANT_DOMAIN
// configurada: nesse caso, todo mundo cai na mesma sala única, comportamento
// idêntico a antes desta etapa.
const LEGACY_TENANT_KEY = '__legacy__';
const rooms = new Map();

function roomFor(tenantId) {
  const key = tenantId || LEGACY_TENANT_KEY;
  let room = rooms.get(key);
  if (!room) {
    room = new Set();
    rooms.set(key, room);
  }
  return room;
}

export function registerClient(ws, tenantId) {
  const room = roomFor(tenantId);
  room.add(ws);
  ws.on('close', () => {
    room.delete(ws);
    if (room.size === 0) rooms.delete(tenantId || LEGACY_TENANT_KEY);
  });
}

export function broadcast(topic, payload = {}, tenantId) {
  const message = JSON.stringify({ topic, ...payload, at: Date.now() });
  const room = rooms.get(tenantId || LEGACY_TENANT_KEY);
  if (!room) return;
  for (const ws of room) {
    if (ws.readyState === ws.OPEN) ws.send(message);
  }
}

// Achado de auditoria (P4): `httpServer.close()` no desligamento gracioso
// (ver server.js) só chama seu callback depois que TODA conexão ativa
// fechar sozinha — e uma conexão WebSocket upgraded fica contada como
// "ativa" até o cliente (ou o servidor) fechar explicitamente, então um
// terminal com a aba aberta faria o servidor ficar esperando pra sempre.
// Chamado no desligamento antes de fechar o servidor HTTP, pra não
// depender do temporizador de segurança pra sair rápido.
export function closeAllClients() {
  for (const room of rooms.values()) {
    for (const ws of room) {
      try { ws.close(); } catch { /* melhor esforço */ }
    }
  }
  rooms.clear();
}
