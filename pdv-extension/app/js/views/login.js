// Tela de login. Cada vendedor/administrador entra com seu próprio usuário
// e senha — é isso que garante que toda venda e ação fique corretamente
// atribuída a uma pessoa (rastreabilidade + log de auditoria).
import { verifyLogin, findByUsername } from '../data/usersRepo.js';
import { setSessionUserId } from '../session.js';
import { logAction } from '../data/auditRepo.js';
import { escapeHtml } from '../utils/format.js';
import { getLoginLockState, MAX_ATTEMPTS } from '../loginLockout.js';
import { isAdmin } from '../utils/permissions.js';
import { icon } from '../components/icon.js';

export function renderLogin(root, { onLogin, company }) {
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <button type="button" class="auth-fullscreen-btn" id="fullscreen-toggle-btn" title="Tela cheia" aria-label="Alternar tela cheia">${icon('fullscreen', { size: 16 })}</button>
        <div class="auth-brand"><span class="dot"></span><span>${escapeHtml(company?.nomeFantasia || 'PDV - C&S Virtual')}</span></div>
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

  // ---------- Tela cheia opcional, sob controle da pessoa (não mais
  // automática — achado do usuário: forçar tela cheia sozinha ao abrir
  // incomodava). Usa a Fullscreen API padrão do navegador (sem depender
  // de chrome.windows nem de nenhuma permissão nova), então funciona
  // igual numa aba comum. Escuta 'fullscreenchange' porque a pessoa pode
  // sair sem usar este botão (Esc, F11) — o ícone precisa refletir o
  // estado real, não só o que este botão fez por último. ----------
  const fullscreenBtn = document.getElementById('fullscreen-toggle-btn');
  function syncFullscreenIcon() {
    const isFs = !!document.fullscreenElement;
    fullscreenBtn.innerHTML = icon(isFs ? 'fullscreenExit' : 'fullscreen', { size: 16 });
    fullscreenBtn.title = isFs ? 'Sair da tela cheia' : 'Tela cheia';
    fullscreenBtn.setAttribute('aria-label', fullscreenBtn.title);
  }
  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', syncFullscreenIcon);

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
      // Achado de auditoria (P3): verifyLogin (data/usersRepo.js) agora
      // registra a tentativa falhada e verifica o bloqueio ELE MESMO, na
      // fonte — não só a tela. Esta função só LÊ o estado depois, pra
      // mostrar a mensagem certa (contagem regressiva ou "mais X
      // tentativas") — não decide mais nada, pra não contar a mesma
      // tentativa duas vezes.
      const user = await verifyLogin(username, password);
      if (!user) {
        // Achado de auditoria: até aqui, uma tentativa malsucedida só
        // ficava no contador efêmero do bloqueio (loginLockout.js, some
        // ao passar os 60s) — o Log do sistema (permanente) nunca sabia
        // que alguém tentou entrar errado. Registra aqui — só na tela de
        // login de verdade, não nos modais de confirmar senha de admin
        // (passwordConfirm.js), que usam verifyLogin com outro namespace
        // e têm seu próprio contexto de ação já logado pelo chamador.
        // Distingue "conta existe mas a senha veio errada" de "esse
        // usuário nem existe" só no log interno — a mensagem pro usuário
        // continua genérica, sem revelar qual dos dois foi.
        const existing = await findByUsername(username);
        await logAction({
          userId: existing?.id ?? null,
          userName: existing?.nome ?? username,
          role: existing?.role ?? null,
          action: 'Login malsucedido',
          details: existing
            ? `Tentativa de login com senha incorreta para "${existing.nome}".`
            : `Tentativa de login com usuário inexistente ("${username}").`,
          entity: 'auth', entityId: existing?.id ?? null,
        });

        const newState = await getLoginLockState(username);
        if (newState.remainingMs > 0) {
          lockFields(newState.lockedUntil);
        } else {
          const remaining = Math.max(1, MAX_ATTEMPTS - newState.failedAttempts);
          errBox.innerHTML = `<div class="form-error">Usuário ou senha inválidos, ou usuário desativado. Mais ${remaining} tentativa incorreta bloqueará o campo de senha por 60 segundos.</div>`;
          submitBtn.disabled = false;
        }
        return;
      }
      await setSessionUserId(user.id);
      await logAction({
        userId: user.id, userName: user.nome, role: user.role,
        action: 'Login',
        details: `Login realizado por "${user.nome}" (${isAdmin(user) ? 'Administrador' : 'Vendedor'}).`,
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
  // fantasma correndo. O listener de 'fullscreenchange' fica em
  // `document` (não dá pra escutar isso só dentro do card), então também
  // precisa ser removido explicitamente aqui.
  return () => {
    stopLockInterval();
    document.removeEventListener('fullscreenchange', syncFullscreenIcon);
  };
}
