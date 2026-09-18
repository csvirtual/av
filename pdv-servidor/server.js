import express from 'express';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';

import { db, sweepOldIdempotencyKeys, getTenantDb } from './db/index.js';
import { controlDb, getTenantBySlug, autoSuspendExpiredTrial } from './control/db.js';
import { ensureAdminUser } from './lib/seedAdmin.js';
import { markTrialStartIfNeeded, getLicenseStatus } from './lib/licenseState.js';
import { getConfig } from './lib/companyConfig.js';
import { resolveSession, sweepExpiredSessions } from './lib/session.js';
import { getPlatformAdminById } from './lib/platformAdminAuth.js';
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
import signupRoutes from './routes/signup.js';
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
// sessão abaixo prepara contra req.db, já sempre resolvido pro banco certo
// (ver o middleware de resolução de tenant, mais abaixo neste arquivo).
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
// Achado de auditoria (pré-lançamento, payload gigante): o limite padrão
// do express.json() é 100kb — pequeno demais pro corpo de POST
// /api/backup/preview e /api/backup/import (routes/backup.js), que
// carrega o backup CRIPTOGRAFADO INTEIRO da loja em base64 dentro do
// próprio corpo JSON. Reproduzido: um envelope de ~200KB (tamanho
// plausível pra qualquer loja depois de alguns meses de uso — catálogo +
// vendas + movimentos de estoque + log) já tomava 413, tornando
// IMPOSSÍVEL restaurar o próprio backup assim que a loja crescesse além
// de ~70KB de dados. 25mb é generoso o bastante pra qualquer backup real
// (a exportação em si — GET, sem limite de corpo — nunca chegou perto
// disso nos testes) sem abrir mão de um teto (nunca "sem limite nenhum",
// isso seria a mesma classe de risco de DoS por payload que o limite
// existe pra fechar).
app.use(express.json({ limit: '25mb' }));
// Achado de auditoria (pré-lançamento, exposição de informação): sem
// isto, um corpo JSON malformado OU maior que o limite acima nunca
// chegava nas rotas de baixo — o handler de erro PADRÃO do Express pegava
// primeiro e devolvia uma página HTML com stack trace, incluindo o
// CAMINHO DE ARQUIVO no disco do servidor (ex:
// "/home/user/.../server.js"), pra qualquer requisição, autenticada ou
// não. Precisa vir logo depois do express.json() (é o único middleware
// que lança esse tipo de erro) — intercepta antes de qualquer coisa
// interna vazar, devolve só uma mensagem segura em JSON, no mesmo formato
// que toda rota da API já usa.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Arquivo enviado é grande demais.' });
  }
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Corpo da requisição não é um JSON válido.' });
  }
  next(err);
});
app.use(cookieParser());

// Achado de auditoria (pré-lançamento, HTTP security headers): dois
// headers de baixo risco (nunca quebram nada — não são como CSP, que
// exigiria mapear todo script/estilo inline de cada tela antes de ligar
// com segurança, incluindo public-admin/public-signup). X-Content-Type-Options
// impede o navegador de "adivinhar" um Content-Type diferente do
// declarado (ex: tratar um upload como HTML executável) — mitigação
// padrão contra um raciocínio de MIME-sniffing que, combinado com
// upload de arquivo, vira XSS. Referrer-Policy evita vazar a URL cheia
// (que pode ter dados da loja num path) pra um link externo clicado de
// dentro do sistema.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

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
  if (tenant.status === 'cancelado') return 'Assinatura cancelada.';
  if (tenant.status === 'suspenso') return 'Assinatura suspensa.';
  if (tenant.expires_at != null && Date.now() > tenant.expires_at) return 'Assinatura vencida.';
  return null;
}

function escapeBlockedPageHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Achado do usuário: a página de bloqueio deixava a loja sem nenhum jeito
// de agir, só um aviso — precisa dos mesmos botões de contato (WhatsApp e
// e-mail) que já existem em public/js/components/supportContact.js pro
// resto do app, com a mesma mensagem pré-preenchida (nome da loja e CNPJ,
// quando dá pra saber quais são). Ícones copiados literalmente de
// components/icon.js (`whatsapp`/`mail`) — mesma técnica do ícone de
// aviso abaixo, porque esta página não pode depender de nenhum arquivo
// externo (ver comentário de renderTenantBlockedPage).
const SUPPORT_WHATSAPP = '5571986461027';
const SUPPORT_EMAIL = 'csvirtual.av@gmail.com';
// Achado do usuário: quando o motivo é "loja não encontrada" (404), quem
// caiu aqui pode ser um endereço digitado errado por um cliente já
// existente, MAS também pode ser gente nova batendo numa loja que nunca
// existiu — esse segundo caso é oportunidade de cadastro perdida se a
// tela só oferece "fale com o suporte". Só entra no 404: no 403 (loja
// encontrada mas bloqueada, ex: trial vencido) quem está vendo a tela já
// é cliente, "cadastre outra loja" não faz sentido nenhum ali.
function renderTenantContactButtons(message, tenant, status) {
  const lines = [`Olá! Uso o sistema PDV - C&S Virtual e preciso de ajuda: ${message}`];
  if (tenant) {
    lines.push('', `Loja: ${tenant.nome_fantasia || tenant.razao_social || '(não identificada)'}`, `CNPJ: ${tenant.cnpj || '(não identificado)'}`);
  }
  const contactMessage = lines.join('\n');
  const waHref = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(contactMessage)}`;
  const mailHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('PDV - C&S Virtual: preciso de ajuda')}&body=${encodeURIComponent(contactMessage)}`;
  const isNotFound = status === 404 && !!MULTI_TENANT_DOMAIN;
  const signupHref = `https://${MULTI_TENANT_DOMAIN}/`;
  const signupSection = isNotFound ? `
    <p class="contact-hint">Ainda não tem o nosso PDV na sua loja?</p>
    <div class="contact-row">
      <a class="signup-btn" href="${signupHref}">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.22)"/><path d="M12 7v10M7 12h10" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
        <span>Cadastre agora grátis</span>
      </a>
    </div>` : '';
  const contactHint = isNotFound
    ? 'Se você já é nosso cliente e mesmo assim caiu aqui nesta tela, verifique se digitou corretamente o endereço da loja na barra de endereço deste navegador. Se algo parece errado, fale com o nosso suporte usando os botões abaixo.'
    : 'Se algo parece errado, fale com o nosso suporte.';
  return `
    ${signupSection}
    <p class="contact-hint">${contactHint}</p>
    <div class="contact-row">
      <a class="contact-btn contact-btn-wa" href="${waHref}" target="_blank" rel="noopener">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="wa-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#32D96A"/><stop offset="100%" stop-color="#1EAE53"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#wa-grad)"/><path d="M12 5.3a6.7 6.7 0 00-5.72 10.15L5.4 18.7l3.34-.88A6.7 6.7 0 1012 5.3z" fill="#fff"/><path d="M9.06 8.4c.24-.53.49-.54.72-.55.19-.01.4-.01.58.01.2.02.47-.08.73.55.28.65.92 2.27 1 2.43.09.17.14.36.02.57-.11.22-.17.34-.33.53-.17.19-.35.42-.5.57-.17.17-.34.35-.15.68.2.34.88 1.44 1.89 2.33 1.3 1.15 2.39 1.51 2.73 1.68.34.17.54.15.74-.08.2-.24.86-1 1.09-1.34.23-.34.47-.28.78-.17.32.12 2.02.95 2.36 1.12.34.17.56.26.65.4.08.15.08.85-.2 1.66-.29.82-1.64 1.6-2.29 1.68-.58.08-1.3.11-2.1-.14-.48-.15-1.09-.35-1.88-.69-3.31-1.43-5.47-4.77-5.64-5-.17-.22-1.35-1.79-1.35-3.42 0-1.63.85-2.42 1.15-2.75z" fill="#1EAE53"/></svg>
        <span>WhatsApp</span>
      </a>
      <a class="contact-btn contact-btn-mail" href="${mailHref}" target="_blank" rel="noopener">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="mail-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6EA8FF"/><stop offset="100%" stop-color="#3F7FF0"/></linearGradient></defs><rect x="2" y="4" width="20" height="16" rx="4.5" fill="url(#mail-grad)"/><path d="M2.6 6.3l8.75 6.9c.38.3.92.3 1.3 0l8.75-6.9" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>E-mail</span>
      </a>
    </div>`;
}

