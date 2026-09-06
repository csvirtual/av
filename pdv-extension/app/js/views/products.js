// Estoque geral: todos os perfis podem consultar (nome, categoria, preço,
// quantidade) e bipar/buscar um código pra ver se já existe cadastro.
// Cadastrar/editar produto, ajustar estoque manualmente e inativar/excluir
// produto exigem as permissões correspondentes (ver utils/permissions.js) —
// admin sempre tem todas; um vendedor só se o admin marcar no cadastro dele.
// A baixa de estoque por venda em si acontece na tela de Nova Venda, não
// aqui.
import {
  listProducts, searchProducts, getByBarcode, createProduct, updateProduct,
  setProductActive, deleteProduct,
} from '../data/productsRepo.js';
import { recordMovement, recordManualAdjustment, listMovementsByProduct } from '../data/stockRepo.js';
import { listSuppliers } from '../data/suppliersRepo.js';
import { logAction } from '../data/auditRepo.js';
import { bindBarcodeInput, generateInternalBarcode } from '../utils/barcode.js';
import { formatMoney, formatDateTime, escapeHtml, displayUnit, formatQty } from '../utils/format.js';
import { isNearExpiry, isExpired } from '../utils/pricing.js';
import { userCan } from '../utils/permissions.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { paginationHtml, wirePagination, createPageState } from '../components/pagination.js';
import { enhanceSelect } from '../components/customSelect.js';
import { icon } from '../components/icon.js';
import { draftCartLocationsForProduct } from './sale.js';

const MOVEMENT_LABELS = {
  entrada: 'Entrada', saida: 'Saída', venda: 'Venda', ajuste: 'Ajuste', estorno: 'Estorno',
};

// Deixa a tela Estoque já abrir com um filtro de status aplicado (ex: o
// Painel manda pra cá com "estoque baixo" já marcado, ao clicar no
// indicador correspondente) — mesmo padrão de estado fora da função de
// render usado em sale.js#cart: o roteador recria a tela do zero a cada
// troca de menu (ver app.js#navigate, só `location.hash = ...`, sem lugar
// nenhum pra passar parâmetro junto), então isso precisa viver fora de
// renderProducts pra sobreviver à troca de tela. `renderProducts` consome
// (e zera) isso uma única vez, na entrada seguinte — não fica "grudado" se
// o usuário voltar pra Estoque depois por conta própria (aí sim volta a
// abrir com "Todos os status", o padrão de sempre).
let pendingStatusFilter = null;
export function openEstoqueFilteredByStatus(status) {
  pendingStatusFilter = status;
}

// Achado do usuário: mostrar só a sigla ("kg", "pct") no <select> obriga
// quem não é do ramo a decorar o que cada uma significa — o nome por
// extenso do lado resolve isso sem trocar o VALOR gravado (continua sendo
// só a sigla, ver createProduct/updateProduct), só muda o que aparece na
// lista. Nome ANTES da sigla ("Quilograma — kg"), não depois: quem não
// reconhece a sigla de cara teria que "pular" ela pra achar a explicação;
// com o nome primeiro, o olho já pousa na palavra reconhecível.
const UNITS = [
  { value: 'un', label: 'Unidade — un' },
  { value: 'kg', label: 'Quilograma — kg' },
  { value: 'g', label: 'Grama — g' },
  { value: 'L', label: 'Litro — L' },
  { value: 'ml', label: 'Mililitro — ml' },
  { value: 'cx', label: 'Caixa — cx' },
  { value: 'saco', label: 'Saco — saco' },
  { value: 'm', label: 'Metro — m' },
  { value: 'pct', label: 'Pacote — pct' },
];
// 'personalizado' fica fora de UNITS de propósito — não é uma sigla de
// unidade normal (kg, un...), é um MODO diferente de cadastro (várias formas
// de venda com preços próprios pro mesmo produto, ver
// data/productsRepo.js#resolveCustomUnitFields), então o <select> do
// formulário monta a opção dele à parte, sempre por último.
const CUSTOM_UNIT_VALUE = 'personalizado';
const MAX_CUSTOM_FORMS = 7;
// Piso do lado esquerdo da "Equivalência" (quantidade da forma vendida, ex:
// "0,5 metro de areia") — achado do usuário: material de construção também
// vende em meios, então 1 inteiro como mínimo ficava curto pra esse caso real.
const EQUIV_N_MIN = 0.5;
const EQUIV_N_STEP = 0.5;

