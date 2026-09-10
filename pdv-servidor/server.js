import express from 'express';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { db } from './db/index.js';
import { ensureAdminUser } from './lib/seedAdmin.js';
import { resolveSession, sweepExpiredSessions } from './lib/session.js';
import { registerClient } from './lib/broadcast.js';
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

const app = express();
app.use(express.json());
app.use(cookieParser());
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
  if (req.userId) {
    const row = getUserByIdStmt.get(req.userId);
    const u = row ? JSON.parse(row.data) : null;
    if (u && u.active) {
      req.userName = u.nome;
      req.userRole = u.role;
      req.userPermissions = u.permissions || {};
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

app.use('/api/auth', authRoutes);
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

// Garante que o usuário admin exista antes de aceitar qualquer conexão —
// idempotente (não faz nada se já existir), então é seguro rodar em TODO
// arranque, mesmo numa hospedagem gerenciada (tipo GoDaddy) onde não dá
// pra rodar `node seed.js` à parte do comando de start configurado no
// painel.
await ensureAdminUser();

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
