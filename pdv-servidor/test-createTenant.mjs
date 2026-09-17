// Etapa 1 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// control/db.js + scripts/createTenant.js, sem tocar em nenhum arquivo
// existente. Diferente dos outros test-*.cjs (que batem via HTTP num
// servidor rodando), este importa os módulos direto — createTenant.js não
// tem rota HTTP ainda (só entra numa etapa futura, junto do painel de
// Super Admin) — e roda contra o banco de controle de verdade
// (control/plataforma.sqlite3), não uma cópia: por isso zera esse banco e
// a pasta tenants/ inteira antes de começar, e limpa tudo de novo no final,
// pra não deixar tenant de teste misturado com tenant real.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTROL_DB_PATH = path.join(__dirname, 'control', 'plataforma.sqlite3');
const TENANTS_DIR = path.join(__dirname, 'tenants');
const SCRATCH_DIR = path.join(__dirname, 'test-createTenant-scratch');

function resetState() {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(CONTROL_DB_PATH + suffix, { force: true });
  fs.rmSync(TENANTS_DIR, { recursive: true, force: true });
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
}

resetState();
fs.mkdirSync(SCRATCH_DIR, { recursive: true });

const { controlDb } = await import('./control/db.js');
const { createNewTenant, adoptExistingTenant, validateSlug } = await import('./scripts/createTenant.js');

const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

try {
  // (1) validação de slug
  try { validateSlug('AB'); check('slug maiúsculo rejeitado', false); } catch (e) { check('slug maiúsculo rejeitado', /inválido/.test(e.message), e.message); }
  try { validateSlug('ab'); check('slug curto (2 chars) rejeitado', false); } catch (e) { check('slug curto (2 chars) rejeitado', /entre 3 e 30/.test(e.message), e.message); }
  try { validateSlug('admin'); check('slug reservado ("admin") rejeitado', false); } catch (e) { check('slug reservado ("admin") rejeitado', /reservado/.test(e.message), e.message); }
  try { validateSlug('-loja'); check('slug começando com hífen rejeitado', false); } catch (e) { check('slug começando com hífen rejeitado', /inválido/.test(e.message), e.message); }
  try { validateSlug('loja-boa-123'); check('slug válido aceito sem lançar', true); } catch (e) { check('slug válido aceito sem lançar', false, e.message); }

  // (2) --new
  const tenantA = await createNewTenant('loja-teste-a', 'Loja Teste A LTDA', 'Loja Teste A');
  check('tenant A registrado no banco de controle', !!controlDb.prepare('SELECT 1 FROM tenants WHERE slug = ?').get('loja-teste-a'));
  check('arquivo .sqlite3 do tenant A foi criado', fs.existsSync(tenantA.dbPath), tenantA.dbPath);

  const dbA = new Database(tenantA.dbPath, { readonly: true });
  const tablesA = dbA.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  check('banco do tenant A tem as tabelas do schema.sql (ex: products, sales, cash_sessions)', ['products', 'sales', 'cash_sessions', 'users', 'company'].every((t) => tablesA.includes(t)), tablesA.join(','));
  const adminA = dbA.prepare("SELECT data FROM users WHERE username_lower = 'admin'").get();
  check('usuário admin foi semeado no tenant A', !!adminA);
  if (adminA) {
    const parsed = JSON.parse(adminA.data);
    check('admin do tenant A tem mustChangePassword=true', parsed.mustChangePassword === true);
    check('admin do tenant A tem role=admin', parsed.role === 'admin');
  }
  dbA.close();

  try { await createNewTenant('loja-teste-a', 'x', 'y'); check('criar de novo o mesmo slug é rejeitado', false); } catch (e) { check('criar de novo o mesmo slug é rejeitado', /Já existe/.test(e.message), e.message); }

  // (3) --from-existing: monta um banco "existente" simulando a loja atual
  const sourcePath = path.join(SCRATCH_DIR, 'loja-existente.sqlite3');
  const schemaSql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  const src = new Database(sourcePath);
  src.pragma('journal_mode = WAL');
  src.exec(schemaSql);
  src.prepare("INSERT INTO company (id, data) VALUES ('config', ?)").run(JSON.stringify({
    razaoSocial: 'Depósito Silva LTDA', nomeFantasia: 'Depósito Silva', cnpj: '11.444.777/0001-61',
  }));
  src.prepare('INSERT INTO users (id, username_lower, data) VALUES (?, ?, ?)').run('marker-user-id', 'admin', JSON.stringify({ id: 'marker-user-id', nome: 'Admin Original', username: 'admin', usernameLower: 'admin', role: 'admin' }));
  src.close();

  const tenantB = adoptExistingTenant('loja-adotada', sourcePath, null, null);
  check('tenant B (adotado) registrado no banco de controle', !!controlDb.prepare('SELECT 1 FROM tenants WHERE slug = ?').get('loja-adotada'));
  check('razão social lida automaticamente do banco adotado', tenantB.razaoSocial === 'Depósito Silva LTDA', tenantB.razaoSocial);
  check('nome fantasia lido automaticamente do banco adotado', tenantB.nomeFantasia === 'Depósito Silva', tenantB.nomeFantasia);
  check('cnpj lido automaticamente do banco adotado', tenantB.cnpj === '11.444.777/0001-61', tenantB.cnpj);
  check('status do tenant adotado é "ativo" (não "trial")', tenantB.status === 'ativo', tenantB.status);
  check('arquivo original foi MOVIDO (não existe mais na origem)', !fs.existsSync(sourcePath));
  check('arquivo existe no novo caminho dentro de tenants/', fs.existsSync(tenantB.dbPath), tenantB.dbPath);
  const backups = fs.readdirSync(SCRATCH_DIR).filter((f) => f.includes('.bak-'));
  check('cópia de segurança (.bak) foi criada', backups.length === 1, backups.join(','));

  const dbB = new Database(tenantB.dbPath, { readonly: true });
  const markerUser = dbB.prepare("SELECT data FROM users WHERE id = 'marker-user-id'").get();
  check('dado original (usuário marcador) preservado intacto após a adoção', !!markerUser && JSON.parse(markerUser.data).nome === 'Admin Original');
  dbB.close();

  // (4) CNPJ duplicado entre tenants diferentes é rejeitado
  const sourcePath2 = path.join(SCRATCH_DIR, 'loja-existente-2.sqlite3');
  const src2 = new Database(sourcePath2);
  src2.pragma('journal_mode = WAL');
  src2.exec(schemaSql);
  src2.prepare("INSERT INTO company (id, data) VALUES ('config', ?)").run(JSON.stringify({
    razaoSocial: 'Outra Loja', nomeFantasia: 'Outra', cnpj: '11.444.777/0001-61',
  }));
  src2.close();
  try {
    adoptExistingTenant('loja-cnpj-duplicado', sourcePath2, null, null);
    check('CNPJ duplicado entre tenants diferentes é rejeitado', false);
  } catch (e) {
    check('CNPJ duplicado entre tenants diferentes é rejeitado', /UNIQUE/.test(e.message) || /constraint/i.test(e.message), e.message);
  }
} finally {
  resetState();
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
