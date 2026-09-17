// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): login
// do painel de Super Admin. Mesmo padrão de routes/auth.js (login de
// loja), com duas diferenças de propósito: sempre contra o banco de
// controle (controlDb, nunca req.db — não existe "tenant" pra um admin da
// plataforma) e cookie com nome PRÓPRIO (`admin_session`, nunca `session`)
// — as duas sessões (loja e plataforma) nunca podem se confundir, mesmo se
// alguém um dia abrir as duas telas no mesmo navegador.
import { Router } from 'express';
import { controlDb } from '../../control/db.js';
import { createSession, destroySession, resolveSession } from '../../lib/session.js';
import { verifyPlatformAdminLogin, getPlatformAdminLoginLockState, getPlatformAdminById, updatePlatformAdminAccount } from '../../lib/platformAdminAuth.js';
import { respondUnexpectedError, respondValidationError } from '../../lib/httpResponses.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!String(username || '').trim() || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }
    const preLock = getPlatformAdminLoginLockState(username);
    if (preLock.remainingMs > 0) {
      return res.status(429).json({
        error: `Muitas tentativas incorretas. Aguarde ${Math.ceil(preLock.remainingMs / 1000)}s antes de tentar de novo.`,
        remainingMs: preLock.remainingMs,
      });
    }
    const admin = await verifyPlatformAdminLogin(username, password);
    if (!admin) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

    const token = createSession(admin.id, controlDb);
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('admin_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.json({ admin: { id: admin.id, username: admin.username } });
  } catch (err) {
    respondUnexpectedError(res, err, 'POST /api/admin/login', 'Erro inesperado ao entrar. Tente novamente.');
  }
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies?.admin_session, controlDb);
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const adminId = resolveSession(req.cookies?.admin_session, controlDb);
  const admin = adminId ? getPlatformAdminById(adminId) : null;
  if (!admin || !admin.active) return res.status(401).json({ error: 'Não autenticado.' });
  res.json({ admin: { id: admin.id, username: admin.username_lower } });
});

// Achado do usuário: clicar no próprio nome deveria dar a opção de trocar
// usuário/senha, sem precisar do terminal (scripts/seedPlatformAdmin.js
// resolvia isso antes, mas só pra quem tem acesso à máquina onde o
// servidor roda). Exige reconfirmar a senha atual — mesma lógica de
// lib/platformAdminAuth.js#updatePlatformAdminAccount.
router.post('/account', async (req, res) => {
  try {
    const adminId = resolveSession(req.cookies?.admin_session, controlDb);
    if (!adminId) return res.status(401).json({ error: 'Não autenticado.' });
    const { currentPassword, newUsername, newPassword } = req.body || {};
    const admin = await updatePlatformAdminAccount(adminId, { currentPassword, newUsername, newPassword });
    res.json({ admin });
  } catch (err) {
    respondValidationError(res, err);
  }
});

export default router;
