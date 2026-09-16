import express from 'express';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';

import { db, sweepOldIdempotencyKeys, getTenantDb } from './db/index.js';
import { controlDb, getTenantBySlug } from './control/db.js';
import { ensureAdminUser } from './lib/seedAdmin.js';
import { markTrialStartIfNeeded, getLicenseStatus } from './lib/licenseState.js';
import { getConfig } from './lib/companyConfig.js';
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
import adminAuthRoutes from './routes/admin/auth.js';
import adminTenantsRoutes from './routes/admin/tenants.js';
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
// Etapa 5 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): SQL
// como texto, não mais um prepared statement pré-montado — o middleware de
// sessão abaixo prepara contra req.db (o tenant da requisição) quando
// existir, senão contra o banco fixo do processo, comportamento idêntico
// a antes desta etapa.
const GET_USER_BY_ID_SQL = 'SELECT data FROM users WHERE id = ?';

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

// Etapa 3 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// resolve o tenant pelo subdomínio do Host (ex: lojax.<MULTI_TENANT_DOMAIN>
// -> slug "lojax"), ANTES de qualquer outro gate — se o Host não apontar
// pra uma loja cadastrada, a requisição nem chega perto de rota nenhuma.
// Sem MULTI_TENANT_DOMAIN definida — o caso de toda instalação de hoje —
// este middleware não faz nada (nem olha o Host), e o comportamento
// observável continua idêntico a antes desta etapa: nenhuma rota consome
// req.tenantId/req.db ainda (isso só entra numa etapa futura do roteiro,
// junto da troca de routes/*.js pra usar req.db em vez do `db` fixo);
// aqui eles só ficam prontos, resolvidos uma vez por requisição.
const MULTI_TENANT_DOMAIN = process.env.MULTI_TENANT_DOMAIN || null;
// Etapa 6 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// mesma resolução Host -> tenant usada pelo middleware HTTP logo abaixo,
// extraída em função à parte pra também servir a conexão WebSocket (ver
// wss.on('connection', ...) mais adiante) — os dois pontos de entrada
// precisam resolver o tenant do mesmo jeito. Devolve `null` (loja
// desconhecida/domínio errado) sempre que MULTI_TENANT_DOMAIN está
// configurada mas o hostname não bate com nenhuma loja; devolve
// `undefined` quando MULTI_TENANT_DOMAIN nem está configurada (nenhum
// tenant pra resolver, comportamento idêntico a antes desta etapa).
function resolveTenantRowFromHostname(hostname) {
  if (!MULTI_TENANT_DOMAIN) return undefined;
  const suffix = `.${MULTI_TENANT_DOMAIN}`;
  // endsWith(suffix) já rejeita o domínio-base sozinho (sem subdomínio):
  // "pdv-csvirtual.com.br" não termina em ".pdv-csvirtual.com.br".
  if (!hostname || !hostname.endsWith(suffix)) return null;
  const slug = hostname.slice(0, -suffix.length);
  return getTenantBySlug(slug);
}
// Etapa 7 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// licença/assinatura, no modo SaaS, é controlada pela PLATAFORMA
// (tenants.status/expires_at no banco de controle), não mais só pelo
// mecanismo de trial/chave de ativação por loja (lib/licenseState.js,
// que continua existindo e funcionando exatamente como antes — é o
// mecanismo de licenciamento do produto single-tenant/on-premise, e
// segue valendo por baixo mesmo numa loja SaaS). Uma loja com assinatura
// suspensa/cancelada/vencida é bloqueada aqui, ANTES de qualquer rota
// (inclusive estáticos e login) — mesmo ponto de entrada único que já
// bloqueia Host desconhecido (etapa 3) — sem precisar de outra chamada
// de rede nem duplicar a checagem em cada rota.
function tenantAccessBlockedReason(tenant) {
  if (tenant.status === 'cancelado') return 'Esta loja foi cancelada. Entre em contato com o suporte.';
  if (tenant.status === 'suspenso') return 'Esta loja está com a assinatura suspensa. Entre em contato com o suporte.';
  if (tenant.expires_at != null && Date.now() > tenant.expires_at) return 'A assinatura desta loja expirou. Entre em contato com o suporte.';
  return null;
}
// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// admin.<MULTI_TENANT_DOMAIN> é o subdomínio RESERVADO (RESERVED_SLUGS,
// ver scripts/createTenant.js) do painel de Super Admin — nunca pode ser
// uma loja de verdade, então nem entra na resolução de tenant abaixo.
// Bloqueio simétrico, dos dois lados: (a) toda rota de LOJA (/api/* fora
// de /api/admin) chegando com o Host do painel — sem isso, um `req.db`
// indefinido cairia no fallback `db` (o banco fixo do processo, ver
// routes/*.js#`req.db || db`) e o painel acabaria lendo/escrevendo a loja
// LEGADA por acidente; (b) toda rota do PAINEL (/api/admin/*) chegando
// por qualquer OUTRO Host — sem isso, `/api/admin/tenants` seria
// alcançável (e autenticável, bastando o cookie certo) por qualquer
// subdomínio de loja, não só pelo domínio reservado do painel.
const ADMIN_HOSTNAME = MULTI_TENANT_DOMAIN ? `admin.${MULTI_TENANT_DOMAIN}` : null;
app.use((req, res, next) => {
  if (!ADMIN_HOSTNAME) return next();
  const isAdminHost = req.hostname === ADMIN_HOSTNAME;
  const isAdminPath = req.path.startsWith('/api/admin');
  if (isAdminHost) {
    req.isPlatformAdminHost = true;
    if (req.path.startsWith('/api/') && !isAdminPath) return res.status(404).send('Não encontrado.');
    return next();
  }
  if (isAdminPath) return res.status(404).send('Não encontrado.');
  next();
});
app.use((req, res, next) => {
  if (!MULTI_TENANT_DOMAIN || req.isPlatformAdminHost) return next();
  const tenant = resolveTenantRowFromHostname(req.hostname);
  if (!tenant) {
    return res.status(404).send('Loja não encontrada.');
  }
  const blockedReason = tenantAccessBlockedReason(tenant);
  if (blockedReason) {
    return res.status(403).send(blockedReason);
  }
  req.tenantId = tenant.id;
  req.db = getTenantDb(tenant.id);
  next();
});

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

// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): o
// painel de Super Admin é uma SPA totalmente separada (pasta própria,
// public-admin/) — nunca a mesma servida pra uma loja, mesmo raciocínio
// do gate acima que já isola o resto do pipeline por Host.
const storeStaticMiddleware = express.static(path.join(__dirname, 'public'));
const adminStaticMiddleware = express.static(path.join(__dirname, 'public-admin'));
app.use((req, res, next) => {
  if (req.isPlatformAdminHost) return adminStaticMiddleware(req, res, next);
  storeStaticMiddleware(req, res, next);
});

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
  // Etapa 8 do roteiro multi-tenant: sessão de LOJA não existe no
  // subdomínio do Super Admin (que tem a própria, ver routes/admin/auth.js
  // e o cookie `admin_session`) — sem este corte, `req.db` indefinido
  // cairia no fallback `db` (banco fixo do processo) só pra descobrir que
  // não há cookie `session` nenhum ali mesmo; pular é só mais direto.
  if (req.isPlatformAdminHost) return next();
  req.userId = resolveSession(req.cookies?.session, req.db) || null;
  req.userName = null;
  req.userRole = null;
  req.userPermissions = null;
  req.mustChangePassword = false;
  if (req.userId) {
    const row = (req.db || db).prepare(GET_USER_BY_ID_SQL).get(req.userId);
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
  if (req.isPlatformAdminHost) return next();
  if (!req.mustChangePassword) return next();
  if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/license')) return next();
  if (!req.path.startsWith('/api/')) return next();
  res.status(403).json({ error: 'Troque a senha padrão antes de continuar.', mustChangePassword: true });
});

