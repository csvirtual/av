import { Router } from 'express';
import { db } from '../db/index.js';
import { createSession, destroySession } from '../lib/session.js';
import { logAction } from '../lib/audit.js';
import { verifyLogin } from '../lib/verifyLogin.js';
import { getLoginLockState } from '../lib/loginLockout.js';
import { hashPassword, verifyPasswordHash } from '../lib/auth.js';
import { MIN_USER_PASSWORD_LENGTH } from '../lib/permissions.js';

const router = Router();

const findById = db.prepare('SELECT * FROM users WHERE id = ?');
const updateUserData = db.prepare('UPDATE users SET data = @data WHERE id = @id');

function publicUser(row) {
  const u = JSON.parse(row.data);
  // Nunca manda salt/hash de senha pro cliente — só o necessário pra tela
  // (mesmo formato que a extensão single-machine expõe em ctx.user).
  return {
    id: u.id, nome: u.nome, username: u.username, role: u.role, permissions: u.permissions,
    mustChangePassword: !!u.mustChangePassword,
  };
}

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!String(username || '').trim() || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }
    // Achado de auditoria (Fase 8): checa o bloqueio ANTES de tentar a senha —
    // dá uma mensagem melhor (quanto falta) sem gastar mais uma tentativa.
    // verifyLogin também confere isto por dentro (nunca confia só na tela),
    // então mesmo pulando esta checagem aqui o resultado seria o mesmo, só
    // com uma mensagem genérica em vez da contagem regressiva.
    const preLock = getLoginLockState(username);
    if (preLock.remainingMs > 0) {
      return res.status(429).json({
        error: `Muitas tentativas incorretas — aguarde ${Math.ceil(preLock.remainingMs / 1000)}s antes de tentar de novo.`,
        remainingMs: preLock.remainingMs,
      });
    }
    // Nunca revela se a conta existe, está inativa, ou a senha está errada —
    // sempre a mesma mensagem genérica pras três (mesmo raciocínio de
    // usersRepo.js#verifyLogin da extensão: diferenciar isso por fora
    // permitiria enumerar quais contas existem só pelo comportamento do
    // login).
    const user = await verifyLogin(username, password);
    if (!user) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    const row = findById.get(user.id);

    // Achado do usuário: até aqui, todo login herdava a MESMA rota
    // (#hash) que quem usou este navegador por último estava vendo — se
    // as permissões forem diferentes, o próximo a entrar podia cair numa
    // tela que não devia acessar (com as ações bloqueadas, mas ainda
    // assim confuso). Regra nova, decidida aqui no servidor pra valer em
    // qualquer terminal: todo login cai no Painel — EXCETO o primeiro
    // login de verdade de QUALQUER conta (admin incluído — achado do
    // usuário: o admin, ao subir o servidor pela primeira vez num Node
    // novo, também deve cair direto na Ajuda, que já explica o que fazer,
    // em vez do Painel vazio), que cai na Ajuda uma única vez. `admin`
    // (seed.js) e todo vendedor novo (routes/users.js#POST) nascem com
    // `hasSeenAjuda: false`; vira `true` aqui no primeiro login de cada
    // um, então ninguém vê a Ajuda forçada de novo nos próximos logins —
    // cada CONTA passa por isso uma vez só, não é por terminal/navegador.
    // O cliente (app.js) decide o `#/dashboard` vs `#/ajuda` com este
    // único campo da resposta — ver renderLogin().
    const firstLogin = !user.hasSeenAjuda;
    if (firstLogin) {
      user.hasSeenAjuda = true;
      updateUserData.run({ id: user.id, data: JSON.stringify(user) });
    }

    const token = createSession(user.id);
    // Achado de auditoria (P3): `secure` fixo em `false` deixaria o cookie de
    // sessão trafegando sem essa proteção mesmo em quem hospeda isto atrás de
    // HTTPS (ex.: GoDaddy/preview, que fala HTTPS com o navegador e repassa
    // pro Node por trás) — condicional, liga sozinho nesse caso e continua
    // desligado no uso principal (HTTP puro na rede interna da loja, sem
    // certificado, onde exigir `secure` quebraria o login). `req.secure`
    // cobre TLS terminado no próprio processo; `x-forwarded-proto` cobre TLS
    // terminado num proxy na frente (não habilitamos `trust proxy` global só
    // por isso — nada mais no servidor lê req.ip/protocol, então checar o
    // cabeçalho aqui é suficiente e não muda comportamento em outro lugar).
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      maxAge: 12 * 60 * 60 * 1000,
    });
    logAction({ userId: user.id, userName: user.nome, role: user.role, action: 'Login', details: '', entity: 'user', entityId: user.id });
    res.json({ user: publicUser(row), firstLogin });
  } catch (err) {
    // Achado de auditoria (auditoria de prontidão pra produção): esta rota
    // é, de longe, a mais chamada do sistema inteiro (todo login) — era a
    // única (junto de /verify, logo abaixo) sem try/catch entre os 10
    // handlers assíncronos do servidor. Numa falha inesperada aqui (ex: um
    // registro de usuário corrompido quebrando o JSON.parse dentro de
    // verifyLogin), a Promise rejeitada NUNCA seria pega pelo Express 4
    // (que só captura throw síncrono) — em versões modernas do Node, uma
    // rejeição não tratada DERRUBA O PROCESSO inteiro, tirando do ar TODOS
    // os terminais conectados de uma vez, não só quem tentou logar.
    console.error('[erro inesperado] POST /api/auth/login:', err);
    res.status(500).json({ error: 'Erro inesperado ao entrar. Tente novamente.' });
  }
});

