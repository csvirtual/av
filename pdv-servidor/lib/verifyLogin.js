// Fase 8 (segurança): checagem de usuário+senha compartilhada por TODO
// lugar que precisa reconferir uma senha — login em si (routes/auth.js) e
// qualquer confirmação por senha de admin (ex: aprovar desconto acima do
// limite em routes/sales.js). O bloqueio por força bruta (lib/loginLockout.js)
// vive AQUI, não em cada chamador — nenhum lugar do sistema consegue testar
// senha em looping sem passar por essa trava, mesmo uma confirmação que não
// seja a tela de login propriamente dita.
import { db } from '../db/index.js';
import { verifyPasswordHash } from './auth.js';
import { getLoginLockState, recordFailedLogin, clearLoginLock } from './loginLockout.js';

const findByUsernameStmt = db.prepare('SELECT data FROM users WHERE username_lower = ?');

export async function verifyLogin(username, password) {
  const lockState = getLoginLockState(username);
  if (lockState.remainingMs > 0) return null;

  const row = findByUsernameStmt.get(String(username || '').trim().toLowerCase());
  if (!row) {
    recordFailedLogin(username);
    return null;
  }
  const user = JSON.parse(row.data);
  if (!user.active) {
    recordFailedLogin(username);
    return null;
  }
  const ok = await verifyPasswordHash(password, user.passwordSalt, user.passwordHash);
  if (!ok) {
    recordFailedLogin(username);
    return null;
  }
  clearLoginLock(username);
  return user;
}
