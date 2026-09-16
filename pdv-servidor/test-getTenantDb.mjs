// Etapa 2 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// db/index.js virou um pool cacheado (getTenantDb), ainda resolvendo um
// tenant FIXO pra tudo que já existe (ninguém além deste teste chama
// getTenantDb com outro id ainda — isso só entra na etapa 3, quando o
// servidor resolver pelo Host). Este teste prova, isolado, que:
// (1) a conexão do tenant fixo (`db`, sem TENANT_ID) continua idêntica ao
// comportamento de sempre; (2) o pool cacheia (mesma conexão em chamadas
// repetidas); (3) tenants diferentes têm conexões diferentes e
// independentes; (4) tenant desconhecido dá erro claro, nunca abre nada
// por engano.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTROL_DB_PATH = path.join(__dirname, 'control', 'plataforma.sqlite3');
const TENANTS_DIR = path.join(__dirname, 'tenants');
const LEGACY_DB_PATH = path.join(__dirname, 'dados-da-loja.sqlite3');

function resetState() {
  for (const base of [CONTROL_DB_PATH, LEGACY_DB_PATH]) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(base + suffix, { force: true });
  }
  fs.rmSync(TENANTS_DIR, { recursive: true, force: true });
}

resetState();

const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

try {
  // (1) sem TENANT_ID: `db` resolve pro arquivo legado de sempre, no
  // mesmo lugar de sempre — comportamento idêntico a antes da etapa 2.
  const { db, getTenantDb } = await import('./db/index.js');
  check('sem TENANT_ID, db/index.js cria o arquivo legado no lugar de sempre', fs.existsSync(LEGACY_DB_PATH), LEGACY_DB_PATH);
  const legacyTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  check('conexão legada tem o schema completo (ex: products, cash_sessions)', ['products', 'cash_sessions', 'users'].every((t) => legacyTables.includes(t)));

  // (2) provisiona dois tenants reais pra testar o pool de verdade
  const { createNewTenant } = await import('./scripts/createTenant.js');
  const { controlDb } = await import('./control/db.js');
  const tenantA = await createNewTenant('pool-teste-a', 'Loja Pool A', 'Loja Pool A');
  const tenantB = await createNewTenant('pool-teste-b', 'Loja Pool B', 'Loja Pool B');

  const dbA1 = getTenantDb(tenantA.id);
  const dbA2 = getTenantDb(tenantA.id);
  check('duas chamadas pro MESMO tenant devolvem a MESMA conexão (cache funcionando)', dbA1 === dbA2);

  const dbB = getTenantDb(tenantB.id);
  check('tenant B tem uma conexão DIFERENTE do tenant A', dbB !== dbA1);

  // (3) escreve em A, confirma que B não vê nada (arquivos físicos
  // diferentes — não é só objeto JS diferente, é dado isolado de verdade)
  dbA1.prepare("INSERT INTO company (id, data) VALUES ('config', ?)").run(JSON.stringify({ nomeFantasia: 'Só existe em A' }));
  const companyInB = dbB.prepare("SELECT data FROM company WHERE id = 'config'").get();
  check('gravação no tenant A não aparece no tenant B (bancos fisicamente separados)', !companyInB, companyInB);

  const companyInA = dbA1.prepare("SELECT data FROM company WHERE id = 'config'").get();
  check('gravação no tenant A é lida de volta corretamente', JSON.parse(companyInA.data).nomeFantasia === 'Só existe em A');

  // (4) tenant desconhecido nunca abre nada — erro claro
  try {
    getTenantDb('id-que-nao-existe');
    check('tenant desconhecido lança erro (nunca abre banco nenhum)', false);
  } catch (e) {
    check('tenant desconhecido lança erro (nunca abre banco nenhum)', /Tenant desconhecido/.test(e.message), e.message);
  }

  // (5) a conexão legada (`db`) nunca aparece registrada em `tenants` —
  // é só um fallback interno, não um tenant de verdade.
  const legacyAsTenant = controlDb.prepare("SELECT 1 FROM tenants WHERE db_path = ?").get(LEGACY_DB_PATH);
  check('o arquivo legado nunca é confundido com um tenant registrado', !legacyAsTenant);
} finally {
  resetState();
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