// Achado do usuário (print): a tela de "loja não encontrada"/"loja
// suspensa" saía como TEXTO PURO (res.send de uma string vira
// text/html sem nenhum estilo — fonte padrão do navegador, sem cor, sem
// nada do PDV) — porque este middleware roda ANTES de qualquer arquivo
// estático, inclusive o CSS: linkar public/css/styles.css aqui não
// funcionaria, essa mesma requisição também seria bloqueada. As páginas
// abaixo são 100% autocontidas (mesmos tokens de cor copiados de
// public-signup/signup.css, mesmo ícone de aviso de components/icon.js)
// — nascem e morrem sem depender de nenhum outro arquivo. CSS extraído
// aqui (BLOCKED_PAGE_STYLE) porque as duas páginas (tenant bloqueado e
// caminho inexistente, ver renderNotFoundRedirectPage mais abaixo)
// compartilham o mesmo cartão/tema, só o conteúdo de dentro muda.
const BLOCKED_PAGE_STYLE = `
  :root {
    --bg: #f4f6f5; --surface: #ffffff; --text: #1c2523; --text-muted: #62716d;
    --primary: #145333; --primary-dark: #0d3b24;
    --shadow-md: 0 4px 16px rgba(20, 30, 27, 0.12);
    --contact-border: rgba(20, 83, 51, 0.15);
    --contact-hover: rgba(20, 83, 51, 0.08);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #101613; --surface: #1a221e; --text: #e9efec; --text-muted: #93a89e;
      --primary: #2f9d6b; --primary-dark: #0d2b1c;
      --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.45);
      --contact-border: rgba(233, 239, 236, 0.15);
      --contact-hover: rgba(47, 157, 107, 0.18);
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; min-height: 100%; background: var(--bg); }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
    color: var(--text);
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(160deg, var(--primary-dark), var(--primary) 65%);
    padding: 32px 16px;
  }
  .card {
    background: var(--surface);
    border-radius: 16px;
    box-shadow: var(--shadow-md);
    width: 100%; max-width: 420px;
    padding: 36px 40px;
    text-align: center;
  }
  h1 { font-size: 20px; margin: 14px 0 8px; text-wrap: balance; }
  p { color: var(--text-muted); font-size: 14px; margin: 0; line-height: 1.5; }
  .contact-hint { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--contact-border); font-size: 13px; }
  .contact-row { display: flex; gap: 12px; justify-content: center; margin-top: 12px; flex-wrap: wrap; }
  .contact-btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 18px; border-radius: 999px;
    text-decoration: none; font-size: 13px; font-weight: 700;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .contact-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16); }
  .contact-btn-wa { background: rgba(30, 174, 83, 0.14); border: 1px solid rgba(30, 174, 83, 0.4); color: var(--text); }
  .contact-btn-mail { background: rgba(63, 127, 240, 0.14); border: 1px solid rgba(63, 127, 240, 0.4); color: var(--text); }
  .signup-btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 18px; border-radius: 999px;
    background: var(--primary); border: 1px solid transparent;
    color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .signup-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24); }
`;

function renderTenantBlockedPage(message, tenant, status) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PDV - C&amp;S Virtual: Loja indisponível</title>
<style>${BLOCKED_PAGE_STYLE}</style>
</head>
<body>
  <div class="card">
    <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l10.2 18H1.8L12 2.5z" fill="#f4a428" stroke="#c9841f" stroke-width=".6" stroke-linejoin="round"/><path d="M12 10v4.2" stroke="#2b2f36" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1" fill="#2b2f36"/></svg>
    <h1>Loja indisponível</h1>
    <p>${escapeBlockedPageHtml(message)}</p>
    ${renderTenantContactButtons(message, tenant, status)}
  </div>
</body>
</html>
`;
}

// Achado do usuário: caminho que não existe (mas o HOST em si é válido —
// domínio-base de cadastro, painel de admin, ou uma loja de verdade já
// resolvida) merece uma mensagem diferente da de "loja indisponível"
// (que é sobre o HOST não resolver pra nenhuma loja, um problema bem
// diferente): aqui a "loja"/painel/cadastro está funcionando
// normalmente, só o CAMINHO específico é que não existe. Mesma
// aparência (cartão, gradiente, ícone), conteúdo e comportamento
// diferentes: "Erro 404" + redirecionamento automático pra "/" depois
// de alguns segundos (pra onde exatamente depende de quem está vendo —
// dashboard se já estiver logado, tela de login se não estiver, decidido
// pelo próprio app/painel depois do redirecionamento, não por esta
// página estática).
function renderNotFoundRedirectPage(redirectSeconds = 7) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PDV - C&amp;S Virtual: Página não encontrada</title>
<style>${BLOCKED_PAGE_STYLE}</style>
</head>
<body>
  <div class="card">
    <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="rgba(20, 83, 51, 0.12)" stroke="var(--primary)" stroke-width="1.4"/><path d="M9.5 9.5a2.5 2.5 0 114.2 1.85c-.6.55-1.2.95-1.2 1.9" stroke="var(--primary)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="12" cy="16.3" r="1" fill="var(--primary)"/></svg>
    <h1>Erro 404</h1>
    <p>A página que você pesquisou não existe.</p>
    <p style="margin-top: 10px;">Você está sendo redirecionado à página inicial do PDV, ou à tela de login se não estiver logado, em <span id="cd">${redirectSeconds}</span> segundos.</p>
  </div>
  <script>
    var s = ${redirectSeconds};
    var el = document.getElementById('cd');
    var t = setInterval(function () {
      s -= 1;
      if (s <= 0) { clearInterval(t); location.href = '/'; return; }
      el.textContent = s;
    }, 1000);
  </script>
</body>
</html>
`;
}