export async function renderProducts(container, ctx) {
  const canManageProducts = userCan(ctx.user, 'manageProducts');
  const canAdjustStock = userCan(ctx.user, 'adjustStock');
  const canToggleProduct = userCan(ctx.user, 'toggleProduct');
  const canDeleteProduct = userCan(ctx.user, 'deleteProduct');
  const initialStatus = pendingStatusFilter || '';
  pendingStatusFilter = null;
  let currentFilter = { term: '', category: '', status: initialStatus };

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Estoque</h1>
        <div class="desc">Material de construção e mercearia — visão geral do que a loja tem disponível.</div>
      </div>
      <div class="page-actions">
        ${canAdjustStock ? '<button class="btn btn-secondary" id="inventory-btn">Fazer inventário</button>' : ''}
        ${canManageProducts ? '<button class="btn" id="new-product-btn">+ Novo produto</button>' : ''}
      </div>
    </div>
    <div class="toolbar">
      <input type="search" id="search-input" placeholder="Buscar por nome ou código de barras — ou escaneie…" autofocus>
      <select id="category-filter">
        <option value="">Todas as categorias</option>
        <option value="material">Material de construção</option>
        <option value="mercearia">Mercearia</option>
      </select>
      <select id="status-filter">
        <option value="" ${initialStatus === '' ? 'selected' : ''}>Todos os status</option>
        <option value="available" ${initialStatus === 'available' ? 'selected' : ''}>Disponível</option>
        <option value="low-stock" ${initialStatus === 'low-stock' ? 'selected' : ''}>Estoque baixo</option>
        <option value="inactive" ${initialStatus === 'inactive' ? 'selected' : ''}>Inativo</option>
        <option value="near-expiry" ${initialStatus === 'near-expiry' ? 'selected' : ''}>Próximo da validade</option>
        <option value="expired" ${initialStatus === 'expired' ? 'selected' : ''}>Fora da validade</option>
      </select>
    </div>
    <div id="products-table"></div>
  `;

  const searchInput = document.getElementById('search-input');
  const tableBox = document.getElementById('products-table');
  // Achado do usuário: o único campo de digitação desta tela é a busca —
  // o atributo `autofocus` do HTML acima não é garantia (o botão do menu
  // lateral que acabou de ser clicado pra chegar aqui continua com o foco
  // do navegador; `autofocus` inserido via innerHTML nem sempre consegue
  // "roubar" esse foco de volta, dependendo do navegador/timing). Foca aqui
  // via JS, sempre, na entrada da tela — não importa se veio do menu, de um
  // indicador do Painel (openEstoqueFilteredByStatus) ou de "Voltar/Avançar"
  // do navegador: o vendedor já pode digitar ou bipar direto, sem clicar.
  searchInput.focus();

  // Mesma condição usada pelo selo de cada linha (ver statusBadge mais
  // abaixo) — pra o filtro nunca "prometer" um status que a própria linha
  // não mostra (ex: produto inativo não ganha selo de "Estoque baixo",
  // então também não aparece filtrando por ele).
  const STATUS_FILTERS = {
    'available': (p) => p.active && p.quantity > p.minStock,
    'low-stock': (p) => p.active && p.quantity <= p.minStock,
    'inactive': (p) => !p.active,
    'near-expiry': (p) => isNearExpiry(p) && !isExpired(p),
    'expired': (p) => isExpired(p),
  };

  // Paginação numerada (ver components/pagination.js) — catálogo de loja
  // bem estocada passa fácil de várias centenas de produtos, e desenhar
  // uma <tr> pra cada um a cada tecla digitada na busca deixava a tela
  // visivelmente lenta. A busca/filtro já é 100% em memória (ver
  // STATUS_FILTERS acima) — não precisa de cursor no banco, só limita
  // quantas linhas do resultado já filtrado entram no DOM de uma vez.
  let pgState = createPageState();

  async function refresh({ resetPage = true } = {}) {
    // O menu "Opções" aberto (se algum estiver) referencia um botão-gatilho
    // que está prestes a ser destruído pelo tableBox.innerHTML mais abaixo
    // — sem fechar aqui, o menu (anexado ao <body>, não ao tableBox, ver
    // openOptionsMenuFor) ficava flutuando sozinho na tela, órfão, mesmo
    // depois da linha dele ter sumido ou mudado de posição.
    closeOptionsMenu();
    let products = currentFilter.term ? await searchProducts(currentFilter.term) : await listProducts();
    if (currentFilter.category) products = products.filter((p) => p.category === currentFilter.category);
    if (currentFilter.status) products = products.filter(STATUS_FILTERS[currentFilter.status]);
    if (resetPage) pgState.page = 1;
    const total = products.length;
    const totalPages = Math.max(1, Math.ceil(total / pgState.pageSize));
    if (pgState.page > totalPages) pgState.page = totalPages;
    const start = (pgState.page - 1) * pgState.pageSize;
    const visible = products.slice(start, start + pgState.pageSize);
    tableBox.innerHTML = `
      ${total > 0 ? `<div class="utility-bar"><span class="text-muted" style="font-size:13px;">${total} produto(s)</span></div>` : ''}
      ${renderTable(visible, { canManageProducts, canAdjustStock, canToggleProduct, canDeleteProduct })}
      ${paginationHtml({ page: pgState.page, pageSize: pgState.pageSize, total })}
    `;
    wireRowActions(products);
    wirePagination(tableBox, pgState, (next) => { pgState = next; refresh({ resetPage: false }); });
  }

  searchInput.addEventListener('input', (e) => {
    currentFilter.term = e.target.value;
    refresh();
  });
  document.getElementById('status-filter').addEventListener('change', (e) => {
    currentFilter.status = e.target.value;
    refresh();
  });
  document.getElementById('category-filter').addEventListener('change', (e) => {
    currentFilter.category = e.target.value;
    refresh();
  });
  enhanceSelect(document.getElementById('status-filter'));
  enhanceSelect(document.getElementById('category-filter'));

  // Mesmo mecanismo de leitor de código de barras do PDV (ver
  // utils/barcode.js e views/sale.js) — um bipe aqui já filtra a tabela
  // sozinho pelo listener de 'input' acima (o leitor "digita" o código);
  // isto aqui só cuida do Enter: se o código não corresponder a NENHUM
  // produto (nem por barcode exato, nem por nome/código parcial), oferece
  // cadastrar na hora, em vez de só deixar a tabela vazia sem explicação.
  bindBarcodeInput(searchInput, async (value) => {
    const code = value.trim();
    if (!code) return;
    if (await getByBarcode(code)) return; // já filtrado e visível na tabela
    const matches = await searchProducts(code);
    if (matches.length > 0) return; // idem — algum nome/código bateu
    // bindBarcodeInput já limpou searchInput.value sozinho (ver
    // utils/barcode.js), mas isso não dispara o listener de 'input' lá em
    // cima (mudar .value por código não conta como digitação) — sem isto,
    // currentFilter.term ficava "preso" no código que não achou nada, e a
    // tabela continuava mostrando "Nenhum produto encontrado" mesmo com o
    // campo de busca já visivelmente vazio na tela.
    currentFilter.term = '';
    refresh();
    promptUnknownBarcode(ctx, code, { onRegistered: refresh });
  });

  if (canManageProducts) {
    document.getElementById('new-product-btn').addEventListener('click', () => openProductModal(ctx, { onSaved: refresh }));
  }
  if (canAdjustStock) {
    document.getElementById('inventory-btn').addEventListener('click', () => openInventoryModal());
  }

  function wireRowActions(products) {
    tableBox.querySelectorAll('[data-options]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        // Achado do usuário: sem isto, o clique no botão também contava
        // como "clique fora" pro listener em document que fecha o menu
        // (ver closeOptionsMenuOnOutsideClick) — abria e fechava no
        // mesmíssimo clique, o menu nunca aparecia de verdade.
        e.stopPropagation();
        const product = products.find((p) => p.id === btn.dataset.options);
        // Clicar de novo no MESMO botão que já abriu o menu fecha em vez
        // de reabrir — comportamento padrão de qualquer menu suspenso.
        if (openOptionsMenu?.triggerBtn === btn) { closeOptionsMenu(); return; }
        openOptionsMenuFor(product, btn);
      });
    });
    tableBox.querySelectorAll('[data-history]').forEach((btn) => {
      btn.addEventListener('click', () => openHistoryModal(products.find((p) => p.id === btn.dataset.history)));
    });
  }

  // Menu suspenso com as ações que antes eram um botão cada (Editar,
  // Ajustar, Inativar/Reativar, Excluir) — agrupadas atrás de "Opções" pra
  // não espremer a linha da tabela com 4-5 botões lado a lado. "Histórico"
  // fica de fora do grupo, de propósito: é a ação mais usada no dia a dia
  // (só consulta, não muda nada) e qualquer perfil pode usar — não faz
  // sentido escondê-la atrás de mais um clique junto de ações sensíveis.
  //
  // Anexado no <body> (não dentro da <td>/tableBox) e posicionado via
  // getBoundingClientRect() do botão — foge do overflow:auto de
  // .table-wrap (ver comentário no CSS), que cortaria/rolaria um menu
  // posicionado ali dentro. Só UM menu aberto por vez (guardado em
  // openOptionsMenu, fora desta função, pra sobreviver entre chamadas).
  let openOptionsMenu = null;

  function closeOptionsMenu() {
    if (!openOptionsMenu) return;
    openOptionsMenu.menuEl.remove();
    openOptionsMenu = null;
  }

  function openOptionsMenuFor(product, triggerBtn) {
    closeOptionsMenu();
    const items = [];
    if (canManageProducts) items.push({ label: 'Editar', run: () => openProductModal(ctx, { product, onSaved: refresh }) });
    if (canAdjustStock) items.push({ label: 'Ajustar', run: () => openAdjustModal(product) });
    if (canToggleProduct) items.push({ label: product.active ? 'Inativar' : 'Reativar', run: () => toggleActive(product) });
    if (canDeleteProduct) items.push({ label: 'Excluir', danger: true, run: () => removeProduct(product) });
    if (items.length === 0) return;

    const menu = document.createElement('div');
    menu.className = 'row-options-menu';
    menu.innerHTML = items.map((item, idx) => `
      <button type="button" class="row-options-item${item.danger ? ' danger' : ''}" data-idx="${idx}">${escapeHtml(item.label)}</button>
    `).join('');
    document.body.appendChild(menu);

    // Achado do usuário: alinhado com `right: window.innerWidth - rect.right`
    // (a 1ª versão daqui), a borda direita do menu ficava ~15px pra dentro
    // da borda direita do botão — exatamente a largura da barra de rolagem
    // do navegador. `window.innerWidth` CONTA a barra de rolagem, mas o
    // "containing block" de um position:fixed é a área visível SEM ela —
    // as duas medidas não falam a mesma língua. `left = rect.right -
    // menu.offsetWidth` não tem essa armadilha: as duas metades da conta
    // (a borda do botão e a largura do próprio menu) vêm do mesmo sistema
    // de coordenadas, sempre batendo certinho, com ou sem barra de rolagem.
    const rect = triggerBtn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.right - menu.offsetWidth}px`;
    // Linha perto do rodapé da tela: o menu nasceria cortado embaixo —
    // reabre pra CIMA do botão em vez de embaixo, só nesse caso.
    if (menu.getBoundingClientRect().bottom > window.innerHeight) {
      menu.style.top = `${rect.top - menu.offsetHeight - 4}px`;
    }

    menu.querySelectorAll('[data-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = items[Number(btn.dataset.idx)];
        closeOptionsMenu();
        item.run();
      });
    });

    openOptionsMenu = { menuEl: menu, triggerBtn };
  }

  // Fecha o menu com um clique em qualquer outro lugar da tela, ou ao
  // rolar a página (rolar sem fechar deixaria o menu flutuando longe do
  // botão que o abriu, já que é position:fixed — mais simples fechar do
  // que reposicionar ao vivo durante o scroll).
  function closeOptionsMenuOnOutsideClick(e) {
    if (openOptionsMenu && !openOptionsMenu.menuEl.contains(e.target)) closeOptionsMenu();
  }
  document.addEventListener('click', closeOptionsMenuOnOutsideClick);
  window.addEventListener('scroll', closeOptionsMenu, true);

  async function openHistoryModal(product) {
    const movements = await listMovementsByProduct(product.id);
    openModal({
      title: `Histórico de estoque — ${escapeHtml(product.name)}`,
      submitLabel: 'Fechar',
      singleButton: true,
      bodyHtml: movements.length === 0
        ? '<div class="table-empty">Nenhuma movimentação registrada para este produto ainda.</div>'
        : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Data/Hora</th><th>Tipo</th><th>Qtd</th><th>Usuário</th><th>Obs.</th></tr></thead>
              <tbody>
                ${movements.map((m) => `
                  <tr>
                    <td style="white-space:nowrap;">${formatDateTime(m.timestamp)}</td>
                    <td>${MOVEMENT_LABELS[m.type] || m.type}</td>
                    <td>${m.qty > 0 ? '+' : ''}${formatQty(m.qty)} ${escapeHtml(displayUnit(product))}</td>
                    <td>${escapeHtml(m.userName)}</td>
                    <td class="text-muted">${escapeHtml(m.note || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `,
      onSubmit: () => true,
    });
  }

  async function toggleActive(product) {
    const next = !product.active;
    const ok = await confirmDialog({
      title: next ? 'Reativar produto' : 'Inativar produto',
      message: `Deseja ${next ? 'reativar' : 'inativar'} "${escapeHtml(product.name)}"? ${next ? '' : 'Ele deixará de aparecer nas vendas, mas o histórico é preservado.'}`,
      confirmLabel: next ? 'Reativar' : 'Inativar',
      danger: !next,
    });
    if (!ok) return;
    try {
      await setProductActive(product.id, next);
      await logAction({
        userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
        action: next ? 'Reativação de produto' : 'Inativação de produto',
        details: `Produto "${product.name}" (código ${product.barcode}) ${next ? 'reativado' : 'inativado'}.`,
        entity: 'product', entityId: product.id,
      });
      showToast(`Produto ${next ? 'reativado' : 'inativado'}.`, 'success');
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // "A, B e C" — junta uma lista de nomes já escapados em texto corrido,
  // no padrão de vírgula com "e" antes do último item (usado no aviso de
  // exclusão quando o produto está em mais de um carrinho congelado).
  function joinWithE(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
  }

  async function removeProduct(product) {
    // Achado do usuário: excluir aqui um produto que está agora mesmo
    // parado no carrinho de uma venda em andamento (ainda não finalizada,
    // em "Nova venda") travava essa venda com um erro só na hora de
    // fechar — sem nenhum aviso antes, mesmo o vendedor estando na tela
    // certa de origem. Avisa aqui, antes de excluir, em vez de deixar a
    // outra tela descobrir o problema depois. A mensagem distingue o
    // carrinho ATIVO de cada carrinho CONGELADO que contém o produto (ao
    // invés de um "está numa venda em andamento" genérico que não deixava
    // claro qual dos dois era, nem de qual cliente, quando era um
    // congelado) — achado do usuário, ver draftCartLocationsForProduct.
    const { inActiveCart, heldLabels } = draftCartLocationsForProduct(product.id);
    const boilerplate = 'Isso não afeta vendas já registradas, mas remove o produto do catálogo. Prefira "Inativar" se ele já teve movimentação.';
    let message;
    if (!inActiveCart && heldLabels.length === 0) {
      message = `Excluir definitivamente "${escapeHtml(product.name)}"? ${boilerplate}`;
    } else {
      const heldPart = heldLabels.length === 1
        ? `no carrinho congelado de "${escapeHtml(heldLabels[0])}"`
        : heldLabels.length > 1
          ? `nos carrinhos congelados de ${joinWithE(heldLabels.map(escapeHtml))}`
          : '';
      const wherePart = inActiveCart && heldPart
        ? `no carrinho de uma venda ainda não finalizada, e também ${heldPart}`
        : inActiveCart
          ? 'no carrinho de uma venda ainda não finalizada'
          : heldPart;
      const consequence = inActiveCart && heldLabels.length > 0
        ? 'excluir vai impedir todos esses atendimentos de fechar até o item ser removido de cada um'
        : heldLabels.length > 1
          ? 'excluir vai impedir esses atendimentos de serem retomados até o item ser removido de cada um'
          : 'excluir vai impedir essa venda de fechar até o item ser removido de lá';
      message = `"${escapeHtml(product.name)}" está agora mesmo ${wherePart} — ${consequence}. Excluir definitivamente mesmo assim? ${boilerplate}`;
    }
    const ok = await confirmDialog({
      title: 'Excluir produto',
      message,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    // Achado de auditoria: diferente de toggleActive logo acima (mesma
    // tela, mesma classe de ação destrutiva), esta função nunca teve
    // try/catch — deleteProduct() pode lançar de verdade (reconfere
    // 'deleteProduct' na fonte, ver productsRepo.js) num cenário real, não
    // só teórico: um admin revoga a permissão do vendedor enquanto a
    // tabela já estava aberta com o botão "Excluir" visível (render
    // desatualizado). Sem isto, o clique falhava em silêncio — nem toast,
    // nem erro no console explicando nada pro vendedor.
    try {
      await deleteProduct(product.id);
      await logAction({
        userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
        action: 'Exclusão de produto',
        details: `Produto "${product.name}" (código ${product.barcode}) excluído do catálogo.`,
        entity: 'product', entityId: product.id,
      });
      showToast('Produto excluído.', 'success');
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function openAdjustModal(product) {
    // Achado de auditoria (P1): gerada uma vez só, na abertura do modal —
    // ver data/stockRepo.js#recordMovement.
    const dedupeKey = crypto.randomUUID();
    openModal({
      title: `Ajustar estoque — ${escapeHtml(product.name)}`,
      submitLabel: 'Confirmar ajuste',
      bodyHtml: `
        <div id="modal-error"></div>
        <p class="text-muted" style="font-size:13px;">Estoque atual: <strong>${formatQty(product.quantity)} ${escapeHtml(displayUnit(product))}</strong></p>
        <div class="field">
          <label>Tipo de movimento</label>
          <select id="f-type">
            <option value="entrada">Entrada (compra/reposição)</option>
            <option value="saida">Saída (perda, quebra, devolução ao fornecedor)</option>
          </select>
        </div>
        <div class="field">
          <label>Quantidade *</label>
          <input id="f-qty" type="number" min="0.5" step="0.5" value="1">
        </div>
        <div class="field">
          <label>Observação</label>
          <input id="f-note" placeholder="Ex: reposição do fornecedor X">
        </div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const type = modalEl.querySelector('#f-type').value;
        const qty = Number(modalEl.querySelector('#f-qty').value);
        const note = modalEl.querySelector('#f-note').value.trim();
        if (!qty || qty <= 0) {
          errBox.innerHTML = '<div class="form-error">Informe uma quantidade válida.</div>';
          return false;
        }
        const delta = type === 'entrada' ? qty : -qty;
        try {
          await recordManualAdjustment({
            productId: product.id, type, qty: delta,
            userId: ctx.user.id, userName: ctx.user.nome, note,
            dedupeKey,
          });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Ajuste manual de estoque',
            details: `${type === 'entrada' ? 'Entrada' : 'Saída'} de ${qty} ${displayUnit(product)} em "${product.name}". ${note ? `Obs: ${note}` : ''}`,
            entity: 'product', entityId: product.id,
          });
          showToast('Estoque ajustado.', 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  /** Inventário/balanço: contagem física de todo o catálogo de uma vez.
   * Pra cada produto onde a contagem digitada difere da quantidade atual do
   * sistema, gera um ajuste (tipo 'ajuste') com a diferença — mesmo
   * mecanismo do ajuste individual, só que em lote. Produto sem diferença
   * não gera movimento nenhum (evita poluir o histórico à toa). */
  async function openInventoryModal() {
    const products = (await listProducts()).filter((p) => p.active);
    // Achado de auditoria (P1): uma chave por ABERTURA do modal, não por
    // produto — mas como um envio legítimo já grava VÁRIOS ajustes
    // diferentes (um por produto com diferença), usar essa mesma chave
    // sozinha em todos rejeitaria o 2º produto em diante como "duplicata"
    // do 1º. Por isso cada chamada usa `${batchKey}:${productId}` (ver
    // abaixo) — única por produto DENTRO deste envio, mas idêntica entre
    // dois envios do MESMO clique em "Aplicar ajustes", que é o que
    // precisa ser bloqueado.
    const batchKey = crypto.randomUUID();
    openModal({
      title: 'Inventário / balanço de estoque',
      submitLabel: 'Aplicar ajustes',
      wide: true,
      bodyHtml: `
        <div id="modal-error"></div>
        <p class="text-muted" style="font-size:13px;">
          Conte fisicamente cada produto e digite o valor encontrado. Só os produtos com contagem
          diferente do sistema geram um ajuste — o resto fica como está.
        </p>
        <div class="table-wrap" style="max-height:420px;overflow-y:auto;">
          <table>
            <thead><tr><th>Produto</th><th>No sistema</th><th>Contagem física</th></tr></thead>
            <tbody>
              ${products.map((p) => `
                <tr>
                  <td>${escapeHtml(p.name)}</td>
                  <td>${formatQty(p.quantity)} ${escapeHtml(displayUnit(p))}</td>
                  <td><input type="number" min="0" step="0.5" value="${p.quantity}" data-count="${p.id}" class="table-inline-input" style="width:90px;"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Observação</label>
          <input id="f-note" placeholder="Ex: balanço mensal de agosto">
        </div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const note = modalEl.querySelector('#f-note').value.trim() || 'Inventário/balanço';
        const diffs = products
          .map((p) => ({ product: p, counted: Number(modalEl.querySelector(`[data-count="${p.id}"]`).value) }))
          .filter(({ product, counted }) => Number.isFinite(counted) && counted !== product.quantity);

        if (diffs.length === 0) {
          showToast('Nenhuma diferença encontrada — estoque já bate com o sistema.', 'success');
          return true;
        }

        try {
          for (const { product, counted } of diffs) {
            const delta = counted - product.quantity;
            await recordManualAdjustment({
              productId: product.id, type: 'ajuste', qty: delta,
              userId: ctx.user.id, userName: ctx.user.nome,
              note: `${note} (${delta > 0 ? '+' : ''}${delta})`,
              dedupeKey: `${batchKey}:${product.id}`,
            });
          }
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Inventário/balanço de estoque',
            details: `${diffs.length} produto(s) ajustado(s) por contagem física. ${note}.`,
            entity: 'inventory', entityId: '',
          });
          showToast(`Inventário aplicado: ${diffs.length} produto(s) ajustado(s).`, 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  refresh();

  // Limpeza do listener em document/window do menu "Opções" (ver
  // closeOptionsMenuOnOutsideClick acima) — sem isto, cada visita à tela
  // Estoque empilharia mais um listener fantasma (o roteador recria a tela
  // do zero a cada troca de menu, mas nunca limpa nada em document/window
  // sozinho — precisa devolver esta função pra ele chamar ao sair, mesmo
  // padrão já usado em sale.js/ajuda.js).
  return () => {
    document.removeEventListener('click', closeOptionsMenuOnOutsideClick);
    window.removeEventListener('scroll', closeOptionsMenu, true);
    closeOptionsMenu();
  };
}

/** Formulário de cadastro/edição de produto — vive fora de renderProducts
 * (exportado) porque também é aberto pelo modal de "código não cadastrado"
 * (promptUnknownBarcode, logo abaixo) tanto daqui quanto do PDV
 * (views/sale.js), então recebe `ctx` explicitamente em vez de depender de
 * uma closure de tela específica. `onSaved(record)` roda depois de gravar
 * com sucesso — cada chamador decide o que fazer com o produto salvo
 * (recarregar a tabela, já jogar no carrinho da venda etc.). */
async function openProductModal(ctx, { product = null, initialBarcode = '', onSaved } = {}) {
  const isEdit = !!product;
  const isCustomEdit = isEdit && product.unit === CUSTOM_UNIT_VALUE;
  const suppliers = await listSuppliers();
  // Estado das formas de venda (só usado em modo Personalizado) — vive fora
  // do bodyHtml (que é só a foto inicial) porque + e ✕ mexem na lista sem
  // reconstruir o formulário inteiro (perderia o foco/valor dos outros
  // campos digitados). Pré-carrega do produto se já for personalizado; senão
  // começa com 1 linha em branco, mas só quando o formulário abrir já em
  // modo Personalizado — trocar PRA personalizado depois de aberto também
  // semeia essa 1ª linha (ver onMount).
  let formRows = isCustomEdit
    ? product.customForms.map((f) => ({ ...f }))
    : [];
  openModal({
    title: isEdit ? 'Editar produto' : 'Novo produto',
    submitLabel: isEdit ? 'Salvar alterações' : 'Cadastrar produto',
    wide: true,
    bodyHtml: `
      <div id="modal-error"></div>
      <div class="field">
        <label>Nome do produto *</label>
        <input id="f-name" value="${isEdit ? escapeHtml(product.name) : ''}">
      </div>
      <div class="form-row">
        <div class="field">
          <label>Categoria *</label>
          <select id="f-category">
            <option value="material" ${!isEdit || product.category === 'material' ? 'selected' : ''}>Material de construção</option>
            <option value="mercearia" ${isEdit && product.category === 'mercearia' ? 'selected' : ''}>Mercearia</option>
          </select>
        </div>
        <div class="field">
          <label>Unidade</label>
          <select id="f-unit">${UNITS.map((u) => `<option value="${u.value}" ${isEdit && product.unit === u.value ? 'selected' : ''}>${u.label}</option>`).join('')}<option value="${CUSTOM_UNIT_VALUE}" ${isCustomEdit ? 'selected' : ''}>Personalizado (várias formas de venda)</option></select>
        </div>
      </div>
      <div class="field">
        <label>Código de barras *</label>
        <div style="display:flex;gap:8px;">
          <input id="f-barcode" style="flex:1;" value="${isEdit ? escapeHtml(product.barcode) : escapeHtml(initialBarcode)}" placeholder="Escaneie ou digite o código">
          <button type="button" class="btn btn-secondary btn-sm" id="gen-barcode-btn">Gerar código interno</button>
        </div>
        <span class="hint">Sem código de fábrica (ex: item a granel)? Gere um código interno.</span>
      </div>
      <div class="form-row" id="normal-price-row">
        <div class="field">
          <label>Preço de venda (R$) *</label>
          <input id="f-price" type="number" step="0.01" min="0" value="${isEdit ? product.price : ''}">
        </div>
        <div class="field">
          <label>Preço de custo (R$)</label>
          <input id="f-cost" type="number" step="0.01" min="0" value="${isEdit ? product.costPrice : ''}">
        </div>
      </div>
      <div class="field" id="custom-unit-label-field" style="display:none;">
        <label>Unidade de medida raiz *</label>
        <select id="f-custom-unit-label-select">${UNITS.map((u) => `<option value="${u.value}" ${isCustomEdit && product.customUnitLabel === u.value ? 'selected' : ''}>${u.label}</option>`).join('')}<option value="__custom__" ${isCustomEdit && !UNITS.some((u) => u.value === product.customUnitLabel) ? 'selected' : ''}>Outra (digite abaixo)</option></select>
        <input id="f-custom-unit-label-text" placeholder="Ex: lata" style="display:none;margin-top:6px;" value="${isCustomEdit && !UNITS.some((u) => u.value === product.customUnitLabel) ? escapeHtml(product.customUnitLabel || '') : ''}">
        <span class="hint">Em que você mede esse produto no depósito? Ex: lata, saco, m³. As formas de venda abaixo derivam dessa unidade de medida.</span>
      </div>
      <div class="form-row">
        ${isEdit ? '' : `
        <div class="field">
          <label>Quantidade inicial em estoque *</label>
          <input id="f-quantity" type="number" step="0.5" min="0" value="0">
        </div>`}
        <div class="field">
          <label>Estoque mínimo (alerta)</label>
          <input id="f-min" type="number" step="0.5" min="0" value="${isEdit ? product.minStock : 0}">
        </div>
      </div>
      <div class="field">
        <label>Fornecedor padrão</label>
        <select id="f-supplier">
          <option value="">Nenhum</option>
          ${suppliers.map((s) => `<option value="${s.id}" ${isEdit && product.supplierId === s.id ? 'selected' : ''}>${escapeHtml(s.nome)}</option>`).join('')}
        </select>
        <span class="hint">Usado pra agrupar a sugestão automática de compra em Compras → Sugestão.</span>
      </div>

      <div id="custom-forms-section" style="display:none;">
        <p class="section-title">Formas de venda</p>
        <p class="text-muted" style="font-size:12.5px;margin-top:-8px;">
          Um produto pode ser vendido de formas diferentes (ex: areia à lata, ao metro, à carrada), cada forma com seu
          próprio preço e custo. Na <strong>Equivalência</strong>, preencha as duas caixas com uma conta que você já
          sabe — ex: 1 metro de areia enche 56 latas — e o app calcula o resto sozinho. No PDV, o vendedor só escolhe
          qual forma vendeu. É possível cadastrar até ${MAX_CUSTOM_FORMS} formas diferentes de vender um único produto.
        </p>
        <div id="custom-forms-rows"></div>
        <button type="button" class="btn btn-secondary btn-sm" id="add-form-row-btn" style="margin-top:6px;">+ Forma de venda</button>
      </div>

      <div id="expiry-section">
        <p class="section-title section-title-row">
          Validade e promoção por vencimento
          <button type="button" class="btn btn-ghost help-btn-inline" id="expiry-help-btn" title="Como escolher os dias e o desconto">?</button>
        </p>
        <p class="text-muted" style="font-size:12.5px;margin-top:-8px;">
          Opcional. Preenchendo os três campos abaixo, o produto passa a vender sozinho pelo preço promocional quando
          estiver perto de vencer — no PDV (bipando ou buscando por nome) e com a etiqueta "Próximo da validade" no Painel.
        </p>
        <div class="form-row">
          <div class="field">
            <label>Data de validade</label>
            <input id="f-expiry-date" type="date" value="${isEdit && product.expiryDate ? product.expiryDate : ''}">
          </div>
          <div class="field">
            <label>Dias de antecedência</label>
            <input id="f-expiry-days" type="number" min="0" step="1" placeholder="Ex: 7" value="${isEdit && product.expiryPromoDays != null ? product.expiryPromoDays : ''}">
            <span class="hint">Quantos dias antes de vencer já entra em promoção.</span>
          </div>
          <div class="field">
            <label>Preço promocional (R$)</label>
            <input id="f-promo-price" type="number" step="0.01" min="0" value="${isEdit && product.promoPrice != null ? product.promoPrice : ''}">
          </div>
        </div>
      </div>
    `,
    onMount: (modalEl) => {
      modalEl.querySelector('#gen-barcode-btn').addEventListener('click', () => {
        modalEl.querySelector('#f-barcode').value = generateInternalBarcode();
      });
      modalEl.querySelector('#expiry-help-btn').addEventListener('click', () => openExpiryHelpModal());

      const unitSelect = modalEl.querySelector('#f-unit');
      const normalPriceRow = modalEl.querySelector('#normal-price-row');
      const customUnitLabelField = modalEl.querySelector('#custom-unit-label-field');
      const customUnitLabelSelect = modalEl.querySelector('#f-custom-unit-label-select');
      const customUnitLabelText = modalEl.querySelector('#f-custom-unit-label-text');
      const customFormsSection = modalEl.querySelector('#custom-forms-section');
      const customFormsRows = modalEl.querySelector('#custom-forms-rows');
      const expirySection = modalEl.querySelector('#expiry-section');
      const addFormRowBtn = modalEl.querySelector('#add-form-row-btn');

      // "Outra" na unidade raiz (ex: "lata", que não é uma das siglas
      // padrão) revela o campo de texto livre — mesma ideia do próprio
      // <select> de Unidade lá em cima, que revela a seção de Personalizado.
      function syncCustomUnitLabelMode() {
        customUnitLabelText.style.display = customUnitLabelSelect.value === '__custom__' ? '' : 'none';
        refreshRootUnitCaptions();
      }
      customUnitLabelSelect.addEventListener('change', syncCustomUnitLabelMode);
      customUnitLabelText.addEventListener('input', refreshRootUnitCaptions);
      syncCustomUnitLabelMode();

      function currentRootUnitLabel() {
        const v = customUnitLabelSelect.value;
        const label = (v === '__custom__' ? customUnitLabelText.value : v).trim();
        return label || 'unidade';
      }

      // Acha o fator de conversão (o único número que de fato é salvo, ver
      // productsRepo.js#parseCustomForms) a partir das duas caixas "N forma =
      // M unidade raiz" — acha do usuário: pedir esse fator pronto ("1
      // Carrada = quantas latas?") exigia conta de cabeça de quem cadastra.
      // Agora a pessoa informa uma contagem que já fez na vida real (ex: "1
      // metro de areia enche 56 latas") e a divisão fica por conta do app.
      function computeFatorFromEquiv(n, mRaw) {
        const nn = Number(n);
        if (!Number.isFinite(nn) || nn <= 0) return null;
        if (mRaw === '' || mRaw === null || mRaw === undefined) return null;
        const mm = Number(mRaw);
        if (!Number.isFinite(mm)) return null;
        return mm / nn;
      }

      // Recalcula e reescreve na tela (sem re-renderizar a linha inteira,
      // que perderia o foco de quem está digitando) o fator + a frase
      // derivada de UMA linha, a partir do estado atual das duas caixas.
      function updateEquivRow(idx) {
        const nInput = customFormsRows.querySelector(`[data-equiv-input="${idx}"][data-equiv-side="n"]`);
        const mInput = customFormsRows.querySelector(`[data-equiv-input="${idx}"][data-equiv-side="m"]`);
        const derivedEl = customFormsRows.querySelector(`[data-equiv-derived="${idx}"]`);
        if (!nInput || !mInput || !derivedEl || !formRows[idx]) return;
        // 0,5 é o mínimo (não 1 inteiro): material de construção também
        // vende em meios — "0,5 metro de areia" é uma quantidade real, não
        // uma exceção — achado do usuário.
        const nRaw = Number(nInput.value);
        const n = Number.isFinite(nRaw) && nRaw >= EQUIV_N_MIN ? nRaw : EQUIV_N_MIN;
        nInput.value = n;
        const mRaw = mInput.value;
        formRows[idx].equivN = n;
        formRows[idx].equivM = mRaw;
        const fator = computeFatorFromEquiv(n, mRaw);
        if (fator === null) {
          formRows[idx].fator = '';
          derivedEl.textContent = '→ informe quanto essa quantidade rende, do lado direito';
          derivedEl.classList.add('equiv-warn');
          return;
        }
        formRows[idx].fator = fator;
        derivedEl.classList.remove('equiv-warn');
        const formaLabel = (formRows[idx].forma || '').trim() || 'forma';
        derivedEl.textContent = `→ cada 1 ${formaLabel} equivale a ${formatQty(fator)} ${currentRootUnitLabel()}`;
      }

      // Unidade de medida raiz mudou (ex: de "lata" pra "saco") — atualiza a
      // legenda do lado direito de TODAS as linhas de uma vez, já que é
      // compartilhada por todas as formas de venda deste produto.
      function refreshRootUnitCaptions() {
        const label = currentRootUnitLabel();
        customFormsRows.querySelectorAll('[data-equiv-caption-side="m"]').forEach((el) => { el.textContent = label; });
        formRows.forEach((_, i) => updateEquivRow(i));
      }

      function renderFormRows() {
        customFormsRows.innerHTML = formRows.map((row, i) => {
          const n = row.equivN ?? 1;
          const m = row.equivM ?? (row.fator ?? '');
          return `
          <div class="custom-form-card">
            <div class="form-row" style="align-items:flex-end;gap:8px;margin-bottom:10px;">
              <div class="field" style="margin-bottom:0;">
                <label>Forma *</label>
                <input data-form-field="forma" data-form-idx="${i}" placeholder="Ex: Carrada" value="${escapeHtml(row.forma || '')}">
              </div>
              <div class="field" style="margin-bottom:0;">
                <label>Valor de venda (R$) *</label>
                <input type="number" step="0.01" min="0" data-form-field="valor" data-form-idx="${i}" value="${row.valor ?? ''}">
              </div>
              <div class="field" style="margin-bottom:0;">
                <label>Custo (R$) *</label>
                <input type="number" step="0.01" min="0" data-form-field="custo" data-form-idx="${i}" value="${row.custo ?? ''}">
              </div>
              <button type="button" class="btn btn-ghost btn-sm" data-remove-form-row="${i}" title="Remover esta forma">${icon('close', { size: 13 })}</button>
            </div>
            <label class="equiv-label">Equivalência *</label>
            <div class="equiv-equation">
              <div class="equiv-stepper-group">
                <div class="equiv-stepper">
                  <button type="button" data-equiv-step="${i}" data-equiv-side="n" data-equiv-dir="-${EQUIV_N_STEP}" aria-label="Diminuir quantidade">−</button>
                  <input type="number" step="${EQUIV_N_STEP}" min="${EQUIV_N_MIN}" data-equiv-input="${i}" data-equiv-side="n" value="${escapeHtml(String(n))}" inputmode="decimal">
                  <button type="button" data-equiv-step="${i}" data-equiv-side="n" data-equiv-dir="${EQUIV_N_STEP}" aria-label="Aumentar quantidade">+</button>
                </div>
                <span class="equiv-unit-caption" data-equiv-caption="${i}" data-equiv-caption-side="n">${escapeHtml((row.forma || 'forma').trim() || 'forma')}</span>
              </div>
              <span class="equiv-eq-sign">=</span>
              <div class="equiv-stepper-group">
                <div class="equiv-stepper">
                  <button type="button" data-equiv-step="${i}" data-equiv-side="m" data-equiv-dir="-1" aria-label="Diminuir quantidade">−</button>
                  <input type="number" step="any" data-equiv-input="${i}" data-equiv-side="m" value="${escapeHtml(String(m))}" inputmode="numeric" placeholder="Ex: 40">
                  <button type="button" data-equiv-step="${i}" data-equiv-side="m" data-equiv-dir="1" aria-label="Aumentar quantidade">+</button>
                </div>
                <span class="equiv-unit-caption" data-equiv-caption="${i}" data-equiv-caption-side="m">${escapeHtml(currentRootUnitLabel())}</span>
              </div>
            </div>
            <p class="equiv-derived" data-equiv-derived="${i}"></p>
          </div>
        `;
        }).join('');
        customFormsRows.querySelectorAll('[data-form-field]').forEach((input) => {
          input.addEventListener('input', () => {
            const idx = Number(input.dataset.formIdx);
            formRows[idx][input.dataset.formField] = input.value;
            if (input.dataset.formField === 'forma') {
              const caption = customFormsRows.querySelector(`[data-equiv-caption="${idx}"][data-equiv-caption-side="n"]`);
              if (caption) caption.textContent = input.value.trim() || 'forma';
              updateEquivRow(idx);
            }
          });
        });
        customFormsRows.querySelectorAll('[data-remove-form-row]').forEach((btn) => {
          btn.addEventListener('click', () => {
            formRows.splice(Number(btn.dataset.removeFormRow), 1);
            renderFormRows();
          });
        });
        customFormsRows.querySelectorAll('[data-equiv-input]').forEach((input) => {
          input.addEventListener('input', () => updateEquivRow(Number(input.dataset.equivInput)));
        });
        customFormsRows.querySelectorAll('[data-equiv-step]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.equivStep);
            const side = btn.dataset.equivSide;
            const dir = Number(btn.dataset.equivDir);
            const input = customFormsRows.querySelector(`[data-equiv-input="${idx}"][data-equiv-side="${side}"]`);
            // Lado N mexe em meios (0,5 em 0,5 — "0,5 metro de areia" é uma
            // quantidade real em material de construção); lado M continua
            // em inteiros (não costuma vender "meia lata"). Arredonda pra 2
            // casas só pra limpar sobra de ponto flutuante (0.1 + 0.2 etc.).
            const min = side === 'n' ? EQUIV_N_MIN : 0;
            const currentRaw = Number(input.value);
            const current = Number.isFinite(currentRaw) ? currentRaw : min;
            const next = Math.round((current + dir) * 100) / 100;
            input.value = Math.max(min, next);
            updateEquivRow(idx);
          });
        });
        addFormRowBtn.disabled = formRows.length >= MAX_CUSTOM_FORMS;
        formRows.forEach((_, i) => updateEquivRow(i));
      }
      addFormRowBtn.addEventListener('click', () => {
        if (formRows.length >= MAX_CUSTOM_FORMS) return;
        formRows.push({ forma: '', valor: '', custo: '', fator: '' });
        renderFormRows();
      });

      function syncUnitMode() {
        const isCustom = unitSelect.value === CUSTOM_UNIT_VALUE;
        normalPriceRow.style.display = isCustom ? 'none' : '';
        customUnitLabelField.style.display = isCustom ? '' : 'none';
        customFormsSection.style.display = isCustom ? '' : 'none';
        expirySection.style.display = isCustom ? 'none' : '';
        if (isCustom && formRows.length === 0) {
          formRows.push({ forma: '', valor: '', custo: '', fator: '' });
          renderFormRows();
        }
      }
      unitSelect.addEventListener('change', syncUnitMode);
      renderFormRows();
      syncUnitMode();
    },
    onSubmit: async (modalEl) => {
      const errBox = modalEl.querySelector('#modal-error');
      errBox.innerHTML = '';
      const name = modalEl.querySelector('#f-name').value.trim();
      const barcode = modalEl.querySelector('#f-barcode').value.trim();
      const unit = modalEl.querySelector('#f-unit').value;
      const isCustom = unit === CUSTOM_UNIT_VALUE;
      if (!name || !barcode) {
        errBox.innerHTML = '<div class="form-error">Preencha nome e código de barras.</div>';
        return false;
      }
      const price = modalEl.querySelector('#f-price').value;
      if (!isCustom && price === '') {
        errBox.innerHTML = '<div class="form-error">Preencha o preço de venda.</div>';
        return false;
      }
      // "Outra" no <select> usa o texto livre do lado; qualquer outra opção
      // já É o valor final (a sigla escolhida, ex: "kg") — mesmo padrão do
      // <select> de Unidade lá em cima revelando o modo Personalizado.
      const rootUnitSelectValue = modalEl.querySelector('#f-custom-unit-label-select').value;
      const customUnitLabel = rootUnitSelectValue === '__custom__'
        ? modalEl.querySelector('#f-custom-unit-label-text').value.trim()
        : rootUnitSelectValue;
      if (isCustom && !customUnitLabel) {
        errBox.innerHTML = '<div class="form-error">Informe o nome da unidade de medida raiz (ex: lata).</div>';
        return false;
      }
      if (isCustom && formRows.length === 0) {
        errBox.innerHTML = '<div class="form-error">Cadastre ao menos uma forma de venda.</div>';
        return false;
      }
      const expiryDate = isCustom ? '' : (modalEl.querySelector('#f-expiry-date').value || '');
      const expiryDays = isCustom ? '' : modalEl.querySelector('#f-expiry-days').value;
      const promoPrice = isCustom ? '' : modalEl.querySelector('#f-promo-price').value;
      if (!isCustom && !expiryDate && (expiryDays !== '' || promoPrice !== '')) {
        errBox.innerHTML = '<div class="form-error">Preencha a data de validade pra usar dias de antecedência ou preço promocional.</div>';
        return false;
      }
      if (!isCustom && expiryDate && (expiryDays === '' || promoPrice === '')) {
        errBox.innerHTML = '<div class="form-error">Com validade preenchida, informe também os dias de antecedência e o preço promocional — ou deixe os três em branco.</div>';
        return false;
      }
      const data = {
        name,
        category: modalEl.querySelector('#f-category').value,
        unit,
        barcode,
        barcodeIsInternal: barcode.startsWith('INT'),
        price,
        costPrice: modalEl.querySelector('#f-cost').value,
        minStock: modalEl.querySelector('#f-min').value,
        supplierId: modalEl.querySelector('#f-supplier').value || null,
        expiryDate: expiryDate || null,
        expiryPromoDays: expiryDays,
        promoPrice,
        customUnitLabel: isCustom ? customUnitLabel : null,
        // Só os 4 campos que o produto de fato guarda — equivN/equivM são
        // estado só-de-tela das duas caixas "N forma = M unidade raiz", já
        // reduzidas a `fator` aqui; não fazem sentido fora do formulário aberto.
        customForms: isCustom ? formRows.map(({ forma, valor, custo, fator }) => ({ forma, valor, custo, fator })) : null,
      };
      try {
        let record;
        if (isEdit) {
          record = await updateProduct(product.id, data);
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Edição de produto',
            details: `Produto "${name}" (código ${barcode}) editado.`,
            entity: 'product', entityId: product.id,
          });
          showToast('Produto atualizado.', 'success');
        } else {
          data.quantity = modalEl.querySelector('#f-quantity').value;
          record = await createProduct(data);
          if (Number(data.quantity) > 0) {
            await recordMovement({
              productId: record.id, type: 'entrada', qty: Number(data.quantity),
              userId: ctx.user.id, userName: ctx.user.nome, note: 'Estoque inicial no cadastro do produto',
            });
          }
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Cadastro de produto',
            details: `Produto "${name}" (código ${barcode}) cadastrado.`,
            entity: 'product', entityId: record.id,
          });
          showToast('Produto cadastrado.', 'success');
        }
        onSaved?.(record);
        return true;
      } catch (err) {
        errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
        return false;
      }
    },
  });
}

