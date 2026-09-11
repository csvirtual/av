import express from 'express';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';

import { db, sweepOldIdempotencyKeys } from './db/index.js';
import { ensureAdminUser } from './lib/seedAdmin.js';
import { markTrialStartIfNeeded } from './lib/licenseState.js';
import { resolveSession, sweepExpiredSessions } from './lib/session.js';
import { registerClient, closeAllClients } from './lib/broadcast.js';
import authRoutes from './routes/auth.js';
import productsRoutes from './routes/products.js';
import salesRoutes from './routes/sales.js';
import cashRoutes from './routes/cash.js';
import customersRoutes from './routes/customers.js';
import suppliersRoutes from './routes/suppliers.js';
import purchasesRoutes from './routes/purchases.js';
import financeRoutes from './routes/finance.js';
import loyaltyRoutes from './routes/loyalty.js';
import deliveriesRoutes from './routes/deliveries.js';
import usersRoutes from './routes/users.js';
import auditRoutes from './routes/audit.js';
import companyRoutes from './routes/company.js';
import licenseRoutes from './routes/license.js';
import backupRoutes from './routes/backup.js';
import reportsRoutes from './routes/reports.js';
import { requirePermission } from './lib/permissions.js';

// Achado de auditoria (auditoria de prontidão pra produção): rede de
// segurança de último recurso. O Express 4 NÃO captura sozinho uma
// Promise rejeitada dentro de um handler assíncrono (diferente do
// Express 5) — e, desde o Node 15, uma rejeição não tratada por padrão
// DERRUBA o processo inteiro. Sem isto, um bug inesperado em QUALQUER
// rota tira do ar a loja inteira (todos os terminais, todas as sessões)
// até alguém perceber e reiniciar `node server.js` na mão. Loga o erro e
// mantém o processo de pé. Cada rota continua com seu próprio try/catch
// (ver routes/*.js) como primeira linha de defesa — isto aqui só evita o
// pior caso se algum ponto escapar dele (ex: um `setInterval` como
// `sweepExpiredSessions` abaixo, que não passa por rota nenhuma).
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection] erro inesperado não tratado:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] erro inesperado não tratado:', err);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3131;
const getUserByIdStmt = db.prepare('SELECT data FROM users WHERE id = ?');

