import express from 'express';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { db } from './db/index.js';
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
import { requirePermission } from './lib/permissions.js';

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
app.use((req, res, next) => {
  req.userId = resolveSession(req.cookies?.session) || null;
  req.userName = null;
  req.userRole = null;
  req.userPermissions = null;
  if (req.userId) {
    const row = getUserByIdStmt.get(req.userId);
    if (row) {
      const u = JSON.parse(row.data);
      req.userName = u.nome;
      req.userRole = u.role;
      req.userPermissions = u.permissions || {};
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
app.use('/api/suppliers', requireAuth, requirePermission('compras'), suppliersRoutes);
app.use('/api/purchases', requireAuth, requirePermission('compras'), purchasesRoutes);
app.use('/api/finance', requireAuth, requirePermission('financeiro'), financeRoutes);
app.use('/api/loyalty', requireAuth, loyaltyRoutes);
app.use('/api/deliveries', requireAuth, deliveriesRoutes);
app.use('/api/users', requireAuth, requirePermission('usuarios'), usersRoutes);
app.use('/api/audit', requireAuth, requirePermission('logs'), auditRoutes);
app.use('/api/company', requireAuth, requirePermission('empresa'), companyRoutes);
app.use('/api/backup', requireAuth, requirePermission('backup'), backupRoutes);

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
