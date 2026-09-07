// Fase 7 (usuários/permissões/log): mesmos 13 poderes que o Administrador
// Geral pode conceder individualmente a um vendedor, portados de
// app/js/utils/permissions.js da extensão. O admin sempre tem tudo (não é
// uma permissão marcável); um vendedor só pode o que estiver marcado no
// cadastro dele. Algumas chaves aqui (empresa, backup, relatorios) ainda não
// têm uma tela/rota correspondente no servidor — ficam definidas mesmo assim
// pra já existir o checkbox certo em Usuários quando essas fases forem
// construídas, e pra nenhum backup/restauração antigo perder o campo.
export const PERMISSION_DEFS = [
  { key: 'compras', label: 'Acessar Compras (fornecedores e pedidos)', group: 'Telas' },
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

/** true se `role`+`permissions` (do usuário AGINDO) cobre `permissionKey` —
 * admin sempre pode tudo. */
export function userCan(role, permissions, permissionKey) {
  if (role === 'admin') return true;
  return !!permissions?.[permissionKey];
}

/** Sempre grava um objeto com as 13 chaves conhecidas (nunca esparso) —
 * ignora qualquer chave desconhecida que venha em `input`. */
export function sanitizePermissions(input) {
  const result = {};
  for (const key of PERMISSION_KEYS) result[key] = !!input?.[key];
  return result;
}

/** Middleware de rota: exige que o usuário logado (já resolvido por
 * server.js em req.userRole/req.userPermissions) tenha `permissionKey` —
 * cobre tanto "acesso à tela inteira" (montado na raiz do router, ex:
 * app.use('/api/finance', requireAuth, requirePermission('financeiro'), ...))
 * quanto uma ação específica dentro de uma rota já montada. Nunca confia em
 * nada que o pedido tenha mandado — sempre o role/permissions resolvidos do
 * banco pela sessão de verdade (ver server.js). */
export function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!userCan(req.userRole, req.userPermissions, permissionKey)) {
      return res.status(403).json({ error: 'Você não tem permissão para fazer isso.' });
    }
    next();
  };
}
