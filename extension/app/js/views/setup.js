// Assistente de configuração inicial: roda uma única vez, na primeira
// abertura do sistema. Passo 1 cadastra a empresa; passo 2 cadastra
// obrigatoriamente o Administrador Geral (primeiro usuário do sistema).
// Só depois dos dois passos o app libera a tela de login.
import { saveCompany } from '../data/companyRepo.js';
import { createUser, findByUsername } from '../data/usersRepo.js';
import { logAction } from '../data/auditRepo.js';
import { isValidCnpj, formatCnpj, onlyDigits } from '../utils/cnpj.js';
import { showToast } from '../components/toast.js';

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

export function renderSetup(root, { onComplete }) {
  const state = { step: 1, company: null };
  renderStep1();

  function shell(inner, stepNum) {
    root.innerHTML = `
      <div class="auth-screen">
        <div class="auth-card wide">
          <div class="auth-brand"><span class="dot"></span><span>Configuração inicial</span></div>
          <h1>${stepNum === 1 ? 'Dados da loja' : 'Administrador Geral'}</h1>
          <p class="subtitle">${stepNum === 1
            ? 'Vamos começar cadastrando os dados da empresa. Esse cadastro é feito uma única vez.'
            : 'Agora cadastre o Administrador Geral — o primeiro usuário do sistema, com acesso total. Os próximos usuários cadastrados serão vendedores.'}</p>
          <div class="steps">
            <div class="step ${stepNum >= 1 ? (stepNum > 1 ? 'done' : 'active') : ''}"></div>
            <div class="step ${stepNum >= 2 ? 'active' : ''}"></div>
          </div>
          ${inner}
        </div>
      </div>
    `;
  }

  function renderStep1() {
    shell(`
      <form id="company-form" novalidate>
        <div id="form-error"></div>
        <div class="form-row">
          <div class="field">
            <label for="cnpj">CNPJ *</label>
            <input id="cnpj" name="cnpj" placeholder="00.000.000/0000-00" maxlength="18" required>
            <span class="hint" id="cnpj-hint"></span>
          </div>
          <div class="field">
            <label for="telefone">Telefone *</label>
            <input id="telefone" name="telefone" placeholder="(00) 00000-0000" required>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="razaoSocial">Razão social *</label>
            <input id="razaoSocial" name="razaoSocial" required>
          </div>
          <div class="field">
            <label for="nomeFantasia">Nome fantasia *</label>
            <input id="nomeFantasia" name="nomeFantasia" required>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="inscricaoEstadual">Inscrição estadual</label>
            <input id="inscricaoEstadual" name="inscricaoEstadual">
          </div>
          <div class="field">
            <label for="inscricaoMunicipal">Inscrição municipal</label>
            <input id="inscricaoMunicipal" name="inscricaoMunicipal">
          </div>
          <div class="field">
            <label for="email">E-mail</label>
            <input id="email" name="email" type="email">
          </div>
        </div>

        <p class="section-title">Endereço</p>
        <div class="form-row">
          <div class="field" style="flex:2"><label for="logradouro">Logradouro *</label><input id="logradouro" required></div>
          <div class="field" style="flex:0 0 100px"><label for="numero">Número *</label><input id="numero" required></div>
          <div class="field" style="flex:1"><label for="complemento">Complemento</label><input id="complemento"></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="bairro">Bairro *</label><input id="bairro" required></div>
          <div class="field"><label for="cidade">Cidade *</label><input id="cidade" required></div>
          <div class="field" style="flex:0 0 90px">
            <label for="uf">UF *</label>
            <select id="uf" required>
              <option value="">--</option>
              ${UFS.map((uf) => `<option value="${uf}">${uf}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="flex:0 0 130px"><label for="cep">CEP *</label><input id="cep" placeholder="00000-000" required></div>
        </div>

        <p class="section-title">Ramo de atuação</p>
        <div class="form-row" style="margin-bottom:14px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;"><input type="checkbox" id="ramoMaterial" checked> Material de construção</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;"><input type="checkbox" id="ramoMercearia" checked> Mercearia</label>
        </div>

        <div class="field">
          <label for="horario">Horário de funcionamento</label>
          <input id="horario" placeholder="Ex: Seg a Sáb, 08h às 18h">
        </div>

        <div class="modal-actions" style="justify-content:flex-end;padding-top:8px;">
          <button type="submit" class="btn">Continuar →</button>
        </div>
      </form>
    `, 1);

    const form = document.getElementById('company-form');
    const cnpjInput = document.getElementById('cnpj');
    cnpjInput.addEventListener('input', () => {
      cnpjInput.value = formatCnpj(cnpjInput.value);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const errBox = document.getElementById('form-error');
      errBox.innerHTML = '';

      const cnpj = onlyDigits(cnpjInput.value);
      if (!isValidCnpj(cnpj)) {
        errBox.innerHTML = '<div class="form-error">CNPJ inválido. Confira os números digitados.</div>';
        cnpjInput.classList.add('invalid');
        return;
      }
      cnpjInput.classList.remove('invalid');

      const ramos = [];
      if (document.getElementById('ramoMaterial').checked) ramos.push('material');
      if (document.getElementById('ramoMercearia').checked) ramos.push('mercearia');

      const required = ['razaoSocial', 'nomeFantasia', 'telefone', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep'];
      for (const id of required) {
        const el = document.getElementById(id);
        if (!el.value.trim()) {
          errBox.innerHTML = '<div class="form-error">Preencha todos os campos obrigatórios (*).</div>';
          el.focus();
          return;
        }
      }

      state.company = {
        cnpj: formatCnpj(cnpj),
        razaoSocial: document.getElementById('razaoSocial').value.trim(),
        nomeFantasia: document.getElementById('nomeFantasia').value.trim(),
        inscricaoEstadual: document.getElementById('inscricaoEstadual').value.trim(),
        inscricaoMunicipal: document.getElementById('inscricaoMunicipal').value.trim(),
        telefone: document.getElementById('telefone').value.trim(),
        email: document.getElementById('email').value.trim(),
        ramos,
        horarioFuncionamento: document.getElementById('horario').value.trim(),
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
      state.step = 2;
      renderStep2();
    });
  }

  function renderStep2() {
    shell(`
      <form id="admin-form" novalidate>
        <div id="form-error"></div>
        <div class="field">
          <label for="nome">Nome completo *</label>
          <input id="nome" required autofocus>
        </div>
        <div class="field">
          <label for="username">Usuário de login *</label>
          <input id="username" required>
          <span class="hint">Usado para entrar no sistema. Não precisa ser um e-mail.</span>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="password">Senha *</label>
            <input id="password" type="password" required minlength="6">
          </div>
          <div class="field">
            <label for="confirmPassword">Confirmar senha *</label>
            <input id="confirmPassword" type="password" required minlength="6">
          </div>
        </div>
        <div class="modal-actions" style="justify-content:space-between;padding-top:8px;">
          <button type="button" class="btn btn-secondary" id="back-btn">← Voltar</button>
          <button type="submit" class="btn">Concluir cadastro</button>
        </div>
      </form>
    `, 2);

    document.getElementById('back-btn').addEventListener('click', () => {
      state.step = 1;
      renderStep1();
    });

    const form = document.getElementById('admin-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('form-error');
      errBox.innerHTML = '';

      const nome = document.getElementById('nome').value.trim();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;

      if (!nome || !username) {
        errBox.innerHTML = '<div class="form-error">Preencha nome e usuário de login.</div>';
        return;
      }
      if (password.length < 6) {
        errBox.innerHTML = '<div class="form-error">A senha deve ter pelo menos 6 caracteres.</div>';
        return;
      }
      if (password !== confirmPassword) {
        errBox.innerHTML = '<div class="form-error">As senhas não coincidem.</div>';
        return;
      }
      if (await findByUsername(username)) {
        errBox.innerHTML = '<div class="form-error">Esse usuário de login já existe.</div>';
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        await saveCompany(state.company);
        const admin = await createUser({ nome, username, password, role: 'admin' });
        await logAction({
          userId: admin.id, userName: admin.nome, role: 'admin',
          action: 'Cadastro inicial do sistema',
          details: `Empresa "${state.company.nomeFantasia}" e Administrador Geral "${admin.nome}" cadastrados.`,
          entity: 'setup', entityId: admin.id,
        });
        showToast('Loja e administrador cadastrados com sucesso!', 'success');
        onComplete();
      } catch (err) {
        errBox.innerHTML = `<div class="form-error">${err.message}</div>`;
        submitBtn.disabled = false;
      }
    });
  }
}
