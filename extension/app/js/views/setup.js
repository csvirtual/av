// Assistente de configuração inicial: roda uma única vez, na primeira
// abertura do sistema. Antes de tudo, pergunta se é um cadastro novo ou se
// existe um backup pra restaurar — quem escolhe cadastro novo segue pro
// fluxo de sempre (passo 1 cadastra a empresa, passo 2 cadastra
// obrigatoriamente o Administrador Geral); quem tem backup pula direto pra
// tela de login com todos os dados já restaurados. Só depois de um dos dois
// caminhos o app libera a tela de login.
import { saveCompany } from '../data/companyRepo.js';
import { createUser, findByUsername } from '../data/usersRepo.js';
import { logAction } from '../data/auditRepo.js';
import { readBackupFile, applyBackup } from '../data/backupRepo.js';
import { isValidCnpj, formatCnpj, onlyDigits } from '../utils/cnpj.js';
import { showToast } from '../components/toast.js';

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

export function renderSetup(root, { onComplete }) {
  const state = { step: 0, company: null };
  renderStep0();

  function shell(inner, { title, subtitle, stepNum = null }) {
    root.innerHTML = `
      <div class="auth-screen">
        <div class="auth-card wide">
          <div class="auth-brand"><span class="dot"></span><span>Configuração inicial</span></div>
          <h1>${title}</h1>
          <p class="subtitle">${subtitle}</p>
          ${stepNum ? `
          <div class="steps">
            <div class="step ${stepNum >= 1 ? (stepNum > 1 ? 'done' : 'active') : ''}"></div>
            <div class="step ${stepNum >= 2 ? 'active' : ''}"></div>
          </div>` : ''}
          ${inner}
        </div>
      </div>
    `;
  }

  // ---------- Passo 0: cadastro novo ou restaurar de um backup ----------
  function renderStep0() {
    shell(`
      <div class="setup-choice-grid">
        <button type="button" class="setup-choice-card" id="choice-new">
          <span class="icon">🏬</span>
          <div class="title">Cadastrar do zero</div>
          <div class="desc">Primeira loja usando o sistema. Vamos cadastrar os dados da empresa e o Administrador Geral.</div>
        </button>
        <button type="button" class="setup-choice-card" id="choice-restore">
          <span class="icon">💾</span>
          <div class="title">Já tenho um backup</div>
          <div class="desc">Restaurar todos os dados de um arquivo de backup gerado anteriormente (nesse ou em outro computador).</div>
        </button>
      </div>
    `, {
      title: 'Bem-vindo',
      subtitle: 'Antes de começar: você já tem um backup deste sistema, ou é a primeira vez que ele é instalado?',
    });

    document.getElementById('choice-new').addEventListener('click', () => { state.step = 1; renderStep1(); });
    document.getElementById('choice-restore').addEventListener('click', renderRestore);
  }

  // ---------- Restaurar de um backup (sem limite de tentativas — a senha
  // errada só mostra erro e deixa tentar de novo; "cadastrar do zero"
  // nunca fica bloqueado, é só voltar) ----------
  function renderRestore() {
    shell(`
      <form id="restore-form" novalidate>
        <div id="form-error"></div>
        <div class="field">
          <label for="restore-file">Arquivo de backup *</label>
          <input id="restore-file" type="file" accept=".json,application/json" required>
        </div>
        <div class="field">
          <label for="restore-pass">Senha do backup *</label>
          <input id="restore-pass" type="password" required>
        </div>
        <div class="modal-actions" style="justify-content:space-between;padding-top:8px;">
          <button type="button" class="btn btn-secondary" id="back-btn">← Voltar</button>
          <button type="submit" class="btn" id="restore-submit-btn">Restaurar</button>
        </div>
      </form>
    `, {
      title: 'Restaurar de um backup',
      subtitle: 'Selecione o arquivo de backup e digite a senha usada na exportação.',
    });

    document.getElementById('back-btn').addEventListener('click', renderStep0);

    document.getElementById('restore-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('form-error');
      errBox.innerHTML = '';

      const fileInput = document.getElementById('restore-file');
      const pass = document.getElementById('restore-pass').value;
      const file = fileInput.files[0];
      if (!file) {
        errBox.innerHTML = '<div class="form-error">Selecione o arquivo de backup.</div>';
        return;
      }

      const btn = document.getElementById('restore-submit-btn');
      btn.disabled = true;
      btn.textContent = 'Restaurando...';
      try {
        const text = await file.text();
        const { payload } = await readBackupFile(text, pass);
        await applyBackup(payload);
        await logAction({
          userId: null, userName: 'Restauração inicial (Setup)', role: 'admin',
          action: 'Backup restaurado no Setup',
          details: 'Backup restaurado durante a configuração inicial da extensão (instalação nova).',
          entity: 'backup', entityId: 'restore-setup',
        });
        showToast('Backup restaurado com sucesso! Faça login com um usuário do backup.', 'success');
        onComplete();
      } catch (err) {
        errBox.innerHTML = `<div class="form-error">${err.message}</div>`;
        btn.disabled = false;
        btn.textContent = 'Restaurar';
      }
    });
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
    `, {
      title: 'Dados da loja',
      subtitle: 'Vamos começar cadastrando os dados da empresa. Esse cadastro é feito uma única vez.',
      stepNum: 1,
    });

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
    `, {
      title: 'Administrador Geral',
      subtitle: 'Agora cadastre o Administrador Geral — o primeiro usuário do sistema, com acesso total. Os próximos usuários cadastrados serão vendedores.',
      stepNum: 2,
    });

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