// Achado de auditoria (P0, Red Team): a tela de bloqueio de licença
// (renderLicenseBlockedScreen em public/js/app.js) intercepta o boot ANTES
// de chegar no login quando o trial/demo/chave expirou — mas isso é só o
// CLIENTE decidindo o que mostrar. Nada no servidor impedia uma sessão que
// já estava logada ANTES da expiração (ou uma chamada direta à API,
// ignorando a tela por completo) de continuar vendendo, cadastrando
// produto, fechando caixa etc. depois que a licença expirasse — reproduzido
// na auditoria: forcei o trial pra expirado e um POST /api/products com
// sessão válida voltou 201 normalmente. Mesmo padrão de allowlist do gate
// de mustChangePassword acima: bloqueia toda rota /api, exceto /api/auth
// (login precisa continuar funcionando — é assim que a tela de bloqueio
// consegue at least deixar alguém entrar pra ativar uma chave nova) e
// /api/license (já pública de propósito, ver routes/license.js).
app.use(async (req, res, next) => {
  // Etapa 8 do roteiro multi-tenant: o gate de licença é sobre a
  // ASSINATURA DE UMA LOJA (lib/licenseState.js) — não existe "loja" no
  // subdomínio do Super Admin, então nada aqui se aplica (o controle
  // sobre uma loja específica já é feito pela etapa 7, no middleware de
  // resolução por Host, antes de chegar até aqui).
  if (req.isPlatformAdminHost) return next();
  if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/license')) return next();
  if (!req.path.startsWith('/api/')) return next();
  try {
    const cnpj = getConfig(req.db).cnpj || '';
    const status = await getLicenseStatus(cnpj, req.db);
    if (status.active) return next();
    res.status(403).json({ error: 'A licença deste sistema expirou. Ative uma chave nova em Dados da loja → Licença.', licenseExpired: true });
  } catch (err) {
    console.error('[erro inesperado] gate de licença:', err);
    // Nunca bloqueia por um erro INESPERADO na própria checagem (ex.: banco
    // momentaneamente indisponível) — só quando a licença de fato está
    // expirada/inválida, que é o único caso que `status.active === false`
    // representa. Um bug aqui travar a loja inteira seria pior que o risco
    // que este gate existe pra fechar.
    next();
  }
});

// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): API do
// painel de Super Admin — só alcançável pelo subdomínio reservado
// (bloqueado nos outros hosts lá em cima, no primeiro `app.use` deste
// arquivo). `requireAdminAuth` é local (não `requireAuth`, que confere
// `req.userId` — sessão de LOJA; aqui é sempre sessão de PLATAFORMA,
// contra `controlDb`, nunca `req.db`).
function requireAdminAuth(req, res, next) {
  const adminId = resolveSession(req.cookies?.admin_session, controlDb);
  if (!adminId) return res.status(401).json({ error: 'Não autenticado.' });
  next();
}
app.use('/api/admin', adminAuthRoutes);
app.use('/api/admin/tenants', requireAdminAuth, adminTenantsRoutes);

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

// `tenantId`: diagnóstico pra etapa 4 do roteiro multi-tenant (ver artifact
// "PDV Multi-Tenant") — nenhuma rota de negócio lê req.tenantId/req.db
// ainda (só entra na etapa 5), então esta é, por enquanto, a ÚNICA forma
// de provar via HTTP de verdade que a resolução por Host (etapa 3) está
// funcionando ponta a ponta, sem precisar esperar a conversão das rotas.
// `null` sem MULTI_TENANT_DOMAIN (mesmo comportamento de sempre).
app.get('/api/status', (req, res) => {
  res.json({ ok: true, autenticado: !!req.userId, tenantId: req.tenantId || null });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
// Etapa 6 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): o
// upgrade do WebSocket não passa pelos middlewares do Express acima — o
// `req` aqui é o http.IncomingMessage cru do handshake, então o tenant
// precisa ser resolvido de novo a partir do Host dele (mesma função usada
// pelo middleware HTTP). Sem MULTI_TENANT_DOMAIN, `tenantId` fica
// `undefined` pra toda conexão — mesma sala única de sempre (ver
// lib/broadcast.js#LEGACY_TENANT_KEY), comportamento idêntico a antes
// desta etapa. Com MULTI_TENANT_DOMAIN configurada, um Host que não bate
// com nenhuma loja cadastrada tem a conexão fechada na hora — mesma regra
// de acesso que já vale pra HTTP (404 "Loja não encontrada"). Etapa 7:
// mesmo raciocínio pra uma loja com assinatura suspensa/cancelada/vencida
// (tenantAccessBlockedReason) — sem mensagem de erro no protocolo
// WebSocket (não dá pra mandar um corpo como no 403 HTTP), só fecha.
wss.on('connection', (ws, req) => {
  if (MULTI_TENANT_DOMAIN) {
    const hostname = (req.headers.host || '').split(':')[0];
    const tenant = resolveTenantRowFromHostname(hostname);
    if (!tenant || tenantAccessBlockedReason(tenant)) {
      ws.close();
      return;
    }
    registerClient(ws, tenant.id);
    return;
  }
  registerClient(ws);
});

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
