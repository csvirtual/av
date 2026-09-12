import { db } from '../db/index.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — turno de loja, folgado

const insertSession = db.prepare('INSERT INTO sessions (token, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)');
const getSession = db.prepare('SELECT * FROM sessions WHERE token = ?');
const touchSession = db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token = ?');
const deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const deleteExpired = db.prepare('DELETE FROM sessions WHERE last_seen_at < ?');

export function createSession(userId) {
  const token = crypto.randomUUID();
  const now = Date.now();
  insertSession.run(token, userId, now, now);
  return token;
}

/** Retorna o user_id da sessão se o token for válido e não tiver expirado
 * por inatividade — senão null. Cada chamada renova o "last_seen_at" (igual
 * ao idle-timeout da extensão single-machine, session.js), então um
 * terminal em uso constante nunca expira no meio do expediente. */
export function resolveSession(token) {
  if (!token) return null;
  const row = getSession.get(token);
  if (!row) return null;
  const now = Date.now();
  if (now - row.last_seen_at > SESSION_TTL_MS) {
    deleteSession.run(token);
    return null;
  }
  touchSession.run(now, token);
  return row.user_id;
}

export function destroySession(token) {
  if (token) deleteSession.run(token);
}

export function sweepExpiredSessions() {
  deleteExpired.run(Date.now() - SESSION_TTL_MS);
}
