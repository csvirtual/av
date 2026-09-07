// Cria o primeiro usuário admin, pra testar o login — a tela de "Cadastro
// da loja" (setup.js na extensão) ainda não foi portada pra cá, então por
// enquanto isso é feito por linha de comando: `node seed.js`.
import { db } from './db/index.js';
import { hashPassword } from './lib/auth.js';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123'; // troque depois de logar pela primeira vez

const existing = db.prepare('SELECT 1 FROM users WHERE username_lower = ?').get(ADMIN_USERNAME);
if (existing) {
  console.log('Usuário "admin" já existe — nada a fazer.');
  process.exit(0);
}

const { salt, hash } = await hashPassword(ADMIN_PASSWORD);
const user = {
  id: crypto.randomUUID(),
  nome: 'Administrador',
  username: ADMIN_USERNAME,
  usernameLower: ADMIN_USERNAME,
  role: 'admin',
  permissions: {},
  passwordSalt: salt,
  passwordHash: hash,
  active: true,
  hasSeenAjuda: false,
  createdAt: Date.now(),
};
db.prepare('INSERT INTO users (id, username_lower, data) VALUES (?, ?, ?)')
  .run(user.id, user.usernameLower, JSON.stringify(user));

console.log(`Usuário criado: username="${ADMIN_USERNAME}" senha="${ADMIN_PASSWORD}" (troque depois de testar).`);
