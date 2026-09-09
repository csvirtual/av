// Poderes que o Administrador Geral pode conceder individualmente a cada
// vendedor, no cadastro ou na edição dele (ver views/users.js). O admin
// sempre tem todos — nunca precisa (nem pode) ter isso desmarcado, ver
// userCan() abaixo. Cada chave aqui é checada tanto na tela (esconder botão/
// rota) quanto no repositório correspondente (ver data/*.js), do mesmo jeito
// que o sistema já fazia pra "é admin?" antes desta mudança — nunca confiar
// só na tela pra decidir algo sensível.
// Tamanho mínimo da senha de uma conta de usuário (cadastro e redefinição) —
// diferente da senha do backup (MIN_PASSWORD_LENGTH em views/backup.js, que
// tem sua própria regra). Repetido em cadastro inicial e nos dois modais de
// usuários antes desta constante existir.
export const MIN_USER_PASSWORD_LENGTH = 6;

export const PERMISSION_DEFS = [
  { key: 'compras', label: 'Acessar Compras', group: 'Telas' },
  { key: 'financeiro', label: 'Acessar Financeiro', group: 'Telas' },
  { key: 'relatorios', label: 'Acessar Relatórios', group: 'Telas' },
  { key: 'usuarios', label: 'Acessar Usuários', group: 'Telas' },
  { key: 'logs', label: 'Acessar Log do sistema', group: 'Telas' },
  { key: 'empresa', label: 'Acessar Dados da loja', group: 'Telas' },
  { key: 'backup', label: 'Acessar Backup', group: 'Telas' },
  { key: 'manageProducts', label: 'Cadastrar/editar produto', group: 'Estoque' },
  { key: 'adjustStock', label: 'Ajustar estoque manualmente e fazer inventário', group: 'Estoque' },
  { key: 'toggleProduct', label: 'Inativar/reativar produto', group: 'Estoque' },
  { key: 'deleteProduct', label: 'Excluir produto', group: 'Estoque' },
  { key: 'deleteCustomer', label: 'Excluir cliente', group: 'Clientes' },
  { key: 'unlimitedDiscount', label: 'Aplicar desconto acima do limite sem aprovação', group: 'Vendas' },
];

const PERMISSION_KEYS = PERMISSION_DEFS.map((p) => p.key);

/** true se `user` é o Administrador Geral — checagem única usada em toda a
 * extensão (tela e repositório) em vez de comparar `role === 'admin'` à mão
 * em cada lugar, pra nunca haver um typo/comparação diferente entre uma
 * checagem e outra. Segura pra `user` nulo/indefinido. */
export function isAdmin(user) {
  return user?.role === 'admin';
}

/** true se `user` pode fazer a ação de `permissionKey` — admin sempre pode
 * tudo (não é uma permissão marcável, é a própria natureza do papel); um
 * vendedor só pode o que estiver marcado no cadastro dele. */
export function userCan(user, permissionKey) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return !!user.permissions?.[permissionKey];
}

/** Sempre grava um objeto com as 13 chaves conhecidas (nunca esparso) — fica
 * explícito no registro do usuário exatamente quais poderes ele tem, sem
 * depender de `undefined` ser tratado como "falso" em todo lugar que ler
 * isso depois. Ignora qualquer chave desconhecida que venha em `input`. */
export function sanitizePermissions(input) {
  const result = {};
  for (const key of PERMISSION_KEYS) result[key] = !!input?.[key];
  return result;
}
