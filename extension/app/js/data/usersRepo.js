// Usuários do sistema: o primeiro cadastrado é sempre o Administrador Geral
// (role 'admin'); todos os demais nascem como 'vendedor'. Senhas nunca são
// gravadas em texto puro — ver auth.js.
import { dbGetAll, dbGet, dbAdd, dbGetByIndex, dbCount, dbUpdate, dbTransaction, newId } from '../db.js';
import { hashPassword, verifyPasswordHash } from '../auth.js';
import { getSessionUserId } from '../session.js';

/** Achado de auditoria: várias funções admin-only (aqui e em outros repos —
 * companyRepo.js, backupRepo.js, financeRepo.js, purchasesRepo.js,
 * suppliersRepo.js) eram protegidas só pela TELA (rota restrita a admin em
 * app.js) — as funções em si não checavam nada, então qualquer usuário com
 * acesso ao console do navegador podia chamá-las direto, contornando a
 * tela inteira (ex: resetUserPassword() na conta do próprio Administrador
 * Geral, sem senha nenhuma). Exportada daqui pra ser reaproveitada nos
 * outros repos, em vez de duplicar a mesma checagem em cada um. Não confia
 * em nenhum parâmetro que quem chamou possa forjar — vai direto na fonte (a
 * sessão realmente logada neste navegador agora, gravada em chrome.storage
 * por session.js) e confere o role gravado no banco pra ESSE usuário. */
export async function assertActingUserIsAdmin() {
  const actingUserId = await getSessionUserId();
  const actingUser = actingUserId ? await dbGet('users', actingUserId) : null;
  if (!actingUser || actingUser.role !== 'admin' || !actingUser.active) {
    throw new Error('Apenas o Administrador Geral pode fazer isso.');
  }
}

export async function hasAnyUser() {
  return (await dbCount('users')) > 0;
}

export async function getUser(id) {
  return dbGet('users', id);
}

export async function findByUsername(username) {
  return dbGetByIndex('users', 'byUsername', (username || '').trim().toLowerCase());
}

export async function listUsers() {
  const users = await dbGetAll('users');
  return users.sort((a, b) => a.createdAt - b.createdAt);
}

async function assertAllowedToCreateUser() {
  if (!(await hasAnyUser())) return; // cadastro do Administrador Geral, ainda sem sessão (setup.js)
  await assertActingUserIsAdmin();
}

/** Cadastra um usuário novo. O primeiro usuário do sistema é forçado a ser
 * admin pela tela de setup (ver views/setup.js); daqui pra frente só o admin
 * chama isto, sempre criando vendedores.
 *
 * Achado de auditoria: antes, esse "sempre criando vendedores" só valia
 * porque a TELA (views/users.js) sempre manda role:'vendedor' fixo — a
 * função em si aceitava qualquer valor de `role` sem checar nada. Um
 * vendedor com acesso ao console do navegador podia chamar createUser()
 * direto (contornando a tela inteira) pedindo role:'admin' e criar uma
 * conta de Administrador Geral pra si mesmo, sem senha de admin nenhuma
 * pra autorizar isso — mesma classe de bug que createSale() já fecha pro
 * desconto (nunca confiar em quem está chamando pra decidir uma coisa
 * sensível). Corrigido aqui: só existe UM jeito de nascer admin — ser
 * literalmente o primeiro usuário do sistema (a checagem abaixo, não o
 * valor que veio no parâmetro).
 *
 * Achado de auditoria (P2 — consistência): a checagem acima fecha a
 * escalação de privilégio (ninguém vira admin por fora do primeiro
 * cadastro), mas a função ainda aceitava CRIAR usuário vendedor a partir
 * de qualquer chamada, sem exigir sessão de admin — inconsistente com
 * todo o resto deste arquivo (setUserActive, resetUserPassword) e dos
 * outros repositórios sensíveis (backupRepo, financeRepo, purchasesRepo),
 * que sempre exigem a sessão realmente logada como admin. Mesmo não
 * sendo escalação de privilégio, um vendedor com acesso ao console
 * conseguia cadastrar contas extras não autorizadas. `assertAllowedToCreateUser`
 * segue o mesmo padrão de backupRepo.assertAllowedToApplyBackup: sem
 * exceção só na instalação nova de verdade, ainda sem ninguém logado
 * (setup.js chama isto antes de existir qualquer usuário). */
