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
    setTimeout(() => el.remove(), 4000);
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
    if (!res.ok) throw new Error((body && body.error) || `Erro ${res.status}`);
    return body;
  }

  function showLogin() {
    loginScreen.hidden = false;
    appScreen.hidden = true;
  }

  function showApp(admin) {
    loginScreen.hidden = true;
    appScreen.hidden = false;
    adminUsernameEl.textContent = admin.username;
    loadTenants();
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

      const statusSelect = row.querySelector('.tenant-status');
      for (const status of validStatuses) {
        const opt = document.createElement('option');
        opt.value = status;
        opt.textContent = status;
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

  // Achado do usuário: excluir precisa ter pra onde voltar — a lixeira
  // (control/db.js#listTrashedTenants/restoreTenant) já guardava a pasta
  // desde a primeira versão do botão Excluir, só faltava um jeito de ver e
  // restaurar isso pela tela.
  function openLixeiraModal() {
    let listEl;
    async function refresh() {
      if (!listEl) return;
      listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;margin:0;">Carregando…</p>';
      try {
        const data = await api('/api/admin/tenants/lixeira');
        const items = data.trashed || [];
        if (!items.length) {
          listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;margin:0;">A lixeira está vazia.</p>';
          return;
        }
        listEl.innerHTML = '';
        for (const item of items) {
          const row = document.createElement('div');
          row.className = 'lixeira-row';
          row.innerHTML = `
            <div>
              <div class="lixeira-slug">${escapeHtml(item.slug)}</div>
              <div class="lixeira-date">Excluída em ${escapeHtml(formatTrashDate(item.deletedAt))}</div>
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
          listEl.appendChild(row);
        }
      } catch (err) {
        listEl.innerHTML = `<p style="color:var(--danger);font-size:13px;margin:0;">${escapeHtml(err.message)}</p>`;
      }
    }
    openModal({
      title: 'Lixeira',
      submitLabel: 'Fechar',
      singleButton: true,
      wide: true,
      bodyHtml: '<div class="lixeira-list"></div>',
      onMount: (modalEl) => {
        listEl = modalEl.querySelector('.lixeira-list');
        refresh();
      },
    });
  }
  lixeiraBtn.addEventListener('click', openLixeiraModal);

  loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    loginError.textContent = '';
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    try {
      const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      showApp(data.admin);
    } catch (err) {
      loginError.textContent = err.message;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* melhor esforço */ }
    showLogin();
  });

  (async function boot() {
    try {
      const data = await api('/api/admin/me');
      showApp(data.admin);
    } catch {
      showLogin();
    }
  })();
})();
