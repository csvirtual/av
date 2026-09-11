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

// Achado de auditoria (P3): salt/hash fixos, só pra pagar o MESMO custo de
// PBKDF2 (150 mil iterações) quando o usuário não existe ou está inativo —
// sem isso, essas duas respostas voltavam quase instantâneas (sem rodar
// verifyPasswordHash nenhuma vez), enquanto um usuário real sempre rodava o
// PBKDF2 inteiro antes de decidir certo/errado. A diferença de tempo entre
// os dois casos permitia, em teoria, descobrir por tentativa e erro quais
// contas existem só medindo quanto tempo cada resposta demora — mesmo a
// mensagem de erro sendo sempre genérica. Nunca é usado pra autenticar
// ninguém de verdade (o resultado de verifyPasswordHash aqui é sempre
// descartado) — só existe pra igualar o tempo gasto.
const DUMMY_SALT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const DUMMY_HASH = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

export async function verifyLogin(username, password, { namespace } = {}) {
  const lockState = getLoginLockState(username, namespace);
  if (lockState.remainingMs > 0) return null;

  const row = findByUsernameStmt.get(String(username || '').trim().toLowerCase());
  if (!row) {
    await verifyPasswordHash(password, DUMMY_SALT, DUMMY_HASH);
    recordFailedLogin(username, namespace);
    return null;
  }
  const user = JSON.parse(row.data);
  if (!user.active) {
    await verifyPasswordHash(password, DUMMY_SALT, DUMMY_HASH);
    recordFailedLogin(username, namespace);
    return null;
  }
  const ok = await verifyPasswordHash(password, user.passwordSalt, user.passwordHash);
  if (!ok) {
    recordFailedLogin(username, namespace);
    return null;
  }
  clearLoginLock(username, namespace);
  return user;
}
