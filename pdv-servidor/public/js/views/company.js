// Política de venda da loja (desconto máximo do vendedor, exigir caixa
// aberto pra vender, juro do parcelamento no cartão de crédito) — versão
// enxuta de views/company.js da extensão, que mistura essa política com
// cadastro da loja (cnpj, endereço) e ATIVAÇÃO DE LICENÇA (trial/demo,
// chave de ativação). O servidor multi-terminal não tem esse conceito de
// licença (ver README) — então só a parte de política, sem equivalente
// nenhum em licenciamento, foi portada aqui. `routes/company.js` já
// existia desde a Fase 8 (escrita/leitura), só faltava esta tela pra
// editar sem precisar chamar a API na unha.
//
// Mesmo padrão de gate já testado em relatorios.js/logs.js/financeiro.js/
// backup.js: o MENU esconde este link de quem não tem a permissão
// 'empresa' (ver ROUTES em app.js), mas a tela em si renderiza pra
// qualquer um que chegue aqui por link direto — a permissão de verdade é
// sempre conferida no servidor (routes/company.js#PUT), nunca só na tela.
import { getCompany, saveCompany } from '../data/companyRepo.js';
import { MAX_INSTALLMENTS } from '../utils/pricing.js';
import { showToast } from '../components/toast.js';
import { icon } from '../components/icon.js';
import { escapeHtml } from '../utils/format.js';

export async function renderCompany(container, ctx) {
  let policies = ctx.company.policies;

  function html() {
    const ci = policies.creditInterest || {};
    return `
      <div class="page-header">
        <div>
          <h1>${icon('store', { size: 22 })} Dados da loja</h1>
          <div class="desc">Política de venda desta loja — vale pra todos os terminais, na hora.</div>
        </div>
      </div>
      <div class="card" style="max-width:560px;">
        <form id="company-form">
          <div id="company-form-error"></div>

          <p class="section-title mt-0">Políticas de venda</p>
          <div class="field" style="max-width:320px;">
            <label for="vendorMaxDiscount">Desconto máximo do vendedor sem aprovação (%)</label>
            <input id="vendorMaxDiscount" type="number" min="0" max="100" step="0.5" value="${policies.vendorMaxDiscountPercent ?? 10}">
            <span class="hint">Acima disso, a venda só finaliza com a senha de um administrador (ou de quem tiver a permissão "desconto sem limite").</span>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;margin:6px 0 16px;">
            <input type="checkbox" id="requireCashSession" ${policies.requireOpenCashSession ? 'checked' : ''}>
            Exigir caixa aberto para registrar vendas
          </label>

          <p class="section-title">Juros no parcelamento do cartão de crédito</p>
          <p class="text-muted" style="font-size:12.5px;margin-top:-8px;">
            Configurado só aqui — o vendedor nunca vê nem edita essa taxa na hora da venda, ela entra sozinha ao escolher Cartão de crédito e o número de parcelas. 1x (à vista no cartão) nunca tem juro, sempre.
          </p>
          <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;margin:10px 0 6px;">
            <input type="checkbox" id="creditInterestFreeEnabled" ${ci.freeInstallmentsEnabled ? 'checked' : ''}>
            Até quantas vezes sem juros
          </label>
          <div class="field field-inline-row" id="creditInterestFreeBox" style="display:${ci.freeInstallmentsEnabled ? 'flex' : 'none'};">
            <input id="creditInterestFreeInstallments" type="number" min="1" max="${MAX_INSTALLMENTS}" step="1" style="width:70px;flex-shrink:0;" value="${ci.freeInstallments ?? 1}">
            <span class="hint" style="margin:0;">vezes sem juros (contando o 1x, que já é sempre isento).</span>
          </div>
          <p class="text-muted" style="font-size:12.5px;margin:0 0 8px;">Desmarcado: qualquer parcelamento (2x em diante) já cobra juro.</p>

          <div class="radio-field-row">
            <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;">
              <input type="radio" name="creditInterestType" id="creditInterestTypeMonthly" value="monthly" ${(ci.type ?? 'monthly') === 'monthly' ? 'checked' : ''}>
              % ao mês
            </label>
            <div class="field" style="max-width:120px;">
              <input id="creditInterestMonthlyPercent" type="number" min="0" step="0.1" value="${ci.monthlyPercent ?? 0}">
            </div>
          </div>
          <div class="radio-field-row" style="margin-bottom:16px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;">
              <input type="radio" name="creditInterestType" id="creditInterestTypeFixed" value="fixed" ${ci.type === 'fixed' ? 'checked' : ''}>
              % fixo
            </label>
            <div class="field" style="max-width:120px;">
              <input id="creditInterestFixedPercent" type="number" min="0" step="0.1" value="${ci.fixedPercent ?? 0}">
            </div>
          </div>
          <span class="hint" style="display:block;margin:-8px 0 16px;">"% ao mês" multiplica pela quantidade de parcelas (mais parcelas, mais juro total). "% fixo" é o mesmo valor não importa quantas parcelas.</span>

          <button type="submit" class="btn" id="company-save-btn">${icon('save', { size: 15 })} Salvar</button>
        </form>
      </div>
    `;
  }

  container.innerHTML = html();
  wire();

  function wire() {
    const freeEnabled = document.getElementById('creditInterestFreeEnabled');
    const freeBox = document.getElementById('creditInterestFreeBox');
    freeEnabled.addEventListener('change', () => {
      freeBox.style.display = freeEnabled.checked ? 'flex' : 'none';
    });

    document.getElementById('company-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('company-form-error');
      errBox.innerHTML = '';
      const btn = document.getElementById('company-save-btn');
      btn.disabled = true;
      try {
        const patch = {
          vendorMaxDiscountPercent: Math.max(0, Math.min(100, Number(document.getElementById('vendorMaxDiscount').value) || 0)),
          requireOpenCashSession: document.getElementById('requireCashSession').checked,
          creditInterest: {
            freeInstallmentsEnabled: document.getElementById('creditInterestFreeEnabled').checked,
            freeInstallments: Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(Number(document.getElementById('creditInterestFreeInstallments').value)) || 1)),
            type: document.getElementById('creditInterestTypeFixed').checked ? 'fixed' : 'monthly',
            monthlyPercent: Math.max(0, Number(document.getElementById('creditInterestMonthlyPercent').value) || 0),
            fixedPercent: Math.max(0, Number(document.getElementById('creditInterestFixedPercent').value) || 0),
          },
        };
        const updated = await saveCompany(patch);
        policies = updated.policies;
        showToast('Política de venda salva.', 'success');
      } catch (err) {
        errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
      } finally {
        btn.disabled = false;
      }
    });
  }
}
