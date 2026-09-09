// Backup e restauração dos dados do sistema — exige a permissão 'backup'
// (admin sempre tem; um vendedor só se marcado no cadastro dele, ver
// utils/permissions.js). O backup contém tudo: vendas, financeiro,
// clientes, senhas com hash... Manual por decisão consciente: nada de
// permissão de downloads/alarms pra rodar sozinho — quem exporta escolhe
// quando (existe também um backup automático só no fechamento de caixa,
// ver views/caixa.js).
import {
  getCurrentCounts, buildBackupBlob, readBackupFile, applyBackup, resetOperationalData, STORE_LABELS,
} from '../data/backupRepo.js';
import { STORE_NAMES } from '../db.js';
import { logAction } from '../data/auditRepo.js';
import { clearSession } from '../session.js';
import { confirmUserPassword } from '../components/passwordConfirm.js';
import { showToast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import { escapeHtml } from '../utils/format.js';
import { icon } from '../components/icon.js';

const EXPORT_BTN_LABEL = `${icon('download', { size: 15 })} Gerar backup`;

const MIN_PASSWORD_LENGTH = 8;

// Exportadas (não só usadas aqui dentro) — views/caixa.js reaproveita as
// duas pro backup automático de segurança gerado ao fechar o caixa, em vez
// de duplicar a mesma lógica de nome de arquivo + download.
export function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// Recebe o Blob já pronto (ver data/backupRepo.js#buildBackupBlob) — não
// serializa nada aqui. Um `JSON.stringify` aqui, na thread principal, era
// exatamente o tipo de trabalho que causava o travamento da aba num backup
// grande (achado de auditoria) — por isso o arquivo inteiro já sai pronto
// da worker, e esta função só cria o link de download.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function countsTableHtml(counts, headerLabel) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Dados</th><th>${headerLabel}</th></tr></thead>
        <tbody>
          ${STORE_NAMES.map((name) => `<tr><td>${escapeHtml(STORE_LABELS[name] || name)}</td><td>${counts[name] ?? 0}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export async function renderBackup(container, ctx) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Backup</h1>
        <div class="desc">Exportar e restaurar todos os dados do sistema.</div>
      </div>
    </div>

    <div class="card" style="max-width:640px;margin-bottom:20px;">
      <p class="section-title">Exportar backup</p>
      <div class="notice">Gera um arquivo com <strong>todos</strong> os dados da loja (estoque, vendas, clientes, financeiro, usuários...), protegido pela senha que você definir agora. Sem essa senha, ninguém consegue abrir o arquivo — <strong>e nem existe "esqueci a senha"</strong>, guarde ela num lugar seguro.</div>
      <form id="export-form" novalidate>
        <div id="export-error"></div>
        <div class="form-row">
          <div class="field"><label for="export-pass">Senha do backup *</label><input id="export-pass" type="password" minlength="${MIN_PASSWORD_LENGTH}" required></div>
          <div class="field"><label for="export-pass2">Confirmar senha *</label><input id="export-pass2" type="password" minlength="${MIN_PASSWORD_LENGTH}" required></div>
        </div>
        <span class="hint">Mínimo de ${MIN_PASSWORD_LENGTH} caracteres. Pode ser diferente da sua senha de login.</span>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button type="submit" class="btn" id="export-btn">${EXPORT_BTN_LABEL}</button>
        </div>
      </form>
    </div>

    <div class="card" style="max-width:640px;">
      <p class="section-title">Restaurar backup</p>
      <div class="notice notice-danger"><strong>Atenção:</strong> restaurar um backup <strong>apaga todos os dados atuais</strong> do sistema e substitui pelos dados do arquivo. Não tem como desfazer. Use isso numa instalação nova, ou só se tiver certeza de que quer voltar pro estado do backup.</div>
      <form id="restore-form" novalidate>
        <div id="restore-error"></div>
        <div class="field"><label for="restore-file">Arquivo de backup *</label><input id="restore-file" type="file" accept=".json,application/json" required></div>
        <div class="field"><label for="restore-pass">Senha do backup *</label><input id="restore-pass" type="password" required></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button type="submit" class="btn btn-secondary" id="restore-read-btn">Ler backup</button>
        </div>
      </form>
      <div id="restore-preview"></div>
    </div>

    <div class="card" style="max-width:640px;margin-top:20px;">
      <p class="section-title">Zerar dados e reiniciar a operação</p>
      <div class="notice">
        Pensado pra depois de um período de teste ou de transição vindo de outro sistema de PDV: apaga tudo que é
        <strong>movimento</strong> e deixa a loja pronta pra operar de verdade — sem refazer nenhum cadastro.
      </div>
      <div class="notice notice-danger">
        <strong>Continuam intactos:</strong> estoque (produtos e a quantidade atual de cada um), dados da loja, usuários, fornecedores e clientes.<br>
        <strong>São apagados:</strong> vendas, sessões de caixa, contas financeiras, dívidas de fiado (o saldo de cada cliente volta a zero), carretos, pedidos de compra, pontos de fidelidade e o log de auditoria.<br>
        Não tem como desfazer — por isso um backup completo é gerado e baixado automaticamente antes de apagar qualquer coisa. Depois de zerar, use "Fazer inventário" em Estoque pra corrigir as quantidades com uma contagem física, se precisar.
      </div>
      <form id="reset-form" novalidate>
        <div id="reset-error"></div>
        <div class="form-row">
          <div class="field"><label for="reset-user">Usuário *</label><input id="reset-user"></div>
          <div class="field"><label for="reset-pass">Senha *</label><input id="reset-pass" type="password"></div>
        </div>
        <span class="hint">Confirma que é alguém autorizado — a mesma senha também protege o backup automático gerado antes de apagar.</span>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button type="submit" class="btn btn-danger" id="reset-btn">Zerar dados e reiniciar a operação</button>
        </div>
      </form>
    </div>
  `;

  // ---------- Exportar ----------
  document.getElementById('export-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('export-error');
    errBox.innerHTML = '';
    const pass = document.getElementById('export-pass').value;
    const pass2 = document.getElementById('export-pass2').value;

    if (pass.length < MIN_PASSWORD_LENGTH) {
      errBox.innerHTML = `<div class="form-error">A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.</div>`;
      return;
    }
    if (pass !== pass2) {
      errBox.innerHTML = '<div class="form-error">As senhas não coincidem.</div>';
      return;
    }

    const btn = document.getElementById('export-btn');
    btn.disabled = true;
    btn.textContent = 'Gerando...';
    try {
      const blob = await buildBackupBlob(pass);
      downloadBlob(blob, `backup-gestao-loja-${timestampForFilename()}.json`);
      await logAction({
        userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
        action: 'Backup exportado',
        details: `Backup completo dos dados exportado por "${ctx.user.nome}".`,
        entity: 'backup', entityId: 'export',
      });
      showToast('Backup gerado e baixado.', 'success');
      document.getElementById('export-form').reset();
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">Não foi possível gerar o backup: ${escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = EXPORT_BTN_LABEL;
    }
  });

  // ---------- Restaurar (ler + prévia + confirmar) ----------
  let pendingPayload = null;

  document.getElementById('restore-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('restore-error');
    const previewBox = document.getElementById('restore-preview');
    errBox.innerHTML = '';
    previewBox.innerHTML = '';
    pendingPayload = null;

    const fileInput = document.getElementById('restore-file');
    const pass = document.getElementById('restore-pass').value;
    const file = fileInput.files[0];
    if (!file) {
      errBox.innerHTML = '<div class="form-error">Selecione o arquivo de backup.</div>';
      return;
    }

    const btn = document.getElementById('restore-read-btn');
    btn.disabled = true;
    btn.textContent = 'Lendo...';
    try {
      const text = await file.text();
      const { payload, counts } = await readBackupFile(text, pass);
      const currentCounts = await getCurrentCounts();
      pendingPayload = payload;

      previewBox.innerHTML = `
        <p class="section-title" style="margin-top:20px;">Prévia — o que será substituído</p>
        <p class="hint" style="margin-bottom:10px;">Backup gerado em ${escapeHtml(new Date(payload.exportedAt).toLocaleString('pt-BR'))}.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div>${countsTableHtml(currentCounts, 'Atual')}</div>
          <div>${countsTableHtml(counts, 'No backup')}</div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button type="button" class="btn btn-danger" id="restore-confirm-btn">Restaurar e substituir tudo</button>
        </div>
      `;

      document.getElementById('restore-confirm-btn').addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Restaurar backup',
          message: 'Isso vai apagar todos os dados atuais e substituir pelos dados do backup. Essa ação não pode ser desfeita. Tem certeza?',
          confirmLabel: 'Sim, restaurar e apagar tudo',
          danger: true,
        });
        if (!ok || !pendingPayload) return;

        const confirmBtn = document.getElementById('restore-confirm-btn');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Restaurando...';
        // Achado de auditoria: applyBackup() é o único passo que pode
        // abortar a restauração inteira (erro aqui = nada foi trocado, o
        // catch abaixo é o certo). A PARTIR do sucesso dele, os dados já
        // foram substituídos de verdade — sem separar o logAction daqui,
        // uma falha nele (mesmo rara, ex: cota de armazenamento no limite
        // logo depois de gravar tudo de novo) caía no mesmo catch e dizia
        // "não foi possível restaurar" pra uma restauração que JÁ tinha
        // acontecido — o usuário podia tentar de novo achando que nada
        // mudou. Mesmo raciocínio já usado em views/caixa.js (fechamento)
        // e views/sale.js#commitSale (venda + carreto): separar o passo
        // que compromete o estado dos passos que só registram/avisam.
        try {
          await applyBackup(pendingPayload);
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">Não foi possível restaurar o backup: ${escapeHtml(err.message)}</div>`;
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Restaurar e substituir tudo';
          return;
        }
        try {
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Backup restaurado',
            details: `Backup restaurado por "${ctx.user.nome}" — todos os dados anteriores foram substituídos.`,
            entity: 'backup', entityId: 'restore',
          });
        } catch { /* dados já restaurados de verdade — log é só um extra, nunca desfaz nem esconde o sucesso */ }
        showToast('Backup restaurado. Faça login novamente.', 'success');
        await clearSession();
        setTimeout(() => location.reload(), 800);
      });
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ler backup';
    }
  });

  // ---------- Zerar dados e reiniciar a operação ----------
  document.getElementById('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('reset-error');
    errBox.innerHTML = '';

    const username = document.getElementById('reset-user').value.trim();
    const password = document.getElementById('reset-pass').value;
    if (!username || !password) {
      errBox.innerHTML = '<div class="form-error">Informe usuário e senha pra confirmar.</div>';
      return;
    }

    // Achado de auditoria: diferente do export-form/restore-form logo
    // acima (os dois desabilitam o botão ANTES de qualquer await), esta
    // versão inicial só desabilitava depois de verifyLogin()+confirmDialog()
    // já resolvidos — o botão "Zerar dados..." continuava clicável (e,
    // mais importante, o campo de senha continuava focado) durante os dois
    // awaits. Apertar Enter de novo bem rápido no campo de senha (sem
    // precisar nem clicar — o backdrop do modal cobre a tela mas não tira o
    // foco do campo por baixo dele) disparava um SEGUNDO submit em
    // paralelo: duas checagens de login, dois modais de confirmação
    // empilhados e, se os dois fossem confirmados, dois backups baixados e
    // duas chamadas a resetOperationalData() (inofensiva na segunda vez,
    // mas gera lixo). Desabilitar aqui, no topo — mesmo ponto em que
    // export-form/restore-form já fazem — fecha essa janela por completo:
    // Enter não reenvia formulário com o botão de submit desabilitado.
    const btn = document.getElementById('reset-btn');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    // Confirmação de identidade, não a checagem de permissão de verdade —
    // essa acontece dentro de resetOperationalData() (ver data/backupRepo.js),
    // sempre contra a sessão realmente logada nesta aba (ctx.user), pelo
    // mesmo raciocínio de applyBackup(). Aqui é só "alguém autorizado
    // confirmou de propósito" + a senha que protege o backup automático.
    const confirmingUser = await confirmUserPassword({ username, password, errBox, checkEmpty: false });
    if (!confirmingUser) {
      btn.disabled = false;
      btn.textContent = 'Zerar dados e reiniciar a operação';
      return;
    }

    const ok = await confirmDialog({
      title: 'Zerar dados e reiniciar a operação',
      message: 'Vendas, caixa, financeiro, fiado, carretos, compras, fidelidade e o log de auditoria serão apagados. Estoque, dados da loja, usuários, fornecedores e clientes continuam intactos. Um backup completo é baixado automaticamente antes. Essa ação não pode ser desfeita. Tem certeza?',
      confirmLabel: 'Sim, zerar e reiniciar',
      danger: true,
    });
    if (!ok) {
      btn.disabled = false;
      btn.textContent = 'Zerar dados e reiniciar a operação';
      return;
    }

    btn.textContent = 'Gerando backup de segurança...';

    // O backup de segurança é um PRÉ-REQUISITO da operação, não um extra:
    // diferente do backup automático de views/caixa.js (que roda DEPOIS de
    // um fechamento já consumado, só um aviso se falhar), aqui é a única
    // rede de segurança contra uma ação irreversível — se ele não sair,
    // o reinício nem começa.
    let blob;
    try {
      blob = await buildBackupBlob(password);
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">Não foi possível gerar o backup de segurança — o reinício foi cancelado, nada foi apagado. (${escapeHtml(err.message)})</div>`;
      btn.disabled = false;
      btn.textContent = 'Zerar dados e reiniciar a operação';
      return;
    }
    downloadBlob(blob, `backup-antes-reiniciar-${timestampForFilename()}.json`);

    btn.textContent = 'Zerando...';
    try {
      await resetOperationalData();
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">Não foi possível zerar os dados: ${escapeHtml(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Zerar dados e reiniciar a operação';
      return;
    }
    try {
      await logAction({
        userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
        action: 'Reinício de operação (zerar dados)',
        details: `Vendas, caixa, financeiro, fiado, carretos, compras, fidelidade e log anteriores foram apagados por "${confirmingUser.nome}" (${confirmingUser.username}) — estoque, dados da loja, usuários, fornecedores e clientes preservados. Backup de segurança gerado automaticamente antes.`,
        entity: 'backup', entityId: 'reset',
      });
    } catch { /* dados já zerados de verdade — log é só um extra, nunca desfaz nem esconde o sucesso */ }
    showToast('Dados zerados. Estoque, empresa, usuários, fornecedores e clientes continuam intactos.', 'success');
    setTimeout(() => location.reload(), 800);
  });
}
