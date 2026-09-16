import { db } from '../db/index.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — turno de loja, folgado

const INSERT_SQL = 'INSERT INTO sessions (token, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)';
const GET_SQL = 'SELECT * FROM sessions WHERE token = ?';
const TOUCH_SQL = 'UPDATE sessions SET last_seen_at = ? WHERE token = ?';
const DELETE_SQL = 'DELETE FROM sessions WHERE token = ?';
const DELETE_EXPIRED_SQL = 'DELETE FROM sessions WHERE last_seen_at < ?';

// `targetDb` opcional em todo este arquivo (etapa 5 do roteiro multi-tenant,
// ver artifact "PDV Multi-Tenant") — normalmente req.db, resolvido pelo
// tenant da requisição. Sem ele (todo call site de hoje, inclusive o
// middleware de sessão em server.js), lê/grava no banco fixo do processo,
// comportamento idêntico a sempre.
export function createSession(userId, targetDb = db) {
  const token = crypto.randomUUID();
  const now = Date.now();
  targetDb.prepare(INSERT_SQL).run(token, userId, now, now);
  return token;
}

/** Retorna o user_id da sessão se o token for válido e não tiver expirado
 * por inatividade — senão null. Cada chamada renova o "last_seen_at" (igual
 * ao idle-timeout da extensão single-machine, session.js), então um
 * terminal em uso constante nunca expira no meio do expediente. */
export function resolveSession(token, targetDb = db) {
  if (!token) return null;
  const row = targetDb.prepare(GET_SQL).get(token);
  if (!row) return null;
  const now = Date.now();
  if (now - row.last_seen_at > SESSION_TTL_MS) {
    targetDb.prepare(DELETE_SQL).run(token);
    return null;
  }
  targetDb.prepare(TOUCH_SQL).run(now, token);
  return row.user_id;
}

export function destroySession(token, targetDb = db) {
  if (token) targetDb.prepare(DELETE_SQL).run(token);
}

export function sweepExpiredSessions(targetDb = db) {
  targetDb.prepare(DELETE_EXPIRED_SQL).run(Date.now() - SESSION_TTL_MS);
}
