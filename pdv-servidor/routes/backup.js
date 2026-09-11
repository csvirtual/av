// Fase 8 (segurança): exportar/restaurar backup completo, criptografado com
// a senha escolhida na hora. Acesso já gated pela permissão 'backup' no
// mount (server.js). Restaurar é a ação mais destrutiva do sistema inteiro
// (apaga TUDO e regrava) — por isso /preview existe: decifra e devolve só a
// contagem de cada tabela, pra tela pedir confirmação ANTES de aplicar de
// verdade (ver public/test.html).
import { Router } from 'express';
import { encryptPayload, decryptPayload, MIN_BACKUP_PASSWORD_LENGTH } from '../lib/backupCrypto.js';
import { buildBackupPayload, applyBackupPayload, getCurrentCounts, resetOperationalData, BACKUP_FORMAT_VERSION, BACKUP_TABLES } from '../lib/backup.js';
import { logAction } from '../lib/audit.js';
import { broadcast } from '../lib/broadcast.js';
import { getConfig, updateConfig } from '../lib/companyConfig.js';

const router = Router();

/** Só a contagem atual de cada tabela — usado pela tela de Backup pra
 * mostrar "o que existe hoje" mesmo fora do fluxo de restaurar (ver
 * data/backupRepo.js#getCurrentCounts no cliente, chamada solta da tela).
 * `lastBackupAt` (achado de auditoria, P2) vai junto — sem isso, a tela
 * nunca mostrava HÁ QUANTO TEMPO não sai um backup, e uma loja que só conta
 * com o gatilho automático do fechamento de caixa (ver
 * routes/cash.js#backup-fechamento) não tinha como perceber, sem abrir o
 * Log do sistema, se aquela rede de segurança estava realmente funcionando. */
router.get('/current-counts', (req, res) => {
  res.json({ counts: getCurrentCounts(), lastBackupAt: getConfig().lastBackupAt || null });
});

router.post('/export', async (req, res) => {
  try {
    const password = req.body.password;
    if (!password || password.length < MIN_BACKUP_PASSWORD_LENGTH) throw new Error(`Informe uma senha com pelo menos ${MIN_BACKUP_PASSWORD_LENGTH} caracteres pra proteger o backup.`);
    const payload = buildBackupPayload();
    const envelope = await encryptPayload(payload, password);
    updateConfig({ lastBackupAt: Date.now() });
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

/** Zera tudo que é MOVIMENTO (vendas, caixa, financeiro, fiado, carreto,
 * compras, fidelidade, crédito de troca, log de auditoria) preservando
 * estoque/empresa/usuários/fornecedores/clientes — ver lib/backup.js#
 * resetOperationalData. Quem chama já confirmou a identidade (senha) e já
 * gerou um backup de segurança do lado do cliente antes (ver
 * views/backup.js) — esta rota não pede senha de novo: a mesma permissão
 * 'backup' do mount já protege, e a confirmação de identidade específica
 * (usuário+senha) é só pra garantir que foi de propósito, não uma trava de
 * autorização adicional (mesmo raciocínio do reset-form na extensão). */
router.post('/reset', async (req, res) => {
  try {
    resetOperationalData();
    logAction({
      userId: req.userId, userName: req.userName, role: req.userRole,
      action: 'Reinício de operação (zerar dados)',
      details: 'Vendas, caixa, financeiro, fiado, carretos, compras, fidelidade, crédito de troca e log anteriores foram apagados — estoque, dados da loja, usuários, fornecedores e clientes preservados.',
      entity: 'backup', entityId: 'reset',
    });
    // Mesmo raciocínio do broadcast de /import acima: um reinício de
    // operação também troca dado que QUALQUER terminal pode estar
    // mostrando na tela agora (um caixa aberto em outro terminal, por
    // exemplo, deixa de existir) — recarregar a página inteira em todo
    // terminal conectado é o jeito mais simples e seguro de todos
    // voltarem a mostrar dados corretos.
    broadcast('data-reset', {});
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
