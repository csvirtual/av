// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// vanilla JS puro, sem build nenhum — mesmo estilo de public/js/views/*.js
// (fetch direto, sem framework), só que pra uma tela sozinha (sem router
// nenhum, é a única tela deste painel).
(function () {
  const loginScreen = document.getElementById('login-screen');
  const appScreen = document.getElementById('app-screen');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const adminUsernameEl = document.getElementById('admin-username');
  const logoutBtn = document.getElementById('logout-btn');
  const tenantsBody = document.getElementById('tenants-body');
  const emptyState = document.getElementById('empty-state');
  const rowTemplate = document.getElementById('tenant-row-template');
  const toastRoot = document.getElementById('toast-root');

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
      row.querySelector('.tenant-cnpj').textContent = tenant.cnpj || '—';
      row.querySelector('.tenant-created').textContent = tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString('pt-BR') : '—';

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

      row.querySelector('.delete-btn').addEventListener('click', async () => {
        const nome = tenant.nomeFantasia || tenant.razaoSocial || tenant.slug;
        // window.confirm em vez de um modal próprio: painel de uma tela só,
        // sem componente de modal nenhum (nem importado de public/js/, ver
        // comentário no topo do arquivo) — pra uma ação rara e destrutiva
        // como esta, o confirm nativo já resolve sem precisar construir uma
        // UI só pra isso.
        const ok = window.confirm(`Excluir a loja "${nome}" (${tenant.slug})?\n\nOs dados saem da lista e a loja deixa de responder. Isto não pode ser desfeito por aqui.`);
        if (!ok) return;
        try {
          await api(`/api/admin/tenants/${encodeURIComponent(tenant.slug)}`, { method: 'DELETE' });
          toast(`Loja "${tenant.slug}" excluída.`, 'success');
          loadTenants();
        } catch (err) {
          toast(err.message, 'error');
        }
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