/** Referência de mercado (faixas típicas por categoria de produto) pra
 * ajudar a preencher "Dias de antecedência" e decidir o preço promocional —
 * só texto informativo, o sistema não usa esses números pra nada sozinho,
 * quem decide os valores de cada produto é sempre quem cadastra. */
function openExpiryHelpModal() {
  const rows = [
    {
      title: 'Ultra-perecíveis — carnes, peixes, padaria própria',
      prazo: 'Geralmente de 3 a 10 dias.',
      gatilho: '2 a 3 dias antes do vencimento.',
      estrategia: 'Desconto agressivo direto (40% a 50%) ou queima total no último dia (70%).',
    },
    {
      title: 'Perecíveis resfriados — laticínios, embutidos, massas frescas',
      prazo: 'Geralmente de 30 a 45 dias.',
      gatilho: '5 a 7 dias antes do vencimento.',
      estrategia: 'Desconto progressivo — ex: 30% com 7 dias, 50% com 3 dias, 70% no penúltimo dia.',
    },
    {
      title: 'Mercearia seca comercial — biscoitos, snacks, bebidas, molhos, chocolates',
      prazo: 'Geralmente de 6 a 12 meses.',
      gatilho: '15 a 30 dias antes do vencimento.',
      estrategia: 'Começa com 20% a 30% pra desovar o lote antes da quinzena final.',
    },
    {
      title: 'Mercearia pesada e enlatados — arroz, feijão, conservas, óleos',
      prazo: 'Geralmente superior a 1 ano.',
      gatilho: '30 a 45 dias antes do vencimento.',
      estrategia: 'Geralmente entra em promoções tipo "Leve 3 pague 2" ou desconto de 20% a 40%.',
    },
  ];
  openModal({
    title: 'Guia de referência — validade e promoção',
    submitLabel: 'Fechar',
    singleButton: true,
    wide: true,
    bodyHtml: `
      <p class="text-muted" style="font-size:13px;">
        Faixas de mercado só pra orientar o preenchimento dos campos "Dias de antecedência" e "Preço promocional" —
        nada aqui é aplicado sozinho, quem decide os números de cada produto é sempre você.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Categoria</th><th>Prazo total típico</th><th>Gatilho sugerido</th><th>Estratégia de desconto</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${escapeHtml(r.title)}</td>
                <td>${escapeHtml(r.prazo)}</td>
                <td>${escapeHtml(r.gatilho)}</td>
                <td>${escapeHtml(r.estrategia)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `,
    onSubmit: () => true,
  });
}

