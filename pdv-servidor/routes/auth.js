import { Router } from 'express';
import { db } from '../db/index.js';
import { createSession, destroySession } from '../lib/session.js';
import { logAction } from '../lib/audit.js';
import { verifyLogin } from '../lib/verifyLogin.js';
import { getLoginLockState } from '../lib/loginLockout.js';

const router = Router();

const findById = db.prepare('SELECT * FROM users WHERE id = ?');

function publicUser(row) {
  const u = JSON.parse(row.data);
  // Nunca manda salt/hash de senha pro cliente — só o necessário pra tela
  // (mesmo formato que a extensão single-machine expõe em ctx.user).
  return { id: u.id, nome: u.nome, username: u.username, role: u.role, permissions: u.permissions };
}

router.post('/login', async (req, res) => {
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

  const token = createSession(user.id);
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    // Sem `secure`: o servidor roda em HTTP puro na rede local (sem
    // certificado — é só a rede interna da loja, não a internet aberta).
    maxAge: 12 * 60 * 60 * 1000,
  });
  logAction({ userId: user.id, userName: user.nome, role: user.role, action: 'Login', details: '', entity: 'user', entityId: user.id });
  res.json({ user: publicUser(row) });
});

// Confirma usuário+senha SEM criar sessão nem cookie — usado pra
// confirmações pontuais de identidade dentro de uma sessão já logada
// como outra pessoa (ex: aprovação de desconto acima do limite, fechar
// caixa — ver components/passwordConfirm.js da extensão, o mesmo núcleo
// reaproveitado nos 3 pontos sensíveis a dinheiro/segurança). SEMPRE com
// `namespace` próprio (nunca o namespace do login real) — ver achado de
// auditoria em lib/loginLockout.js.
router.post('/verify', async (req, res) => {
  const { username, password, namespace } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }
  const user = await verifyLogin(username, password, { namespace: namespace || 'confirmPassword' });
  if (!user) return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  res.json({ user: { id: user.id, nome: user.nome, username: user.username, role: user.role, permissions: user.permissions } });
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

export default router;
