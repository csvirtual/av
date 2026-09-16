// Provisiona uso multi-tenant (Estratégia B — ver artifact "PDV
// Multi-Tenant"): cria um banco de loja novo, do zero, OU adota um banco
// `.sqlite3` já em uso (ex: a instalação atual, de loja única) — e
// registra a loja no banco de controle (control/plataforma.sqlite3).
//
// Nenhuma rota HTTP chama isto ainda — só entra numa etapa futura do
// roteiro, junto do painel de Super Admin. Reaproveita
// db/connection.js#openTenantConnection (mesma função que db/index.js usa
// desde a etapa 2) pra aplicar schema.sql + migrações — nunca o singleton
// `db` de db/index.js (que aponta sempre pro tenant fixo de hoje, nunca
// pro arquivo que este script está provisionando/adotando).
//
// Uso:
//   node scripts/createTenant.js --new <slug> "<Razão Social>" "<Nome Fantasia>"
//   node scripts/createTenant.js --from-existing <slug> <caminho-do-sqlite3> ["<Razão Social>"] ["<Nome Fantasia>"]
//   node scripts/createTenant.js --set-status <slug> <trial|ativo|suspenso|cancelado> [data-ISO-de-vencimento|null]
//
//   --new             cria um banco vazio (mesmo db/schema.sql de sempre) +
//                     usuário admin inicial (mesma credencial padrão de
//                     sempre: admin/admin123, com troca obrigatória no
//                     primeiro login — ver lib/seedAdmin.js).
//   --from-existing   adota um banco `.sqlite3` já em uso: faz uma cópia de
//                     segurança (.bak) do arquivo original ao lado dele,
//                     garante que o conteúdo do WAL foi gravado no arquivo
//                     principal, e MOVE o arquivo pra dentro da nova
//                     estrutura de pastas — sem alterar uma linha do
//                     conteúdo dele. Se razão social/nome fantasia não
//                     forem passados, tenta ler da própria tabela `company`
//                     do banco adotado.
//   --set-status      etapa 7 do roteiro (ver artifact "PDV Multi-Tenant"):
//                     muda status/vencimento de uma loja já cadastrada —
//                     é o mecanismo de controle da PLATAFORMA (server.js
//                     bloqueia toda requisição, ANTES de qualquer rota,
//                     pra uma loja "suspenso"/"cancelado" ou com
//                     expires_at no passado). Omitir a data mantém o
//                     vencimento atual; "null" remove (sem vencimento,
//                     plano manual).
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlDb } from '../control/db.js';
import { openTenantConnection } from '../db/connection.js';
import { hashPassword } from '../lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const TENANTS_DIR = path.join(ROOT_DIR, 'tenants');

// Mesma lista citada no artifact (§3) — nome de loja não pode colidir com
// um subdomínio que o próprio sistema vai reservar pra rotas administrativas
// (ex: admin.<dominio>, api.<dominio>) quando a resolução por Host entrar
// numa etapa futura do roteiro.
const RESERVED_SLUGS = new Set([
  'www', 'app', 'api', 'admin', 'painel', 'suporte', 'mail', 'ftp', 'static', 'ws',
]);

function validateSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Slug inválido: "${slug}". Use só letras minúsculas, números e hífen (ex: "loja-silva").`);
  }
  if (slug.length < 3 || slug.length > 30) {
    throw new Error(`Slug "${slug}" precisa ter entre 3 e 30 caracteres.`);
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new Error(`Slug "${slug}" é reservado pelo próprio sistema — escolha outro.`);
  }
  const existing = controlDb.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(slug);
  if (existing) {
    throw new Error(`Já existe uma loja cadastrada com o slug "${slug}".`);
  }
}

function seedAdminInto(tenantDb) {
  // Duplicata mínima e proposital de lib/seedAdmin.js#ensureAdminUser:
  // aquela função sempre semeia no tenant FIXO de db/index.js (`db`, o
  // singleton) — nunca dá pra reusá-la aqui, porque este script está
  // sempre semeando um banco de tenant DIFERENTE daquele. Mesma credencial
  // padrão, mesmo mustChangePassword forçado no primeiro login.
  return hashPassword('admin123').then(({ salt, hash }) => {
    const user = {
      id: crypto.randomUUID(),
      nome: 'Administrador',
      username: 'admin',
      usernameLower: 'admin',
      role: 'admin',
      permissions: {},
      passwordSalt: salt,
      passwordHash: hash,
      active: true,
      hasSeenAjuda: false,
      mustChangePassword: true,
      createdAt: Date.now(),
    };
    tenantDb.prepare('INSERT INTO users (id, username_lower, data) VALUES (?, ?, ?)')
      .run(user.id, user.usernameLower, JSON.stringify(user));
  });
}

function readCompanyConfig(tenantDb) {
  try {
    const row = tenantDb.prepare("SELECT data FROM company WHERE id = 'config'").get();
    return row ? JSON.parse(row.data) : {};
  } catch {
    return {};
  }
}

function registerTenant({ slug, razaoSocial, nomeFantasia, cnpj, dbPath, status }) {
  const tenant = {
    id: crypto.randomUUID(),
    slug,
    razaoSocial: razaoSocial || slug,
    nomeFantasia: nomeFantasia || slug,
    cnpj: cnpj || null,
    status,
    dbPath,
    createdAt: Date.now(),
  };
  controlDb.prepare(`
    INSERT INTO tenants (id, slug, razao_social, nome_fantasia, cnpj, status, plano, db_path, created_at, expires_at)
    VALUES (@id, @slug, @razaoSocial, @nomeFantasia, @cnpj, @status, @status, @dbPath, @createdAt, NULL)
  `).run(tenant);
  return tenant;
}

async function createNewTenant(slug, razaoSocial, nomeFantasia) {
  validateSlug(slug);
  const tenantDir = path.join(TENANTS_DIR, slug);
  const dbPath = path.join(tenantDir, 'dados-da-loja.sqlite3');

  const tenantDb = openTenantConnection(dbPath);
  await seedAdminInto(tenantDb);
  tenantDb.close();

  const tenant = registerTenant({ slug, razaoSocial, nomeFantasia, cnpj: null, dbPath, status: 'trial' });
  console.log(`Loja "${slug}" criada (nova, vazia) em ${dbPath}`);
  console.log(`Usuário criado: username="admin" senha="admin123" (troque no primeiro login).`);
  return tenant;
}

function adoptExistingTenant(slug, sourcePath, razaoSocialArg, nomeFantasiaArg) {
  validateSlug(slug);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Arquivo não encontrado: ${sourcePath}`);
  }

  // Sanity check: precisa parecer um banco deste sistema (tabela `users`
  // existe), não qualquer `.sqlite3` qualquer.
  const probe = new Database(sourcePath, { readonly: true });
  const looksValid = probe.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!looksValid) {
    probe.close();
    throw new Error(`"${sourcePath}" não parece um banco de dados deste sistema (tabela "users" não encontrada).`);
  }
  const existingConfig = readCompanyConfig(probe);
  probe.close();

  // Cópia de segurança antes de qualquer coisa tocar o arquivo original.
  const backupPath = `${sourcePath}.bak-${Date.now()}`;
  fs.copyFileSync(sourcePath, backupPath);
  console.log(`Cópia de segurança criada em ${backupPath}`);

  // Garante que tudo que está no WAL foi gravado no arquivo principal antes
  // de mover — senão o arquivo movido pode ficar sem as escritas mais
  // recentes (que ficariam pra trás, no -wal antigo).
  const checkpoint = new Database(sourcePath);
  checkpoint.pragma('wal_checkpoint(TRUNCATE)');
  checkpoint.close();

  const tenantDir = path.join(TENANTS_DIR, slug);
  const dbPath = path.join(tenantDir, 'dados-da-loja.sqlite3');
  fs.mkdirSync(tenantDir, { recursive: true });
  fs.renameSync(sourcePath, dbPath);

  // Garante schema + migrações em dia mesmo se o banco adotado vier de uma
  // versão bem mais antiga do sistema (ex: sem a coluna user_id de
  // cash_sessions) — mesma função que db/index.js usa pro tenant fixo.
  openTenantConnection(dbPath).close();

  const razaoSocial = razaoSocialArg || existingConfig.razaoSocial;
  const nomeFantasia = nomeFantasiaArg || existingConfig.nomeFantasia;
  const cnpj = existingConfig.cnpj || null;
  const tenant = registerTenant({ slug, razaoSocial, nomeFantasia, cnpj, dbPath, status: 'ativo' });
  console.log(`Loja "${slug}" adotada: ${sourcePath} -> ${dbPath}`);
  return tenant;
}

