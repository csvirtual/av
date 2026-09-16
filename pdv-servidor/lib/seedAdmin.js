// Garante que exista um usuário admin pra logar — extraído de seed.js pra
// poder ser chamado tanto pela linha de comando (`node seed.js`, uso
// manual) quanto pelo próprio server.js no arranque (hospedagens tipo
// GoDaddy que não dão um terminal fácil pra rodar `node seed.js` à parte
// do "start" configurado no painel). Idempotente: só cria se ainda não
// existir ninguém com esse username, então é seguro rodar em TODO
// arranque do servidor, sempre.
import { db } from '../db/index.js';
import { hashPassword } from './auth.js';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123'; // troque depois de logar pela primeira vez

// `targetDb` opcional (etapa 5 do roteiro multi-tenant, ver artifact "PDV
// Multi-Tenant") — normalmente req.db, resolvido pelo tenant da
// requisição. Sem ele (todo call site de hoje), semeia no banco fixo do
// processo, comportamento idêntico a sempre. Note: scripts/createTenant.js
// tem sua PRÓPRIA cópia mínima desta lógica (seedAdminInto), porque
// precisa semear um banco de tenant que nem existe no pool ainda — ver o
// comentário lá.
export async function ensureAdminUser(targetDb = db) {
  const existing = targetDb.prepare('SELECT 1 FROM users WHERE username_lower = ?').get(ADMIN_USERNAME);
  if (existing) return false;

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
    // Achado de auditoria (P1): senha padrão (`admin123`) é a mesma em toda
    // instalação nova deste sistema, documentada publicamente na própria
    // Ajuda — só um aviso textual (não bloqueante) não impedia ninguém de
    // continuar usando o sistema com ela indefinidamente. Este campo força
    // a troca antes de qualquer outra ação (ver o middleware em server.js
    // que bloqueia toda rota /api, exceto /api/auth e /api/license,
    // enquanto isto for true — e POST /api/auth/change-password, o único
    // jeito de zerá-lo).
    mustChangePassword: true,
    createdAt: Date.now(),
  };
  targetDb.prepare('INSERT INTO users (id, username_lower, data) VALUES (?, ?, ?)')
    .run(user.id, user.usernameLower, JSON.stringify(user));

  console.log(`Usuário criado: username="${ADMIN_USERNAME}" senha="${ADMIN_PASSWORD}" (troque depois de testar).`);
  return true;
}
