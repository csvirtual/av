// Gestão de usuários — exclusiva do Administrador Geral. Todo usuário
// cadastrado a partir daqui nasce como vendedor (o único admin é o criado no
// assistente de configuração inicial), mantendo os perfis isolados: cada
// vendedor cuida das próprias vendas, sem poder mexer em cadastro de
// produto, outros usuários ou no log do sistema.
import { listUsers, createUser, findByUsername, setUserActive, resetUserPassword } from '../data/usersRepo.js';
import { logAction } from '../data/auditRepo.js';
import { formatDateTime, escapeHtml } from '../utils/format.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';

export async function renderUsers(container, ctx) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Usuários</h1>
        <div class="desc">Vendedores com acesso ao sistema. O Administrador Geral é único e definido no cadastro inicial.</div>
      </div>
      <div class="page-actions">
        <button class="btn" id="new-user-btn">+ Novo vendedor</button>
      </div>
    </div>
    <div id="users-table"></div>
  `;

  const tableBox = document.getElementById('users-table');

  async function refresh() {
    const users = await listUsers();
    tableBox.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Status</th><th>Cadastrado em</th><th></th></tr></thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td>${escapeHtml(u.nome)}</td>
                <td>${escapeHtml(u.username)}</td>
                <td>${u.role === 'admin' ? '<span class="badge badge-gold">Administrador</span>' : '<span class="badge badge-green">Vendedor</span>'}</td>
                <td>${u.active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>'}</td>
                <td>${formatDateTime(u.createdAt)}</td>
                <td style="white-space:nowrap;">
                  <button class="btn btn-ghost btn-sm" data-reset="${u.id}">Redefinir senha</button>
                  ${u.role === 'admin' ? '' : `<button class="btn btn-ghost btn-sm" data-toggle="${u.id}">${u.active ? 'Desativar' : 'Reativar'}</button>`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    tableBox.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => toggleUser(users.find((u) => u.id === btn.dataset.toggle)));
    });
    tableBox.querySelectorAll('[data-reset]').forEach((btn) => {
      btn.addEventListener('click', () => openResetModal(users.find((u) => u.id === btn.dataset.reset)));
    });
  }

  async function toggleUser(user) {
    const next = !user.active;
    const ok = await confirmDialog({
      title: next ? 'Reativar usuário' : 'Desativar usuário',
      message: `Deseja ${next ? 'reativar' : 'desativar'} o acesso de "${escapeHtml(user.nome)}"? ${next ? '' : 'Ele não conseguirá mais fazer login, mas o histórico de vendas dele é preservado.'}`,
      confirmLabel: next ? 'Reativar' : 'Desativar',
      danger: !next,
    });
    if (!ok) return;
    try {
      await setUserActive(user.id, next);
      await logAction({
        userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
        action: next ? 'Reativação de usuário' : 'Desativação de usuário',
        details: `Usuário "${user.nome}" (${user.username}) ${next ? 'reativado' : 'desativado'}.`,
        entity: 'user', entityId: user.id,
      });
      showToast(`Usuário ${next ? 'reativado' : 'desativado'}.`, 'success');
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function openResetModal(user) {
    openModal({
      title: `Redefinir senha — ${escapeHtml(user.nome)}`,
      submitLabel: 'Redefinir senha',
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="field"><label>Nova senha *</label><input id="f-pass" type="password" minlength="6"></div>
        <div class="field"><label>Confirmar nova senha *</label><input id="f-pass2" type="password" minlength="6"></div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const p1 = modalEl.querySelector('#f-pass').value;
        const p2 = modalEl.querySelector('#f-pass2').value;
        if (p1.length < 6) { errBox.innerHTML = '<div class="form-error">A senha deve ter pelo menos 6 caracteres.</div>'; return false; }
        if (p1 !== p2) { errBox.innerHTML = '<div class="form-error">As senhas não coincidem.</div>'; return false; }
        try {
          await resetUserPassword(user.id, p1);
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Redefinição de senha',
            details: `Senha de "${user.nome}" (${user.username}) redefinida pelo administrador.`,
            entity: 'user', entityId: user.id,
          });
          showToast('Senha redefinida.', 'success');
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  document.getElementById('new-user-btn').addEventListener('click', () => {
    openModal({
      title: 'Novo vendedor',
      submitLabel: 'Cadastrar vendedor',
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="field"><label>Nome completo *</label><input id="f-nome"></div>
        <div class="field"><label>Usuário de login *</label><input id="f-username"></div>
        <div class="form-row">
          <div class="field"><label>Senha *</label><input id="f-pass" type="password" minlength="6"></div>
          <div class="field"><label>Confirmar senha *</label><input id="f-pass2" type="password" minlength="6"></div>
        </div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const nome = modalEl.querySelector('#f-nome').value.trim();
        const username = modalEl.querySelector('#f-username').value.trim();
        const p1 = modalEl.querySelector('#f-pass').value;
        const p2 = modalEl.querySelector('#f-pass2').value;
        if (!nome || !username) { errBox.innerHTML = '<div class="form-error">Preencha nome e usuário de login.</div>'; return false; }
        if (p1.length < 6) { errBox.innerHTML = '<div class="form-error">A senha deve ter pelo menos 6 caracteres.</div>'; return false; }
        if (p1 !== p2) { errBox.innerHTML = '<div class="form-error">As senhas não coincidem.</div>'; return false; }
        if (await findByUsername(username)) { errBox.innerHTML = '<div class="form-error">Esse usuário de login já existe.</div>'; return false; }
        const user = await createUser({ nome, username, password: p1, role: 'vendedor' });
        await logAction({
          userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
          action: 'Cadastro de usuário',
          details: `Vendedor "${user.nome}" (${user.username}) cadastrado.`,
          entity: 'user', entityId: user.id,
        });
        showToast('Vendedor cadastrado.', 'success');
        refresh();
        return true;
      },
    });
  });

  refresh();
}
