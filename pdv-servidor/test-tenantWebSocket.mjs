// Etapa 6 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): prova
// de isolamento do canal de avisos em tempo real (WebSocket). Dois tenants
// distintos, um terminal conectado em cada um — uma mudança no tenant A
// (via HTTP) só pode acordar o terminal do tenant A; o terminal do tenant B
// nunca deve ver nada. Também confirma que uma conexão WebSocket com um
// Host desconhecido (fora de qualquer loja cadastrada) é recusada na hora.
//
// Uso: precisa de um servidor rodando com MULTI_TENANT_DOMAIN definida.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOMAIN = process.env.MULTI_TENANT_DOMAIN || 'pdv-csvirtual.com.br';
const PORT = Number(process.env.PORT) || 3131;

const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

function request(hostHeader, { method = 'GET', reqPath = '/api/status', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: reqPath, method,
      headers: {
        Host: hostHeader,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const setCookie = res.headers['set-cookie']?.[0]?.split(';')[0] || null;
        resolve({ status: res.statusCode, body: JSON.parse(data || '{}'), cookie: setCookie });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function connectWs(hostHeader) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Host: hostHeader } });
    const messages = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
    ws.on('close', () => resolve({ ws, messages, closedEarly: true }));
  });
}

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const { createNewTenant } = await import('./scripts/createTenant.js');
const { controlDb } = await import('./control/db.js');
const Database = (await import('better-sqlite3')).default;

const suffix = Date.now();
const slugA = `ws-a-${suffix}`;
const slugB = `ws-b-${suffix}`;
const tenantA = await createNewTenant(slugA, 'WS Tenant A', 'WS Tenant A');
const tenantB = await createNewTenant(slugB, 'WS Tenant B', 'WS Tenant B');

function patchAdmin(dbPath) {
  const tdb = new Database(dbPath);
  const row = tdb.prepare("SELECT * FROM users WHERE username_lower = 'admin'").get();
  const data = JSON.parse(row.data);
  data.mustChangePassword = false;
  tdb.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id);
  tdb.close();
}
patchAdmin(tenantA.dbPath);
patchAdmin(tenantB.dbPath);

const hostA = `${slugA}.${DOMAIN}`;
const hostB = `${slugB}.${DOMAIN}`;

let wsA, wsB, wsUnknown;
try {
  const loginA = await request(hostA, { method: 'POST', reqPath: '/api/auth/login', body: { username: 'admin', password: 'admin123' } });
  check('login no tenant A funciona', loginA.status === 200, loginA.status);
  const cookieA = loginA.cookie;

  const connA = await connectWs(hostA);
  const connB = await connectWs(hostB);
  wsA = connA.ws;
  wsB = connB.ws;
  check('WebSocket do tenant A conecta normalmente', connA.ws.readyState === WebSocket.OPEN, connA.ws.readyState);
  check('WebSocket do tenant B conecta normalmente', connB.ws.readyState === WebSocket.OPEN, connB.ws.readyState);

  // Host desconhecido (fora de qualquer loja cadastrada) — mesma regra de
  // acesso que o HTTP já aplica (404 "Loja não encontrada"), a conexão
  // WebSocket precisa ser recusada na hora.
  const connUnknown = await connectWs(`nao-existe-${suffix}.${DOMAIN}`);
  wsUnknown = connUnknown.ws;
  // O servidor fecha a conexão logo depois do handshake (ver
  // wss.on('connection', ...) em server.js) — o cliente ainda vê 'open'
  // primeiro (o handshake em si terminou), então dá um instante pro 'close'
  // do lado do servidor chegar antes de conferir o estado final.
  await waitFor(300);
  check('WebSocket com Host de loja inexistente é recusado', connUnknown.ws.readyState === WebSocket.CLOSED || connUnknown.ws.readyState === WebSocket.CLOSING, connUnknown.ws.readyState);

  // Ação real no tenant A (criar fornecedor) via HTTP — dispara
  // broadcast('suppliers-changed', ..., tenantId da loja A).
  const createSupplierA = await request(hostA, { method: 'POST', reqPath: '/api/suppliers', cookie: cookieA, body: { nome: 'Fornecedor WS A' } });
  check('fornecedor criado no tenant A (dispara o broadcast)', createSupplierA.status === 201, createSupplierA.status);

  // Tempo pro broadcast chegar nos dois sockets (ou não chegar, no caso do B).
  await waitFor(500);

  check('terminal do tenant A recebeu o aviso em tempo real', connA.messages.some((m) => m.topic === 'suppliers-changed'), JSON.stringify(connA.messages));
  check('terminal do tenant B NÃO recebeu nada da mudança no tenant A', !connB.messages.some((m) => m.topic === 'suppliers-changed'), JSON.stringify(connB.messages));
} finally {
  try { wsA?.close(); } catch { /* melhor esforço */ }
  try { wsB?.close(); } catch { /* melhor esforço */ }
  try { wsUnknown?.close(); } catch { /* melhor esforço */ }
  controlDb.prepare('DELETE FROM tenants WHERE slug IN (?, ?)').run(slugA, slugB);
  fs.rmSync(path.join(__dirname, 'tenants', slugA), { recursive: true, force: true });
  fs.rmSync(path.join(__dirname, 'tenants', slugB), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