// Confirma usuário+senha SEM criar sessão nem cookie — usado pra
// confirmações pontuais de identidade dentro de uma sessão já logada
// como outra pessoa (ex: aprovação de desconto acima do limite, fechar
// caixa — ver components/passwordConfirm.js da extensão, o mesmo núcleo
// reaproveitado nos 3 pontos sensíveis a dinheiro/segurança). SEMPRE com
// `namespace` próprio (nunca o namespace do login real) — ver achado de
// auditoria em lib/loginLockout.js.
router.post('/verify', async (req, res) => {
  try {
    const { username, password, namespace } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }
    const user = await verifyLogin(username, password, { namespace: namespace || 'confirmPassword' });
    if (!user) return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    res.json({ user: { id: user.id, nome: user.nome, username: user.username, role: user.role, permissions: user.permissions } });
  } catch (err) {
    // Mesmo achado de auditoria do handler /login acima.
    console.error('[erro inesperado] POST /api/auth/verify:', err);
    res.status(500).json({ error: 'Erro inesperado ao confirmar. Tente novamente.' });
  }
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies?.session);
  res.clearCookie('session');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado.' });
  const row = findById.get(req.userId);
  if (!row) return res.status(401).json({ error: 'Não autenticado.' });
  res.json({ user: publicUser(row) });
});

/** Achado de auditoria (P1): único caminho pra zerar `mustChangePassword`
 * — sempre a PRÓPRIA conta (via sessão, nunca um :id no path), sempre
 * confirmando a senha atual primeiro. Fica em /api/auth (não em
 * /api/users, que é montado com requirePermission('usuarios') e não faria
 * sentido de qualquer forma: um vendedor sem essa permissão nunca teria
 * como trocar a própria senha) de propósito, pra ficar alcançável mesmo
 * com o middleware de server.js bloqueando o resto de /api enquanto a
 * troca obrigatória estiver pendente. */
router.post('/change-password', async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado.' });
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Informe a senha atual e a nova senha.' });
    }
    if (newPassword.length < MIN_USER_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `A nova senha precisa ter pelo menos ${MIN_USER_PASSWORD_LENGTH} caracteres.` });
    }
    const row = findById.get(req.userId);
    if (!row) return res.status(401).json({ error: 'Não autenticado.' });
    const user = JSON.parse(row.data);
    const ok = await verifyPasswordHash(currentPassword, user.passwordSalt, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Senha atual incorreta.' });
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'A nova senha precisa ser diferente da atual.' });
    }
    const { salt, hash } = await hashPassword(newPassword);
    user.passwordSalt = salt;
    user.passwordHash = hash;
    user.mustChangePassword = false;
    updateUserData.run({ id: user.id, data: JSON.stringify(user) });
    logAction({ userId: user.id, userName: user.nome, role: user.role, action: 'Troca de senha', details: 'Senha própria alterada.', entity: 'user', entityId: user.id });
    res.json({ user: publicUser({ data: JSON.stringify(user) }) });
  } catch (err) {
    console.error('[erro inesperado] POST /api/auth/change-password:', err);
    res.status(500).json({ error: 'Erro inesperado ao trocar a senha. Tente novamente.' });
  }
});

export default router;
