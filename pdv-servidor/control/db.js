// Conexão com o banco de controle do SaaS (lista de lojas) — irmão de
// db/index.js, mas para um arquivo totalmente separado
// (control/plataforma.sqlite3), que nunca guarda dado operacional de
// nenhuma loja. Ver control/schema.sql pro porquê da separação.
//
// Etapa 1 do roteiro: só scripts/createTenant.js importa isto por enquanto.
// server.js e o resto do servidor ainda não sabem que este arquivo existe.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTenantConnection } from '../db/connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTROL_DB_PATH = path.join(__dirname, 'plataforma.sqlite3');
const TENANTS_DIR = path.join(__dirname, '..', 'tenants');

export const controlDb = new Database(CONTROL_DB_PATH);
controlDb.pragma('journal_mode = WAL');
controlDb.pragma('foreign_keys = ON');
// Mesmo raciocínio de db/index.js: evita um SQLITE_BUSY espúrio numa
// colisão passageira de acesso concorrente ao arquivo.
controlDb.pragma('busy_timeout = 5000');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
controlDb.exec(schema);

const getTenantBySlugStmt = controlDb.prepare('SELECT * FROM tenants WHERE slug = ?');

/** Usado pelo middleware de resolução por Host (etapa 3 do roteiro
 * multi-tenant, ver server.js) e por scripts/createTenant.js — devolve
 * `null` (nunca lança) quando o slug não está cadastrado, pra quem chama
 * decidir o que fazer (normalmente: 404). */
export function getTenantBySlug(slug) {
  return getTenantBySlugStmt.get(slug) || null;
}

// Etapa 7 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): status
// válidos de uma loja, mesma lista documentada acima na coluna
// `tenants.status` — server.js#tenantAccessBlockedReason bloqueia toda
// requisição de uma loja "suspenso" ou "cancelado", ou com `expires_at` no
// passado (qualquer que seja o status).
export const VALID_TENANT_STATUSES = new Set(['trial', 'ativo', 'suspenso', 'cancelado']);

const LIST_TENANTS_SQL = 'SELECT * FROM tenants ORDER BY created_at DESC';

/** Todas as lojas cadastradas, mais recente primeiro — usado pelo painel de
 * Super Admin (etapa 8, ver routes/admin/tenants.js) e por scripts de
 * diagnóstico. Nunca inclui o `db_path` fora do necessário (a linha inteira
 * da tabela já não tem segredo nenhum — nem senha de loja nenhuma mora
 * aqui, ver control/schema.sql). */
export function listTenants() {
  return controlDb.prepare(LIST_TENANTS_SQL).all();
}

/** Muda status/vencimento de uma loja já cadastrada — é o mecanismo de
 * controle da PLATAFORMA sobre a assinatura de uma loja (suspender por
 * inadimplência, cancelar, reativar, ajustar vencimento), independente do
 * mecanismo de trial/chave de ativação de cada loja (lib/licenseState.js,
 * que continua existindo e funcionando por baixo — ver comentário em
 * server.js#tenantAccessBlockedReason). Usado tanto pela CLI
 * (scripts/createTenant.js --set-status) quanto pelo painel de Super Admin
 * (routes/admin/tenants.js).
 *
 * `expiresAtArg`: `undefined` mantém o vencimento atual sem mexer; `null`
 * ou a string `'null'` remove o vencimento (sem data, plano manual); uma
 * string ISO ou um timestamp numérico define a nova data. Lança se o
 * status for inválido, a loja não existir, ou a data não puder ser
 * interpretada. */
export function setTenantStatus(slug, status, expiresAtArg) {
  if (!VALID_TENANT_STATUSES.has(status)) {
    throw new Error(`Status inválido: "${status}". Use um de: ${[...VALID_TENANT_STATUSES].join(', ')}.`);
  }
  const tenant = getTenantBySlug(slug);
  if (!tenant) throw new Error(`Loja não encontrada: "${slug}".`);

  let expiresAt = tenant.expires_at;
  if (expiresAtArg !== undefined) {
    if (expiresAtArg === null || expiresAtArg === 'null' || expiresAtArg === '') {
      expiresAt = null;
    } else if (typeof expiresAtArg === 'number') {
      expiresAt = expiresAtArg;
    } else {
      const parsed = Date.parse(expiresAtArg);
      if (Number.isNaN(parsed)) {
        throw new Error(`Data de vencimento inválida: "${expiresAtArg}" (use um formato ISO, ex: "2026-12-31", ou "null" pra remover).`);
      }
      expiresAt = parsed;
    }
  }

  controlDb.prepare('UPDATE tenants SET status = ?, expires_at = ? WHERE slug = ?').run(status, expiresAt, slug);
  return getTenantBySlug(slug);
}

/** Exclui uma loja da plataforma — usado pelo painel de Super Admin (etapa
 * 8, ver routes/admin/tenants.js). Nunca apaga o arquivo `.sqlite3` de
 * verdade: mesma cautela de scripts/createTenant.js#adoptExistingTenant
 * (que também nunca sobrescreve/some com dado da loja sem antes guardar
 * uma cópia) — move a pasta inteira da loja pra uma "lixeira" dentro de
 * tenants/, com o slug + timestamp no nome pra nunca colidir com uma
 * exclusão anterior. Dá pra recuperar manualmente movendo a pasta de volta
 * e recadastrando com `--from-existing`, caso alguém exclua a loja errada
 * sem querer. Lança se a loja não existir. */
