// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): cria
// (ou redefine a senha de) um administrador da PLATAFORMA — quem acessa o
// painel de Super Admin (admin.<MULTI_TENANT_DOMAIN>) pra listar lojas e
// suspender/cancelar/reativar assinaturas. Sem tela de cadastro nem rota
// HTTP de propósito: mesma lógica de segurança de lib/seedAdmin.js (o
// PRIMEIRO usuário de uma loja também nasce fora de qualquer rota) — quem
// tem acesso à máquina/terminal onde o servidor roda decide quem entra na
// plataforma inteira, nunca um formulário exposto na rede.
//
// Uso:
//   node scripts/seedPlatformAdmin.js <username> <senha>
//
// Rodar de novo com o MESMO username redefine a senha da conta existente
// (idempotente, mesmo raciocínio de --set-status: reaplicar não duplica).
import { controlDb } from '../control/db.js';
import { hashPassword } from '../lib/auth.js';
import { MIN_USER_PASSWORD_LENGTH } from '../lib/permissions.js';

async function seedPlatformAdmin(username, password) {
  const usernameLower = String(username || '').trim().toLowerCase();
  if (!usernameLower) throw new Error('Informe um nome de usuário.');
  if (!password || password.length < MIN_USER_PASSWORD_LENGTH) {
    throw new Error(`Informe uma senha com pelo menos ${MIN_USER_PASSWORD_LENGTH} caracteres.`);
  }
  const { salt, hash } = await hashPassword(password);
  const existing = controlDb.prepare('SELECT id FROM platform_admins WHERE username_lower = ?').get(usernameLower);
  if (existing) {
    controlDb.prepare('UPDATE platform_admins SET password_salt = ?, password_hash = ?, active = 1 WHERE id = ?')
      .run(salt, hash, existing.id);
    console.log(`Senha do admin da plataforma "${usernameLower}" redefinida.`);
    return existing.id;
  }
  const id = crypto.randomUUID();
  controlDb.prepare('INSERT INTO platform_admins (id, username_lower, password_salt, password_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(id, usernameLower, salt, hash, Date.now());
  console.log(`Admin da plataforma "${usernameLower}" criado.`);
  return id;
}

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    throw new Error('Uso: node scripts/seedPlatformAdmin.js <username> <senha>');
  }
  await seedPlatformAdmin(username, password);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Falha:', err.message);
    process.exit(1);
  });
}

export { seedPlatformAdmin };
