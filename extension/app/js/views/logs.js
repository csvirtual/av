// Log de auditoria — exclusivo do Administrador Geral. Mostra a ação de
// TODOS os usuários (admin e vendedores), com filtro por perfil e por
// pessoa, pra poder isolar "o que cada perfil andou fazendo" como pedido.
import { listAuditLog } from '../data/auditRepo.js';
import { listUsers } from '../data/usersRepo.js';
import { formatDateTime, escapeHtml } from '../utils/format.js';

export async function renderLogs(container, ctx) {
  container.innerHTML = '<div class="card">Carregando…</div>';

  const [log, users] = await Promise.all([listAuditLog(), listUsers()]);

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Log do sistema</h1>
        <div class="desc">Registro de todas as ações realizadas no sistema, por usuário e perfil. Visível apenas para o Administrador Geral.</div>
      </div>
    </div>
    <div class="toolbar">
      <select id="role-filter">
        <option value="">Todos os perfis</option>
        <option value="admin">Administrador</option>
        <option value="vendedor">Vendedor</option>
      </select>
      <select id="user-filter">
        <option value="">Todos os usuários</option>
        ${users.map((u) => `<option value="${u.id}">${escapeHtml(u.nome)}</option>`).join('')}
      </select>
      <input type="search" id="term-filter" placeholder="Buscar na ação/detalhes…">
      <label class="text-muted" style="font-size:13px;">De <input type="date" id="date-from"></label>
      <label class="text-muted" style="font-size:13px;">Até <input type="date" id="date-to"></label>
    </div>
    <div id="log-table"></div>
  `;

  const tableBox = document.getElementById('log-table');

  function applyFilters() {
    const role = document.getElementById('role-filter').value;
    const userId = document.getElementById('user-filter').value;
    const term = document.getElementById('term-filter').value.trim().toLowerCase();
    const from = document.getElementById('date-from').value;
    const to = document.getElementById('date-to').value;

    let filtered = log;
    if (role) filtered = filtered.filter((l) => l.role === role);
    if (userId) filtered = filtered.filter((l) => l.userId === userId);
    if (term) filtered = filtered.filter((l) => `${l.action} ${l.details}`.toLowerCase().includes(term));
    if (from) {
      const fromTs = new Date(`${from}T00:00:00`).getTime();
      filtered = filtered.filter((l) => l.timestamp >= fromTs);
    }
    if (to) {
      // .999, não .000 — mesmo achado de auditoria do filtro de data em
      // Histórico de vendas e Relatórios: sem isso, um registro no último
      // segundo do dia "até" ficava fora do filtro.
      const toTs = new Date(`${to}T23:59:59.999`).getTime();
      filtered = filtered.filter((l) => l.timestamp <= toTs);
    }
    renderTable(filtered);
  }

  function renderTable(list) {
    if (list.length === 0) {
      tableBox.innerHTML = '<div class="table-wrap"><div class="table-empty">Nenhum registro encontrado para o filtro selecionado.</div></div>';
      return;
    }
    tableBox.innerHTML = `
      <div class="utility-bar"><span class="text-muted" style="font-size:13px;">${list.length} registro(s)</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data/Hora</th><th>Usuário</th><th>Perfil</th><th>Ação</th><th>Detalhes</th></tr></thead>
          <tbody>
            ${list.map((l) => `
              <tr>
                <td style="white-space:nowrap;">${formatDateTime(l.timestamp)}</td>
                <td>${escapeHtml(l.userName)}</td>
                <td>${l.role === 'admin' ? '<span class="badge badge-gold">Admin</span>' : '<span class="badge badge-green">Vendedor</span>'}</td>
                <td>${escapeHtml(l.action)}</td>
                <td class="text-muted">${escapeHtml(l.details)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  ['role-filter', 'user-filter', 'term-filter', 'date-from', 'date-to'].forEach((id) => {
    document.getElementById(id).addEventListener('input', applyFilters);
    document.getElementById(id).addEventListener('change', applyFilters);
  });

  renderTable(log);
}
