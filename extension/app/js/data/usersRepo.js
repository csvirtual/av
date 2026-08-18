// Usuários do sistema: o primeiro cadastrado é sempre o Administrador Geral
// (role 'admin'); todos os demais nascem como 'vendedor'. Senhas nunca são
// gravadas em texto puro — ver auth.js.
import { dbGetAll, dbGet, dbAdd, dbGetByIndex, dbCount, dbUpdate, newId } from '../db.js';
import { hashPassword, verifyPasswordHash } from '../auth.js';

export async function hasAnyUser() {
  return (await dbCount('users')) > 0;
}

export async function getUser(id) {
  return dbGet('users', id);
}

export async function findByUsername(username) {
  return dbGetByIndex('users', 'byUsername', (username || '').trim().toLowerCase());
}

export async function listUsers() {
  const users = await dbGetAll('users');
  return users.sort((a, b) => a.createdAt - b.createdAt);
}

/** Cadastra um usuário novo. O primeiro usuário do sistema é forçado a ser
 * admin pela tela de setup (ver views/setup.js); daqui pra frente só o admin
 * chama isto, sempre criando vendedores. */
export async function createUser({ nome, username, password, role }) {
  const usernameLower = (username || '').trim().toLowerCase();
  if (!usernameLower) throw new Error('Nome de usuário é obrigatório.');
  if (await findByUsername(usernameLower)) {
    throw new Error('Já existe um usuário com esse nome de login.');
  }
  const { salt, hash } = await hashPassword(password);
  const record = {
    id: newId(),
    nome: (nome || '').trim(),
    username: (username || '').trim(),
    usernameLower,
    role, // 'admin' | 'vendedor'
    passwordSalt: salt,
    passwordHash: hash,
    active: true,
    createdAt: Date.now(),
  };
  await dbAdd('users', record);
  return record;
}

export async function verifyLogin(username, password) {
  const user = await findByUsername(username);
  if (!user || !user.active) return null;
  const ok = await verifyPasswordHash(password, user.passwordSalt, user.passwordHash);
  return ok ? user : null;
}

export async function setUserActive(id, active) {
  return dbUpdate('users', id, (user) => {
    if (!user) throw new Error('Usuário não encontrado.');
    user.active = active;
    return user;
  });
}

export async function resetUserPassword(id, newPassword) {
  // hashPassword é assíncrono — precisa rodar ANTES do dbUpdate, cujo
  // updateFn é síncrono por definição (ver db.js). Não depende de ler o
  // usuário primeiro, então calcular o hash antes não muda a atomicidade
  // do get+put que segue.
  const { salt, hash } = await hashPassword(newPassword);
  return dbUpdate('users', id, (user) => {
    if (!user) throw new Error('Usuário não encontrado.');
    user.passwordSalt = salt;
    user.passwordHash = hash;
    return user;
  });
}