// API (fetch de JS que já tenha carregado) precisa continuar recebendo
// JSON, não HTML — só a NAVEGAÇÃO de página (o que o navegador mostra na
// aba) usa a página estilizada acima.
function sendTenantBlocked(req, res, status, message, tenant) {
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: message });
  res.status(status).type('html').send(renderTenantBlockedPage(message, tenant, status));
}
// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// admin.<MULTI_TENANT_DOMAIN> é o subdomínio RESERVADO (RESERVED_SLUGS,
// ver scripts/createTenant.js) do painel de Super Admin — nunca pode ser
// uma loja de verdade, então nem entra na resolução de tenant abaixo.
// Etapa 9: o domínio-BASE em si (sem subdomínio nenhum, ex:
// "pdv-csvirtual.com.br") é o cadastro self-service (routes/signup.js) —
// mesmo raciocínio, terreno que nenhuma loja jamais ocupa (uma loja
// sempre precisa de um SUBdomínio, ver resolveTenantRowFromHostname
// acima: `hostname === MULTI_TENANT_DOMAIN`, sem o "." de subdomínio,
// nunca bate com `.endsWith(suffix)`).
//
// Bloqueio simétrico, dos três lados: (a) toda rota de LOJA (/api/* fora
// de /api/admin e /api/signup) chegando com o Host do painel ou do
// cadastro — sem isso, `req.isPlatformAdminHost`/`req.isSignupHost` nunca
// seriam marcados, o middleware de resolução de tenant logo abaixo cairia
// no ramo de modo legado, e essas duas telas acabariam lendo/escrevendo o
// banco fixo do processo por acidente; (b) toda
// rota do PAINEL (/api/admin/*) chegando por qualquer OUTRO Host — sem
// isso, `/api/admin/tenants` seria alcançável (e autenticável, bastando o
// cookie certo) por qualquer subdomínio de loja; (c) mesma coisa pra
// /api/signup, só que sem cookie nenhum protegendo — mais motivo ainda
// pra nunca ficar aberta em nenhum outro Host além do domínio-base.
const ADMIN_HOSTNAME = MULTI_TENANT_DOMAIN ? `admin.${MULTI_TENANT_DOMAIN}` : null;
app.use((req, res, next) => {
  if (!MULTI_TENANT_DOMAIN) return next();
  const isAdminHost = req.hostname === ADMIN_HOSTNAME;
  const isSignupHost = req.hostname === MULTI_TENANT_DOMAIN;
  const isAdminPath = req.path.startsWith('/api/admin');
  const isSignupPath = req.path.startsWith('/api/signup');
  if (isAdminHost) {
    req.isPlatformAdminHost = true;
    if (req.path.startsWith('/api/') && !isAdminPath) return res.status(404).send('Não encontrado.');
    return next();
  }
  if (isSignupHost) {
    req.isSignupHost = true;
    if (req.path.startsWith('/api/') && !isSignupPath) return res.status(404).send('Não encontrado.');
    return next();
  }
  if (isAdminPath || isSignupPath) return res.status(404).send('Não encontrado.');
  next();
});
// Achado de auditoria (DRY — fonte única de verdade pro banco da
// requisição): antes, `req.db` só era preenchido aqui quando
// MULTI_TENANT_DOMAIN estava configurada — em modo legado (a instalação
// de toda loja de hoje) ficava indefinido pra sempre, e cada uma das
// ~80 rotas em routes/*.js precisava repetir o mesmo fallback
// (`req.db`) pra saber qual banco usar. Mesma regra, 80 lugares
// diferentes decidindo. Agora `req.db` sai daqui SEMPRE definido (o
// banco do tenant resolvido, ou o banco fixo do processo em modo
// legado) — nenhuma rota de loja mais precisa saber que "modo legado"
// existe, só usa `req.db` direto. (Nunca preenchido pro Host do painel
// de Super Admin nem do cadastro self-service — essas duas telas usam
// `controlDb` direto, nunca uma loja específica.)
app.use((req, res, next) => {
  if (req.isPlatformAdminHost || req.isSignupHost) return next();
  if (!MULTI_TENANT_DOMAIN) {
    req.db = db;
    return next();
  }
  const tenant = resolveTenantRowFromHostname(req.hostname);
  if (!tenant) {
    return sendTenantBlocked(req, res, 404, 'Loja não encontrada.');
  }
  const blockedReason = tenantAccessBlockedReason(tenant);
  if (blockedReason) {
    return sendTenantBlocked(req, res, 403, blockedReason, tenant);
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

// Etapa 8/9 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): o
// painel de Super Admin e o cadastro self-service são SPAs totalmente
// separadas (pastas próprias, public-admin/ e public-signup/) — nunca a
// mesma servida pra uma loja, mesmo raciocínio do gate acima que já
// isola o resto do pipeline por Host.
const storeStaticMiddleware = express.static(path.join(__dirname, 'public'));
const adminStaticMiddleware = express.static(path.join(__dirname, 'public-admin'));
const signupStaticMiddleware = express.static(path.join(__dirname, 'public-signup'));
app.use((req, res, next) => {
  if (req.isPlatformAdminHost) return adminStaticMiddleware(req, res, next);
  if (req.isSignupHost) return signupStaticMiddleware(req, res, next);
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
  // Etapa 8/9 do roteiro multi-tenant: sessão de LOJA não existe no
  // subdomínio do Super Admin (que tem a própria, ver routes/admin/auth.js
  // e o cookie `admin_session`) nem no domínio-base de cadastro (que não
  // tem sessão nenhuma — POST /api/signup é público) — sem este corte,
  // `req.db` indefinido cairia no fallback `db` (banco fixo do processo)
  // só pra descobrir que não há cookie `session` nenhum ali mesmo; pular
  // é só mais direto.
  if (req.isPlatformAdminHost || req.isSignupHost) return next();
  req.userId = resolveSession(req.cookies?.session, req.db) || null;
  req.userName = null;
  req.userRole = null;
  req.userPermissions = null;
  req.mustChangePassword = false;
  if (req.userId) {
    const row = req.db.prepare(GET_USER_BY_ID_SQL).get(req.userId);
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
  if (req.isPlatformAdminHost || req.isSignupHost) return next();
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
  // Etapa 8/9 do roteiro multi-tenant: o gate de licença é sobre a
  // ASSINATURA DE UMA LOJA (lib/licenseState.js) — não existe "loja" no
  // subdomínio do Super Admin nem no domínio-base de cadastro, então nada
  // aqui se aplica (o controle sobre uma loja específica já é feito pela
  // etapa 7, no middleware de resolução por Host, antes de chegar até
  // aqui).
  if (req.isPlatformAdminHost || req.isSignupHost) return next();
  if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/license')) return next();
  if (!req.path.startsWith('/api/')) return next();
  try {
    const cnpj = getConfig(req.db).cnpj || '';
    const status = await getLicenseStatus(cnpj, req.db);
    if (status.active) return next();
    // Achado do usuário: quando o período de teste de 7 dias acaba, a
    // loja deve suspender também na PLATAFORMA — este é o gate que de
    // fato bloqueia toda rota de API assim que a licença fica inativa
    // (routes/license.js#/status, o outro lugar que dispara a mesma
    // função, está fora deste gate de propósito — precisa continuar
    // alcançável mesmo bloqueado). Só mexe se o status atual for "trial"
    // (ver control/db.js#autoSuspendExpiredTrial); idempotente.
    if (req.tenantId) autoSuspendExpiredTrial(req.tenantId);
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
  // Anexa quem está agindo — routes/admin/tenants.js#DELETE precisa do
  // username pra reconfirmar a senha antes de excluir uma loja (mesmo
  // raciocínio de req.userId em requireAuth, versão painel).
  req.platformAdmin = getPlatformAdminById(adminId);
  next();
}
app.use('/api/admin', adminAuthRoutes);
app.use('/api/admin/tenants', requireAdminAuth, adminTenantsRoutes);

// Etapa 9 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): API
// de cadastro self-service — só alcançável pelo domínio-base (bloqueado
// nos outros hosts lá em cima, no primeiro `app.use` deste arquivo).
// SEM requireAuth/requireAdminAuth de propósito: é o único jeito de criar
// uma loja sem já ter uma sessão de nada.
app.use('/api/signup', signupRoutes);

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

// Achado do usuário (print): visitar um caminho que não existe (ex:
// digitado errado, link velho, bot sondando) caía no handler PADRÃO do
// Express — "Cannot GET /caminho", texto cru sem nada do visual do PDV.
// Pega qualquer requisição que sobrou sem resposta até aqui:
// - /api/* desconhecido: 404 JSON simples (nunca a página HTML — quem
//   chama uma API espera JSON, mesmo quando o caminho em si não existe).
// - Qualquer outro caminho, em qualquer host (domínio-base de cadastro,
//   painel de Super Admin, ou uma loja de verdade já resolvida e
//   liberada): página de "Erro 404" com redirecionamento automático pra
//   "/" (ver renderNotFoundRedirectPage) — diferente da página de "loja
//   indisponível" (essa é sobre o HOST inteiro não resolver pra nenhuma
//   loja; aqui o host está ótimo, só o caminho específico é que não
//   existe). O próprio "/" decide o que mostrar depois do
//   redirecionamento: formulário de cadastro, tela de login do painel,
//   ou o app da loja (dashboard se já estiver logado, login se não —
//   nunca esta página estática decidindo isso).
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Não encontrado.' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.status(404).type('html').send(renderNotFoundRedirectPage());
});

// Achado de auditoria (pré-lançamento, exposição de informação — defesa
// em profundidade): toda rota já trata seus próprios erros (try/catch,
// resposta JSON própria — ver qualquer routes/*.js), mas um erro
// verdadeiramente inesperado (bug numa dependência, algo que escapou de
// um try/catch) ainda cairia no handler PADRÃO do Express, que devolve
// uma página HTML com stack trace completo — incluindo caminho de
// arquivo no disco do servidor — pra qualquer cliente, autenticado ou
// não. Rede de segurança final: nunca deveria disparar no uso normal,
// mas se disparar, garante que o vazamento não acontece. O erro
// completo continua indo pro log do servidor (nunca escondido de quem
// opera a loja), só não vai mais pra quem fez a requisição.
app.use((err, req, res, next) => {
  console.error('[erro inesperado] não tratado por nenhuma rota:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Erro inesperado no servidor.' });
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
// Achado de auditoria (pré-lançamento): o upgrade do WebSocket nunca
// conferia sessão nenhuma — bastava alcançar a rede (LAN da loja, ou a
// internet inteira em modo multi-tenant) pra abrir `ws://.../ws` sem
// login nenhum e ficar recebendo, em tempo real, todo aviso de venda,
// caixa, cliente, produto etc. desta loja (id + motivo do evento — nunca
// o dado completo, ver lib/broadcast.js, mas ainda assim informação
// operacional e IDs reais que nenhum visitante sem sessão deveria ver).
// O upgrade não passa pelos middlewares do Express (mesmo raciocínio já
// documentado acima pra resolução de tenant), então a sessão precisa ser
// conferida aqui à mão, a partir do cookie cru do handshake — mesma
// função (resolveSession) e mesma regra (conta precisa continuar ativa)
// que já protegem toda rota HTTP, ver o middleware de sessão logo acima
// neste arquivo.
function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}
function wsSessionIsValid(req, targetDb) {
  const cookies = parseCookieHeader(req.headers.cookie);
  const userId = resolveSession(cookies.session, targetDb);
  if (!userId) return false;
  const row = targetDb.prepare(GET_USER_BY_ID_SQL).get(userId);
  const u = row ? JSON.parse(row.data) : null;
  return !!(u && u.active);
}
wss.on('connection', (ws, req) => {
  if (MULTI_TENANT_DOMAIN) {
    const hostname = (req.headers.host || '').split(':')[0];
    const tenant = resolveTenantRowFromHostname(hostname);
    if (!tenant || tenantAccessBlockedReason(tenant)) {
      ws.close();
      return;
    }
    const tenantDb = getTenantDb(tenant.id);
    if (!wsSessionIsValid(req, tenantDb)) {
      ws.close();
      return;
    }
    registerClient(ws, tenant.id);
    return;
  }
  if (!wsSessionIsValid(req, db)) {
    ws.close();
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