/** "Esse código não é de nenhum produto cadastrado — o que fazer?" — usado
 * tanto aqui (bipe/Enter na busca do Estoque) quanto em views/sale.js (bipe
 * no PDV), sempre que um código não corresponde a nenhum produto existente.
 * Quem não tem a permissão 'manageProducts' só vê a explicação, sem a opção
 * de cadastrar — a mesma trava já existe no repositório (ver
 * data/productsRepo.js#createProduct), isto aqui só evita oferecer um botão
 * que ia falhar na hora de salvar. */
export function promptUnknownBarcode(ctx, code, { onRegistered } = {}) {
  if (!userCan(ctx.user, 'manageProducts')) {
    openModal({
      title: 'Produto não cadastrado',
      submitLabel: 'Entendi',
      singleButton: true,
      bodyHtml: `<p>O código <strong>${escapeHtml(code)}</strong> não corresponde a nenhum produto cadastrado. Peça a um administrador (ou a alguém com permissão de cadastrar produtos) para cadastrá-lo.</p>`,
      onSubmit: () => true,
    });
    return;
  }
  openModal({
    title: 'Produto não cadastrado',
    submitLabel: 'Cadastrar produto',
    cancelLabel: 'Ignorar',
    bodyHtml: `<p>O código <strong>${escapeHtml(code)}</strong> não corresponde a nenhum produto cadastrado. Deseja cadastrá-lo agora?</p>`,
    onSubmit: () => {
      openProductModal(ctx, { initialBarcode: code, onSaved: onRegistered });
      return true;
    },
  });
}

