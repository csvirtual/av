// Fase 7 (usuários/permissões): gestão de vendedores. O PRIMEIRO usuário do
// sistema inteiro (o Administrador Geral) nasce fora daqui — via seed.js,
// rodado uma vez na instalação do servidor (equivalente ao views/setup.js
// da extensão, que também roda antes de existir qualquer sessão). Daqui pra
// frente, só quem já tem a permissão 'usuarios' (montada em server.js) cria/
// edita/desativa/reseta senha de outras contas — e essas sempre nascem
// 'vendedor', nunca 'admin' (só existe UM jeito de virar admin: ser
// literalmente o primeiro usuário, decidido pelo seed.js, nunca por um
// parâmetro que um pedido HTTP possa forjar).
import { Router } from 'express';
import { db } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';
import { hashPassword } from '../lib/auth.js';
import { sanitizePermissions, PERMISSION_DEFS, MIN_USER_PASSWORD_LENGTH } from '../lib/permissions.js';
import { logAction } from '../lib/audit.js';

const router = Router();

const insertUserStmt = db.prepare('INSERT INTO users (id, username_lower, data) VALUES (@id, @usernameLower, @data)');
const updateUserStmt = db.prepare('UPDATE users SET data = @data WHERE id = @id');
// Só usado no PUT /:id, que agora também pode mudar o login (ver abaixo) —
// `username_lower` é uma COLUNA própria (não só um campo dentro do JSON de
// `data`), usada pra achar a conta no login (ver findByUsernameStmt.js/
// verifyLogin.js). Gravar só `data` e esquecer desta coluna deixaria o
// login antigo continuando a funcionar (e o novo, não) — sempre as duas
// juntas, na mesma escrita.
const updateUserFullStmt = db.prepare('UPDATE users SET data = @data, username_lower = @usernameLower WHERE id = @id');
const getUserStmt = db.prepare('SELECT data FROM users WHERE id = ?');
const findByUsernameStmt = db.prepare('SELECT data FROM users WHERE username_lower = ?');
const listUsersStmt = db.prepare('SELECT data FROM users');

function rowToUser(row) { return JSON.parse(row.data); }
function publicUser(u) { return { id: u.id, nome: u.nome, username: u.username, role: u.role, permissions: u.permissions, active: u.active, createdAt: u.createdAt }; }

router.get('/permission-defs', (req, res) => {
  res.json({ defs: PERMISSION_DEFS });
});

router.get('/', (req, res) => {
  const users = listUsersStmt.all().map(rowToUser).sort((a, b) => a.createdAt - b.createdAt);
  res.json({ users: users.map(publicUser) });
});

