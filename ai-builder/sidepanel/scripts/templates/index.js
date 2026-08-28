// Composable page/entity builders. Both the free local planner
// (ai/providers/local.js) and the LLM-backed one (ai/providers/anthropic.js,
// openai.js) produce the SAME kind of structured plan (pages + entities +
// features — see ai/schema.js) and both hand it to `assemblePlan()` here.
// The LLM never writes a component tree itself — it only decides *what*
// pages/entities/features an app needs; *how* those become an actual tree of
// Button/DataTable/Card nodes is always this deterministic code. That's the
// boundary that keeps AI-authored apps from ever containing a broken or
// invented component type.
import { createProject, createPage, createNode, createEntity } from '../data/project.js';

// Known domain vocab -> sensible default fields. Falls back to a generic
// name/description/status shape for anything not recognized, so an entity
// the planner has never heard of still produces a usable CRUD page.
const FIELD_PRESETS = {
  produto: [
    { key: 'nome', label: 'Nome', type: 'text' },
    { key: 'categoria', label: 'Categoria', type: 'text' },
    { key: 'preco', label: 'Preço', type: 'number' },
    { key: 'quantidade', label: 'Quantidade', type: 'number' },
    { key: 'estoqueMinimo', label: 'Estoque mínimo', type: 'number' },
  ],
  fornecedor: [
    { key: 'nome', label: 'Nome', type: 'text' },
    { key: 'contato', label: 'Contato', type: 'text' },
    { key: 'telefone', label: 'Telefone', type: 'tel' },
    { key: 'email', label: 'E-mail', type: 'email' },
  ],
  cliente: [
    { key: 'nome', label: 'Nome', type: 'text' },
    { key: 'telefone', label: 'Telefone', type: 'tel' },
    { key: 'email', label: 'E-mail', type: 'email' },
    { key: 'status', label: 'Status', type: 'text' },
  ],
  entrada: [
    { key: 'produto', label: 'Produto', type: 'text' },
    { key: 'quantidade', label: 'Quantidade', type: 'number' },
    { key: 'fornecedor', label: 'Fornecedor', type: 'text' },
    { key: 'data', label: 'Data', type: 'date' },
  ],
  saida: [
    { key: 'produto', label: 'Produto', type: 'text' },
    { key: 'quantidade', label: 'Quantidade', type: 'number' },
    { key: 'destino', label: 'Destino', type: 'text' },
    { key: 'data', label: 'Data', type: 'date' },
  ],
  pedido: [
    { key: 'numero', label: 'Número', type: 'text' },
    { key: 'cliente', label: 'Cliente', type: 'text' },
    { key: 'total', label: 'Total', type: 'number' },
    { key: 'status', label: 'Status', type: 'text' },
  ],
  tarefa: [
    { key: 'titulo', label: 'Título', type: 'text' },
    { key: 'responsavel', label: 'Responsável', type: 'text' },
    { key: 'prazo', label: 'Prazo', type: 'date' },
    { key: 'status', label: 'Status', type: 'text' },
  ],
  transacao: [
    { key: 'descricao', label: 'Descrição', type: 'text' },
    { key: 'categoria', label: 'Categoria', type: 'text' },
    { key: 'valor', label: 'Valor', type: 'number' },
    { key: 'data', label: 'Data', type: 'date' },
  ],
};

