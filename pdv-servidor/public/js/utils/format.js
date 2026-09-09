// Formatação de moeda, data e hora — tudo em pt-BR, usando Intl (nativo do
// navegador, sem biblioteca externa).
const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

export function formatMoney(value) {
  return currencyFormatter.format(Number(value) || 0);
}

// Achado de auditoria: Intl.DateTimeFormat#format joga RangeError pra
// qualquer timestamp que não vire uma data válida (NaN, string que não é
// data, etc.) — e como isso é chamado direto dentro de template literals
// espalhados pela tela inteira, um valor assim quebrava a RENDERIZAÇÃO
// INTEIRA daquela tela (não só o campo em questão), sem toast nem erro
// amigável nenhum, só a tela sumindo. Na prática isso só ficou alcançável
// depois que campos de data ficaram OPCIONAIS e editáveis por fora do fluxo
// que sempre garantia um valor bom (ex: customer.debtDueDate, ver
// data/customersRepo.js) — mas nunca custa nada blindar aqui também, pra
// nenhuma tela inteira depender de todo campo de data upstream estar
// perfeito.
function safeDate(timestamp) {
  const d = new Date(timestamp);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(timestamp) {
  const d = safeDate(timestamp);
  return d ? dateFormatter.format(d) : '—';
}

export function formatDateTime(timestamp) {
  const d = safeDate(timestamp);
  return d ? dateTimeFormatter.format(d) : '—';
}

// Produto com unidade 'personalizado' (ver data/productsRepo.js) não tem uma
// sigla de unidade real (kg, un, L...) — quem cadastrou digitou um nome
// próprio (ex: "lata") pra rotular a quantidade única de estoque que esse
// produto controla, mesmo vendendo em várias formas diferentes (lata, metro,
// carrada — ver customForms). Todo lugar que mostra "quantidade + unidade"
// de um PRODUTO (não de um item já vendido, que já carrega seu próprio rótulo
// — ver data/salesRepo.js#createSale) usa isto em vez de `product.unit` direto.
export function displayUnit(product) {
  if (product?.unit === 'personalizado') return product.customUnitLabel || 'un';
  return product?.unit || 'un';
}

// Quantidade em unidade fracionária (ex: 0,5 metro, 1,5 kg, ou o fator de
// conversão de uma forma de venda personalizada, ex: 0,018) — igual
// formatMoney, mas pra números de quantidade/estoque, não dinheiro. Achado
// do usuário: `toFixed(2)` arredondava um valor digitado de propósito (ex:
// 0,018 virava "0,02") — 6 casas cobre os casos reais de loja (frações de
// m³, litro de lata etc.) sem exibir lixo de ponto flutuante de uma divisão
// que não fecha redondo.
export function formatQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  const rounded = Math.round(n * 1e6) / 1e6;
  return String(rounded).replace('.', ',');
}

// Só os dígitos de uma string — base de toda máscara/validação de
// documento e telefone do sistema (CNPJ, CPF, CEP, telefone). Fica aqui,
// não em nenhum utils/<documento>.js específico, porque é usado por vários
// deles ao mesmo tempo, sem nenhum ser "dono" natural da regra.
export function onlyDigits(str) {
  return (str || '').replace(/\D/g, '');
}

// Rótulo de exibição de cada categoria de produto (ver data/productsRepo.js)
// — uma única fonte pras 3 telas que precisam mostrar isso (Estoque,
// Relatórios, PDF de relatório), em vez de repetir o mesmo par de strings.
export const CATEGORY_LABELS = { material: 'Material de construção', mercearia: 'Mercearia' };
export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || escapeHtml(category);
}

// Siglas de UF — mesma lista usada nos dois formulários de dados da loja
// (cadastro inicial e edição em Dados da loja), em vez de duas cópias.
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

// As 4 formas de pagamento que valem em QUALQUER tela (dinheiro entra ou
// sai de verdade, na hora): Caixa e Clientes (pagar fiado) usam só isso.
// Financeiro soma "Transferência" (pagamento de conta por banco, sem
// relação com fiado); Nova venda soma "Fiado" (a venda em si pode virar
// dívida do cliente). As duas extras não valem pra tudo, então cada tela
// as adiciona por conta própria em vez de uma lista única forçada.
export const BASE_PAYMENT_METHODS = ['Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Pix'];

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
