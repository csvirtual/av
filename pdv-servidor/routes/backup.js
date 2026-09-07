// Fase 8 (segurança): exportar/restaurar backup completo, criptografado com
// a senha escolhida na hora. Acesso já gated pela permissão 'backup' no
// mount (server.js). Restaurar é a ação mais destrutiva do sistema inteiro
// (apaga TUDO e regrava) — por isso /preview existe: decifra e devolve só a
// contagem de cada tabela, pra tela pedir confirmação ANTES de aplicar de
// verdade (ver public/test.html).
import { Router } from 'express';
import { encryptPayload, decryptPayload } from '../lib/backupCrypto.js';
import { buildBackupPayload, applyBackupPayload, getCurrentCounts, BACKUP_FORMAT_VERSION, BACKUP_TABLES } from '../lib/backup.js';
import { logAction } from '../lib/audit.js';
import { broadcast } from '../lib/broadcast.js';

const router = Router();

router.post('/export', async (req, res) => {
  try {
    const password = req.body.password;
    if (!password || password.length < 4) throw new Error('Informe uma senha com pelo menos 4 caracteres pra proteger o backup.');
    const payload = buildBackupPayload();
    const envelope = await encryptPayload(payload, password);
    logAction({
      userId: req.userId, userName: req.userName, role: req.userRole,
      action: 'Exportação de backup', details: 'Backup completo gerado e baixado.', entity: 'backup', entityId: 'export',
    });
    res.json({ envelope });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Decifra e valida um arquivo de backup, sem gravar nada — devolve a
 * contagem de registros de cada tabela (arquivo x hoje), pra tela mostrar
 * um resumo e pedir confirmação antes de qualquer coisa destrutiva. */
router.post('/preview', async (req, res) => {
  try {
    const { envelope, password } = req.body;
    if (!envelope || !envelope.ciphertext || !envelope.salt || !envelope.iv) {
      throw new Error('Arquivo inválido — não parece ser um backup deste sistema.');
    }
    let payload;
    try {
      payload = await decryptPayload(envelope, password);
    } catch {
      throw new Error('Não foi possível abrir o backup — senha incorreta ou arquivo corrompido.');
    }
    if (!payload || typeof payload !== 'object' || !payload.tables) {
      throw new Error('Arquivo inválido — não parece ser um backup deste sistema.');
    }
    if (typeof payload.backupFormatVersion !== 'number' || payload.backupFormatVersion > BACKUP_FORMAT_VERSION) {
      throw new Error('Este arquivo de backup foi gerado por uma versão mais nova do sistema — atualize o servidor antes de restaurar.');
    }
    const fileCounts = {};
    for (const table of BACKUP_TABLES) fileCounts[table] = (payload.tables[table] || []).length;
    res.json({ fileCounts, currentCounts: getCurrentCounts(), exportedAt: payload.exportedAt });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/import', async (req, res) => {
  try {
    const { envelope, password } = req.body;
    if (!envelope || !envelope.ciphertext || !envelope.salt || !envelope.iv) {
      throw new Error('Arquivo inválido — não parece ser um backup deste sistema.');
    }
    let payload;
    try {
      payload = await decryptPayload(envelope, password);
    } catch {
      throw new Error('Não foi possível abrir o backup — senha incorreta ou arquivo corrompido.');
    }
    if (!payload || typeof payload !== 'object' || !payload.tables) {
      throw new Error('Arquivo inválido — não parece ser um backup deste sistema.');
    }
    if (typeof payload.backupFormatVersion !== 'number' || payload.backupFormatVersion > BACKUP_FORMAT_VERSION) {
      throw new Error('Este arquivo de backup foi gerado por uma versão mais nova do sistema — atualize o servidor antes de restaurar.');
    }
    applyBackupPayload(payload);
    logAction({
      userId: req.userId, userName: req.userName, role: req.userRole,
      action: 'Restauração de backup', details: 'TODOS os dados do sistema foram substituídos pelo conteúdo do arquivo restaurado.',
      entity: 'backup', entityId: 'import',
    });
    // Restauração troca TUDO — o jeito mais simples e seguro de todo
    // terminal conectado voltar a mostrar dados corretos é recarregar a
    // página inteira (ver public/test.html), em vez de tentar reconciliar
    // cada seção uma por uma.
    broadcast('backup-restored', {});
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
