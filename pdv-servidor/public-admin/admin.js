// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// vanilla JS puro, sem build nenhum — mesmo estilo de public/js/views/*.js
// (fetch direto, sem framework), só que pra uma tela sozinha (sem router
// nenhum, é a única tela deste painel).
(function () {
  // Botão discreto de claro/escuro — mesma chave de localStorage do resto
  // do PDV (public/js/theme.js), só que sozinho aqui em vez de um mecanismo
  // de 3 opções (claro/escuro/automático) como em personalizacao.js: essa
  // tela não tem uma seção de configurações pra abrigar isso, só o ícone.
  const THEME_KEY = 'theme.preference';
  const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" fill="currentColor"/></svg>';
  const themeToggle = document.getElementById('theme-toggle');
  function currentTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function renderThemeToggle() {
    themeToggle.innerHTML = currentTheme() === 'dark' ? SUN : MOON;
  }
  themeToggle.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.setAttribute('data-theme', next);
    renderThemeToggle();
  });
  renderThemeToggle();

  const loginScreen = document.getElementById('login-screen');
  const appScreen = document.getElementById('app-screen');
  const blockedScreen = document.getElementById('blocked-screen');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const adminUsernameEl = document.getElementById('admin-username');
  const logoutBtn = document.getElementById('logout-btn');
  const lixeiraBtn = document.getElementById('lixeira-btn');
  const tenantsBody = document.getElementById('tenants-body');
  const emptyState = document.getElementById('empty-state');
  const rowTemplate = document.getElementById('tenant-row-template');
  const toastRoot = document.getElementById('toast-root');

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Modal genérico (versão mínima de public/js/components/modal.js —
  // este bundle é autocontido, ver comentário no topo do arquivo, então
  // não importa de lá). Usado pela confirmação de exclusão (com campo de
  // senha) e pela lista da lixeira.
  function openModal({ title, bodyHtml, onMount, onSubmit, submitLabel = 'Salvar', cancelLabel = 'Cancelar', danger = false, singleButton = false, wide = false }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal${wide ? ' wide' : ''}">
        <h2>${escapeHtml(title)}</h2>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-actions">
          ${singleButton ? '' : `<button type="button" class="btn btn-secondary" data-action="cancel">${escapeHtml(cancelLabel)}</button>`}
          <button type="button" class="btn ${danger ? 'btn-danger' : ''}" data-action="submit">${escapeHtml(submitLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const modalEl = backdrop.querySelector('.modal');
    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKeydown);
    };
    const onKeydown = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKeydown);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    const cancelBtn = backdrop.querySelector('[data-action="cancel"]');
    cancelBtn?.addEventListener('click', close);

    const submitBtn = backdrop.querySelector('[data-action="submit"]');
    let submitting = false;
    submitBtn.addEventListener('click', async () => {
      if (submitting) return;
      if (!onSubmit) { close(); return; }
      submitting = true;
      submitBtn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;
      try {
        const shouldClose = await onSubmit(modalEl, close);
        if (shouldClose !== false) close();
      } finally {
        submitting = false;
        submitBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
      }
    });

    if (onMount) onMount(modalEl, close);
    return { close, modalEl };
  }

  // Ação destrutiva + reconfirmação da PRÓPRIA senha do admin logado (mesmo
  // raciocínio do fechamento de caixa) — usado tanto por excluir loja
  // quanto por excluir definitivamente um item da lixeira.
  function openPasswordConfirmModal({ title, message, submitLabel = 'Confirmar', onConfirm }) {
    let errorEl, passwordInput;
    openModal({
      title,
      danger: true,
      submitLabel,
      bodyHtml: `
        <p style="margin:0 0 14px;color:var(--text-muted);font-size:13.5px;line-height:1.5;">${message}</p>
        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">Confirme sua senha</label>
        <input type="password" class="confirm-password-input" autocomplete="current-password" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;box-sizing:border-box;background:var(--surface);color:var(--text);">
        <p class="confirm-error" style="color:var(--danger);font-size:12.5px;min-height:16px;margin:8px 0 0;"></p>
      `,
      onMount: (modalEl) => {
        errorEl = modalEl.querySelector('.confirm-error');
        passwordInput = modalEl.querySelector('.confirm-password-input');
        passwordInput.focus();
      },
      onSubmit: async () => {
        const password = passwordInput.value;
        if (!password) { errorEl.textContent = 'Informe sua senha.'; return false; }
        try {
          await onConfirm(password);
        } catch (err) {
          errorEl.textContent = err.message;
          return false;
        }
      },
    });
  }

  let validStatuses = ['trial', 'ativo', 'suspenso', 'cancelado'];

  function toast(message, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = message;
    toastRoot.appendChild(el);
    setTimeout(() => el.remove(), 7000);
  }

  async function api(path, options) {
    const res = await fetch(path, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options,
    });
    let body = null;
    try { body = await res.json(); } catch { /* corpo vazio (ex: 204) */ }
    if (!res.ok) {
      const err = new Error((body && body.error) || `Erro ${res.status}`);
      if (body && body.remainingMs) err.remainingMs = body.remainingMs;
      throw err;
    }
    return body;
  }

  function showLogin() {
    loginScreen.hidden = false;
    appScreen.hidden = true;
    blockedScreen.hidden = true;
  }

  function showBlocked() {
    loginScreen.hidden = true;
    appScreen.hidden = true;
    blockedScreen.hidden = false;
  }

  let currentAdmin = null;
  function showApp(admin) {
    currentAdmin = admin;
    loginScreen.hidden = true;
    appScreen.hidden = false;
    blockedScreen.hidden = true;
    adminUsernameEl.textContent = admin.username;
    loadTenants();
  }

  // Achado do usuário: clicar no próprio nome deveria dar a opção de
  // trocar usuário/senha, sem precisar do terminal.
  function openAccountModal() {
    let errorEl, usernameInput, newPasswordInput, confirmPasswordInput, currentPasswordInput;
    openModal({
      title: 'Trocar usuário/senha',
      submitLabel: 'Salvar',
      bodyHtml: `
        <div class="field">
          <label>Usuário</label>
          <input type="text" class="account-username-input" autocomplete="username" value="${escapeHtml(currentAdmin.username)}">
        </div>
        <div class="field">
          <label>Nova senha</label>
          <input type="password" class="account-new-password-input" autocomplete="new-password" placeholder="Deixe em branco pra manter a atual">
        </div>
        <div class="field">
          <label>Confirmar nova senha</label>
          <input type="password" class="account-confirm-password-input" autocomplete="new-password">
        </div>
        <div class="field">
          <label>Sua senha atual</label>
          <input type="password" class="account-current-password-input" autocomplete="current-password" placeholder="Obrigatória pra confirmar">
        </div>
        <p class="confirm-error" style="color:var(--danger);font-size:12.5px;min-height:16px;margin:0;"></p>
      `,
      onMount: (modalEl) => {
        errorEl = modalEl.querySelector('.confirm-error');
        usernameInput = modalEl.querySelector('.account-username-input');
        newPasswordInput = modalEl.querySelector('.account-new-password-input');
        confirmPasswordInput = modalEl.querySelector('.account-confirm-password-input');
        currentPasswordInput = modalEl.querySelector('.account-current-password-input');
        usernameInput.focus();
      },
      onSubmit: async () => {
        const newUsername = usernameInput.value.trim();
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;
        const currentPassword = currentPasswordInput.value;
        if (!currentPassword) { errorEl.textContent = 'Informe sua senha atual.'; return false; }
        if (newPassword && newPassword !== confirmPassword) { errorEl.textContent = 'As duas senhas novas não são iguais.'; return false; }
        const usernameChanged = newUsername && newUsername.toLowerCase() !== currentAdmin.username.toLowerCase();
        if (!usernameChanged && !newPassword) { errorEl.textContent = 'Informe um novo usuário ou uma nova senha.'; return false; }
        try {
          const body = { currentPassword };
          if (usernameChanged) body.newUsername = newUsername;
          if (newPassword) body.newPassword = newPassword;
          const data = await api('/api/admin/account', { method: 'POST', body: JSON.stringify(body) });
          currentAdmin = data.admin;
          adminUsernameEl.textContent = data.admin.username;
          toast('Dados da conta atualizados.', 'success');
        } catch (err) {
          errorEl.textContent = err.message;
          return false;
        }
      },
    });
  }
  adminUsernameEl.addEventListener('click', openAccountModal);

  // Achado do usuário: quis um "gerador de chaves" dentro do painel — mas
  // a chave PRIVADA nunca pode morar num servidor exposto na internet
  // (quem invadir o painel forjaria chave válida pra qualquer CNPJ, sem
  // limite e sem deixar rastro). O meio-termo combinado: nenhuma chave
  // nasce aqui, só um atalho pra copiar o CNPJ certo da loja certa, pra
  // colar na ferramenta local (fora deste sistema) que já gera as chaves.
  function openKeygenModal(tenant) {
    const cnpj = tenant.cnpj || '';
    openModal({
      title: 'Copiar dados p/ gerar chave',
      submitLabel: 'Copiar CNPJ',
      bodyHtml: `
        <p style="margin:0 0 14px;color:var(--text-muted);font-size:13.5px;line-height:1.5;">
          A chave de ativação é gerada numa ferramenta separada, no seu computador. Por segurança, nunca aqui no painel.
          Copie o CNPJ abaixo e cole lá.
        </p>
        <div class="field">
          <label>Loja</label>
          <input type="text" value="${escapeHtml(tenant.nomeFantasia || tenant.razaoSocial || tenant.slug)}" readonly>
        </div>
        <div class="field">
          <label>CNPJ</label>
          <input type="text" class="keygen-cnpj-input" value="${escapeHtml(cnpj)}" placeholder="Ainda não cadastrado" readonly>
        </div>
      `,
      onSubmit: async () => {
        if (!cnpj) { toast('Essa loja ainda não cadastrou um CNPJ (a própria loja precisa preencher em "Dados da loja" antes).', 'error'); return false; }
        try {
          await navigator.clipboard.writeText(cnpj);
          toast('CNPJ copiado.', 'success');
        } catch {
          toast('Não deu pra copiar automaticamente, selecione o CNPJ e copie manualmente.', 'error');
        }
      },
    });
  }

  // Mostra as credenciais resetadas só desta vez — mesmo raciocínio da tela
  // de sucesso do cadastro (public-signup/index.html#success-card): depois
  // de fechado, ninguém mais consegue ver a senha em texto puro de novo
  // (só o hash fica salvo), então precisa ficar visível o suficiente pra
  // copiar/repassar pra loja antes de fechar o modal.
  function openResetCredentialsModal(nomeLoja, credentials) {
    openModal({
      title: 'Senha redefinida',
      submitLabel: 'Fechar',
      singleButton: true,
      bodyHtml: `
        <p style="margin:0 0 14px;color:var(--text-muted);font-size:13.5px;line-height:1.5;">
          Repasse estes dados pra loja <strong>"${escapeHtml(nomeLoja)}"</strong> — ela vai precisar trocar a senha no primeiro login.
        </p>
        <div class="field">
          <label>Usuário</label>
          <input type="text" value="${escapeHtml(credentials.username)}" readonly>
        </div>
        <div class="field">
          <label>Senha</label>
          <input type="text" value="${escapeHtml(credentials.password)}" readonly>
        </div>
      `,
    });
  }

  function dateInputValue(expiresAt) {
    if (!expiresAt) return '';
    const d = new Date(expiresAt);
    return d.toISOString().slice(0, 10);
  }

  function renderTenants(tenants) {
    tenantsBody.innerHTML = '';
    emptyState.hidden = tenants.length > 0;
    for (const tenant of tenants) {
      const row = rowTemplate.content.firstElementChild.cloneNode(true);
      row.querySelector('.tenant-name').textContent = tenant.nomeFantasia || tenant.razaoSocial || tenant.slug;
      row.querySelector('.tenant-slug').textContent = tenant.slug;
      row.querySelector('.tenant-cnpj').textContent = tenant.cnpj || '-';
      row.querySelector('.tenant-created').textContent = tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString('pt-BR') : '-';

      row.querySelector('.keygen-btn').addEventListener('click', () => openKeygenModal(tenant));

      const statusSelect = row.querySelector('.tenant-status');
      for (const status of validStatuses) {
        const opt = document.createElement('option');
        opt.value = status;
        opt.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        if (status === tenant.status) opt.selected = true;
        statusSelect.appendChild(opt);
      }

      const expiresInput = row.querySelector('.tenant-expires');
      expiresInput.value = dateInputValue(tenant.expiresAt);

      row.querySelector('.save-btn').addEventListener('click', async () => {
        try {
          const body = {
            status: statusSelect.value,
            // Campo de data vazio remove o vencimento (plano manual, sem
            // data) — mesma convenção de control/db.js#setTenantStatus.
            expiresAt: expiresInput.value ? new Date(expiresInput.value + 'T00:00:00').toISOString() : 'null',
          };
          await api(`/api/admin/tenants/${encodeURIComponent(tenant.slug)}/status`, { method: 'POST', body: JSON.stringify(body) });
          toast(`Loja "${tenant.slug}" atualizada.`, 'success');
          loadTenants();
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      // Achado do usuário: dono de loja esqueceu a própria senha e não tem
      // outro admin ativo pra redefinir por dentro do sistema — sem isso,
      // ficava sem jeito nenhum de entrar. Mesma reconfirmação de senha do
      // botão Excluir (é a mesma classe de ação sensível: dá acesso total a
      // uma loja de outra pessoa), mas sem apagar dado nenhum — só a conta
      // de login volta pro usuário/senha padrão de instalação.
      row.querySelector('.reset-password-btn').addEventListener('click', () => {
        const nome = tenant.nomeFantasia || tenant.razaoSocial || tenant.slug;
        openPasswordConfirmModal({
          title: 'Redefinir senha da loja',
          submitLabel: 'Redefinir',
          message: `Redefinir a senha de admin da loja <strong>"${escapeHtml(nome)}"</strong> (${escapeHtml(tenant.slug)})? A conta volta pro usuário e senha padrão de instalação, sem apagar nenhum outro dado da loja.`,
          onConfirm: async (password) => {
            const data = await api(`/api/admin/tenants/${encodeURIComponent(tenant.slug)}/reset-admin-password`, { method: 'POST', body: JSON.stringify({ password }) });
            openResetCredentialsModal(nome, data.credentials);
          },
        });
      });

      row.querySelector('.delete-btn').addEventListener('click', () => {
        const nome = tenant.nomeFantasia || tenant.razaoSocial || tenant.slug;
        // Achado do usuário: window.confirm() nativo não fica centralizado
        // na tela (posição varia por navegador/SO, fora do nosso controle
        // via CSS) — trocado pelo modal próprio acima. E excluir é destrutivo
        // demais pra só um clique de confirmação: pede a PRÓPRIA senha do
        // admin logado (mesmo raciocínio do fechamento de caixa), conferida
        // no servidor (routes/admin/tenants.js).
        openPasswordConfirmModal({
          title: 'Excluir loja',
          submitLabel: 'Excluir',
          message: `Excluir a loja <strong>"${escapeHtml(nome)}"</strong> (${escapeHtml(tenant.slug)})? Os dados saem da lista e a loja deixa de responder. A pasta vai pra lixeira, dá pra restaurar depois por lá.`,
          onConfirm: async (password) => {
            await api(`/api/admin/tenants/${encodeURIComponent(tenant.slug)}`, { method: 'DELETE', body: JSON.stringify({ password }) });
            toast(`Loja "${tenant.slug}" excluída.`, 'success');
            loadTenants();
          },
        });
      });

      tenantsBody.appendChild(row);
    }
  }

  async function loadTenants() {
    try {
      const data = await api('/api/admin/tenants');
      validStatuses = data.validStatuses || validStatuses;
      renderTenants(data.tenants || []);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function formatTrashDate(ts) {
    return ts ? new Date(ts).toLocaleString('pt-BR') : '-';
  }

  // Achado do usuário: contador de dias até a exclusão automática de cada
  // entrada (control/db.js#purgeExpiredTrashedTenants, 90 dias de
  // retenção) — `purgeAt` vem pronto da API (mesma conta que o purge
  // periódico usa pra decidir, nunca um número recalculado aqui que
  // pudesse divergir). Math.ceil (não floor/round) pra nunca mostrar "0
  // dias" enquanto ainda falta uma fração de dia — a entrada continua
  // válida até o instante exato de `purgeAt`, só o ARREDONDAMENTO pra
  // baixo mentiria sobre esse instante.
  function formatTrashCountdown(purgeAt) {
    if (!purgeAt) return '';
    const daysLeft = Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 0) return 'Exclusão automática definitiva a qualquer momento';
    if (daysLeft === 1) return 'Exclusão automática definitiva em 1 dia';
    return `Exclusão automática definitiva em ${daysLeft} dias`;
  }
  // Últimos 7 dias antes da exclusão automática — destaque visual (mesmo
  // raciocínio de company.js#badge-gold pra licença perto de vencer).
  function trashCountdownIsSoon(purgeAt) {
    if (!purgeAt) return false;
    return purgeAt - Date.now() <= 7 * 24 * 60 * 60 * 1000;
  }

  // Achado do usuário: excluir precisa ter pra onde voltar — a lixeira
  // (control/db.js#listTrashedTenants/restoreTenant) já guardava a pasta
  // desde a primeira versão do botão Excluir, só faltava um jeito de ver e
  // restaurar isso pela tela.
  //
  // Achado do usuário: sem limite nenhum, essa lista só cresceria pra
  // sempre (uma entrada por exclusão) e o modal teria que renderizar tudo
  // de uma vez. Duas frentes: 90 dias de retenção automática no servidor
  // (control/db.js#purgeExpiredTrashedTenants, chamado por um
  // `setInterval` em server.js — sem rota nenhuma envolvida, roda sozinho)
  // e paginação aqui na tela — a API continua devolvendo a lista inteira
  // (já limitada pelos 90 dias) e o modal fatia em páginas de 10, mesmo
  // padrão "servidor manda tudo, tela pagina" já usado no resto do PDV
  // (ver public/js/components/pagination.js) — versão mínima copiada aqui
  // porque public-admin/ é um bundle autocontido (ver comentário no topo
  // deste arquivo), sem o seletor de tamanho de página (lista pequena
  // demais pra precisar).
  const LIXEIRA_PAGE_SIZE = 10;
  function openLixeiraModal() {
    let listEl, pagerEl;
    let allItems = [];
    let page = 1;

    function renderRow(item) {
      const row = document.createElement('div');
      row.className = 'lixeira-row';
      row.innerHTML = `
        <div>
          <div class="lixeira-slug">${escapeHtml(item.slug)}</div>
          <div class="lixeira-date">Excluída em ${escapeHtml(formatTrashDate(item.deletedAt))}</div>
          <div class="lixeira-countdown${trashCountdownIsSoon(item.purgeAt) ? ' lixeira-countdown-soon' : ''}">${escapeHtml(formatTrashCountdown(item.purgeAt))}</div>
        </div>
        <div class="lixeira-row-actions">
          <button type="button" class="restore-btn">Restaurar</button>
          <button type="button" class="purge-btn">Excluir definitivamente</button>
        </div>
      `;
      row.querySelector('.restore-btn').addEventListener('click', async () => {
        try {
          await api(`/api/admin/tenants/lixeira/${encodeURIComponent(item.entry)}/restore`, { method: 'POST' });
          toast(`Loja "${item.slug}" restaurada.`, 'success');
          refresh();
          loadTenants();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      row.querySelector('.purge-btn').addEventListener('click', () => {
        // Diferente de excluir (que ainda vai pra lixeira), isto é
        // definitivo — apaga o .sqlite3 de verdade (control/db.js#purgeTrashedTenant),
        // por isso reconfirma a senha de novo, mesmo já estando dentro
        // de um fluxo que começou com uma confirmação de senha.
        openPasswordConfirmModal({
          title: 'Excluir definitivamente',
          submitLabel: 'Excluir definitivamente',
          message: `Excluir <strong>"${escapeHtml(item.slug)}"</strong> definitivamente? Isto apaga os dados da loja de vez. Depois disso não tem mais lixeira, não tem como desfazer.`,
          onConfirm: async (password) => {
            await api(`/api/admin/tenants/lixeira/${encodeURIComponent(item.entry)}`, { method: 'DELETE', body: JSON.stringify({ password }) });
            toast(`"${item.slug}" excluído definitivamente.`, 'success');
            refresh();
          },
        });
      });
      return row;
    }

    // Fatia `allItems` (já em memória, sem chamada nova ao servidor) pra
    // página atual — trocar de página é só re-render local, mesmo
    // raciocínio do resto do PDV (slice client-side sobre uma lista que já
    // cabe inteira em memória).
    function renderPage() {
      const totalPages = Math.max(1, Math.ceil(allItems.length / LIXEIRA_PAGE_SIZE));
      page = Math.min(Math.max(1, page), totalPages);
      const start = (page - 1) * LIXEIRA_PAGE_SIZE;
      const pageItems = allItems.slice(start, start + LIXEIRA_PAGE_SIZE);

      listEl.innerHTML = '';
      for (const item of pageItems) listEl.appendChild(renderRow(item));

      if (allItems.length <= LIXEIRA_PAGE_SIZE) { pagerEl.innerHTML = ''; return; }
      pagerEl.innerHTML = `
        <span class="lixeira-pg-info">${start + 1}–${Math.min(start + LIXEIRA_PAGE_SIZE, allItems.length)} de ${allItems.length}</span>
        <div class="lixeira-pg-buttons">
          <button type="button" class="lixeira-pg-prev" ${page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
          <span class="lixeira-pg-current">Página ${page} de ${totalPages}</span>
          <button type="button" class="lixeira-pg-next" ${page >= totalPages ? 'disabled' : ''}>Próxima ›</button>
        </div>
      `;
      pagerEl.querySelector('.lixeira-pg-prev')?.addEventListener('click', () => { page -= 1; renderPage(); });
      pagerEl.querySelector('.lixeira-pg-next')?.addEventListener('click', () => { page += 1; renderPage(); });
    }

    async function refresh() {
      if (!listEl) return;
      listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;margin:0;">Carregando…</p>';
      pagerEl.innerHTML = '';
      try {
        const data = await api('/api/admin/tenants/lixeira');
        allItems = data.trashed || [];
        if (!allItems.length) {
          listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;margin:0;">A lixeira está vazia.</p>';
          return;
        }
        renderPage();
      } catch (err) {
        listEl.innerHTML = `<p style="color:var(--danger);font-size:13px;margin:0;">${escapeHtml(err.message)}</p>`;
      }
    }
    openModal({
      title: 'Lixeira',
      submitLabel: 'Fechar',
      singleButton: true,
      wide: true,
      bodyHtml: `
        <div class="lixeira-toolbar">
          <button type="button" class="empty-trash-btn">Esvaziar lixeira</button>
        </div>
        <div class="lixeira-list"></div>
        <div class="lixeira-pagination"></div>
      `,
      onMount: (modalEl) => {
        listEl = modalEl.querySelector('.lixeira-list');
        pagerEl = modalEl.querySelector('.lixeira-pagination');
        page = 1;
        refresh();
        // Achado do usuário: esvaziar a lixeira inteira de uma vez, sem
        // precisar restaurar/excluir uma por uma — mesma reconfirmação de
        // senha da exclusão definitiva de UMA entrada (é a mesma classe de
        // ação: apaga o .sqlite3 de cada loja de verdade, sem volta).
        modalEl.querySelector('.empty-trash-btn').addEventListener('click', () => {
          if (!allItems.length) { toast('A lixeira já está vazia.', 'error'); return; }
          openPasswordConfirmModal({
            title: 'Esvaziar lixeira',
            submitLabel: 'Esvaziar lixeira',
            message: `Excluir definitivamente as <strong>${allItems.length}</strong> loja(s) na lixeira? Isto apaga os dados de todas elas de vez. Depois disso não tem como desfazer.`,
            onConfirm: async (password) => {
              const data = await api('/api/admin/tenants/lixeira', { method: 'DELETE', body: JSON.stringify({ password }) });
              toast(`${data.purged} loja(s) excluída(s) definitivamente.`, 'success');
              refresh();
            },
          });
        });
      },
    });
  }
  lixeiraBtn.addEventListener('click', openLixeiraModal);

  // Achado do usuário: o aviso de bloqueio por tentativas incorretas
  // (lib/loginLockout.js, 60s a partir da 2ª tentativa errada) mostrava só
  // o segundo inicial, parado na tela, sem descer — parecia travado. Agora
  // desce de verdade, um segundo por vez, e reabilita o botão sozinho
  // quando chega a zero.
  const loginSubmitBtn = loginForm.querySelector('button[type="submit"]');
  const loginPasswordInput = document.getElementById('login-password');
  let lockoutTimer = null;
  // Achado do usuário: proteção contra força bruta — cada novo bloqueio
  // (lib/loginLockout.js#PROGRESSIVE_NAMESPACES) dobra de duração a partir
  // do anterior, podendo passar bem de 60s. Formata em minutos quando
  // passa de 1 minuto, senão "612s" fica ilegível na tela.
  function formatCountdown(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return sec > 0 ? `${min}min ${sec}s` : `${min}min`;
  }
  // Achado do usuário: mesmo raciocínio do login da loja (ver
  // public/js/app.js#startLockoutCountdown) — só o botão ficava bloqueado
  // contra clique, o campo de senha continuava digitável. Bloqueio é por
  // usuário (lib/loginLockout.js#keyFor), então o campo de usuário
  // continua editável de propósito.
  function startLockoutCountdown(remainingMs) {
    if (lockoutTimer) clearInterval(lockoutTimer);
    let remaining = Math.ceil(remainingMs / 1000);
    loginSubmitBtn.disabled = true;
    loginPasswordInput.disabled = true;
    const render = () => { loginError.textContent = `Muitas tentativas incorretas. Aguarde ${formatCountdown(remaining)} antes de tentar de novo.`; };
    render();
    lockoutTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(lockoutTimer);
        lockoutTimer = null;
        loginError.textContent = '';
        loginSubmitBtn.disabled = false;
        loginPasswordInput.disabled = false;
        return;
      }
      render();
    }, 1000);
  }

  loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (lockoutTimer) return;
    loginError.textContent = '';
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    try {
      const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      showApp(data.admin);
    } catch (err) {
      if (err.remainingMs > 0) {
        startLockoutCountdown(err.remainingMs);
      } else {
        loginError.textContent = err.message;
      }
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* melhor esforço */ }
    showLogin();
  });

  // Achado do usuário: sem isto, duplicar a aba (ou abrir o painel em duas
  // abas do mesmo navegador) dava acesso total e simultâneo às DUAS, sem
  // pedir senha de novo — a sessão é por COOKIE do navegador, não por aba,
  // então qualquer aba nova já nasce autenticada se a de origem estiver
  // logada. Mesmo mecanismo e mesmo motivo de public/js/tabPresence.js
  // (usado pelo PDV da própria loja): a aba nova nasce REALMENTE
  // bloqueada, não só avisada, até a mais antiga fechar. Cópia adaptada
  // aqui (não um import de public/js/) porque este bundle é autocontido,
  // ver comentário no topo do arquivo.
  const TAB_PRESENCE_KEY = 'adminTabPresence';
  const HEARTBEAT_MS = 300;
  const PROBE_MS = 2500;
  const STALE_MS = 8000;
  const myTabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function readTabPresence() {
    try { return JSON.parse(localStorage.getItem(TAB_PRESENCE_KEY) || '{}'); } catch { return {}; }
  }
  function writeTabPresence(map) {
    try { localStorage.setItem(TAB_PRESENCE_KEY, JSON.stringify(map)); } catch { /* aba privada/sem storage — nunca vence a eleição sozinha, fica bloqueada com segurança */ }
  }
  function watchTabPresence(onChange) {
    let running = false;
    async function tick() {
      if (running) return;
      running = true;
      try {
        const now = Date.now();
        let map = readTabPresence();
        for (const [id, ts] of Object.entries(map)) {
          if (now - ts > STALE_MS) delete map[id];
        }
        map[myTabId] = now;
        writeTabPresence(map);

        let liveIds = Object.keys(map).sort();
        if (liveIds[0] !== myTabId) {
          const rivalId = liveIds[0];
          const rivalTsBefore = map[rivalId];
          await new Promise((r) => setTimeout(r, PROBE_MS));
          const mapAfterProbe = readTabPresence();
          const rivalTsAfter = mapAfterProbe[rivalId];
          if (rivalTsAfter === undefined || rivalTsAfter === rivalTsBefore) delete mapAfterProbe[rivalId];
          mapAfterProbe[myTabId] = Date.now();
          writeTabPresence(mapAfterProbe);
          map = mapAfterProbe;
          liveIds = Object.keys(map).sort();
        }
        onChange(liveIds.length === 0 || liveIds[0] === myTabId);
      } finally {
        running = false;
      }
    }
    tick();
    setInterval(tick, HEARTBEAT_MS);
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) return;
      const map = readTabPresence();
      delete map[myTabId];
      writeTabPresence(map);
    });
    window.addEventListener('pageshow', (event) => { if (event.persisted) tick(); });
  }

  // Nasce bloqueada de propósito (mesmo raciocínio de public/js/app.js) —
  // só vira false uma vez, quando watchTabPresence confirma que esta é a
  // aba mais antiga viva. Checado dentro de boot() (não só no ponto que
  // chama a primeira vez) pra nunca deixar uma aba bloqueada terminar de
  // rodar por baixo do pano.
  let tabIsBlocked = true;
  async function boot() {
    if (tabIsBlocked) return;
    try {
      const data = await api('/api/admin/me');
      showApp(data.admin);
    } catch {
      showLogin();
    }
  }

  watchTabPresence((iAmTheOldestAlive) => {
    if (iAmTheOldestAlive) {
      if (tabIsBlocked) {
        tabIsBlocked = false;
        boot();
      }
      return;
    }
    // Uma aba que já estava operando nunca é interrompida no meio por
    // causa de uma aba nova aparecendo depois — só a aba nova bloqueia.
    if (tabIsBlocked) showBlocked();
  });
})();
