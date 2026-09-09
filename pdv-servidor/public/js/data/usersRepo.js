// Usuários — versão multi-terminal. `verifyLogin` (Fase 9, passo 3) é o
// que components/passwordConfirm.js chama (confirmação pontual de senha
// de admin, sem criar sessão — aprovação de desconto em sale.js);
// `listUsers` (passo 7) é o que o filtro de vendedor de
// views/salesHistory.js precisa. `createUser`/permissões (usados por uma
// futura views/users.js portada) ficam pra quando essa tela for a vez.
import { api } from './apiClient.js';

/** Lista de vendedores/admins pra exibição — mesmo contrato de
 * app/js/data/usersRepo.js#listUsers() da extensão. */
export async function listUsers() {
  const { users } = await api('/api/users');
  return users;
}

/** Confirma usuário+senha sem logar como essa pessoa (ver
 * routes/auth.js#POST /verify) — devolve o usuário ou `null` pra
 * credencial inválida, mas LANÇA pra qualquer outra falha (rede,
 * servidor fora do ar) — mesma divisão de responsabilidade de
 * app/js/data/usersRepo.js#verifyLogin da extensão: quem chama
 * (components/passwordConfirm.js) já tem seu próprio try/catch pra
 * mostrar uma mensagem de erro decente nesse segundo caso, em vez de um
 * "senha inválida" enganoso quando na verdade o servidor caiu. */
export async function verifyLogin(username, password, { namespace } = {}) {
  const res = await fetch('/api/auth/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ username, password, namespace }),
  });
  if (res.status === 401) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
  return body.user;
}
