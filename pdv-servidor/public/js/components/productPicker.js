// Campo de "buscar produto do estoque" repetido em linhas de item de
// Carreto e de Pedido de compra: input de texto com debounce de 200ms
// chamando searchProducts, lista de até 6 resultados como botões-ghost, e
// ao clicar preenche o campo hidden de id + o próprio texto de busca com o
// nome escolhido (exige reselecionar se o texto mudar depois, por isso
// hiddenId é limpo a cada tecla digitada).
//
// O Carreto guarda campos extras que o Pedido de compra não usa (unidade
// do produto, pra mostrar "un"/"kg"/etc. na linha) — por isso o produto
// inteiro (não só id/nome) é passado pro `onPick` opcional, e quem chamar
// decide o que fazer com ele. O Pedido de compra não passa `onPick`.
import { searchProducts } from '../data/productsRepo.js';
import { escapeHtml } from '../utils/format.js';

export function wireProductPicker(modalEl, idx, { onPick } = {}) {
  const searchInput = modalEl.querySelector(`[data-item-search="${idx}"]`);
  const resultsDiv = modalEl.querySelector(`[data-item-results="${idx}"]`);
  const hiddenId = modalEl.querySelector(`[data-item-product-id="${idx}"]`);
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    const term = searchInput.value.trim();
    hiddenId.value = ''; // exige reselecionar se o texto mudou
    if (term.length < 2) { resultsDiv.innerHTML = ''; return; }
    debounce = setTimeout(async () => {
      const matches = await searchProducts(term);
      resultsDiv.innerHTML = matches.slice(0, 6).map((p) => `
        <div class="btn btn-ghost btn-sm" data-pick-product="${p.id}" style="display:block;text-align:left;cursor:pointer;">${escapeHtml(p.name)}</div>
      `).join('');
      resultsDiv.querySelectorAll('[data-pick-product]').forEach((el) => {
        el.addEventListener('click', () => {
          const product = matches.find((p) => p.id === el.dataset.pickProduct);
          hiddenId.value = product.id;
          searchInput.value = product.name;
          resultsDiv.innerHTML = '';
          onPick?.(product);
        });
      });
    }, 200);
  });
}