// Achado de auditoria (P3): duas instâncias de `node server.js` abertas por
// engano no mesmo computador (ex.: um atalho clicado duas vezes) apontando
// pro mesmo arquivo .sqlite3 é o tipo de coisa que só aparece muito depois,
// como corrupção/estranheza esporádica difícil de rastrear — melhor travar
// na cara na hora. Um lockfile com o PID de quem está rodando: se já existe
// um lock apontando pra um processo VIVO, este processo novo recusa subir;
// se o PID do lock não existe mais (processo anterior morreu sem limpar —
// ex.: `kill -9`), o lock é considerado órfão e substituído. Removido no
// desligamento gracioso (ver SIGTERM/SIGINT mais abaixo).
const LOCK_PATH = path.join(__dirname, '.server.lock');
function acquireProcessLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
    let alive = false;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    }
    if (alive) {
      console.error(`\nJá existe um servidor rodando (PID ${pid}) usando este mesmo banco de dados. Feche-o antes de abrir outro, ou os dois vão brigar pelo mesmo arquivo .sqlite3.\n`);
      process.exit(1);
    }
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
}
function releaseProcessLock() {
  try {
    if (fs.existsSync(LOCK_PATH) && fs.readFileSync(LOCK_PATH, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(LOCK_PATH);
    }
  } catch { /* melhor esforço — não impede o desligamento */ }
}
acquireProcessLock();
process.on('exit', releaseProcessLock);

const app = express();
app.use(express.json());
app.use(cookieParser());

// Achado de auditoria (P3): public/test*.html são páginas de prova das
// telas (usadas pelos test-*.cjs deste repo, ver run_all.sh no
// scratchpad), servidas sem exigir login — expostas numa loja de verdade
// dariam a qualquer um na rede um jeito de acionar rotas da API pela mão.
// Bloqueadas por padrão; só liberam com ALLOW_TEST_PAGES=1 no ambiente
// (é isso que run_all.sh precisa setar pra continuar rodando a suíte).
app.use((req, res, next) => {
  if (process.env.ALLOW_TEST_PAGES === '1') return next();
  if (/^\/test.*\.html$/i.test(req.path)) return res.status(404).end();
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Preenche req.userId/userName/userRole a partir do cookie de sessão — não
// bloqueia rota nenhuma sozinho (algumas, como /api/auth/login, precisam
// ficar abertas); cada rota que exige login confere req.userId ela mesma.
// userName/userRole (não só o id) já ficam prontos aqui pra toda rota que
// precisa gravar "quem fez" (ex: vendas, estornos) sem ter que buscar de
// novo em cada uma.
//
// Achado de auditoria (Fase 9, passo do app.js completo): esta checagem
// nunca olhava `u.active` — resolveSession() só confere se o TOKEN ainda é
// válido (não expirou por TTL), nunca se a CONTA continua ativa. Login em
// si já bloqueia (lib/verifyLogin.js), mas uma sessão criada ANTES de um
// admin desativar o vendedor continuava com acesso total a toda rota
// protegida (vendas, caixa, tudo) até o cookie expirar sozinho (12h) — o
// mesmo raciocínio de "reconferir se o usuário continua ativo a cada
// navegação" que a extensão já tinha em app.js#renderCurrentRoute, só que
// aqui, sem isso, nem o SERVIDOR reforçava (a extensão nunca dependeu só
// da tela pra isso — o IndexedDB local dela é a fonte de verdade de cada
// chamada; aqui a fonte de verdade é este middleware, e ele deixava
// passar). Uma conta desativada agora é tratada exatamente como uma
// sessão inválida — próxima chamada de qualquer rota (inclusive
// GET /api/auth/me, ver routes/auth.js) já cai em 401 sozinha, sem
// precisar de nenhuma checagem extra em cada rota individual.
app.use((req, res, next) => {
  req.userId = resolveSession(req.cookies?.session) || null;
  req.userName = null;
  req.userRole = null;
  req.userPermissions = null;
  req.mustChangePassword = false;
  if (req.userId) {
    const row = getUserByIdStmt.get(req.userId);
    const u = row ? JSON.parse(row.data) : null;
    if (u && u.active) {
      req.userName = u.nome;
      req.userRole = u.role;
      req.userPermissions = u.permissions || {};
      req.mustChangePassword = !!u.mustChangePassword;
    } else {
      req.userId = null;
    }
  }
  // Identidade do TERMINAL (a máquina física), separada da identidade do
  // USUÁRIO logado nela — precisa das duas pra saber, no modo "porTerminal",
  // qual caixa pertence a qual máquina mesmo se o vendedor logado mudar ao
  // longo do turno. Gerado e guardado pelo próprio cliente (localStorage,
  // ver public/test.html); aqui é só repassado, o servidor nunca precisa
  // "cadastrar" um terminal.
  req.terminalId = req.get('X-Terminal-Id') || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado.' });
  next();
}

// Achado de auditoria (P1): sem isto, `mustChangePassword` (ver
// lib/seedAdmin.js) era só um aviso textual na tela de Ajuda — nada no
// SERVIDOR impedia continuar usando o admin/admin123 padrão indefinidamente.
// Bloqueia toda rota /api enquanto a troca estiver pendente, EXCETO
// /api/auth (login/logout/me/verify/change-password — sem isso ninguém
// conseguiria nem trocar a senha) e /api/license (já é pública de
// propósito, precisa continuar funcionando mesmo bloqueado). O cliente
// (app.js) já reforça a mesma coisa numa tela dedicada antes disto sequer
// ser testado — isto aqui é a garantia real, que vale mesmo pra quem
// ignorar a tela e chamar a API direto.
app.use((req, res, next) => {
  if (!req.mustChangePassword) return next();
  if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/license')) return next();
  if (!req.path.startsWith('/api/')) return next();
  res.status(403).json({ error: 'Troque a senha padrão antes de continuar.', mustChangePassword: true });
});

app.use('/api/auth', authRoutes);
// SEM requireAuth de propósito — ver comentário no topo de routes/license.js:
// precisa funcionar mesmo sem sessão nenhuma, inclusive travando a tela de
// login em si quando o trial/demo expira.
app.use('/api/license', licenseRoutes);
app.use('/api/products', requireAuth, productsRoutes);
app.use('/api/sales', requireAuth, salesRoutes);
app.use('/api/cash', requireAuth, cashRoutes);
app.use('/api/customers', requireAuth, customersRoutes);
// Achado de auditoria (ao portar suppliersRepo.js pra cá): SEM
// requirePermission('compras') aqui no mount, diferente de purchases —
// a extensão deixa listSuppliers/getSupplier propositalmente sem
// permissão (ver comentário em app/js/data/suppliersRepo.js): Estoque
// (aberto a qualquer vendedor com 'manageProducts', não precisa de
// 'compras') lê a lista pra preencher o fornecedor padrão de um
// produto — só CRIAR/EDITAR/EXCLUIR fornecedor é gestão sensível. Gate
// fica por rota, dentro de routes/suppliers.js, igual ao padrão já usado
// em routes/products.js.
app.use('/api/suppliers', requireAuth, suppliersRoutes);
app.use('/api/purchases', requireAuth, requirePermission('compras'), purchasesRoutes);
app.use('/api/finance', requireAuth, requirePermission('financeiro'), financeRoutes);
app.use('/api/loyalty', requireAuth, loyaltyRoutes);
app.use('/api/deliveries', requireAuth, deliveriesRoutes);
app.use('/api/users', requireAuth, requirePermission('usuarios'), usersRoutes);
// Achado de auditoria (Fase 9, ao portar auditRepo.js): SEM
// requirePermission('logs') aqui no mount — logAction() da extensão não
// tem permissão própria de propósito (não é uma "ação do usuário", é só
// o registro de uma ação que já passou pelo gate certo em outro
// repositório) — só a LEITURA (Log do sistema, ver views/logs.js) exige
// 'logs'. Gate fica por rota, dentro de routes/audit.js.
app.use('/api/audit', requireAuth, auditRoutes);
// Achado de auditoria (Fase 9, mesmo padrão já corrigido em suppliers e
// audit): SEM requirePermission('empresa') aqui no mount — getCompany()
// da extensão não tem permissão nenhuma (qualquer vendedor lê a política
// de desconto/juro pra saber se uma venda precisa de aprovação, ver
// sale.js), só saveCompany() (escrita) exige 'empresa'. Gate fica por
// rota, dentro de routes/company.js.
app.use('/api/company', requireAuth, companyRoutes);
app.use('/api/backup', requireAuth, requirePermission('backup'), backupRoutes);
app.use('/api/reports', requireAuth, requirePermission('relatorios'), reportsRoutes);

app.get('/api/status', (req, res) => {
  res.json({ ok: true, autenticado: !!req.userId });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws) => registerClient(ws));

// Limpa sessões expiradas periodicamente — sem isso a tabela `sessions` só
// cresce (cada login novo insere, nada nunca removia sozinho antes de
// existir isto).
setInterval(sweepExpiredSessions, 30 * 60 * 1000);
// Achado de auditoria (P4): mesmo motivo, agora pra `idempotency_keys` —
// ver db/index.js#sweepOldIdempotencyKeys.
setInterval(sweepOldIdempotencyKeys, 30 * 60 * 1000);

// Garante que o usuário admin exista antes de aceitar qualquer conexão —
// idempotente (não faz nada se já existir), então é seguro rodar em TODO
// arranque, mesmo numa hospedagem gerenciada (tipo GoDaddy) onde não dá
// pra rodar `node seed.js` à parte do comando de start configurado no
// painel.
await ensureAdminUser();

// Idempotente igual ensureAdminUser() acima — só grava na primeira vez,
// nos arranques seguintes não faz nada (ver lib/licenseState.js). É o
// equivalente daqui pro markTrialStartIfNeeded() da extensão (lá chamado
// só ao concluir o assistente de primeira execução, que este servidor não
// tem — o próprio primeiro arranque já é o evento correspondente).
markTrialStartIfNeeded();

httpServer.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const enderecos = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) enderecos.push(addr.address);
    }
  }
  console.log(`\nServidor da loja rodando na porta ${PORT}.`);
  console.log(`Neste computador: http://localhost:${PORT}`);
  if (enderecos.length > 0) {
    console.log('Nos outros computadores da mesma rede:');
    enderecos.forEach((ip) => console.log(`  http://${ip}:${PORT}`));
  } else {
    console.log('(Não detectei um endereço de rede local — confira se este computador está conectado ao Wi-Fi/cabo da loja.)');
  }
  console.log('');
});

// Achado de auditoria (P4): sem isto, um `Ctrl+C`/reinício de serviço
// (SIGINT/SIGTERM) matava o processo no meio de qualquer coisa — incluindo,
// em tese, no meio da janela mínima de uma escrita no WAL. Fecha primeiro
// as conexões HTTP (não aceita gente nova, deixa quem já está em request
// terminar), faz um checkpoint do WAL pro arquivo principal (não deixa
// nada só no -wal) e só então fecha o handle do banco — nessa ordem, pra
// não fechar o banco com alguma resposta HTTP ainda em voo tentando lê-lo.
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] Desligando o servidor da loja...`);
  closeAllClients();
  httpServer.close(() => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (err) {
      console.error('[shutdown] erro ao fechar o banco:', err);
    }
    releaseProcessLock();
    console.log('[shutdown] Encerrado.');
    process.exit(0);
  });
  // Segurança: se alguma conexão HTTP ficar pendurada e `close()` nunca
  // chamar o callback, não deixa o processo preso pra sempre.
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
