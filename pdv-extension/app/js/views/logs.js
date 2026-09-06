// Log de auditoria — exige a permissão 'logs' (admin sempre tem; um
// vendedor só se marcado no cadastro dele, ver utils/permissions.js).
// Mostra a ação de TODOS os usuários (admin e vendedores), com filtro por
// perfil e por pessoa, pra poder isolar "o que cada perfil andou fazendo"
// como pedido.
import { listAuditLogPage } from '../data/auditRepo.js';
import { listUsers } from '../data/usersRepo.js';
import { formatDateTime, escapeHtml } from '../utils/format.js';
import { enhanceSelect } from '../components/customSelect.js';
import { isAdmin } from '../utils/permissions.js';

export async function renderLogs(container) {
  container.innerHTML = '<div class="card loading-state"><span class="spinner"></span>Carregando…</div>';

  const users = await listUsers();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Log do sistema</h1>
        <div class="desc">Registro de todas as ações realizadas no sistema, por usuário e perfil. Acesso restrito a quem tem a permissão "Acessar Log do sistema".</div>
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

  // Paginação real (ver data/auditRepo.js#listAuditLogPage) — mesmo achado
  // de auditoria do Histórico de vendas: a versão anterior carregava o log
  // inteiro (listAuditLog()) e desenhava uma <tr> por registro de uma vez
  // só. Com anos de operação, esse log só cresce (nunca é apagado) — sem
  // paginação, essa tela seria a que mais sofreria com o tempo.
  const PAGE_SIZE = 50;
  let loadedLog = [];
  let cursor = { afterKey: undefined, afterId: undefined };
  let hasMore = false;
  // A varredura agora é assíncrona (cursor no IndexedDB, não mais um
  // filtro síncrono num array já carregado) — sem essa trava, digitar
  // rápido no campo de busca dispararia uma reload() por tecla, e uma
  // resposta mais antiga podia voltar DEPOIS de uma mais nova e sobrescrever
  // o resultado certo com um desatualizado. `requestSeq` garante que só a
  // resposta da chamada mais recente é aplicada.
  let requestSeq = 0;

  function currentFilters() {
    const role = document.getElementById('role-filter').value || undefined;
    const userId = document.getElementById('user-filter').value || undefined;
    const term = document.getElementById('term-filter').value.trim() || undefined;
    const from = document.getElementById('date-from').value;
    const to = document.getElementById('date-to').value;
    const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
    // .999, não .000 — mesmo achado de auditoria do filtro de data em
    // Histórico de vendas e Relatórios: sem isso, um registro no último
    // segundo do dia "até" ficava fora do filtro.
    const toTs = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined;
    return { role, userId, term, fromTs, toTs };
  }

  async function reload() {
    const seq = ++requestSeq;
    const page = await listAuditLogPage({ ...currentFilters(), limit: PAGE_SIZE });
    if (seq !== requestSeq) return; // uma busca mais nova já foi disparada — descarta esta resposta atrasada
    loadedLog = page.items;
    hasMore = page.hasMore;
    cursor = { afterKey: page.nextKey, afterId: page.nextId };
    renderTable();
  }

  async function loadMore() {
    const page = await listAuditLogPage({ ...currentFilters(), limit: PAGE_SIZE, afterKey: cursor.afterKey, afterId: cursor.afterId });
    loadedLog = loadedLog.concat(page.items);
    hasMore = page.hasMore;
    cursor = { afterKey: page.nextKey, afterId: page.nextId };
    renderTable();
  }

  function renderTable() {
    if (loadedLog.length === 0) {
      tableBox.innerHTML = '<div class="table-wrap"><div class="table-empty">Nenhum registro encontrado para o filtro selecionado.</div></div>';
      return;
    }
    tableBox.innerHTML = `
      <div class="utility-bar"><span class="text-muted" style="font-size:13px;">${loadedLog.length} registro(s)${hasMore ? ' carregado(s)' : ''}</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data/Hora</th><th>Usuário</th><th>Perfil</th><th>Ação</th><th>Detalhes</th></tr></thead>
          <tbody>
            ${loadedLog.map((l) => `
              <tr>
                <td style="white-space:nowrap;">${formatDateTime(l.timestamp)}</td>
                <td>${escapeHtml(l.userName)}</td>
                <td>${isAdmin(l) ? '<span class="badge badge-gold">Admin</span>' : '<span class="badge badge-green">Vendedor</span>'}</td>
                <td>${escapeHtml(l.action)}</td>
                <td class="text-muted">${escapeHtml(l.details)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${hasMore ? '<div style="text-align:center;margin-top:14px;"><button class="btn btn-secondary" id="load-more-btn">Carregar mais</button></div>' : ''}
    `;
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async () => {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = 'Carregando…';
        await loadMore();
      });
    }
  }

  ['role-filter', 'user-filter', 'date-from', 'date-to'].forEach((id) => {
    document.getElementById(id).addEventListener('change', reload);
  });
  enhanceSelect(document.getElementById('role-filter'));
  enhanceSelect(document.getElementById('user-filter'));
  // Campo de texto livre: debounced (mesmo padrão já usado na busca de
  // produto/cliente em views/sale.js) — sem isso, cada tecla digitada
  // dispararia uma varredura no banco por conta própria.
  let termDebounce;
  document.getElementById('term-filter').addEventListener('input', () => {
    clearTimeout(termDebounce);
    termDebounce = setTimeout(reload, 250);
  });

  await reload();
}
