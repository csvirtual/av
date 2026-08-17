// Tela de login. Cada vendedor/administrador entra com seu próprio usuário
// e senha — é isso que garante que toda venda e ação fique corretamente
// atribuída a uma pessoa (rastreabilidade + log de auditoria).
import { verifyLogin } from '../data/usersRepo.js';
import { setSessionUserId } from '../session.js';
import { logAction } from '../data/auditRepo.js';

export function renderLogin(root, { onLogin, company }) {
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand"><span class="dot"></span><span>${company?.nomeFantasia || 'Gestão de Loja'}</span></div>
        <h1>Entrar</h1>
        <p class="subtitle">Informe seu usuário e senha para acessar o sistema.</p>
        <form id="login-form" novalidate>
          <div id="form-error"></div>
          <div class="field">
            <label for="username">Usuário</label>
            <input id="username" autofocus required>
          </div>
          <div class="field">
            <label for="password">Senha</label>
            <input id="password" type="password" required>
          </div>
          <button type="submit" class="btn" style="width:100%;padding:11px;">Entrar</button>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('form-error');
    errBox.innerHTML = '';
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const user = await verifyLogin(username, password);
      if (!user) {
        errBox.innerHTML = '<div class="form-error">Usuário ou senha inválidos, ou usuário desativado.</div>';
        submitBtn.disabled = false;
        return;
      }
      await setSessionUserId(user.id);
      await logAction({
        userId: user.id, userName: user.nome, role: user.role,
        action: 'Login',
        details: `Login realizado por "${user.nome}" (${user.role === 'admin' ? 'Administrador' : 'Vendedor'}).`,
        entity: 'auth', entityId: user.id,
      });
      onLogin(user);
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">${err.message}</div>`;
      submitBtn.disabled = false;
    }
  });
}
