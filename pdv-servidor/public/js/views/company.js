// Dados da loja — igual à extensão (ver pdv-extension/app/js/views/company.js):
// cadastro fiscal (CNPJ travado após salvo, razão social, endereço...),
// ativação de licença (trial/demo/definitiva, mesma chave pública) e a
// política de venda (desconto máximo, exigir caixa aberto, juro do
// parcelamento). Achado do usuário: sem os dados fiscais, o recibo
// impresso (components/receipt.js) e o relatório (reportPrint.js) saíam
// sem nome/CNPJ da loja — os dois já esperavam esses campos prontos, só
// nunca eram gravados de verdade. Diferença proposital da extensão: sem
// assistente de primeira execução separado (este servidor nunca teve um)
// — o CNPJ nasce vazio e é digitado direto aqui; uma vez salvo, trava (só
// destrava com um código de liberação assinado, conferido de novo no
// servidor ao salvar — nunca confia só no campo desabilitado da tela).
//
// Mesmo padrão de gate já testado em relatorios.js/logs.js/financeiro.js/
// backup.js: o MENU esconde este link de quem não tem a permissão
// 'empresa' (ver ROUTES em app.js), mas a tela em si renderiza pra
// qualquer um que chegue aqui por link direto — a permissão de verdade é
// sempre conferida no servidor (routes/company.js#PUT), nunca só na tela.
import { getCompany, saveCompany } from '../data/companyRepo.js';
import { getLicenseStatus, activateLicenseKey } from '../data/licenseRepo.js';
import { verifyLicenseKey } from '../utils/license.js';
import { logAction } from '../data/auditRepo.js';
import { isValidCnpj, formatCnpj } from '../utils/cnpj.js';
import { formatPhoneBR } from '../utils/phone.js';
import { formatCep, isValidCep } from '../utils/cep.js';
import { isValidEmail } from '../utils/email.js';
import { MAX_INSTALLMENTS } from '../utils/pricing.js';
import { showToast } from '../components/toast.js';
import { icon } from '../components/icon.js';
import { wireMaskedInput } from '../components/maskedInput.js';
import { escapeHtml as escAttr, formatDateTime, onlyDigits, UFS } from '../utils/format.js';
import { infoTooltipHtml, initInfoTooltips, CNPJ_LEGAL_NOTICE_HTML } from '../components/infoTooltip.js';
import { openSupportContactChoiceModal } from '../components/supportContact.js';

function licenseStatusLabel(license) {
  if (license.tipo === 'full') return { text: 'Definitiva — ativada', cls: 'badge-green' };
  if (license.tipo === 'demo') return { text: `Demo — expira em ${formatDateTime(license.expiraEm)}`, cls: 'badge-gold' };
  if (license.tipo === 'trial') return { text: `Período de teste — expira em ${formatDateTime(license.expiraEm)}`, cls: 'badge-gold' };
  return { text: 'Sem restrição de licença', cls: 'badge-gray' };
}

