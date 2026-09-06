// Usuários do sistema: o primeiro cadastrado é sempre o Administrador Geral
// (role 'admin'); todos os demais nascem como 'vendedor'. Senhas nunca são
// gravadas em texto puro — ver auth.js.
import { dbGetAll, dbGet, dbAdd, dbGetByIndex, dbCount, dbUpdate, dbTransaction, newId } from '../db.js';
import { hashPassword, verifyPasswordHash } from '../auth.js';
import { getSessionUserId } from '../session.js';
import { sanitizePermissions, isAdmin, MIN_USER_PASSWORD_LENGTH } from '../utils/permissions.js';
import { getLoginLockState, recordFailedLogin, clearLoginLock } from '../loginLockout.js';

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

/** Generalização de assertActingUserIsAdmin pras ações que agora podem ser
 * delegadas a um vendedor específico via checkbox de permissão (ver
 * utils/permissions.js e views/users.js) — admin continua podendo tudo
 * sempre; um vendedor só passa se tiver `permissionKey` marcado no próprio
 * cadastro. Mesmo raciocínio de "nunca confiar em quem chamou": reconferido
 * aqui, contra o usuário realmente logado nesta sessão, não só escondido na
 * tela (botão/rota). Ações que precisam continuar travadas SÓ pro
 * Administrador Geral de verdade (nunca delegáveis) continuam usando
 * assertActingUserIsAdmin diretamente. */
