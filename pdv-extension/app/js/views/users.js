// Gestão de usuários — exclusiva de quem tem a permissão 'usuarios' (admin
// sempre tem; um vendedor só se outro admin marcar isso pra ele, ver
// utils/permissions.js). Todo usuário cadastrado a partir daqui nasce como
// vendedor (o único admin é o criado no assistente de configuração
// inicial). Cada vendedor nasce sem nenhum poder além do básico (vender,
// consultar estoque, caixa, clientes, carreto, personalização) — o admin
// decide, no cadastro ou na edição, quais dos poderes extras (cadastrar
// produto, acessar Compras/Financeiro/etc.) esse vendedor específico tem.
import { listUsers, createUser, updateUser, findByUsername, setUserActive, resetUserPassword } from '../data/usersRepo.js';
import { logAction } from '../data/auditRepo.js';
import { formatDateTime, escapeHtml } from '../utils/format.js';
import { PERMISSION_DEFS, userCan, isAdmin, MIN_USER_PASSWORD_LENGTH } from '../utils/permissions.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { icon } from '../components/icon.js';

/** Checkboxes de permissão (ver utils/permissions.js), agrupados igual à
 * lista que o admin vê — reaproveitado tanto no cadastro quanto na edição
 * de vendedor, pra nunca desalinhar os dois formulários. Layout em
 * .permission-groups/.permission-grid (ver styles.css) em vez de um
 * .form-row comum: 13 itens em 4 grupos desiguais (um deles com 7)
 * espremiam demais numa única linha flex.
 *
 * `actingUser` trava (disabled) as caixinhas de poder que quem está
 * cadastrando/editando não tem — visível na tela, não só imposto sem
 * explicação no repositório (data/usersRepo.js#createUser/updateUser
 * ignoram silenciosamente o que vier marcado ali, mas sem isso aqui o
 * vendedor via a caixinha marcada, clicava em Salvar, recebia sucesso, e o
 * poder simplesmente não pegava — confuso sem essa pista visual). Admin não
 * trava nada (userCan(admin, qualquer coisa) é sempre true). */
