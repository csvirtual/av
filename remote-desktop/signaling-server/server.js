'use strict';

/**
 * cs-remote-desktop — servidor de sinalização
 * ---------------------------------------------
 * Responsabilidade única: parear um HOST (a máquina que vai ser controlada)
 * com um VIEWER (quem está controlando) através de um código de acesso, e
 * repassar (relay) as mensagens de sinalização WebRTC (SDP offer/answer e
 * ICE candidates) entre os dois.
 *
 * Este servidor NUNCA vê vídeo, áudio, mouse ou teclado — depois que o
 * WebRTC conecta, tudo passa direto (P2P, criptografado com DTLS-SRTP) entre
 * host e viewer. O servidor só participa da etapa de "aperto de mão" inicial.
 *
 * Modelo de sala (room):
 *   - 1 host registra-se e recebe um código numérico de 6 dígitos.
 *   - 1 viewer entra usando esse código.
 *   - Sala é 1:1 — assim que o viewer entra, o código é invalidado para
 *     qualquer outra tentativa (evita que duas pessoas usem o mesmo código).
 *   - Código expira sozinho se ninguém entrar dentro de CODE_TTL_MS.
 *   - Se o host cair, a sala é destruída e o viewer é avisado.
 */

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const CODE_TTL_MS = Number(process.env.CODE_TTL_MS || 5 * 60 * 1000); // 5 min p/ usar o código
const SESSION_IDLE_TTL_MS = Number(process.env.SESSION_IDLE_TTL_MS || 12 * 60 * 60 * 1000); // 12h
const HEARTBEAT_INTERVAL_MS = 30_000;

// --- Rate limiting simples por IP (mitiga brute-force de código de 6 dígitos) ---
const MAX_JOIN_ATTEMPTS = Number(process.env.MAX_JOIN_ATTEMPTS || 8);
const JOIN_WINDOW_MS = Number(process.env.JOIN_WINDOW_MS || 60_000);
const joinAttempts = new Map(); // ip -> { count, windowStart }

function isRateLimited(ip) {
  const now = Date.now();
  const entry = joinAttempts.get(ip);
  if (!entry || now - entry.windowStart > JOIN_WINDOW_MS) {
    joinAttempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_JOIN_ATTEMPTS;
}

// --- Estado das salas ---
/** @type {Map<string, Room>} */
const rooms = new Map();

function generateCode() {
  // 6 dígitos, sem zeros à esquerda ambíguos — string sempre com 6 chars.
  let code;
  do {
    code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  } while (rooms.has(code));
  return code;
}

class Room {
  constructor(code, hostSocket) {
    this.code = code;
    this.host = hostSocket;
    this.viewer = null;
    this.createdAt = Date.now();
    this.expiresAt = Date.now() + CODE_TTL_MS;
    this.expiryTimer = setTimeout(() => this.expireIfUnused(), CODE_TTL_MS);
  }

  expireIfUnused() {
    if (!this.viewer && rooms.get(this.code) === this) {
      send(this.host, { type: 'code-expired', code: this.code });
      this.destroy();
    }
  }

  destroy() {
    clearTimeout(this.expiryTimer);
    rooms.delete(this.code);
  }
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function fail(ws, code, message) {
  send(ws, { type: 'error', code, message });
}

// --- HTTP: apenas health-check (útil para plataformas de deploy) ---
const httpServer = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 256 * 1024 });

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown';
  ws.isAlive = true;
  ws.role = null; // 'host' | 'viewer'
  ws.room = null; // código da sala

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return fail(ws, 'bad-json', 'Mensagem inválida.');
    }
    if (!msg || typeof msg.type !== 'string') {
      return fail(ws, 'bad-message', 'Campo "type" ausente.');
    }

    switch (msg.type) {
      case 'host-register': {
        const code = generateCode();
        const room = new Room(code, ws);
        rooms.set(code, room);
        ws.role = 'host';
        ws.room = code;
        send(ws, { type: 'host-registered', code, expiresAt: room.expiresAt });
        break;
      }

      case 'viewer-join': {
        const code = String(msg.code || '').trim();
        if (isRateLimited(ip)) {
          return fail(ws, 'rate-limited', 'Muitas tentativas. Aguarde um minuto.');
        }
        const room = rooms.get(code);
        if (!room) {
          return fail(ws, 'invalid-code', 'Código inválido ou expirado.');
        }
        if (room.viewer) {
          return fail(ws, 'room-full', 'Essa sessão já tem um viewer conectado.');
        }
        clearTimeout(room.expiryTimer);
        room.viewer = ws;
        ws.role = 'viewer';
        ws.room = code;
        send(ws, { type: 'joined', code });
        send(room.host, { type: 'viewer-joined' });
        break;
      }

      // Relay opaco de SDP offer/answer e ICE candidates.
      case 'signal': {
        const room = rooms.get(ws.room || '');
        if (!room) return fail(ws, 'no-room', 'Você não está em uma sessão.');
        const peer = ws.role === 'host' ? room.viewer : room.host;
        if (!peer) return fail(ws, 'no-peer', 'O outro lado ainda não conectou.');
        send(peer, { type: 'signal', from: ws.role, data: msg.data });
        break;
      }

      case 'leave': {
        closeRoom(ws, 'peer-left');
        break;
      }

      default:
        fail(ws, 'unknown-type', `Tipo desconhecido: ${msg.type}`);
    }
  });

  ws.on('close', () => closeRoom(ws, ws.role === 'host' ? 'host-left' : 'viewer-left'));
  ws.on('error', () => closeRoom(ws, 'error'));
});

function closeRoom(ws, reasonForPeer) {
  if (!ws.room) return;
  const room = rooms.get(ws.room);
  if (!room) return;

  if (ws.role === 'host') {
    if (room.viewer) send(room.viewer, { type: reasonForPeer });
    room.destroy();
  } else if (ws.role === 'viewer') {
    room.viewer = null;
    send(room.host, { type: reasonForPeer });
    // Sala volta a ficar "aberta" só até o TTL original — depois disso o
    // host precisa gerar um código novo (evita reuso indefinido do mesmo
    // código após alguém já ter usado).
    room.expiryTimer = setTimeout(() => room.expireIfUnused(), Math.max(0, room.expiresAt - Date.now()));
  }
  ws.room = null;
  ws.role = null;
}

// Heartbeat: derruba conexões mortas (evita salas fantasmas).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

// Limpeza periódica de salas órfãs (defensivo).
const janitor = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.viewer && now - room.createdAt > SESSION_IDLE_TTL_MS) {
      room.destroy();
    }
  }
}, 60_000);

httpServer.listen(PORT, () => {
  console.log(`[cs-remote-desktop] signaling server ouvindo na porta ${PORT}`);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
function shutdown() {
  clearInterval(heartbeat);
  clearInterval(janitor);
  wss.close(() => httpServer.close(() => process.exit(0)));
}
