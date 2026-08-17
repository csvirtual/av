// Dados cadastrais da loja — edição restrita ao Administrador Geral.
import { getCompany, saveCompany } from '../data/companyRepo.js';
import { logAction } from '../data/auditRepo.js';
import { isValidCnpj, formatCnpj, onlyDigits } from '../utils/cnpj.js';
import { showToast } from '../components/toast.js';
import { escapeHtml as escAttr } from '../utils/format.js';

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

export async function renderCompanySettings(container, ctx) {
  const company = await getCompany();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Dados da loja</h1>
        <div class="desc">Informações cadastrais da empresa.</div>
      </div>
    </div>
    <div class="card" style="max-width:760px;">
      <form id="company-form" novalidate>
        <div id="form-error"></div>
        <div class="form-row">
          <div class="field"><label for="cnpj">CNPJ *</label><input id="cnpj" value="${company.cnpj}" maxlength="18" required></div>
          <div class="field"><label for="telefone">Telefone *</label><input id="telefone" value="${company.telefone}" required></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="razaoSocial">Razão social *</label><input id="razaoSocial" value="${escAttr(company.razaoSocial)}" required></div>
          <div class="field"><label for="nomeFantasia">Nome fantasia *</label><input id="nomeFantasia" value="${escAttr(company.nomeFantasia)}" required></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="inscricaoEstadual">Inscrição estadual</label><input id="inscricaoEstadual" value="${escAttr(company.inscricaoEstadual)}"></div>
          <div class="field"><label for="inscricaoMunicipal">Inscrição municipal</label><input id="inscricaoMunicipal" value="${escAttr(company.inscricaoMunicipal)}"></div>
          <div class="field"><label for="email">E-mail</label><input id="email" type="email" value="${escAttr(company.email)}"></div>
        </div>

        <p class="section-title">Endereço</p>
        <div class="form-row">
          <div class="field" style="flex:2"><label for="logradouro">Logradouro *</label><input id="logradouro" value="${escAttr(company.endereco.logradouro)}" required></div>
          <div class="field" style="flex:0 0 100px"><label for="numero">Número *</label><input id="numero" value="${escAttr(company.endereco.numero)}" required></div>
          <div class="field" style="flex:1"><label for="complemento">Complemento</label><input id="complemento" value="${escAttr(company.endereco.complemento)}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="bairro">Bairro *</label><input id="bairro" value="${escAttr(company.endereco.bairro)}" required></div>
          <div class="field"><label for="cidade">Cidade *</label><input id="cidade" value="${escAttr(company.endereco.cidade)}" required></div>
          <div class="field" style="flex:0 0 90px">
            <label for="uf">UF *</label>
            <select id="uf" required>${UFS.map((uf) => `<option value="${uf}" ${company.endereco.uf === uf ? 'selected' : ''}>${uf}</option>`).join('')}</select>
          </div>
          <div class="field" style="flex:0 0 130px"><label for="cep">CEP *</label><input id="cep" value="${escAttr(company.endereco.cep)}" required></div>
        </div>

        <p class="section-title">Ramo de atuação</p>
        <div class="form-row" style="margin-bottom:14px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;"><input type="checkbox" id="ramoMaterial" ${company.ramos.includes('material') ? 'checked' : ''}> Material de construção</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;"><input type="checkbox" id="ramoMercearia" ${company.ramos.includes('mercearia') ? 'checked' : ''}> Mercearia</label>
        </div>

        <div class="field"><label for="horario">Horário de funcionamento</label><input id="horario" value="${escAttr(company.horarioFuncionamento)}"></div>

        <p class="section-title">Políticas de venda</p>
        <div class="field" style="max-width:320px;">
          <label for="vendorMaxDiscount">Desconto máximo do vendedor sem aprovação (%)</label>
          <input id="vendorMaxDiscount" type="number" min="0" max="100" step="0.5" value="${company.policies?.vendorMaxDiscountPercent ?? 10}">
          <span class="hint">Acima disso, a venda só finaliza com a senha de um administrador.</span>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;margin:6px 0 16px;">
          <input type="checkbox" id="requireCashSession" ${company.policies?.requireOpenCashSession ? 'checked' : ''}>
          Exigir caixa aberto para registrar vendas
        </label>

        <p class="section-title">Fidelidade</p>
        <div class="form-row" style="max-width:520px;">
          <div class="field">
            <label for="loyaltyPointsPerReal">Pontos ganhos por R$1 gasto</label>
            <input id="loyaltyPointsPerReal" type="number" min="0" step="0.1" value="${company.policies?.loyaltyPointsPerReal ?? 0}">
            <span class="hint">0 desliga o programa de fidelidade. Só conta em vendas com cliente selecionado.</span>
          </div>
          <div class="field">
            <label for="loyaltyRedemptionRate">Pontos que valem R$1 no resgate</label>
            <input id="loyaltyRedemptionRate" type="number" min="1" step="1" value="${company.policies?.loyaltyRedemptionRate ?? 100}">
          </div>
        </div>

        <div class="modal-actions" style="justify-content:flex-end;">
          <button type="submit" class="btn">Salvar alterações</button>
        </div>
      </form>
    </div>
  `;

  const cnpjInput = document.getElementById('cnpj');
  cnpjInput.addEventListener('input', () => { cnpjInput.value = formatCnpj(cnpjInput.value); });

  document.getElementById('company-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('form-error');
    errBox.innerHTML = '';

    const cnpj = onlyDigits(cnpjInput.value);
    if (!isValidCnpj(cnpj)) {
      errBox.innerHTML = '<div class="form-error">CNPJ inválido. Confira os números digitados.</div>';
      return;
    }

    const ramos = [];
    if (document.getElementById('ramoMaterial').checked) ramos.push('material');
    if (document.getElementById('ramoMercearia').checked) ramos.push('mercearia');

    const required = ['razaoSocial', 'nomeFantasia', 'telefone', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep'];
    for (const id of required) {
      if (!document.getElementById(id).value.trim()) {
        errBox.innerHTML = '<div class="form-error">Preencha todos os campos obrigatórios (*).</div>';
        return;
      }
    }

    const data = {
      cnpj: formatCnpj(cnpj),
      razaoSocial: document.getElementById('razaoSocial').value.trim(),
      nomeFantasia: document.getElementById('nomeFantasia').value.trim(),
      inscricaoEstadual: document.getElementById('inscricaoEstadual').value.trim(),
      inscricaoMunicipal: document.getElementById('inscricaoMunicipal').value.trim(),
      telefone: document.getElementById('telefone').value.trim(),
      email: document.getElementById('email').value.trim(),
      ramos,
      horarioFuncionamento: document.getElementById('horario').value.trim(),
      policies: {
        vendorMaxDiscountPercent: Math.max(0, Math.min(100, Number(document.getElementById('vendorMaxDiscount').value) || 0)),
        requireOpenCashSession: document.getElementById('requireCashSession').checked,
        loyaltyPointsPerReal: Math.max(0, Number(document.getElementById('loyaltyPointsPerReal').value) || 0),
        loyaltyRedemptionRate: Math.max(1, Number(document.getElementById('loyaltyRedemptionRate').value) || 100),
      },
      endereco: {
        logradouro: document.getElementById('logradouro').value.trim(),
        numero: document.getElementById('numero').value.trim(),
        complemento: document.getElementById('complemento').value.trim(),
        bairro: document.getElementById('bairro').value.trim(),
        cidade: document.getElementById('cidade').value.trim(),
        uf: document.getElementById('uf').value,
        cep: document.getElementById('cep').value.trim(),
      },
    };

    await saveCompany(data);
    await logAction({
      userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
      action: 'Edição dos dados da loja',
      details: `Dados cadastrais da loja atualizados por "${ctx.user.nome}".`,
      entity: 'company', entityId: 'main',
    });
    showToast('Dados da loja atualizados.', 'success');
    ctx.refreshShell();
  });
}