function renderTable(products, flags) {
  const { canManageProducts, canAdjustStock, canToggleProduct, canDeleteProduct } = flags;
  // Editar/Ajustar/Inativar-Reativar/Excluir viraram um único botão
  // "Opções" (ver openOptionsMenuFor) — só aparece se sobrar pelo menos UMA
  // dessas ações pro usuário logado (mesma regra de antes, quando cada uma
  // era um botão próprio: sem nenhuma permissão, a linha só mostra
  // "Histórico", que continua liberado pra todo mundo).
  const hasAnyOption = canManageProducts || canAdjustStock || canToggleProduct || canDeleteProduct;
  if (products.length === 0) return '<div class="table-wrap"><div class="table-empty">Nenhum produto encontrado.</div></div>';
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="min-width:200px;">Produto</th><th>Categoria</th><th style="text-align:center;">Código</th><th>Preço</th><th>Estoque</th><th style="text-align:center;">Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${products.map((p) => `
            <tr class="${p.active && p.quantity <= p.minStock ? 'low-stock-row' : ''}">
              <td>${escapeHtml(p.name)}</td>
              <td>${p.category === 'material' ? 'Material' : 'Mercearia'}</td>
              <td style="text-align:center;">${p.barcodeIsInternal
                ? `<div>${escapeHtml(p.barcode)}</div><span class="badge badge-gray" style="margin-top:2px;">interno</span>`
                : escapeHtml(p.barcode)}</td>
              <td>${priceCell(p)}</td>
              <td>${formatQty(p.quantity)} ${escapeHtml(displayUnit(p))}</td>
              <td style="text-align:center;">${statusBadge(p)}</td>
              <td style="white-space:nowrap;">
                <button class="btn btn-ghost btn-sm" data-history="${p.id}">Histórico</button>
                ${hasAnyOption ? `<button class="btn btn-ghost btn-sm" data-options="${p.id}">Opções</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/** Achado de auditoria: produto 'personalizado' sempre grava `price: 0`
 * (não tem UM preço — cada forma de venda tem o seu, ver
 * data/productsRepo.js#resolveCustomUnitFields) — sem este caso à parte, a
 * coluna Preço da tabela de Estoque mostrava "R$ 0,00" pra TODO produto
 * personalizado, dando a entender que ele estava com preço zerado/quebrado.
 * Mostra a faixa de valores das formas cadastradas em vez disso (só o valor
 * quando todas as formas têm o mesmo preço). */
function priceCell(p) {
  if (p.unit === CUSTOM_UNIT_VALUE) {
    const forms = p.customForms || [];
    if (forms.length === 0) return '—';
    const values = forms.map((f) => f.valor);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max ? formatMoney(min) : `${formatMoney(min)} – ${formatMoney(max)}`;
  }
  if (!isNearExpiry(p)) return formatMoney(p.price);
  return `
    <div style="text-decoration:line-through;color:var(--text-muted);font-size:12px;">${formatMoney(p.price)}</div>
    <div>${formatMoney(p.promoPrice)}</div>
  `;
}

function statusBadge(p) {
  const availability = !p.active
    ? '<span class="badge badge-gray">Inativo</span>'
    : p.quantity <= p.minStock
      ? '<span class="badge badge-red">Estoque baixo</span>'
      : '<span class="badge badge-green">Disponível</span>';
  const expiryBadge = isExpired(p)
    ? '<span class="badge badge-red" style="margin-top:2px;">Fora da validade</span>'
    : isNearExpiry(p)
      ? '<span class="badge badge-gold" style="margin-top:2px;">Próximo da validade</span>'
      : '';
  if (!expiryBadge) return availability;
  return `<div>${availability}</div>${expiryBadge}`;
}
