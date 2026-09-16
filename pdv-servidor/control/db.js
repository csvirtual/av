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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTROL_DB_PATH = path.join(__dirname, 'plataforma.sqlite3');

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
