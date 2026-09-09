// Fase 7 (log): leitura do log de auditoria (gravado por lib/audit.js).
// Fase 9: grava também — client-side data/auditRepo.js#logAction (mesmo
// contrato de app/js/data/auditRepo.js da extensão) chama POST / depois
// de cada mutação bem-sucedida nas telas portadas (produtos, estoque...),
// mesmo padrão da extensão (a VIEW loga, não o repositório de dados —
// nenhum manageProducts/adjustStock etc. exige nem impõe log próprio).
//
// Permissão: só GET (leitura, ver views/logs.js) exige 'logs' — POST fica
// aberto a qualquer usuário autenticado (é só o registro de uma ação que
// já passou pelo gate certo em outro repositório, não uma ação nova em si
// — mesmo raciocínio do logAction() da extensão, sem permissão própria).
import { Router } from 'express';
import { db } from '../db/index.js';
import { requirePermission } from '../lib/permissions.js';
import { logAction } from '../lib/audit.js';

const router = Router();

// userId/userName/role NUNCA vêm do corpo do pedido — sempre resolvidos
// da sessão de verdade (req.userId/req.userName/req.userRole, ver
// server.js), mesmo princípio de "nunca confiar em quem está chamando"
// já aplicado em toda rota sensível deste servidor. action/details/
// entity/entityId são descritivos (o que aconteceu), sem risco de
// autorização — guardados como o cliente mandou, escapados só na hora de
// EXIBIR (mesmo padrão de views/logs.js da extensão via escapeHtml).
router.post('/', (req, res) => {
  const body = req.body || {};
  const record = logAction({
    userId: req.userId, userName: req.userName, role: req.userRole,
    action: String(body.action || ''), details: String(body.details || ''),
    entity: String(body.entity || ''), entityId: String(body.entityId || ''),
  });
  res.status(201).json({ entry: record });
});

/** Achado de auditoria (Fase 9, ao ligar views/logs.js): a versão anterior
 * desta rota sempre carregava a tabela `audit_log` INTEIRA na memória
 * (`listStmt.all()`) pra filtrar/paginar em JS — mesmo bug de performance
 * já corrigido antes em Vendas/Relatórios/Painel (ver dbScanByIndex em
 * db.js da extensão), só que este log NUNCA é apagado (só cresce com o
 * tempo de operação da loja), então seria a tela que mais sofreria disso.
 * Agora faz um scan em ORDEM via cursor de chave (timestamp, id) — os
 * filtros que o schema indexa de verdade (user_id, intervalo de
 * timestamp) entram direto no WHERE do SQL; `role` e `term` (sem coluna
 * própria, só dentro do JSON) continuam conferidos registro a registro
 * durante a varredura, mas parando assim que encontra `limit + 1`
 * combinações, nunca precisando materializar a tabela inteira — mesmo
 * espírito de app/js/data/auditRepo.js#listAuditLogPage da extensão
 * (dbScanByIndex: range no índice + predicado por linha + corte cedo). */
const scanStmt = db.prepare(`
  SELECT id, timestamp, data FROM audit_log
  WHERE (@userId IS NULL OR user_id = @userId)
    AND (@fromTs IS NULL OR timestamp >= @fromTs)
    AND (@toTs IS NULL OR timestamp <= @toTs)
    AND (@afterTs IS NULL OR timestamp < @afterTs OR (timestamp = @afterTs AND id < @afterId))
  ORDER BY timestamp DESC, id DESC
`);

router.get('/', requirePermission('logs'), (req, res) => {
  const { role, userId, term, fromTs, toTs, limit = 50, afterKey, afterId } = req.query;
  const lim = Math.min(200, Number(limit) || 50);
  const termLower = term ? String(term).toLowerCase() : null;

  const params = {
    userId: userId || null,
    fromTs: fromTs != null ? Number(fromTs) : null,
    toTs: toTs != null ? Number(toTs) : null,
    afterTs: afterKey != null ? Number(afterKey) : null,
    afterId: afterId || null,
  };

  const items = [];
  let hasMore = false;
  for (const row of scanStmt.iterate(params)) {
    const entry = JSON.parse(row.data);
    if (role && entry.role !== role) continue;
    if (termLower && !`${entry.action} ${entry.details}`.toLowerCase().includes(termLower)) continue;
    if (items.length >= lim) { hasMore = true; break; }
    items.push(entry);
  }

  const last = items[items.length - 1];
  res.json({
    items, entries: items, hasMore,
    nextKey: last ? last.timestamp : null, nextId: last ? last.id : null,
  });
});

export default router;