export async function assertActingUserHasPermission(permissionKey) {
  const actingUserId = await getSessionUserId();
  const actingUser = actingUserId ? await dbGet('users', actingUserId) : null;
  if (!actingUser || !actingUser.active) {
    throw new Error('Sessão inválida — faça login novamente.');
  }
  if (isAdmin(actingUser)) return;
  if (!actingUser.permissions?.[permissionKey]) {
    throw new Error('Você não tem permissão para fazer isso.');
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
  await assertActingUserHasPermission('usuarios');
}

/** Cadastra um usuário novo. O primeiro usuário do sistema é forçado a ser
 * admin pela tela de setup (ver views/setup.js); daqui pra frente só quem
 * tem a permissão 'usuarios' chama isto (admin sempre tem; um vendedor só
 * se marcado no cadastro dele), sempre criando vendedores.
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
export async function createUser({ nome, username, password, permissions }) {
  await assertAllowedToCreateUser();
  const usernameLower = (username || '').trim().toLowerCase();
  if (!usernameLower) throw new Error('Nome de usuário é obrigatório.');
  if (await findByUsername(usernameLower)) {
    throw new Error('Já existe um usuário com esse nome de login.');
  }
  // Achado de auditoria: a checagem de tamanho mínimo só existia na TELA
  // (users.js/setup.js) — quem chamasse createUser direto (console do
  // navegador, ou um futuro código novo que esqueça de checar antes)
  // conseguia cadastrar senha de 1 caractere. Mesmo padrão do resto deste
  // arquivo: a garantia de verdade fica na fonte, não só na tela.
  if ((password || '').length < MIN_USER_PASSWORD_LENGTH) {
    throw new Error(`A senha deve ter pelo menos ${MIN_USER_PASSWORD_LENGTH} caracteres.`);
  }
  const isFirstUser = !(await hasAnyUser());
  const safeRole = isFirstUser ? 'admin' : 'vendedor';

  // Achado de auditoria (mesma classe do P2 acima, aplicado a permissões em
  // vez de role): sem isto, um vendedor com a permissão 'usuarios' podia
  // conceder ao vendedor que está criando QUALQUER poder — inclusive um que
  // ele mesmo não tem (ex: 'backup', 'financeiro') — bastando marcar a
  // caixinha no formulário. 'usuarios' viraria, sozinho, um jeito indireto
  // de qualquer vendedor virar "admin de fato": basta criar uma conta nova
  // com tudo marcado e logar nela. Só quem já É admin de verdade pode
  // conceder qualquer poder livremente; um vendedor só repassa os poderes
  // que ele mesmo possui (a tela já desabilita essas caixinhas pra deixar
  // isso visível, ver views/users.js, mas a garantia de verdade é sempre
  // aqui, na fonte).
  const actingUserId = await getSessionUserId();
  const actingUser = actingUserId ? await dbGet('users', actingUserId) : null;
  const requestedPermissions = sanitizePermissions(permissions);
  const grantedPermissions = isAdmin(actingUser)
    ? requestedPermissions
    : Object.fromEntries(Object.keys(requestedPermissions).map(
      (key) => [key, requestedPermissions[key] && !!actingUser?.permissions?.[key]],
    ));

  const { salt, hash } = await hashPassword(password);
  const record = {
    id: newId(),
    nome: (nome || '').trim(),
    username: (username || '').trim(),
    usernameLower,
    role: safeRole, // 'admin' | 'vendedor' — nunca o `role` recebido por parâmetro, ver comentário acima
    // Poderes individuais (ver utils/permissions.js) — só importam pra
    // vendedor; admin já pode tudo por ser admin (userCan() nem olha isto
    // pra ele). Sempre as 13 chaves conhecidas, nunca esparso.
    permissions: grantedPermissions,
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

/** Edita nome e/ou poderes de um vendedor já cadastrado. Nunca mexe em
 * username, senha (ver resetUserPassword) nem role — e nunca aceita editar o
 * Administrador Geral: ele não tem (nem precisa de) permissões marcáveis, já
 * pode tudo por ser admin, então "editar as permissões dele" não faz
 * sentido nenhum e só criaria confusão na tela.
 *
 * Achado de auditoria: um vendedor com a permissão 'usuarios' já pode gerir
 * QUALQUER outro vendedor — inclusive marcar nele permissões que o próprio
 * editor não tem (ex: 'backup', 'financeiro'). Isso por si só é intencional
 * (é a delegação que a tela pede), mas sem uma trava aqui esse mesmo
 * vendedor conseguia abrir "Editar" na PRÓPRIA linha da tabela e se
 * autoconceder todo o resto — 'usuarios' virando, sozinho, um jeito
 * indireto de virar admin de fato. Nunca permite editar a própria conta por
 * este caminho (ela é gerida de outros jeitos — perfil, senha via login
 * normal — não por aqui); alguém PRECISA de outra conta com 'usuarios' (ou
 * o admin) pra mudar essas permissões, igual qualquer sistema de permissão
 * decente não deixa ninguém aprovar a própria promoção. */
export async function updateUser(id, { nome, permissions } = {}) {
  await assertActingUserHasPermission('usuarios');
  const actingUserId = await getSessionUserId();
  if (id === actingUserId) {
    throw new Error('Você não pode editar as próprias permissões — peça pra outra pessoa com acesso a Usuários fazer isso.');
  }
  const actingUser = actingUserId ? await dbGet('users', actingUserId) : null;
  const actingIsAdmin = isAdmin(actingUser);
  return dbUpdate('users', id, (user) => {
    if (!user) throw new Error('Usuário não encontrado.');
    if (isAdmin(user)) throw new Error('O Administrador Geral já tem acesso total — não há permissões pra editar nele.');
    if (nome !== undefined) {
      const trimmed = nome.trim();
      if (!trimmed) throw new Error('Nome é obrigatório.');
      user.nome = trimmed;
    }
    if (permissions !== undefined) {
      const requested = sanitizePermissions(permissions);
      if (actingIsAdmin) {
        user.permissions = requested;
      } else {
        // Mesmo raciocínio de createUser acima: um vendedor com 'usuarios'
        // só pode MEXER nos poderes que ele mesmo tem (conceder ou tirar do
        // alvo, sua escolha) — pros poderes que ele mesmo não tem, o valor
        // que veio do formulário é ignorado e o que já estava gravado no
        // alvo é preservado tal qual, pra um clique em "Salvar" nunca
        // conceder por engano nem revogar por engano algo fora do alcance
        // de quem está editando (a tela já desabilita essas caixinhas, ver
        // views/users.js, mas a garantia de verdade é sempre aqui).
        const current = user.permissions || {};
        const next = {};
        for (const key of Object.keys(requested)) {
          next[key] = actingUser?.permissions?.[key] ? requested[key] : !!current[key];
        }
        user.permissions = next;
      }
    }
    return user;
  });
}

/** Achado de auditoria (P3): o bloqueio por força bruta (loginLockout.js)
 * só era aplicado pela TELA (views/login.js) — diferente de toda outra
 * função sensível deste arquivo (que reconfere permissão aqui, na fonte),
 * `verifyLogin` em si não tinha limite de tentativas nenhum. Uma chamada
 * direta (console do navegador, ou um caminho futuro que esqueça de passar
 * pela tela de login) conseguia testar senhas em looping sem trava alguma.
 * Agora o bloqueio é verificado e mantido AQUI — a tela continua lendo o
 * mesmo estado (loginLockout.js#getLoginLockState) só pra exibir o aviso/
 * contagem regressiva, não pra decidir se libera a tentativa. */
// Achado de auditoria (P1): `namespace` isola a trava de força-bruta de
// QUEM está chamando — o login de verdade (views/login.js, sem passar
// namespace) usa uma, e os três modais de "confirmar senha de admin"
// (aprovar desconto em sale.js, fechar caixa em caixa.js, zerar dados em
// backup.js — todos via components/passwordConfirm.js) usam outra
// própria, compartilhada só entre eles. Antes, os quatro dividiam a MESMA
// trava por nome de usuário: um vendedor errando a senha do admin 2x num
// desses modais bloqueava o LOGIN de verdade do admin por 60s, sem o
// admin nunca ter tentado logar — repetível à vontade, um jeito indireto
// de negar acesso ao próprio admin.
export async function verifyLogin(username, password, { namespace } = {}) {
  const lockState = await getLoginLockState(username, namespace);
  if (lockState.remainingMs > 0) return null;

  const user = await findByUsername(username);
  if (!user || !user.active) {
    await recordFailedLogin(username, namespace);
    return null;
  }
  const ok = await verifyPasswordHash(password, user.passwordSalt, user.passwordHash);
  if (!ok) {
    await recordFailedLogin(username, namespace);
    return null;
  }
  await clearLoginLock(username, namespace);
  return user;
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
  await assertActingUserHasPermission('usuarios');
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
        const otherActiveAdmins = getAllReq.result.some((u) => u.id !== id && isAdmin(u) && u.active);
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
  await assertActingUserHasPermission('usuarios');
  // Mesmo achado de auditoria do createUser acima — checagem de tamanho
  // mínimo só existia na tela (users.js).
  if ((newPassword || '').length < MIN_USER_PASSWORD_LENGTH) {
    throw new Error(`A senha deve ter pelo menos ${MIN_USER_PASSWORD_LENGTH} caracteres.`);
  }
  // Achado de auditoria: diferente de setUserActive/updateUser (que já
  // recusam mexer no alvo Administrador Geral), esta função não tinha
  // nenhuma checagem sobre QUEM está sendo resetado — com a permissão
  // 'usuarios' agora delegável a vendedor, isso abriria um jeito indireto de
  // um vendedor tomar a conta do admin (reseta a senha dele, loga como
  // admin). Redefinir a senha do próprio Administrador Geral continua
  // possível (ex: ele esqueceu a senha e outro admin não existe pra
  // ajudar), mas só por quem já É admin de verdade — nunca por delegação.
  const target = await dbGet('users', id);
  if (isAdmin(target)) {
    await assertActingUserIsAdmin();
  } else {
    // Achado de auditoria (P1): a checagem acima só cobria o alvo ser
    // admin — resetar a senha de um vendedor comum e logar como ele era
    // um jeito indireto de herdar QUALQUER poder que esse vendedor
    // tivesse, mesmo que quem fez o reset não tivesse esse poder — o
    // mesmo furo que updateUser (abaixo) já fecha pra edição de
    // permissões, só que por uma porta lateral (reset de senha) que
    // ninguém tinha fechado. Vale o mesmo raciocínio: delegação nunca
    // pode dar mais poder do que quem delega já possui.
    const actingUserId = await getSessionUserId();
    const actingUser = actingUserId ? await dbGet('users', actingUserId) : null;
    if (!isAdmin(actingUser)) {
      const targetPerms = target?.permissions || {};
      const actingPerms = actingUser?.permissions || {};
      const hasExtraPower = Object.keys(targetPerms).some((key) => targetPerms[key] && !actingPerms[key]);
      if (hasExtraPower) {
        throw new Error('Você não pode redefinir a senha de um usuário com mais poderes que você — peça pra um Administrador Geral fazer isso.');
      }
    }
  }
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