// Etapa 7 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): status
// válidos, mesma lista documentada em control/schema.sql (coluna
// `tenants.status`) — server.js#tenantAccessBlockedReason bloqueia toda
// requisição de uma loja "suspenso" ou "cancelado", ou com `expires_at` no
// passado (qualquer que seja o status).
const VALID_TENANT_STATUSES = new Set(['trial', 'ativo', 'suspenso', 'cancelado']);

function setTenantStatus(slug, status, expiresAtArg) {
  if (!VALID_TENANT_STATUSES.has(status)) {
    throw new Error(`Status inválido: "${status}". Use um de: ${[...VALID_TENANT_STATUSES].join(', ')}.`);
  }
  const tenant = controlDb.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  if (!tenant) throw new Error(`Loja não encontrada: "${slug}".`);

  let expiresAt = tenant.expires_at;
  if (expiresAtArg !== undefined) {
    if (expiresAtArg === 'null' || expiresAtArg === '') {
      expiresAt = null;
    } else {
      const parsed = Date.parse(expiresAtArg);
      if (Number.isNaN(parsed)) {
        throw new Error(`Data de vencimento inválida: "${expiresAtArg}" (use um formato ISO, ex: "2026-12-31", ou "null" pra remover).`);
      }
      expiresAt = parsed;
    }
  }

  controlDb.prepare('UPDATE tenants SET status = ?, expires_at = ? WHERE slug = ?').run(status, expiresAt, slug);
  const updated = controlDb.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  console.log(`Loja "${slug}": status = "${updated.status}", expires_at = ${updated.expires_at ? new Date(updated.expires_at).toISOString() : 'null'}`);
  return updated;
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === '--new') {
    const [slug, razaoSocial, nomeFantasia] = rest;
    if (!slug) throw new Error('Uso: node scripts/createTenant.js --new <slug> "<Razão Social>" "<Nome Fantasia>"');
    await createNewTenant(slug, razaoSocial, nomeFantasia);
  } else if (mode === '--from-existing') {
    const [slug, sourcePath, razaoSocial, nomeFantasia] = rest;
    if (!slug || !sourcePath) throw new Error('Uso: node scripts/createTenant.js --from-existing <slug> <caminho-do-sqlite3> ["<Razão Social>"] ["<Nome Fantasia>"]');
    adoptExistingTenant(slug, sourcePath, razaoSocial, nomeFantasia);
  } else if (mode === '--set-status') {
    const [slug, status, expiresAt] = rest;
    if (!slug || !status) throw new Error('Uso: node scripts/createTenant.js --set-status <slug> <trial|ativo|suspenso|cancelado> [data-ISO-de-vencimento|null]');
    setTenantStatus(slug, status, expiresAt);
  } else {
    throw new Error('Uso: node scripts/createTenant.js --new|--from-existing|--set-status ...');
  }
  process.exit(0);
}

// Só roda main() quando chamado direto (`node scripts/createTenant.js`) —
// os testes importam createNewTenant/adoptExistingTenant sem disparar a CLI.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Falha:', err.message);
    process.exit(1);
  });
}

export { createNewTenant, adoptExistingTenant, validateSlug, RESERVED_SLUGS, setTenantStatus, VALID_TENANT_STATUSES };
