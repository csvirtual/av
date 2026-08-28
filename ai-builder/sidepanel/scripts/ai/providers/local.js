// The default provider: 100% deterministic, 100% offline, $0 marginal cost.
// It is not a toy fallback — it is the primary path (spec §16 "economia de
// tokens" / §16 custo operacional). It handles the same `generate({task,...})`
// contract as the paid providers so the rest of the app never branches on
// "which provider is this".

const DOMAIN_DEFAULTS = [
  { match: /estoque|invent[aá]rio|almoxarifado/i, name: 'Controle de Estoque', entities: ['Produto', 'Fornecedor', 'Entrada', 'Saida'] },
  { match: /crm|clientes|vendas|comercial/i, name: 'CRM', entities: ['Cliente', 'Pedido'] },
  { match: /financeiro|caixa|fluxo de caixa|contas/i, name: 'Financeiro', entities: ['Transacao'] },
  { match: /tarefa|projeto|kanban|produtividade/i, name: 'Gestão de Projetos', entities: ['Tarefa'] },
  { match: /agend|reserva|booking/i, name: 'Agendamentos', entities: ['Cliente', 'Agendamento'] },
];

const FEATURE_PATTERNS = [
  [/pesquisa|busca/i, 'Pesquisa'],
  [/filtro/i, 'Filtros'],
  [/dashboard|painel/i, 'Dashboard'],
  [/relat[óo]rio/i, 'Relatórios'],
  [/hist[óo]rico/i, 'Histórico'],
  [/estoque m[íi]nimo|alerta/i, 'Alertas de estoque mínimo'],
  [/configura[çc][ãa]o/i, 'Configurações'],
  [/exporta[çc][ãa]o|exportar/i, 'Exportação'],
];

const SKIP_WORDS = new Set(['dashboard', 'pesquisa', 'busca', 'filtros', 'filtro', 'relatórios', 'relatorios', 'histórico', 'historico', 'configuração', 'configuracao', 'configurações', 'configuracoes']);

function singularize(word) {
  const w = word.trim();
  if (/ões$/i.test(w)) return w.replace(/ões$/i, 'ão');
  if (/res$/i.test(w) && w.length > 5) return w.replace(/es$/i, '');
  if (/[aeiouáéíóú]s$/i.test(w)) return w.replace(/s$/i, '');
  return w;
}

function titleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function extractEntitiesAndFeatures(prompt) {
  const features = [];
  for (const [re, label] of FEATURE_PATTERNS) if (re.test(prompt)) features.push(label);

  const match = prompt.match(/\bcom\s+(.+?)(?:\.|$)/i);
  const entities = [];
  if (match) {
    const chunk = match[1].replace(/\be\b/gi, ',');
    for (const raw of chunk.split(',')) {
      const token = raw.trim().replace(/^de\s+|^os\s+|^as\s+/i, '');
      if (!token) continue;
      const firstWord = token.split(/\s+/)[0];
      const key = firstWord.toLowerCase();
      if (SKIP_WORDS.has(key) || FEATURE_PATTERNS.some(([re]) => re.test(token))) continue;
      entities.push(titleCase(singularize(firstWord)));
    }
  }
  return { entities: [...new Set(entities)], features };
}

function detectDomain(prompt) {
  return DOMAIN_DEFAULTS.find((d) => d.match.test(prompt));
}

async function plan({ prompt }) {
  const { entities: extracted, features } = extractEntitiesAndFeatures(prompt);
  const domain = detectDomain(prompt);
  const entityNames = extracted.length ? extracted : domain?.entities || ['Item'];
  const name = domain?.name || (entityNames[0] ? `Gestão de ${entityNames[0]}s` : 'Meu Aplicativo');
  return {
    name,
    entities: entityNames.map((n) => ({ name: n })),
    features: features.length ? features : ['Pesquisa', 'Dashboard'],
  };
}

// Cheap, rule-based "improve this component" for the free tier. Real
// reasoning about UX quality is exactly the job the Anthropic/OpenAI
// providers are for — this only fixes the mechanical stuff.
async function improve({ node }) {
  const patch = { props: {}, style: {} };
  switch (node.type) {
    case 'Button':
      if (!node.props.label?.trim()) patch.props.label = 'Continuar';
      break;
    case 'Input':
      if (!node.props.label?.trim()) patch.props.label = 'Campo';
      if (!node.props.placeholder?.trim()) patch.props.placeholder = `Digite ${node.props.label || 'aqui'}`;
      break;
    case 'StatCard':
      if (!node.props.trend?.trim()) patch.props.trend = 'Atualizado agora';
      break;
    default:
      break;
  }
  return { patch, note: 'Ajustes mecânicos aplicados (provedor local). Configure Anthropic/OpenAI em Configurações para sugestões de UX mais profundas.' };
}

export const localProvider = {
  id: 'local',
  label: 'Local (grátis, offline)',
  requiresApiKey: false,
  async generate(task) {
    if (task.task === 'plan') return plan(task);
    if (task.task === 'improve') return improve(task);
    throw new Error(`Tarefa não suportada pelo provedor local: ${task.task}`);
  },
};
