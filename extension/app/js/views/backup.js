// Backup e restauração dos dados do sistema — exclusivo do Administrador
// Geral (o backup contém tudo: vendas, financeiro, clientes, senhas com
// hash...). Manual por decisão consciente: nada de permissão de
// downloads/alarms pra rodar sozinho — o lojista escolhe quando exportar.
import {
  getCurrentCounts, buildBackupEnvelope, readBackupFile, applyBackup, STORE_LABELS,
} from '../data/backupRepo.js';
import { STORE_NAMES } from '../db.js';
import { logAction } from '../data/auditRepo.js';
import { clearSession } from '../session.js';
import { showToast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import { escapeHtml } from '../utils/format.js';

const MIN_PASSWORD_LENGTH = 8;

function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
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
        <div class="modal-actions" style="justify-content:flex-end;margin-top:14px;">
          <button type="submit" class="btn" id="export-btn">⬇️ Gerar backup</button>
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
        <div class="modal-actions" style="justify-content:flex-end;margin-top:14px;">
          <button type="submit" class="btn btn-secondary" id="restore-read-btn">Ler backup</button>
        </div>
      </form>
      <div id="restore-preview"></div>
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
      const envelope = await buildBackupEnvelope(pass);
      downloadJson(envelope, `backup-gestao-loja-${timestampForFilename()}.json`);
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
      btn.textContent = '⬇️ Gerar backup';
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
        <div class="modal-actions" style="justify-content:flex-end;margin-top:14px;">
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
        try {
          await applyBackup(pendingPayload);
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Backup restaurado',
            details: `Backup restaurado por "${ctx.user.nome}" — todos os dados anteriores foram substituídos.`,
            entity: 'backup', entityId: 'restore',
          });
          showToast('Backup restaurado. Faça login novamente.', 'success');
          await clearSession();
          setTimeout(() => location.reload(), 800);
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">Não foi possível restaurar o backup: ${escapeHtml(err.message)}</div>`;
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Restaurar e substituir tudo';
        }
      });
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ler backup';
    }
  });
}
