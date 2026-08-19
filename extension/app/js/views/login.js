// Tela de login. Cada vendedor/administrador entra com seu próprio usuário
// e senha — é isso que garante que toda venda e ação fique corretamente
// atribuída a uma pessoa (rastreabilidade + log de auditoria).
import { verifyLogin } from '../data/usersRepo.js';
import { setSessionUserId } from '../session.js';
import { logAction } from '../data/auditRepo.js';
import { escapeHtml } from '../utils/format.js';
import { getLoginLockState, recordFailedLogin, clearLoginLock, MAX_ATTEMPTS } from '../loginLockout.js';

export function renderLogin(root, { onLogin, company }) {
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand"><span class="dot"></span><span>${escapeHtml(company?.nomeFantasia) || 'Gestão de Loja'}</span></div>
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
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const submitBtn = form.querySelector('button[type="submit"]');
  const errBox = document.getElementById('form-error');

  // ---------- Bloqueio por força bruta (ver loginLockout.js) ----------
  let lockInterval = null;
  function stopLockInterval() {
    if (lockInterval) { clearInterval(lockInterval); lockInterval = null; }
  }
  function showLockMessage(lockedUntil) {
    const secs = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
    errBox.innerHTML = `<div class="form-error">Muitas tentativas incorretas. O campo de senha está bloqueado por segurança — tente novamente em ${secs}s.</div>`;
    errBox.dataset.kind = 'lock';
  }
  function lockFields(lockedUntil) {
    passwordInput.disabled = true;
    submitBtn.disabled = true;
    showLockMessage(lockedUntil);
    stopLockInterval();
    lockInterval = setInterval(() => {
      const remaining = lockedUntil - Date.now();
      if (remaining <= 0) {
        stopLockInterval();
        unlockFields();
      } else {
        showLockMessage(lockedUntil);
      }
    }, 1000);
  }
  function unlockFields() {
    passwordInput.disabled = false;
    submitBtn.disabled = false;
    // Só limpa a mensagem se for a de bloqueio — não apaga um erro comum
    // (usuário/senha inválidos) que porventura já estivesse na tela.
    if (errBox.dataset.kind === 'lock') {
      errBox.innerHTML = '';
      delete errBox.dataset.kind;
    }
  }
  // Reflete um bloqueio já em andamento assim que o nome de usuário é
  // digitado — inclusive depois de recarregar a página no meio da espera
  // (o estado vem de chrome.storage.local, sobrevive ao reload) — e
  // libera o campo sozinho se o usuário trocar pra uma conta que não está
  // bloqueada.
  async function refreshLockUI() {
    const username = usernameInput.value.trim();
    const state = await getLoginLockState(username);
    stopLockInterval();
    if (state.remainingMs > 0) lockFields(state.lockedUntil);
    else unlockFields();
  }
  usernameInput.addEventListener('blur', refreshLockUI);
  usernameInput.addEventListener('change', refreshLockUI);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    // Confere o bloqueio de novo na hora de enviar (não só no blur) — cobre
    // quem aperta Enter rápido sem tirar o foco do campo de senha.
    const lockState = await getLoginLockState(username);
    if (lockState.remainingMs > 0) {
      lockFields(lockState.lockedUntil);
      return;
    }

    errBox.innerHTML = '';
    delete errBox.dataset.kind;
    submitBtn.disabled = true;
    try {
      const user = await verifyLogin(username, password);
      if (!user) {
        const newState = await recordFailedLogin(username);
        if (newState.remainingMs > 0) {
          lockFields(newState.lockedUntil);
        } else {
          const remaining = Math.max(1, MAX_ATTEMPTS - newState.failedAttempts);
          errBox.innerHTML = `<div class="form-error">Usuário ou senha inválidos, ou usuário desativado. Mais ${remaining} tentativa incorreta bloqueará o campo de senha por 60 segundos.</div>`;
          submitBtn.disabled = false;
        }
        return;
      }
      await clearLoginLock(username);
      await setSessionUserId(user.id);
      await logAction({
        userId: user.id, userName: user.nome, role: user.role,
        action: 'Login',
        details: `Login realizado por "${user.nome}" (${user.role === 'admin' ? 'Administrador' : 'Vendedor'}).`,
        entity: 'auth', entityId: user.id,
      });
      onLogin(user);
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
      submitBtn.disabled = false;
    }
  });

  // Limpeza ao sair desta tela (troca pro Setup ou pro shell principal) —
  // sem isso, o intervalo do contador continuava rodando escrito num nó
  // desanexado do DOM depois do login, até o próximo tick perceber e
  // parar sozinho; não quebra nada, mas não tem por que deixar um timer
  // fantasma correndo.
  return () => stopLockInterval();
}
