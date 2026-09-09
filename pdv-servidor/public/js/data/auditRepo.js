// Log de auditoria — versão multi-terminal, mesmo contrato de
// app/js/data/auditRepo.js da extensão single-machine (mesma assinatura de
// logAction). Mesmo princípio de lá: quem CHAMA (a view, depois de uma
// mutação bem-sucedida noutro repositório) é quem loga — este módulo não
// impõe permissão nenhuma, só formata a chamada.
//
// `userId`/`userName`/`role` continuam aceitos aqui só pra manter a MESMA
// assinatura da extensão e as views funcionarem sem reescrita — mas nunca
// são enviados ao servidor: quem fez a ação é sempre resolvido lá a
// partir do cookie de sessão de verdade (ver routes/audit.js), nunca do
// que o cliente afirma ser (mesmo motivo de stockRepo.js#recordMovement).
import { api } from './apiClient.js';

export async function logAction({ userId, userName, role, action, details = '', entity = '', entityId = '' }) {
  void userId; void userName; void role; // aceitos só pra bater a assinatura da extensão — o servidor sempre resolve quem fez pela sessão de verdade, nunca por isto
  const { entry } = await api('/api/audit', { method: 'POST', body: JSON.stringify({ action, details, entity, entityId }) });
  return entry;
}