export async function renderCompany(container, ctx) {
  let company = ctx.company;
  let license = await getLicenseStatus();
  // Token do código de liberação de CNPJ (ver "Desbloquear edição" abaixo)
  // — só some da memória ao trocar de tela ou salvar; nunca persiste.
  let cnpjUnlockToken = null;

  function html() {
    const p = company.policies;
    const ci = p.creditInterest || {};
    const e = company.endereco || {};
    const statusInfo = licenseStatusLabel(license);
    return `
      <div class="page-header">
        <div>
          <h1>${icon('store', { size: 22 })} Dados da loja</h1>
          <div class="desc">Cadastro fiscal, ativação e política de venda — vale pra todos os terminais, na hora.</div>
        </div>
      </div>

      <div class="card" style="max-width:760px;margin-bottom:20px;">
        <p class="section-title mt-0">Ativação</p>
        <p style="margin:0 0 6px;">Situação atual: <span class="badge ${statusInfo.cls}">${escAttr(statusInfo.text)}</span></p>
        ${license.version ? `<p style="margin:0 0 14px;">Versão atual: ${escAttr(license.version)}</p>` : ''}
        ${license.tipo !== 'full' ? `
          <div id="license-error"></div>
          <div class="field" style="max-width:420px;">
            <label for="license-input">Tem uma chave de ativação definitiva? Cole aqui pra sair do teste/demo</label>
            <input id="license-input" placeholder="Cole a chave de ativação">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary btn-sm" id="license-activate-btn">Ativar</button>
            <button type="button" class="btn btn-ghost btn-sm" id="request-key-btn">${icon('key', { size: 15 })} Solicitar chave</button>
          </div>
        ` : ''}
      </div>

      <div class="card" style="max-width:760px;">
        <form id="company-form" novalidate>
          <div id="form-error"></div>

          <p class="section-title mt-0">Cadastro fiscal</p>
          <div class="form-row">
            <div class="field">
              <div class="field-label-row">
                <label for="cnpj">CNPJ *</label>
                ${infoTooltipHtml('cnpj-legal-notice-company', 'Mais informações sobre o CNPJ', CNPJ_LEGAL_NOTICE_HTML)}
              </div>
              <input id="cnpj" value="${escAttr(company.cnpj)}" maxlength="18" placeholder="xx.xxx.xxx/xxxx-xx" required ${company.cnpjLocked ? 'disabled' : ''}>
              ${company.cnpjLocked ? `
                <button type="button" id="cnpj-unlock-toggle" style="background:none;border:none;color:var(--primary);cursor:pointer;padding:2px 0;text-align:left;font-size:12px;">Desbloquear edição (com código do suporte)</button>
                <div id="cnpj-unlock-box" hidden>
                  <input id="cnpj-unlock-code" placeholder="Cole o código de liberação" style="width:100%;margin-bottom:6px;">
                  <button type="button" class="btn btn-secondary btn-sm" id="cnpj-unlock-btn">Destravar</button>
                </div>
                <div id="cnpj-unlock-error"></div>
              ` : `<span class="hint">Depois de salvo, só muda de novo com um código de liberação.</span>`}
            </div>
            <div class="field"><label for="telefone">Telefone *</label><input id="telefone" value="${escAttr(formatPhoneBR(company.telefone))}" placeholder="(xx) x xxxx-xxxx" maxlength="17" required></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="razaoSocial">Razão social *</label><input id="razaoSocial" value="${escAttr(company.razaoSocial)}" required></div>
            <div class="field"><label for="nomeFantasia">Nome fantasia *</label><input id="nomeFantasia" value="${escAttr(company.nomeFantasia)}" required></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="inscricaoEstadual">Inscrição estadual</label><input id="inscricaoEstadual" value="${escAttr(company.inscricaoEstadual)}"></div>
            <div class="field"><label for="inscricaoMunicipal">Inscrição municipal</label><input id="inscricaoMunicipal" value="${escAttr(company.inscricaoMunicipal)}"></div>
            <div class="field"><label for="email">E-mail</label><input id="email" type="email" value="${escAttr(company.email)}" placeholder="exemplo@dominio.com"></div>
          </div>

          <p class="section-title">Endereço</p>
          <div class="form-row">
            <div class="field" style="flex:2"><label for="logradouro">Logradouro *</label><input id="logradouro" value="${escAttr(e.logradouro)}" required></div>
            <div class="field" style="flex:0 0 100px"><label for="numero">Número *</label><input id="numero" value="${escAttr(e.numero)}" required></div>
            <div class="field" style="flex:1"><label for="complemento">Complemento</label><input id="complemento" value="${escAttr(e.complemento)}"></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="bairro">Bairro *</label><input id="bairro" value="${escAttr(e.bairro)}" required></div>
            <div class="field"><label for="cidade">Cidade *</label><input id="cidade" value="${escAttr(e.cidade)}" required></div>
            <div class="field" style="flex:0 0 90px">
              <label for="uf">UF *</label>
              <select id="uf" required>${UFS.map((uf) => `<option value="${uf}" ${e.uf === uf ? 'selected' : ''}>${uf}</option>`).join('')}</select>
            </div>
            <div class="field" style="flex:0 0 130px"><label for="cep">CEP *</label><input id="cep" value="${escAttr(formatCep(e.cep))}" placeholder="xxxxx-xxx" maxlength="9" required></div>
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
            <input id="vendorMaxDiscount" type="number" min="0" max="100" step="0.5" value="${p.vendorMaxDiscountPercent ?? 10}">
            <span class="hint">Acima disso, a venda só finaliza com a senha de um administrador (ou de quem tiver a permissão "desconto sem limite").</span>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;margin:6px 0 16px;">
            <input type="checkbox" id="requireCashSession" ${p.requireOpenCashSession ? 'checked' : ''}>
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

          <p class="section-title">Privacidade e LGPD</p>
          <div class="form-row" style="max-width:560px;">
            <div class="field">
              <label for="encarregadoNome">Encarregado de dados (opcional)</label>
              <input id="encarregadoNome" value="${escAttr(company.encarregadoLgpd?.nome)}" placeholder="Nome de quem responde por dúvidas de privacidade">
            </div>
            <div class="field">
              <label for="encarregadoContato">Contato do encarregado</label>
              <input id="encarregadoContato" value="${escAttr(company.encarregadoLgpd?.contato)}" placeholder="Telefone ou e-mail">
            </div>
          </div>
          <span class="hint" style="display:block;margin:-8px 0 16px;">Aparece no aviso de privacidade pronto pra imprimir, na tela de Ajuda → "Privacidade e LGPD". Veja lá o porquê de preencher isso.</span>

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
            <button type="submit" class="btn" id="company-save-btn">${icon('save', { size: 15 })} Salvar</button>
          </div>
        </form>
      </div>
    `;
  }

  async function refresh() {
    company = await getCompany();
    license = await getLicenseStatus();
    cnpjUnlockToken = null;
    container.innerHTML = html();
    wire();
  }

  container.innerHTML = html();
  wire();

  function wire() {
    initInfoTooltips(container);

    document.getElementById('license-activate-btn')?.addEventListener('click', async () => {
      const errBox = document.getElementById('license-error');
      errBox.innerHTML = '';
      const input = document.getElementById('license-input');
      const btn = document.getElementById('license-activate-btn');
      btn.disabled = true;
      btn.textContent = 'Verificando...';
      try {
        await activateLicenseKey(input.value.trim());
        showToast('Chave ativada com sucesso!', 'success');
        await refresh();
      } catch (err) {
        errBox.innerHTML = `<div class="form-error">${escAttr(err.message)}</div>`;
        btn.disabled = false;
        btn.textContent = 'Ativar';
      }
    });

    document.getElementById('request-key-btn')?.addEventListener('click', () => {
      openSupportContactChoiceModal(company, 'gostaria de solicitar minha chave de ativação definitiva');
    });

    const cnpjInput = document.getElementById('cnpj');
    wireMaskedInput(cnpjInput, formatCnpj);

    // Destrava o campo com um código de liberação de uso único (gerado
    // pela mesma ferramenta que gera a chave de ativação, só que com
    // tipo:'cnpj-unlock' — ver utils/license.js). Checagem otimista aqui
    // no cliente, só pra destravar o CAMPO na hora — o servidor confere o
    // mesmo token de novo ao salvar (routes/company.js#PUT), que é quem
    // decide de verdade. Só afeta esta tela nesta sessão: recarregar sem
    // salvar volta travado.
    const cnpjUnlockToggle = document.getElementById('cnpj-unlock-toggle');
    const cnpjUnlockBox = document.getElementById('cnpj-unlock-box');
    const cnpjUnlockErrBox = document.getElementById('cnpj-unlock-error');
    cnpjUnlockToggle?.addEventListener('click', () => { cnpjUnlockBox.hidden = !cnpjUnlockBox.hidden; });
    document.getElementById('cnpj-unlock-btn')?.addEventListener('click', async () => {
      cnpjUnlockErrBox.innerHTML = '';
      const codeInput = document.getElementById('cnpj-unlock-code');
      const result = await verifyLicenseKey(codeInput.value, company.cnpj);
      if (!result.valid || result.tipo !== 'cnpj-unlock') {
        const reason = result.valid ? 'Esse código não é um código de liberação de CNPJ.' : result.reason;
        cnpjUnlockErrBox.innerHTML = `<div class="form-error">${escAttr(reason)}</div>`;
        return;
      }
      cnpjUnlockToken = codeInput.value.trim();
      cnpjInput.disabled = false;
      cnpjUnlockToggle.hidden = true;
      cnpjUnlockBox.hidden = true;
      showToast('Campo de CNPJ destravado — pode corrigir agora.', 'success');
    });

    const telefoneInput = document.getElementById('telefone');
    wireMaskedInput(telefoneInput, formatPhoneBR);
    const cepInput = document.getElementById('cep');
    wireMaskedInput(cepInput, formatCep);
    const emailInput = document.getElementById('email');

    const freeEnabled = document.getElementById('creditInterestFreeEnabled');
    const freeBox = document.getElementById('creditInterestFreeBox');
    freeEnabled.addEventListener('change', () => {
      freeBox.style.display = freeEnabled.checked ? 'flex' : 'none';
    });

    document.getElementById('company-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('form-error');
      errBox.innerHTML = '';

      const cnpjDigits = onlyDigits(cnpjInput.value);
      if (!isValidCnpj(cnpjDigits)) {
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

      if (!isValidCep(cepInput.value)) {
        errBox.innerHTML = '<div class="form-error">CEP inválido. Use o formato 00000-000.</div>';
        cepInput.focus();
        return;
      }

      if (emailInput.value.trim() && !isValidEmail(emailInput.value)) {
        errBox.innerHTML = '<div class="form-error">E-mail inválido. Use o formato exemplo@dominio.com.</div>';
        emailInput.focus();
        return;
      }

      const patch = {
        cnpj: formatCnpj(cnpjDigits),
        cnpjUnlockToken,
        razaoSocial: document.getElementById('razaoSocial').value.trim(),
        nomeFantasia: document.getElementById('nomeFantasia').value.trim(),
        inscricaoEstadual: document.getElementById('inscricaoEstadual').value.trim(),
        inscricaoMunicipal: document.getElementById('inscricaoMunicipal').value.trim(),
        telefone: document.getElementById('telefone').value.trim(),
        email: document.getElementById('email').value.trim(),
        ramos,
        horarioFuncionamento: document.getElementById('horario').value.trim(),
        vendorMaxDiscountPercent: Math.max(0, Math.min(100, Number(document.getElementById('vendorMaxDiscount').value) || 0)),
        requireOpenCashSession: document.getElementById('requireCashSession').checked,
        creditInterest: {
          freeInstallmentsEnabled: document.getElementById('creditInterestFreeEnabled').checked,
          freeInstallments: Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(Number(document.getElementById('creditInterestFreeInstallments').value)) || 1)),
          type: document.getElementById('creditInterestTypeFixed').checked ? 'fixed' : 'monthly',
          monthlyPercent: Math.max(0, Number(document.getElementById('creditInterestMonthlyPercent').value) || 0),
          fixedPercent: Math.max(0, Number(document.getElementById('creditInterestFixedPercent').value) || 0),
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
        encarregadoLgpd: {
          nome: document.getElementById('encarregadoNome').value.trim(),
          contato: document.getElementById('encarregadoContato').value.trim(),
        },
      };

      const submitBtn = document.getElementById('company-save-btn');
      submitBtn.disabled = true;
      try {
        await saveCompany(patch);
        await logAction({
          userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
          action: 'Edição dos dados da loja',
          details: `Dados cadastrais e política de venda de "${patch.nomeFantasia}" atualizados por "${ctx.user.nome}".`,
          entity: 'company', entityId: 'main',
        });
        showToast('Dados da loja atualizados.', 'success');
        await refresh();
      } catch (err) {
        errBox.innerHTML = `<div class="form-error">${escAttr(err.message)}</div>`;
        submitBtn.disabled = false;
      }
    });
  }
}
