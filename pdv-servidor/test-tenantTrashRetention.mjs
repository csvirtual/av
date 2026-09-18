// Achado do usuário: a lixeira do painel de Super Admin
// (tenants/_lixeira/<slug>-<timestamp>/, ver control/db.js#deleteTenant)
// não tinha limite nenhum — cada exclusão deixava uma pasta (banco
// .sqlite3 da loja incluído) lá pra sempre. Prova de
// control/db.js#purgeExpiredTrashedTenants: 90 dias de retenção,
// entradas mais novas que isso continuam intocadas.
//
// Não precisa de servidor rodando — mexe direto no banco de controle e no
// disco, igual scripts/createTenant.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

const { createNewTenant } = await import('./scripts/createTenant.js');
const { controlDb, deleteTenant, listTrashedTenants, purgeExpiredTrashedTenants } = await import('./control/db.js');

const suffix = Date.now();
const slugOld = `trash-old-${suffix}`;
const slugRecent = `trash-recent-${suffix}`;
const trashDir = path.join(__dirname, 'tenants', '_lixeira');

const tenantOld = await createNewTenant(slugOld, 'Lixo Antigo', 'Lixo Antigo');
const tenantRecent = await createNewTenant(slugRecent, 'Lixo Recente', 'Lixo Recente');

let oldEntryFinal, recentEntry;
try {
  deleteTenant(slugOld);
  deleteTenant(slugRecent);

  const trashedRightAfterDelete = listTrashedTenants();
  const oldEntry = trashedRightAfterDelete.find((t) => t.slug === slugOld)?.entry;
  recentEntry = trashedRightAfterDelete.find((t) => t.slug === slugRecent)?.entry;
  check('as duas lojas excluídas aparecem na lixeira logo depois de excluir', !!oldEntry && !!recentEntry, JSON.stringify(trashedRightAfterDelete.map((t) => t.slug)));

  // Simula uma exclusão de 91 dias atrás renomeando a pasta pra trocar só o
  // timestamp do nome (deletedAt vem do PRÓPRIO nome da pasta, ver
  // control/db.js#listTrashedTenants — não precisa mexer em mtime nenhum).
  const ninetyOneDaysAgo = Date.now() - 91 * 24 * 60 * 60 * 1000;
  oldEntryFinal = `${slugOld}-${ninetyOneDaysAgo}`;
  fs.renameSync(path.join(trashDir, oldEntry), path.join(trashDir, oldEntryFinal));

  const trashedBeforePurge = listTrashedTenants();
  check('entrada "envelhecida" (91 dias) e a recente continuam as duas na lixeira antes do purge', trashedBeforePurge.some((t) => t.entry === oldEntryFinal) && trashedBeforePurge.some((t) => t.entry === recentEntry), JSON.stringify(trashedBeforePurge.map((t) => t.entry)));

  const purgedCount = purgeExpiredTrashedTenants();
  check('purgeExpiredTrashedTenants() reporta 1 entrada purgada', purgedCount === 1, purgedCount);

  const oldGoneFromDisk = !fs.existsSync(path.join(trashDir, oldEntryFinal));
  check('pasta da entrada envelhecida (91 dias) some do disco de verdade', oldGoneFromDisk, oldGoneFromDisk);

  const recentStillOnDisk = fs.existsSync(path.join(trashDir, recentEntry));
  check('pasta da entrada recente continua no disco (retenção de 90 dias não vencida ainda)', recentStillOnDisk, recentStillOnDisk);

  const trashedAfterPurge = listTrashedTenants();
  check('entrada envelhecida some da listagem depois do purge', !trashedAfterPurge.some((t) => t.entry === oldEntryFinal), JSON.stringify(trashedAfterPurge.map((t) => t.entry)));
  check('entrada recente continua na listagem depois do purge', trashedAfterPurge.some((t) => t.entry === recentEntry), JSON.stringify(trashedAfterPurge.map((t) => t.entry)));

  const purgedCountSecondRun = purgeExpiredTrashedTenants();
  check('rodar de novo sem nenhuma entrada vencida não purga nada (0)', purgedCountSecondRun === 0, purgedCountSecondRun);
} finally {
  controlDb.prepare('DELETE FROM tenants WHERE slug IN (?, ?)').run(slugOld, slugRecent);
  fs.rmSync(path.join(__dirname, 'tenants', slugOld), { recursive: true, force: true });
  fs.rmSync(path.join(__dirname, 'tenants', slugRecent), { recursive: true, force: true });
  if (oldEntryFinal) fs.rmSync(path.join(trashDir, oldEntryFinal), { recursive: true, force: true });
  if (recentEntry) fs.rmSync(path.join(trashDir, recentEntry), { recursive: true, force: true });
}

console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
process.exit(results.every(Boolean) ? 0 : 1);
