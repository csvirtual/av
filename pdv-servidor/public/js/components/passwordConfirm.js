// Confirmação de identidade por usuário+senha — núcleo repetido nos 3
// pontos sensíveis a dinheiro/segurança da extensão (fechar caixa, aprovar
// desconto acima do limite do vendedor, zerar dados em Backup). Só a parte
// que é IDÊNTICA nos três (chamar verifyLogin, escrever o erro em errBox)
// vem pra cá — cada chamador mantém sua própria estrutura de tela (modal
// vs. formulário solto) e suas próprias regras de quando checar campo
// vazio e se exige admin, porque essas divergem DE PROPÓSITO entre os três
// (auditado — não é acidente, ver comentário de cada chamador).
import { verifyLogin } from '../data/usersRepo.js';
import { isAdmin } from '../utils/permissions.js';
import { escapeHtml } from '../utils/format.js';

/** Devolve o usuário confirmado, ou `null` se falhou — já com a mensagem
 * de erro escrita em `errBox` nesse caso, então quem chama só precisa
 * conferir o retorno. */
export async function confirmUserPassword({
  username,
  password,
  errBox,
  checkEmpty = true,
  emptyMessage = 'Informe usuário e senha pra confirmar.',
  requireAdmin = false,
  invalidMessage = 'Usuário ou senha inválidos.',
}) {
  if (checkEmpty && (!username || !password)) {
    errBox.innerHTML = `<div class="form-error">${emptyMessage}</div>`;
    return null;
  }
  let user;
  try {
    // namespace próprio (ver usersRepo.js#verifyLogin): a trava de força-
    // bruta daqui nunca deve bloquear o login de verdade do admin.
    user = await verifyLogin(username, password, { namespace: 'confirmPassword' });
  } catch (err) {
    errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
    return null;
  }
  if (!user || (requireAdmin && !isAdmin(user))) {
    errBox.innerHTML = `<div class="form-error">${invalidMessage}</div>`;
    return null;
  }
  return user;
}
