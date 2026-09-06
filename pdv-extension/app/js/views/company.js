// Dados cadastrais da loja — edição exige a permissão 'empresa' (admin
// sempre tem; um vendedor só se marcado no cadastro dele, ver
// utils/permissions.js).
import { getCompany, saveCompany } from '../data/companyRepo.js';
import { logAction } from '../data/auditRepo.js';
import { isValidCnpj, formatCnpj } from '../utils/cnpj.js';
import { formatPhoneBR } from '../utils/phone.js';
import { formatCep, isValidCep } from '../utils/cep.js';
import { isValidEmail } from '../utils/email.js';
import { MAX_INSTALLMENTS } from '../utils/pricing.js';
import { showToast } from '../components/toast.js';
import { openModal } from '../components/modal.js';
import { icon } from '../components/icon.js';
import { wireMaskedInput } from '../components/maskedInput.js';
import { escapeHtml as escAttr } from '../utils/format.js';
import { infoTooltipHtml, initInfoTooltips, CNPJ_LEGAL_NOTICE_HTML } from '../components/infoTooltip.js';
import { getLicenseStatus, setStoredActivationKey } from '../data/licenseRepo.js';
import { verifyLicenseKey } from '../license.js';
import { formatDateTime, onlyDigits, UFS } from '../utils/format.js';

// Versão instalada agora, lida direto do manifest.json — nunca hardcoded
// aqui, pra nunca ficar desatualizada em relação ao que a Chrome Web
// Store realmente está servindo.
const APP_VERSION = chrome.runtime.getManifest().version;

function licenseStatusLabel(license) {
  if (license.tipo === 'full') return { text: 'Definitiva — ativada', cls: 'badge-green' };
  if (license.tipo === 'demo') return { text: `Demo — expira em ${formatDateTime(license.expiraEm)}`, cls: 'badge-gold' };
  if (license.tipo === 'trial') return { text: `Período de teste — expira em ${formatDateTime(license.expiraEm)}`, cls: 'badge-gold' };
  return { text: 'Sem restrição de licença', cls: 'badge-gray' }; // instalação anterior à função de licença (grandfathered)
}