const GENERIC_FIELDS = [
  { key: 'nome', label: 'Nome', type: 'text' },
  { key: 'descricao', label: 'Descrição', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
];

function normalize(word) {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function fieldsForEntity(entityName) {
  const key = normalize(entityName);
  return FIELD_PRESETS[key] || GENERIC_FIELDS;
}

const SAMPLE_WORDS = ['Alfa', 'Beta', 'Central', 'Norte', 'Premium', 'Express', 'Básico', 'Plus'];

export function seedRowsForEntity(entityName, fields, count = 4) {
  return Array.from({ length: count }, (_, i) => {
    const row = { id: `seed_${normalize(entityName)}_${i}` };
    for (const f of fields) {
      if (f.type === 'number') row[f.key] = (i + 1) * (f.key.toLowerCase().includes('preco') || f.key.toLowerCase().includes('valor') || f.key.toLowerCase().includes('total') ? 49.9 : 10);
      else if (f.type === 'date') row[f.key] = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      else if (f.type === 'email') row[f.key] = `contato${i + 1}@exemplo.com`;
      else row[f.key] = `${f.label} ${SAMPLE_WORDS[i % SAMPLE_WORDS.length]}`;
    }
    return row;
  });
}

// Portuguese pluralization is irregular enough that "just append s" gets
// common cases wrong (Fornecedor -> "Fornecedors" instead of "Fornecedores").
// This covers the endings that actually show up in domain nouns; anything
// else falls back to the naive "+s", same as before.
function pluralize(word) {
  if (/[rz]$/i.test(word)) return `${word}es`;
  if (/ão$/i.test(word)) return word.replace(/ão$/i, 'ões');
  if (/l$/i.test(word)) return word.replace(/l$/i, 'is');
  if (/s$/i.test(word)) return word;
  return `${word}s`;
}

function slug(name) {
  return `/${normalize(name).replace(/\s+/g, '-')}`;
}

export function buildSidebar(pages) {
  return createNode('Sidebar', {
    title: 'Menu',
    links: pages.map((p) => ({ label: p.name, href: `#${p.route}` })),
  });
}

function shell(pages, ...content) {
  return createNode('Stack', { direction: 'row', gap: '0' }, [
    buildSidebar(pages),
    createNode('Container', { maxWidth: '80rem' }, [createNode('Stack', { direction: 'column', gap: '5' }, content)]),
  ]);
}

export function buildDashboardPage(appName, entities, pages) {
  const kpis = createNode(
    'Grid',
    { minColumnWidth: '200px', gap: '4' },
    entities.slice(0, 4).map((e) =>
      Object.assign(createNode('StatCard', { label: `${pluralize(e.name)} cadastrados`, value: '0', variant: 'neutral' }), {
        bind: { entity: e.name, agg: 'count' },
      })
    )
  );
  const body = [
    createNode('Header', { title: appName, subtitle: 'Visão geral' }),
    entities.length ? kpis : createNode('EmptyState', { title: 'Nenhum dado ainda', description: 'Cadastre o primeiro registro para ver os indicadores aqui.' }),
    createNode('Card', { title: 'Bem-vindo' }, [
      createNode('Alert', { text: `Aplicação gerada automaticamente a partir da sua descrição. Use o menu lateral para navegar entre ${entities.map((e) => `${e.name}s`).join(', ') || 'as páginas'}.`, variant: 'info' }),
    ]),
  ];
  return createPage('Dashboard', '/', shell(pages, ...body));
}

export function buildEntityListPage(entity, pages) {
  const fields = entity.fields;
  const formFields = fields.map((f) => createNode('Input', { label: f.label, name: f.key, inputType: f.type === 'text' ? 'text' : f.type }));
  const form = Object.assign(createNode('Form', { submitLabel: 'Salvar' }, [...formFields, createNode('Button', { label: 'Salvar', variant: 'primary', type: 'submit' })]), {
    bind: { entity: entity.name },
  });
  const modal = createNode('Modal', { title: `Novo ${entity.name}`, triggerLabel: `+ Novo ${entity.name}` }, [form]);
  const table = Object.assign(
    createNode('DataTable', { columns: fields.map((f) => ({ key: f.key, label: f.label })), pageSize: 8, searchable: true }),
    { bind: { entity: entity.name } }
  );
  const plural = pluralize(entity.name);
  const body = [
    createNode('Header', { title: plural, subtitle: `Cadastro e consulta de ${plural.toLowerCase()}` }, [modal]),
    createNode('Card', {}, [table]),
  ];
  return createPage(plural, slug(plural), shell(pages, ...body));
}

export function buildSettingsPage(appName, pages) {
  const body = [
    createNode('Header', { title: 'Configurações', subtitle: appName }),
    createNode('Card', { title: 'Preferências' }, [
      createNode('Form', {}, [
        createNode('Input', { label: 'Nome da aplicação', name: 'appName' }),
        createNode('Switch', { label: 'Modo compacto', name: 'compact' }),
        createNode('Button', { label: 'Salvar configurações', variant: 'primary', type: 'submit' }),
      ]),
    ]),
  ];
  return createPage('Configurações', '/configuracoes', shell(pages, ...body));
}

/**
 * Turns a structured AppPlan (see ai/schema.js) into a full, ready-to-run
 * Project — pages built from real component nodes, entities with default
 * fields, and seed data so the preview is never an empty shell.
 */
export function assemblePlan(appPlan) {
  const project = createProject(appPlan.name || 'Novo projeto');
  const entities = (appPlan.entities || []).map((e) => createEntity(e.name, e.fields?.length ? e.fields : fieldsForEntity(e.name)));
  project.entities = entities;
  project.seedData = {};
  for (const entity of entities) {
    project.seedData[entity.name] = seedRowsForEntity(entity.name, entity.fields);
  }

  // Page stubs (name + route only) so the sidebar can be built before every
  // page tree exists — every page links to every other page.
  const pageStubs = [
    { name: 'Dashboard', route: '/' },
    ...entities.map((e) => ({ name: pluralize(e.name), route: slug(pluralize(e.name)) })),
    { name: 'Configurações', route: '/configuracoes' },
  ];

  project.pages = [
    buildDashboardPage(project.name, entities, pageStubs),
    ...entities.map((e) => buildEntityListPage(e, pageStubs)),
    buildSettingsPage(project.name, pageStubs),
  ];
  project.pages.forEach((p, i) => (p.order = i));
  return project;
}