function renderPermissionFields(checked = {}, actingUser) {
  const groups = [];
  for (const p of PERMISSION_DEFS) {
    let group = groups.find((g) => g.name === p.group);
    if (!group) { group = { name: p.group, perms: [] }; groups.push(group); }
    group.perms.push(p);
  }
  return `
    <div class="permission-groups">
      ${groups.map((g) => `
        <div>
          <div class="permission-group-title">${escapeHtml(g.name)}</div>
          <div class="permission-grid">
            ${g.perms.map((p) => {
              const locked = actingUser && !userCan(actingUser, p.key);
              return `
                <label class="permission-item${locked ? ' locked' : ''}" ${locked ? 'title="Você mesmo não tem esse poder — só quem tem pode conceder ou tirar dos outros."' : ''}>
                  <input type="checkbox" data-perm="${p.key}" ${checked[p.key] ? 'checked' : ''} ${locked ? 'disabled' : ''}>
                  <span>${escapeHtml(p.label)}${locked ? ' ' + icon('lock', { size: 13 }) : ''}</span>
                </label>
              `;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function collectPermissions(modalEl) {
  const result = {};
  modalEl.querySelectorAll('[data-perm]').forEach((el) => { result[el.dataset.perm] = el.checked; });
  return result;
}

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
          <thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th style="text-align:center;">Status</th><th>Cadastrado em</th><th></th></tr></thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td>${escapeHtml(u.nome)}</td>
                <td>${escapeHtml(u.username)}</td>
                <td>${isAdmin(u) ? '<span class="badge badge-gold">Administrador</span>' : '<span class="badge badge-green">Vendedor</span>'}</td>
                <td style="text-align:center;">${u.active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>'}</td>
                <td>${formatDateTime(u.createdAt)}</td>
                <td style="white-space:nowrap;">
                  ${isAdmin(u) || u.id === ctx.user.id ? '' : `<button class="btn btn-ghost btn-sm" data-edit="${u.id}">Editar</button>`}
                  <button class="btn btn-ghost btn-sm" data-reset="${u.id}">Redefinir senha</button>
                  ${isAdmin(u) ? '' : `<button class="btn btn-ghost btn-sm" data-toggle="${u.id}">${u.active ? 'Desativar' : 'Reativar'}</button>`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    tableBox.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openEditUserModal(users.find((u) => u.id === btn.dataset.edit)));
    });
    tableBox.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => toggleUser(users.find((u) => u.id === btn.dataset.toggle)));
    });
    tableBox.querySelectorAll('[data-reset]').forEach((btn) => {
      btn.addEventListener('click', () => openResetModal(users.find((u) => u.id === btn.dataset.reset)));
    });
  }

  function openEditUserModal(user) {
    openModal({
      title: `Editar vendedor — ${escapeHtml(user.nome)}`,
      submitLabel: 'Salvar alterações',
      wide: true,
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="field"><label>Nome completo *</label><input id="f-nome" value="${escapeHtml(user.nome)}"></div>
        <p class="section-title">Permissões</p>
        <p class="text-muted" style="font-size:12.5px;margin-top:-8px;">
          O que este vendedor pode fazer além do básico (vender, consultar estoque, caixa, clientes, carreto,
          personalização) — desmarcado, ele não vê nem pode fazer.
        </p>
        ${renderPermissionFields(user.permissions || {}, ctx.user)}
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const nome = modalEl.querySelector('#f-nome').value.trim();
        if (!nome) { errBox.innerHTML = '<div class="form-error">Nome é obrigatório.</div>'; return false; }
        try {
          await updateUser(user.id, { nome, permissions: collectPermissions(modalEl) });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Edição de usuário',
            details: `Vendedor "${nome}" (${user.username}) editado — nome e permissões atualizados.`,
            entity: 'user', entityId: user.id,
          });
          showToast('Vendedor atualizado.', 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
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
        <div class="field"><label>Nova senha *</label><input id="f-pass" type="password" minlength="${MIN_USER_PASSWORD_LENGTH}"></div>
        <div class="field"><label>Confirmar nova senha *</label><input id="f-pass2" type="password" minlength="${MIN_USER_PASSWORD_LENGTH}"></div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const p1 = modalEl.querySelector('#f-pass').value;
        const p2 = modalEl.querySelector('#f-pass2').value;
        if (p1.length < MIN_USER_PASSWORD_LENGTH) { errBox.innerHTML = `<div class="form-error">A senha deve ter pelo menos ${MIN_USER_PASSWORD_LENGTH} caracteres.</div>`; return false; }
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
      wide: true,
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="field"><label>Nome completo *</label><input id="f-nome"></div>
        <div class="field"><label>Usuário de login *</label><input id="f-username"></div>
        <div class="form-row">
          <div class="field"><label>Senha *</label><input id="f-pass" type="password" minlength="${MIN_USER_PASSWORD_LENGTH}"></div>
          <div class="field"><label>Confirmar senha *</label><input id="f-pass2" type="password" minlength="${MIN_USER_PASSWORD_LENGTH}"></div>
        </div>
        <p class="section-title">Permissões</p>
        <p class="text-muted" style="font-size:12.5px;margin-top:-8px;">
          O que este vendedor pode fazer além do básico (vender, consultar estoque, caixa, clientes, carreto,
          personalização) — nasce com tudo desmarcado, marque só o que ele precisar.
        </p>
        ${renderPermissionFields({}, ctx.user)}
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const nome = modalEl.querySelector('#f-nome').value.trim();
        const username = modalEl.querySelector('#f-username').value.trim();
        const p1 = modalEl.querySelector('#f-pass').value;
        const p2 = modalEl.querySelector('#f-pass2').value;
        if (!nome || !username) { errBox.innerHTML = '<div class="form-error">Preencha nome e usuário de login.</div>'; return false; }
        if (p1.length < MIN_USER_PASSWORD_LENGTH) { errBox.innerHTML = `<div class="form-error">A senha deve ter pelo menos ${MIN_USER_PASSWORD_LENGTH} caracteres.</div>`; return false; }
        if (p1 !== p2) { errBox.innerHTML = '<div class="form-error">As senhas não coincidem.</div>'; return false; }
        if (await findByUsername(username)) { errBox.innerHTML = '<div class="form-error">Esse usuário de login já existe.</div>'; return false; }
        // createUser confere o usuário duplicado de novo por conta própria
        // (proteção contra a janela entre o findByUsername acima e este
        // ponto — ver comentário em usersRepo.js) e pode lançar por esse ou
        // outro motivo inesperado. Sem este try/catch, um erro aqui deixava
        // o modal parado sem fechar e sem mostrar nada pro usuário — achado
        // de auditoria: os outros dois formulários desta mesma tela
        // (redefinir senha, ativar/desativar) já tratavam erro assim.
        try {
          const user = await createUser({ nome, username, password: p1, permissions: collectPermissions(modalEl) });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Cadastro de usuário',
            details: `Vendedor "${user.nome}" (${user.username}) cadastrado.`,
            entity: 'user', entityId: user.id,
          });
          showToast('Vendedor cadastrado.', 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  });

  refresh();
}