router.post('/', async (req, res) => {
  try {
    const nome = (req.body.nome || '').trim();
    const username = (req.body.username || '').trim();
    const usernameLower = username.toLowerCase();
    if (!usernameLower) throw new Error('Nome de usuário é obrigatório.');
    if (findByUsernameStmt.get(usernameLower)) throw new Error('Já existe um usuário com esse nome de login.');
    if (!req.body.password || req.body.password.length < MIN_USER_PASSWORD_LENGTH) throw new Error(`Informe uma senha com pelo menos ${MIN_USER_PASSWORD_LENGTH} caracteres.`);

    // Um vendedor com 'usuarios' só repassa os poderes que ele mesmo possui —
    // nunca concede a uma conta nova (nem à sua própria, mais tarde) um poder
    // que ele não tem. Só quem já É admin de verdade concede livremente.
    const requested = sanitizePermissions(req.body.permissions);
    const granted = req.userRole === 'admin'
      ? requested
      : Object.fromEntries(Object.keys(requested).map((key) => [key, requested[key] && !!req.userPermissions?.[key]]));

    const { salt, hash } = await hashPassword(req.body.password);
    const user = {
      id: crypto.randomUUID(),
      nome, username, usernameLower,
      role: 'vendedor',
      permissions: granted,
      passwordSalt: salt, passwordHash: hash,
      active: true,
      hasSeenAjuda: false,
      createdAt: Date.now(),
    };
    insertUserStmt.run({ id: user.id, usernameLower: user.usernameLower, data: JSON.stringify(user) });
    logAction({
      userId: req.userId, userName: req.userName, role: req.userRole,
      action: 'Cadastro de usuário', details: `Vendedor "${user.nome}" (${user.username}) cadastrado.`,
      entity: 'user', entityId: user.id,
    });
    broadcast('users-changed', { reason: 'created', id: user.id });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  if (req.params.id === req.userId) {
    return res.status(400).json({ error: 'Você não pode editar as próprias permissões — peça pra outra pessoa com acesso a Usuários fazer isso.' });
  }
  const row = getUserStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Usuário não encontrado.' });
  try {
    const user = rowToUser(row);
    if (user.role === 'admin') throw new Error('O Administrador Geral já tem acesso total — não há permissões pra editar nele.');
    if (req.body.nome !== undefined) {
      const nome = req.body.nome.trim();
      if (!nome) throw new Error('Nome é obrigatório.');
      user.nome = nome;
    }
    // Achado do usuário: só dava pra editar o nome completo — sem poder
    // trocar o login, não tinha como reaproveitar a conta de um vendedor
    // que saiu da loja pro próximo que entrar no lugar dele (precisava
    // desativar a antiga e cadastrar uma nova do zero, perdendo o
    // histórico de permissões já configurado). Mesma checagem de
    // duplicidade do cadastro (findByUsernameStmt), só que ignorando a
    // PRÓPRIA conta sendo editada — senão salvar sem mudar o login (ou só
    // mudando maiúsculas/minúsculas) sempre acusaria "duplicado" contra
    // si mesma.
    if (req.body.username !== undefined) {
      const username = req.body.username.trim();
      if (!username) throw new Error('Usuário de login é obrigatório.');
      const usernameLower = username.toLowerCase();
      if (usernameLower !== user.usernameLower) {
        const existing = findByUsernameStmt.get(usernameLower);
        if (existing && rowToUser(existing).id !== user.id) {
          throw new Error('Já existe um usuário com esse nome de login.');
        }
      }
      user.username = username;
      user.usernameLower = usernameLower;
    }
    if (req.body.permissions !== undefined) {
      const requested = sanitizePermissions(req.body.permissions);
      if (req.userRole === 'admin') {
        user.permissions = requested;
      } else {
        // Mesmo raciocínio do cadastro: um vendedor com 'usuarios' só MEXE
        // nos poderes que ele mesmo tem — pros que não tem, preserva o que
        // já estava gravado no alvo, nunca concede nem revoga por engano.
        const current = user.permissions || {};
        const next = {};
        for (const key of Object.keys(requested)) {
          next[key] = req.userPermissions?.[key] ? requested[key] : !!current[key];
        }
        user.permissions = next;
      }
    }
    updateUserFullStmt.run({ id: user.id, usernameLower: user.usernameLower, data: JSON.stringify(user) });
    logAction({
      userId: req.userId, userName: req.userName, role: req.userRole,
      action: 'Edição de usuário', details: `Cadastro de "${user.nome}" (${user.username}) atualizado.`,
      entity: 'user', entityId: user.id,
    });
    broadcast('users-changed', { reason: 'updated', id: user.id });
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Desativar precisa garantir que sobra pelo menos um admin ATIVO — senão o
 * sistema fica num beco sem saída administrativo (nenhum jeito de reativar
 * ninguém). Checagem e gravação na mesma transação, mesmo padrão do resto
 * do sistema. */
const commitSetActive = db.transaction((input) => {
  const row = getUserStmt.get(input.id);
  if (!row) throw new Error('Usuário não encontrado.');
  const user = rowToUser(row);
  if (!input.active && user.role === 'admin') {
    const all = listUsersStmt.all().map(rowToUser);
    const otherActiveAdmins = all.some((u) => u.id !== user.id && u.role === 'admin' && u.active);
    if (!otherActiveAdmins) {
      throw new Error('Não é possível desativar o único Administrador Geral ativo — o sistema ficaria sem nenhum admin.');
    }
  }
  user.active = input.active;
  updateUserStmt.run({ id: user.id, data: JSON.stringify(user) });
  return user;
});

router.post('/:id/ativo', (req, res) => {
  try {
    const user = commitSetActive({ id: req.params.id, active: !!req.body.active });
    logAction({
      userId: req.userId, userName: req.userName, role: req.userRole,
      action: user.active ? 'Reativação de usuário' : 'Desativação de usuário',
      details: `Conta de "${user.nome}" (${user.username}) ${user.active ? 'reativada' : 'desativada'}.`,
      entity: 'user', entityId: user.id,
    });
    broadcast('users-changed', { reason: 'active-toggled', id: user.id });
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/redefinir-senha', async (req, res) => {
  const row = getUserStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Usuário não encontrado.' });
  try {
    const user = rowToUser(row);
    // Redefinir a senha do próprio Administrador Geral continua possível,
    // mas só por quem já É admin de verdade — nunca por delegação via
    // 'usuarios' (senão um vendedor com essa permissão teria um jeito
    // indireto de tomar a conta do admin).
    if (user.role === 'admin' && req.userRole !== 'admin') {
      throw new Error('Apenas o Administrador Geral pode redefinir a própria senha.');
    }
    // Achado de auditoria (Fase 9, ao ligar views/users.js): faltava aqui
    // a mesma trava contra escalonamento de privilégio que
    // data/usersRepo.js#resetUserPassword da extensão já tem — sem isso,
    // um vendedor com a permissão 'usuarios' podia redefinir a senha de
    // OUTRO vendedor com MAIS poderes que ele, logar como essa pessoa e
    // herdar os poderes extras por uma porta lateral (updateUser, abaixo,
    // já fechava essa mesma classe de furo pra EDIÇÃO de permissões, mas
    // reset de senha nunca tinha essa checagem no servidor). Delegação
    // nunca pode dar mais poder do que quem delega já possui.
    if (user.role !== 'admin' && req.userRole !== 'admin') {
      const targetPerms = user.permissions || {};
      const actingPerms = req.userPermissions || {};
      const hasExtraPower = Object.keys(targetPerms).some((key) => targetPerms[key] && !actingPerms[key]);
      if (hasExtraPower) {
        throw new Error('Você não pode redefinir a senha de um usuário com mais poderes que você — peça pra um Administrador Geral fazer isso.');
      }
    }
    if (!req.body.newPassword || req.body.newPassword.length < MIN_USER_PASSWORD_LENGTH) {
      throw new Error(`Informe uma senha com pelo menos ${MIN_USER_PASSWORD_LENGTH} caracteres.`);
    }
    const { salt, hash } = await hashPassword(req.body.newPassword);
    user.passwordSalt = salt;
    user.passwordHash = hash;
    updateUserStmt.run({ id: user.id, data: JSON.stringify(user) });
    logAction({
      userId: req.userId, userName: req.userName, role: req.userRole,
      action: 'Redefinição de senha', details: `Senha de "${user.nome}" (${user.username}) redefinida.`,
      entity: 'user', entityId: user.id,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