export async function renderCompanySettings(container, ctx) {
  const company = await getCompany();
  const license = await getLicenseStatus(company.cnpj);
  const statusInfo = licenseStatusLabel(license);

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Dados da loja</h1>
        <div class="desc">Informações cadastrais da empresa.</div>
      </div>
    </div>
    <div class="card" style="max-width:760px;margin-bottom:20px;">
      <p class="section-title mt-0">Ativação</p>
      <p style="margin:0 0 10px;">Situação atual: <span class="badge ${statusInfo.cls}">${escAttr(statusInfo.text)}</span></p>
      <p style="margin:0 0 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span class="text-muted" style="font-size:13px;">Versão atual: <strong style="color:var(--text);">${escAttr(APP_VERSION)}</strong></span>
        <button type="button" class="btn btn-secondary btn-sm" id="check-update-btn">${icon('refresh', { size: 15 })} Verificar atualização</button>
      </p>
      ${license.tipo !== 'full' ? `
        <div id="license-settings-error"></div>
        <div class="field" style="max-width:420px;">
          <label for="license-settings-input">Tem uma chave de ativação definitiva? Cole aqui pra sair do teste/demo</label>
          <input id="license-settings-input" placeholder="Cole a chave de ativação">
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="license-settings-btn">Ativar</button>
      ` : ''}
    </div>
    <div class="card" style="max-width:760px;">
      <form id="company-form" novalidate>
        <div id="form-error"></div>
        <div class="form-row">
          <div class="field">
            <div class="field-label-row">
              <label for="cnpj">CNPJ *</label>
              ${infoTooltipHtml('cnpj-legal-notice-company', 'Mais informações sobre o CNPJ', CNPJ_LEGAL_NOTICE_HTML)}
            </div>
            <input id="cnpj" value="${escAttr(company.cnpj)}" maxlength="18" required disabled>
            <button type="button" id="cnpj-unlock-toggle" style="background:none;border:none;color:var(--primary);cursor:pointer;padding:2px 0;text-align:left;font-size:12px;">Desbloquear edição (com código do suporte)</button>
            <div id="cnpj-unlock-box" hidden>
              <input id="cnpj-unlock-code" placeholder="Cole o código de liberação" style="width:100%;margin-bottom:6px;">
              <button type="button" class="btn btn-secondary btn-sm" id="cnpj-unlock-btn">Destravar</button>
            </div>
            <div id="cnpj-unlock-error"></div>
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
          <div class="field" style="flex:0 0 130px"><label for="cep">CEP *</label><input id="cep" value="${escAttr(formatCep(company.endereco.cep))}" placeholder="xxxxx-xxx" maxlength="9" required></div>
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

        <p class="section-title">Juros no parcelamento do cartão de crédito</p>
        <p class="text-muted" style="font-size:12.5px;margin-top:-8px;">
          Configurado só aqui — o vendedor nunca vê nem edita essa taxa na hora da venda, ela entra sozinha ao escolher Cartão de crédito e o número de parcelas. 1x (à vista no cartão) nunca tem juro, sempre.
        </p>
        <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;margin:10px 0 6px;">
          <input type="checkbox" id="creditInterestFreeEnabled" ${company.policies?.creditInterest?.freeInstallmentsEnabled ? 'checked' : ''}>
          Até quantas vezes sem juros
        </label>
        <div class="field field-inline-row" id="creditInterestFreeBox" style="display:${company.policies?.creditInterest?.freeInstallmentsEnabled ? 'flex' : 'none'};">
          <input id="creditInterestFreeInstallments" type="number" min="1" max="${MAX_INSTALLMENTS}" step="1" style="width:70px;flex-shrink:0;" value="${company.policies?.creditInterest?.freeInstallments ?? 1}">
          <span class="hint" style="margin:0;">vezes sem juros (contando o 1x, que já é sempre isento).</span>
        </div>
        <p class="text-muted" style="font-size:12.5px;margin:0 0 8px;">Desmarcado: qualquer parcelamento (2x em diante) já cobra juro.</p>

        <div class="form-row" style="align-items:flex-start;">
          <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;">
            <input type="radio" name="creditInterestType" id="creditInterestTypeMonthly" value="monthly" ${(company.policies?.creditInterest?.type ?? 'monthly') === 'monthly' ? 'checked' : ''}>
            % ao mês
          </label>
          <div class="field" style="max-width:120px;">
            <input id="creditInterestMonthlyPercent" type="number" min="0" step="0.1" value="${company.policies?.creditInterest?.monthlyPercent ?? 0}">
          </div>
        </div>
        <div class="form-row" style="align-items:flex-start;margin-bottom:16px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;">
            <input type="radio" name="creditInterestType" id="creditInterestTypeFixed" value="fixed" ${company.policies?.creditInterest?.type === 'fixed' ? 'checked' : ''}>
            % fixo
          </label>
          <div class="field" style="max-width:120px;">
            <input id="creditInterestFixedPercent" type="number" min="0" step="0.1" value="${company.policies?.creditInterest?.fixedPercent ?? 0}">
          </div>
        </div>
        <span class="hint" style="display:block;margin:-8px 0 16px;">"% ao mês" multiplica pela quantidade de parcelas (mais parcelas, mais juro total). "% fixo" é o mesmo valor não importa quantas parcelas.</span>

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
          <button type="submit" class="btn">Salvar alterações</button>
        </div>
      </form>
    </div>
  `;

  initInfoTooltips(container);

  document.getElementById('license-settings-btn')?.addEventListener('click', async () => {
    const errBox = document.getElementById('license-settings-error');
    errBox.innerHTML = '';
    const input = document.getElementById('license-settings-input');
    const btn = document.getElementById('license-settings-btn');
    btn.disabled = true;
    btn.textContent = 'Verificando...';
    const result = await verifyLicenseKey(input.value, company.cnpj);
    // Mesmo cuidado do bloqueio em app.js: um código de liberação de CNPJ
    // (tipo 'cnpj-unlock') tem assinatura e CNPJ válidos igual uma chave
    // de ativação — sem checar o tipo aqui, viraria "Definitiva" por
    // engano (ver comentário completo em app.js#renderLicenseBlockedScreen).
    if (!result.valid || (result.tipo !== 'demo' && result.tipo !== 'full')) {
      const reason = result.valid ? 'Esse código não é uma chave de ativação (é um código de outro tipo).' : result.reason;
      errBox.innerHTML = `<div class="form-error">${escAttr(reason)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Ativar';
      return;
    }
    await setStoredActivationKey(input.value.trim());
    await logAction({
      userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
      action: 'Chave de ativação aplicada',
      details: `Licença ativada em Dados da loja (tipo: ${result.tipo}) por "${ctx.user.nome}".`,
      entity: 'license', entityId: 'main',
    });
    showToast('Chave ativada com sucesso!', 'success');
    ctx.refreshShell();
  });

  // chrome.runtime.requestUpdateCheck() pede pro Chrome checar AGORA (em
  // vez de esperar a checagem periódica automática dele, que roda sozinha
  // em segundo plano de tempos em tempos) se existe uma versão nova na
  // Chrome Web Store. Só funciona de verdade em uma instalação feita pela
  // própria Store — instalação "descompactada" (modo desenvolvedor) não
  // tem de onde checar, então sempre volta como se estivesse atualizada.
  // Achar uma atualização não instala na hora: o Chrome baixa em segundo
  // plano e só aplica quando a extensão recarrega — por isso o botão
  // "Atualizar agora" chama chrome.runtime.reload() explicitamente, em
  // vez de só avisar e esperar o usuário lembrar de reiniciar o Chrome.
  document.getElementById('check-update-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('check-update-btn');
    const originalLabel = btn.innerHTML;
    // Checado ANTES de chamar requestUpdateCheck() de propósito: a API do
    // Chrome não tem um status próprio pra "não consegui alcançar o
    // servidor" — sem conexão nenhuma, ela normalmente volta "no_update"
    // do mesmo jeito que voltaria se realmente não houvesse atualização,
    // o que mostraria "Tudo certo!" de forma enganosa. navigator.onLine
    // não é perfeito (detecta falta de rede local — avião, Wi-Fi
    // desligado — mas não pega todo caso de "conectado no roteador só que
    // sem internet de verdade"), mas cobre o caso mais comum sem
    // depender de nenhuma permissão nova.
    if (!navigator.onLine) {
      openModal({
        title: 'Sem conexão',
        centerTitle: true,
        centerActions: true,
        singleButton: true,
        submitLabel: 'Fechar',
        bodyHtml: `
          <div style="text-align:center;padding:8px 0;">
            <div style="margin-bottom:6px;">${icon('warning', { size: 34 })}</div>
            <p style="margin:0;">Não foi possível verificar — este computador está sem conexão com a internet agora. Verifique a rede e tente de novo.</p>
          </div>
        `,
      });
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Verificando...';
    try {
      const result = await chrome.runtime.requestUpdateCheck();
      // API baseada em callback (mais antiga) devolve só a string do
      // status; a versão em Promise (Chrome 109+) devolve {status,
      // version} — normaliza os dois formatos pra não depender de qual
      // delas o navegador do lojista está rodando.
      const status = typeof result === 'string' ? result : result.status;
      const newVersion = typeof result === 'object' && result ? result.version : null;
      if (status === 'update_available') {
        openModal({
          title: 'Nova versão disponível',
          centerTitle: true,
        centerActions: true,
          submitLabel: `${icon('download', { size: 15 })} Atualizar agora`,
          cancelLabel: 'Agora não',
          bodyHtml: `
            <div style="text-align:center;padding:8px 0 12px;">
              <div style="margin-bottom:6px;">${icon('refresh', { size: 34 })}</div>
              <p style="margin:0;">Uma nova versão do sistema${newVersion ? ` (<strong>${escAttr(newVersion)}</strong>)` : ''} já foi baixada e está pronta pra instalar.</p>
            </div>
            <div class="notice notice-danger"><strong>Atenção:</strong> aplicar a atualização recarrega o sistema agora — uma venda com itens no carrinho ainda não finalizada seria perdida. Nenhum dado já salvo (vendas, estoque, caixa, clientes etc.) é afetado.</div>
          `,
          onSubmit: async (modalEl) => {
            const submitBtn = modalEl.querySelector('[data-action="submit"]');
            if (submitBtn) submitBtn.textContent = 'Atualizando...';
            chrome.runtime.reload();
            // A partir daqui o próprio contexto desta extensão já está
            // sendo desligado pelo Chrome — não dá pra confiar em mais
            // nada além de recarregar a aba de fato pra pegar a versão
            // nova. O atraso é só pra dar tempo do reload() de verdade
            // acontecer primeiro.
            await new Promise((resolve) => setTimeout(resolve, 1200));
            location.reload();
            return false;
          },
        });
      } else if (status === 'throttled') {
        openModal({
          title: 'Aguarde um instante',
          centerTitle: true,
        centerActions: true,
          singleButton: true,
          submitLabel: 'Entendi',
          bodyHtml: '<p style="margin:0;">Você verificou por atualização há pouco tempo — o Chrome limita quantas vezes isso pode ser pedido seguido. Aguarde alguns minutos e tente de novo.</p>',
        });
      } else {
        openModal({
          title: 'Tudo certo!',
          centerTitle: true,
        centerActions: true,
          singleButton: true,
          submitLabel: 'Fechar',
          bodyHtml: `
            <div style="text-align:center;padding:8px 0;">
              <div style="margin-bottom:6px;">${icon('checkCircle', { size: 34 })}</div>
              <p style="margin:0;">Você já está na versão mais recente do sistema (<strong>${escAttr(APP_VERSION)}</strong>).</p>
            </div>
          `,
        });
      }
    } catch (err) {
      openModal({
        title: 'Não foi possível verificar',
        centerTitle: true,
        centerActions: true,
        singleButton: true,
        submitLabel: 'Fechar',
        bodyHtml: `<p style="margin:0;">Não foi possível checar por atualização agora (${escAttr(err.message)}).</p>`,
      });
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  });

  const cnpjInput = document.getElementById('cnpj');
  wireMaskedInput(cnpjInput, formatCnpj);

  // Destrava o campo com um código de liberação de uso único (gerado pela
  // mesma ferramenta local que gera a chave de ativação, só que com
  // tipo:'cnpj-unlock' — ver license.js). Só afeta esta tela nesta
  // sessão: se recarregar a página sem salvar, volta travado, porque o
  // campo nasce sempre desabilitado de novo (ver disabled acima).
  const cnpjUnlockToggle = document.getElementById('cnpj-unlock-toggle');
  const cnpjUnlockBox = document.getElementById('cnpj-unlock-box');
  const cnpjUnlockErrBox = document.getElementById('cnpj-unlock-error');
  cnpjUnlockToggle.addEventListener('click', () => { cnpjUnlockBox.hidden = !cnpjUnlockBox.hidden; });
  document.getElementById('cnpj-unlock-btn').addEventListener('click', async () => {
    cnpjUnlockErrBox.innerHTML = '';
    const codeInput = document.getElementById('cnpj-unlock-code');
    const result = await verifyLicenseKey(codeInput.value, company.cnpj);
    if (!result.valid || result.tipo !== 'cnpj-unlock') {
      const reason = result.valid ? 'Esse código não é um código de liberação de CNPJ.' : result.reason;
      cnpjUnlockErrBox.innerHTML = `<div class="form-error">${escAttr(reason)}</div>`;
      return;
    }
    cnpjInput.disabled = false;
    cnpjUnlockToggle.hidden = true;
    cnpjUnlockBox.hidden = true;
    await logAction({
      userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
      action: 'Campo de CNPJ destravado',
      details: `Edição do CNPJ destravada por "${ctx.user.nome}" com código de liberação.`,
      entity: 'license', entityId: 'main',
    });
    showToast('Campo de CNPJ destravado — pode corrigir agora.', 'success');
  });
  const telefoneInput = document.getElementById('telefone');
  wireMaskedInput(telefoneInput, formatPhoneBR);
  const cepInput = document.getElementById('cep');
  wireMaskedInput(cepInput, formatCep);
  const emailInput = document.getElementById('email');

  // Mostra/esconde o campo "até quantas vezes" junto com a caixinha, e
  // trava o campo do tipo de juro que não está selecionado (rádio) — só
  // um dos dois (% ao mês / % fixo) vale por vez.
  const creditFreeEnabled = document.getElementById('creditInterestFreeEnabled');
  const creditFreeBox = document.getElementById('creditInterestFreeBox');
  creditFreeEnabled.addEventListener('change', () => {
    creditFreeBox.style.display = creditFreeEnabled.checked ? 'flex' : 'none';
  });

  const creditMonthlyRadio = document.getElementById('creditInterestTypeMonthly');
  const creditFixedRadio = document.getElementById('creditInterestTypeFixed');
  const creditMonthlyInput = document.getElementById('creditInterestMonthlyPercent');
  const creditFixedInput = document.getElementById('creditInterestFixedPercent');
  function syncCreditInterestTypeFields() {
    creditMonthlyInput.disabled = !creditMonthlyRadio.checked;
    creditFixedInput.disabled = !creditFixedRadio.checked;
  }
  creditMonthlyRadio.addEventListener('change', syncCreditInterestTypeFields);
  creditFixedRadio.addEventListener('change', syncCreditInterestTypeFields);
  syncCreditInterestTypeFields();

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
        creditInterest: {
          freeInstallmentsEnabled: document.getElementById('creditInterestFreeEnabled').checked,
          freeInstallments: Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(Number(document.getElementById('creditInterestFreeInstallments').value)) || 1)),
          type: document.getElementById('creditInterestTypeFixed').checked ? 'fixed' : 'monthly',
          monthlyPercent: Math.max(0, Number(document.getElementById('creditInterestMonthlyPercent').value) || 0),
          fixedPercent: Math.max(0, Number(document.getElementById('creditInterestFixedPercent').value) || 0),
        },
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

    // Trava contra clique duplo (dois submits em paralelo) + try/catch
    // pra não deixar o formulário "sem reação nenhuma" se saveCompany
    // falhar por algum motivo inesperado — achado de auditoria; mesmo
    // padrão já usado no formulário de mesma cara em views/setup.js.
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await saveCompany(data);
      await logAction({
        userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
        action: 'Edição dos dados da loja',
        details: `Dados cadastrais da loja atualizados por "${ctx.user.nome}".`,
        entity: 'company', entityId: 'main',
      });
      showToast('Dados da loja atualizados.', 'success');
      ctx.refreshShell();
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">${escAttr(err.message)}</div>`;
      submitBtn.disabled = false;
    }
  });
}
