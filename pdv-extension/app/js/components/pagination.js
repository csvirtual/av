// Paginação numerada (1 2 3 4 5 …) + seletor de "mostrar N por página" —
// usada nas telas cuja lista inteira já fica em memória de qualquer jeito
// (Estoque, Caixa, Clientes, Carreto, Compras, Financeiro). Histórico de
// vendas e Log do sistema usam um mecanismo À PARTE, com cursor direto no
// IndexedDB (ver salesRepo.js#listSalesPage / auditRepo.js#listAuditLogPage)
// — foi correção de uma lentidão real, confirmada com dezenas de milhares
// de registros, porque aquelas duas listas não cabem inteiras em memória
// sem travar a tela. Não trocar esses dois pelo componente daqui: página
// numerada exige saber o total e "pular" pra qualquer página, o que built
// de volta o problema que o cursor resolveu.
import { icon } from './icon.js';

const DEFAULT_PAGE_SIZES = [10, 25, 50, 75, 100];

/** Estado inicial repetido em Estoque, Caixa, Clientes (x2), Carreto,
 * Compras e Financeiro: página 1, 10 por página. É uma FUNÇÃO (não um
 * objeto exportado direto) de propósito — cada tela guarda seu próprio
 * `pgState` e o muta em vários pontos (ex: `pgState.page = 1` ao
 * resetar o filtro), então um objeto único compartilhado entre as telas
 * quebraria silenciosamente essa mutação de uma tela vazando pra outra. */
export function createPageState() {
  return { page: 1, pageSize: 10 };
}

/** Gera o HTML da barra de paginação pro estado atual. Devolve string vazia
 * quando não há nenhum registro (a própria tela já mostra "nada encontrado"
 * nesse caso, não precisa de paginação junto). */
export function paginationHtml({ page, pageSize, total, pageSizeOptions = DEFAULT_PAGE_SIZES }) {
  if (total === 0) return '';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize + 1;
  const end = Math.min(clampedPage * pageSize, total);

  // Janela de números visível: primeira, última, e a atual ± 2 — evita uma
  // fileira de dezenas de botões quando o histórico já é grande (ex:
  // Financeiro depois de anos de loja em operação).
  const windowSize = 2;
  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= clampedPage - windowSize && p <= clampedPage + windowSize)) pages.push(p);
  }
  let prevPage = 0;
  const pageButtons = pages.map((p) => {
    const gap = p - prevPage > 1 ? '<span class="pg-ellipsis">…</span>' : '';
    prevPage = p;
    return `${gap}<button type="button" class="btn-sm ${p === clampedPage ? 'btn' : 'btn-secondary'} pg-page-btn" data-page="${p}" ${p === clampedPage ? 'disabled' : ''}>${p}</button>`;
  }).join('');

  return `
    <div class="pagination-bar">
      <div class="pg-size-row">
        <label class="text-muted" style="font-size:12.5px;">Mostrar</label>
        <select class="pg-size-select">
          ${pageSizeOptions.map((n) => `<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <span class="text-muted" style="font-size:12.5px;">${start}–${end} de ${total}</span>
      </div>
      <div class="pg-page-row">
        <button type="button" class="btn-sm btn-secondary pg-prev-btn" ${clampedPage <= 1 ? 'disabled' : ''}>${icon('arrowLeft', { size: 14 })} Anterior</button>
        ${pageButtons}
        <button type="button" class="btn-sm btn-secondary pg-next-btn" ${clampedPage >= totalPages ? 'disabled' : ''}>Próxima ${icon('arrowRight', { size: 14 })}</button>
      </div>
    </div>
  `;
}

/** Liga os controles renderizados por paginationHtml() dentro de `container`.
 * `onChange({ page, pageSize })` é chamado com o novo estado — quem chama
 * decide o que fazer (tipicamente: guardar o novo estado e re-renderizar a
 * tabela com o slice certo). Trocar o tamanho da página sempre volta pra
 * página 1 (evita "página 8" virar inválida na hora, ou parecer que sumiu
 * gente da lista). */
export function wirePagination(container, state, onChange) {
  container.querySelector('.pg-size-select')?.addEventListener('change', (e) => {
    onChange({ page: 1, pageSize: Number(e.target.value) });
  });
  container.querySelectorAll('.pg-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => onChange({ page: Number(btn.dataset.page), pageSize: state.pageSize }));
  });
  container.querySelector('.pg-prev-btn')?.addEventListener('click', () => onChange({ page: state.page - 1, pageSize: state.pageSize }));
  container.querySelector('.pg-next-btn')?.addEventListener('click', () => onChange({ page: state.page + 1, pageSize: state.pageSize }));
}
