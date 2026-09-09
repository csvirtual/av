// Backup — versão multi-terminal. Escopo desta primeira fatia: só
// `buildAutomaticCashCloseBackup`, o que views/caixa.js chama sozinha ao
// fechar um caixa (ver POST /api/cash/backup-fechamento, de propósito fora
// do router de Backup real — mesmo raciocínio da extensão, ver comentário
// da rota). `buildBackupBlob`/`readBackupFile`/`applyBackup` (usados por
// uma futura views/backup.js portada, com a permissão 'backup' de
// verdade) ficam pra quando essa tela for a vez — o servidor já tem as
// rotas prontas desde a Fase 8 (routes/backup.js), só falta o cliente.
import { api } from './apiClient.js';

/** Gera e devolve um Blob do backup completo, cifrado com `password` —
 * mesmo contrato de data/backupRepo.js#buildAutomaticCashCloseBackup() da
 * extensão (nenhuma permissão exigida aqui, de propósito: ver o
 * comentário da rota server-side). O servidor devolve o envelope já
 * cifrado como JSON; o Blob é só o mesmo JSON serializado, pronto pra
 * downloadBlob() (ver views/backup.js). */
export async function buildAutomaticCashCloseBackup(password) {
  const { envelope } = await api('/api/cash/backup-fechamento', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  return new Blob([JSON.stringify(envelope)], { type: 'application/json' });
}
