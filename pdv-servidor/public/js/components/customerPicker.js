// Campo de "cliente" repetido em Nova venda e Carreto: busca por nome/
// telefone (chamando searchCustomers no banco, com debounce de 220ms),
// permite cadastrar um cliente novo na hora a partir do termo buscado, e
// mostra o escolhido como um cartão com botão "Trocar". O Histórico de
// vendas tem um widget PARECIDO mas deliberadamente mais simples — é um
// FILTRO sobre uma lista já carregada em memória (sem busca no banco, sem
// debounce, sem cadastro rápido, sem saldo, e troca o cliente na hora,
// sem passo de confirmação) — não foi unificado aqui de propósito: forçar
// as duas formas na mesma função pioraria a legibilidade de ambas.
//
// `getSelected`/`setSelected` deixam o estado "cliente selecionado" morar
// no closure de quem chama, porque cada tela guarda isso ao lado de outro
// estado próprio (ex: o carreto também guarda o endereço de entrega ligado
// ao cliente escolhido). `onPicked`, opcional, roda toda vez que um
// cliente é selecionado OU cadastrado na hora (não ao clicar em "Trocar")
// — usado só pelo Carreto, pra pré-preencher o endereço de entrega.
import { searchCustomers, createCustomer, getCustomerBalance } from '../data/customersRepo.js';
import { formatPhoneBR } from '../utils/phone.js';
import { formatMoney, escapeHtml } from '../utils/format.js';
import { showToast } from './toast.js';

export async function renderCustomerPicker(box, { getSelected, setSelected, showBalance = false, onPicked }) {
  const selectedCustomer = getSelected();
  if (!selectedCustomer) {
    box.innerHTML = `
      <input type="text" id="customer-search" class="customer-search-input" placeholder="Buscar cliente por nome ou telefone…">
      <div id="customer-results"></div>
    `;
    const searchInput = box.querySelector('#customer-search');
    const resultsDiv = box.querySelector('#customer-results');
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      const term = searchInput.value.trim();
      if (term.length < 2) { resultsDiv.innerHTML = ''; return; }
      debounce = setTimeout(async () => {
        const matches = await searchCustomers(term);
        resultsDiv.innerHTML = `
          <div class="table-wrap" style="margin-top:8px;">
            <table><tbody>
              ${matches.slice(0, 6).map((c) => `
                <tr>
                  <td>${escapeHtml(c.nome)}</td>
                  <td class="text-muted">${escapeHtml(formatPhoneBR(c.telefone) || '—')}</td>
                  <td><button type="button" class="btn btn-sm" data-pick-customer="${c.id}">Selecionar</button></td>
                </tr>
              `).join('')}
              <tr>
                <td colspan="3">
                  <button type="button" class="btn btn-ghost btn-sm" id="quick-new-customer">+ Cadastrar "${escapeHtml(term)}" como novo cliente</button>
                </td>
              </tr>
            </tbody></table>
          </div>
        `;
        resultsDiv.querySelectorAll('[data-pick-customer]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const customer = matches.find((c) => c.id === btn.dataset.pickCustomer);
            setSelected(customer);
            onPicked?.(customer);
            await renderCustomerPicker(box, { getSelected, setSelected, showBalance, onPicked });
          });
        });
        resultsDiv.querySelector('#quick-new-customer').addEventListener('click', async () => {
          try {
            const customer = await createCustomer({ nome: term });
            setSelected(customer);
            onPicked?.(customer);
            await renderCustomerPicker(box, { getSelected, setSelected, showBalance, onPicked });
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      }, 220);
    });
  } else {
    const balance = showBalance ? await getCustomerBalance(selectedCustomer.id) : 0;
    box.innerHTML = `
      <div class="cart-item" style="padding:8px 0;">
        <div style="flex:1;">
          <div class="name">${escapeHtml(selectedCustomer.nome)}</div>
          <div class="meta">${escapeHtml(formatPhoneBR(selectedCustomer.telefone) || 'sem telefone')}${showBalance && balance > 0.01 ? ` · deve ${formatMoney(balance)}` : ''}</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="clear-customer-btn" type="button">Trocar</button>
      </div>
    `;
    box.querySelector('#clear-customer-btn').addEventListener('click', async () => {
      setSelected(null);
      await renderCustomerPicker(box, { getSelected, setSelected, showBalance, onPicked });
    });
  }
}