export function deleteTenant(slug) {
  const tenant = getTenantBySlug(slug);
  if (!tenant) throw new Error(`Loja não encontrada: "${slug}".`);

  const tenantDir = path.dirname(tenant.db_path);
  if (fs.existsSync(tenantDir)) {
    const trashDir = path.join(TENANTS_DIR, '_lixeira');
    fs.mkdirSync(trashDir, { recursive: true });
    fs.renameSync(tenantDir, path.join(trashDir, `${slug}-${Date.now()}`));
  }

  controlDb.prepare('DELETE FROM tenants WHERE slug = ?').run(slug);
  return tenant;
}

/** Lista o que está na "lixeira" (tenants/_lixeira/<slug>-<timestamp>/),
 * mais recente primeiro — usado pelo painel de Super Admin pra oferecer
 * restaurar uma loja excluída. `entry` é o nome da pasta em si (chave
 * usada por restoreTenant abaixo); `slug`/`deletedAt` são derivados do
 * próprio nome, sem precisar abrir o banco de cada loja só pra listar. */
export function listTrashedTenants() {
  const trashDir = path.join(TENANTS_DIR, '_lixeira');
  if (!fs.existsSync(trashDir)) return [];
  return fs.readdirSync(trashDir)
    .filter((name) => fs.statSync(path.join(trashDir, name)).isDirectory())
    .map((entry) => {
      const match = entry.match(/^(.*)-(\d+)$/);
      return { entry, slug: match ? match[1] : entry, deletedAt: match ? Number(match[2]) : null };
    })
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

/** Restaura uma loja da lixeira — move a pasta de volta pra tenants/<slug>
 * e recadastra no banco de controle (id novo; o cadastro antigo foi
 * apagado por deleteTenant, então isto é, na prática, o mesmo caminho de
 * scripts/createTenant.js#adoptExistingTenant, só que a pasta já está no
 * lugar certo — sem precisar de cópia de segurança nem checkpoint de WAL,
 * o arquivo não foi tocado desde a exclusão). O INSERT aqui é uma
 * duplicata mínima e proposital do de registerTenant (scripts/createTenant.js)
 * — importar de lá criaria um ciclo (createTenant.js já importa este
 * arquivo), mesmo raciocínio documentado em seedAdminInto sobre duplicar
 * em vez de reusar através de um ciclo. Lança se a pasta não existir na
 * lixeira ou se o slug já estiver em uso (ex: alguém recadastrou o mesmo
 * endereço depois da exclusão). */
export function restoreTenant(entry) {
  const trashDir = path.join(TENANTS_DIR, '_lixeira');
  const source = path.join(trashDir, entry);
  if (!fs.existsSync(source)) throw new Error(`Não encontrado na lixeira: "${entry}".`);

  const match = entry.match(/^(.*)-(\d+)$/);
  const slug = match ? match[1] : entry;
  if (getTenantBySlug(slug)) {
    throw new Error(`Não dá pra restaurar: já existe uma loja cadastrada com o endereço "${slug}" (provavelmente recadastrado depois da exclusão).`);
  }

  const dest = path.join(TENANTS_DIR, slug);
  fs.renameSync(source, dest);
  const dbPath = path.join(dest, 'dados-da-loja.sqlite3');

  const tenantDb = openTenantConnection(dbPath);
  let config = {};
  try {
    const row = tenantDb.prepare("SELECT data FROM company WHERE id = 'config'").get();
    config = row ? JSON.parse(row.data) : {};
  } catch {
    // Segue com config vazio (nomeFantasia/razaoSocial caem pro slug) —
    // mesma cautela de scripts/createTenant.js#readCompanyConfig.
  }
  tenantDb.close();

  const tenant = {
    id: crypto.randomUUID(),
    slug,
    razaoSocial: config.razaoSocial || slug,
    nomeFantasia: config.nomeFantasia || slug,
    cnpj: config.cnpj || null,
    status: 'ativo',
    dbPath,
    createdAt: Date.now(),
  };
  controlDb.prepare(`
    INSERT INTO tenants (id, slug, razao_social, nome_fantasia, cnpj, status, plano, db_path, created_at, expires_at)
    VALUES (@id, @slug, @razaoSocial, @nomeFantasia, @cnpj, @status, @status, @dbPath, @createdAt, NULL)
  `).run(tenant);
  return getTenantBySlug(slug);
}

/** Exclusão DEFINITIVA de um item da lixeira — apaga a pasta (e o
 * `.sqlite3` dentro dela) de verdade, sem volta. Diferente de deleteTenant
 * (que só move pra lixeira), esta é destrutiva mesmo — routes/admin/tenants.js
 * exige a mesma reconfirmação de senha do admin antes de chamar. Lança se
 * a entrada não existir na lixeira. */
export function purgeTrashedTenant(entry) {
  const trashDir = path.join(TENANTS_DIR, '_lixeira');
  const target = path.join(trashDir, entry);
  if (!fs.existsSync(target)) throw new Error(`Não encontrado na lixeira: "${entry}".`);
  fs.rmSync(target, { recursive: true, force: true });
}
