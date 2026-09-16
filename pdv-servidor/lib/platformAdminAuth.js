// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): login
// do painel de Super Admin — mesmo raciocínio de lib/verifyLogin.js
// (checagem de senha em tempo constante contra usuário inexistente/
// inativo, bloqueio por força bruta), só que contra `platform_admins`
// (colunas próprias — username_lower/password_salt/password_hash — não o
// blob `data` em JSON que a tabela `users` de cada loja usa) e sempre
// contra o banco de controle (nunca `req.db`: não existe "tenant" pra um
// admin da plataforma, é um único banco pro sistema inteiro).
import { controlDb } from '../control/db.js';
import { verifyPasswordHash } from './auth.js';
import { getLoginLockState, recordFailedLogin, clearLoginLock } from './loginLockout.js';

const FIND_BY_USERNAME_SQL = 'SELECT * FROM platform_admins WHERE username_lower = ?';

// Namespace próprio (nunca o mesmo do login de loja) — mesmo raciocínio
// documentado em lib/loginLockout.js: dois mecanismos de bloqueio
// completamente independentes, um vendedor errando a senha várias vezes
// numa loja nunca afeta o bloqueio de um admin da plataforma, e vice-versa.
const LOCKOUT_NAMESPACE = 'platform-admin';

// Namespace SEPARADO pra reconfirmação de senha (ex: excluir loja no
// painel) — mesmo raciocínio de lib/verifyLogin.js (usado por
// routes/cash.js#confirmPassword): errar a reconfirmação várias vezes não
// pode bloquear o login normal do admin, nem o contrário.
const CONFIRM_LOCKOUT_NAMESPACE = 'platform-admin-confirm';

// Mesmo raciocínio de DUMMY_SALT/DUMMY_HASH em lib/verifyLogin.js: paga o
// mesmo custo de PBKDF2 pra usuário inexistente/inativo, pra não vazar por
// timing quais logins de admin existem.
const DUMMY_SALT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const DUMMY_HASH = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

export function getPlatformAdminLoginLockState(username) {
  return getLoginLockState(username, LOCKOUT_NAMESPACE);
}

async function verifyPlatformAdminPasswordInNamespace(username, password, namespace) {
  const usernameLower = String(username || '').trim().toLowerCase();
  const lockState = getLoginLockState(usernameLower, namespace);
  if (lockState.remainingMs > 0) return null;

  const row = controlDb.prepare(FIND_BY_USERNAME_SQL).get(usernameLower);
  if (!row || !row.active) {
    await verifyPasswordHash(password, DUMMY_SALT, DUMMY_HASH);
    recordFailedLogin(usernameLower, namespace);
    return null;
  }
  const ok = await verifyPasswordHash(password, row.password_salt, row.password_hash);
  if (!ok) {
    recordFailedLogin(usernameLower, namespace);
    return null;
  }
  clearLoginLock(usernameLower, namespace);
  return { id: row.id, username: row.username_lower };
}

export async function verifyPlatformAdminLogin(username, password) {
  return verifyPlatformAdminPasswordInNamespace(username, password, LOCKOUT_NAMESPACE);
}

/** Reconfirmação de senha de uma sessão de admin já autenticada — usado por
 * ações destrutivas do painel (ex: excluir loja, ver
 * routes/admin/tenants.js). Bloqueio por força bruta em namespace PRÓPRIO
 * (ver CONFIRM_LOCKOUT_NAMESPACE acima), nunca o do login normal. */
export async function verifyPlatformAdminPassword(username, password) {
  return verifyPlatformAdminPasswordInNamespace(username, password, CONFIRM_LOCKOUT_NAMESPACE);
}

export function getPlatformAdminById(id) {
  return controlDb.prepare('SELECT id, username_lower, active FROM platform_admins WHERE id = ?').get(id) || null;
}