export async function createUser({ nome, username, password }) {
  await assertAllowedToCreateUser();
  const usernameLower = (username || '').trim().toLowerCase();
  if (!usernameLower) throw new Error('Nome de usuário é obrigatório.');
  if (await findByUsername(usernameLower)) {
    throw new Error('Já existe um usuário com esse nome de login.');
  }
  const isFirstUser = !(await hasAnyUser());
  const safeRole = isFirstUser ? 'admin' : 'vendedor';
  const { salt, hash } = await hashPassword(password);
  const record = {
    id: newId(),
    nome: (nome || '').trim(),
    username: (username || '').trim(),
    usernameLower,
    role: safeRole, // 'admin' | 'vendedor' — nunca o `role` recebido por parâmetro, ver comentário acima
    passwordSalt: salt,
    passwordHash: hash,
    active: true,
    // Controla o redirecionamento automático pra tela de Ajuda no
    // primeiríssimo login deste usuário (ver app.js) — nasce falso e vira
    // verdadeiro uma única vez, na hora desse redirecionamento.
    hasSeenAjuda: false,
    createdAt: Date.now(),
  };
  await dbAdd('users', record);
  return record;
}

export async function verifyLogin(username, password) {
  const user = await findByUsername(username);
  if (!user || !user.active) return null;
  const ok = await verifyPasswordHash(password, user.passwordSalt, user.passwordHash);
  return ok ? user : null;
}

/** Marca que este usuário já foi redirecionado pra Ajuda no primeiro login
 * (ver app.js) — daqui pra frente, login dele cai no Painel normalmente. */
export async function markAjudaSeen(id) {
  return dbUpdate('users', id, (user) => {
    if (!user) throw new Error('Usuário não encontrado.');
    user.hasSeenAjuda = true;
    return user;
  });
}

/** Achado de auditoria (P0 — GRAVE): esta função nunca impedia desativar o
 * ÚNICO Administrador Geral ativo do sistema. A tela (views/users.js) só
 * mostra o botão "Desativar" pra linhas de vendedor — nunca pra admin —
 * então isso é inalcançável pelo uso normal, mas era protegido SÓ pela
 * tela: qualquer chamada direta a esta função (console do navegador, ou
 * uma futura tela/atalho que esqueça dessa regra) conseguia desativar o
 * admin sem checagem nenhuma. Como só existe UM jeito de nascer admin —
 * ser literalmente o primeiro usuário do sistema (ver createUser acima) —
 * e restaurar um backup também exige um admin ativo logado (ver
 * backupRepo.assertAllowedToApplyBackup), desativar o único admin ativo
 * seria um beco sem saída: nenhum jeito de reativar ninguém, nenhum jeito
 * de restaurar um backup anterior, a loja inteira travada pra sempre nas
 * funções administrativas. Corrigido: agora a checagem "sobra pelo menos
 * um admin ativo depois dessa mudança" vive AQUI, na função, não só na
 * tela — mesmo raciocínio de "nunca confiar em quem está chamando" já
 * aplicado no resto deste arquivo. */
export async function setUserActive(id, active) {
  await assertActingUserIsAdmin();
  let validationError = null;
  await dbTransaction('users', 'readwrite', (transaction) => {
    const store = transaction.objectStore('users');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const user = getReq.result;
      if (!user) { validationError = 'Usuário não encontrado.'; return; }
      if (active || user.role !== 'admin') {
        store.put({ ...user, active });
        return;
      }
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const otherActiveAdmins = getAllReq.result.some((u) => u.id !== id && u.role === 'admin' && u.active);
        if (!otherActiveAdmins) {
          validationError = 'Não é possível desativar o único Administrador Geral ativo — o sistema ficaria sem nenhum admin, sem jeito de recuperar (nem a restauração de backup funciona sem um admin ativo logado).';
          return;
        }
        store.put({ ...user, active });
      };
    };
  });
  if (validationError) throw new Error(validationError);
}

export async function resetUserPassword(id, newPassword) {
  await assertActingUserIsAdmin();
  // hashPassword é assíncrono — precisa rodar ANTES do dbUpdate, cujo
  // updateFn é síncrono por definição (ver db.js). Não depende de ler o
  // usuário primeiro, então calcular o hash antes não muda a atomicidade
  // do get+put que segue.
  const { salt, hash } = await hashPassword(newPassword);
  return dbUpdate('users', id, (user) => {
    if (!user) throw new Error('Usuário não encontrado.');
    user.passwordSalt = salt;
    user.passwordHash = hash;
    return user;
  });
}
