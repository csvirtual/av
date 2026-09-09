// Usuários — versão multi-terminal. `verifyLogin` (Fase 9, passo 3) é o
// que components/passwordConfirm.js chama (confirmação pontual de senha
// de admin, sem criar sessão — aprovação de desconto em sale.js);
// `listUsers` (passo 7) é o que o filtro de vendedor de
// views/salesHistory.js precisa; o resto (passo 11) é o que
// views/users.js precisa.
import { api } from './apiClient.js';

/** Lista de vendedores/admins pra exibição — mesmo contrato de
 * app/js/data/usersRepo.js#listUsers() da extensão. */
export async function listUsers() {
  const { users } = await api('/api/users');
  return users;
}

/** Checagem otimista de "esse login já existe?", ANTES de tentar
 * cadastrar — mesmo contrato de findByUsername() da extensão, mas sem
 * rota própria no servidor (não existia motivo pra criar uma só pra
 * isso): filtra em memória sobre listUsers(), mesmo espírito de
 * productsRepo.js#searchProducts ("catálogo de usuários da loja é pequeno
 * o bastante"). A fonte de verdade continua sendo o servidor rejeitando
 * um username duplicado de qualquer jeito no createUser() abaixo — isso
 * aqui só evita a viagem de ida e volta óbvia. */
export async function findByUsername(username) {
  const usernameLower = (username || '').trim().toLowerCase();
  if (!usernameLower) return null;
  const users = await listUsers();
  return users.find((u) => u.username.toLowerCase() === usernameLower) || null;
}

export async function createUser({ nome, username, password, permissions }) {
  const { user } = await api('/api/users', {
    method: 'POST',
    body: JSON.stringify({ nome, username, password, permissions }),
  });
  return user;
}

export async function updateUser(id, { nome, permissions } = {}) {
  const { user } = await api(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ nome, permissions }),
  });
  return user;
}

export async function setUserActive(id, active) {
  const { user } = await api(`/api/users/${encodeURIComponent(id)}/ativo`, {
    method: 'POST',
    body: JSON.stringify({ active }),
  });
  return user;
}

export async function resetUserPassword(id, newPassword) {
  // Servidor devolve só { ok: true } (não o usuário) — a extensão
  // também não devolve nada útil aqui (dbUpdate por baixo, mas
  // views/users.js#confirmResetPassword nunca usa o retorno), então
  // não há contrato de valor de volta pra preservar.
  await api(`/api/users/${encodeURIComponent(id)}/redefinir-senha`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
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
