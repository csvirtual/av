// Real Claude integration. This is the path where the platform's planning
// quality is literally Claude's reasoning, not a heuristic imitating it: the
// model is asked to work through the same pipeline a senior engineer would
// (requirements -> entities -> pages -> features) and forced, via tool_choice,
// to answer as structured data — never raw HTML/CSS/JS (see
// templates/index.js for why that boundary exists).

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';

const PLAN_SYSTEM_PROMPT = `Você é uma engenheira de software sênior especializada em planejar aplicações web CRUD a partir de um pedido em linguagem natural (em português).
Seu trabalho, nesta etapa, é SÓ planejamento — não gerar HTML/CSS/JS. Pense como a sequência: análise de requisitos -> modelo de entidades -> páginas -> funcionalidades.
Regras:
- Tome decisões razoáveis sozinha quando algo não for especificado; não peça esclarecimentos desnecessários.
- Nomeie entidades no singular, em português, com nomes de domínio claros (ex: "Produto", não "produtos" nem "item genérico").
- Cada entidade deve ter entre 3 e 6 campos realistas para o domínio, com "type" em {text, number, date, email, tel}.
- Liste no máximo 6 entidades e no máximo 8 features.
- Responda chamando a ferramenta submit_app_plan — nunca em texto livre.`;

const PLAN_TOOL = {
  name: 'submit_app_plan',
  description: 'Envia o plano estruturado da aplicação (entidades, campos e funcionalidades).',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nome curto e claro da aplicação' },
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', description: 'camelCase, sem acentos' },
                  label: { type: 'string' },
                  type: { type: 'string', enum: ['text', 'number', 'date', 'email', 'tel'] },
                },
                required: ['key', 'label', 'type'],
              },
            },
          },
          required: ['name', 'fields'],
        },
      },
      features: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'entities', 'features'],
  },
};

const IMPROVE_SYSTEM_PROMPT = `Você é uma product designer e engenheira frontend sênior revisando UM componente de uma interface já gerada.
Sugira melhorias de copy, propriedades e microcopy — só usando as chaves de propriedade permitidas pelo componente (fornecidas em "propSchema"). Não invente propriedades novas.
Responda chamando a ferramenta submit_improvement — nunca em texto livre.`;

function improveTool(propSchema) {
  const propKeys = (propSchema || []).map((p) => p.key);
  return {
    name: 'submit_improvement',
    description: 'Envia as propriedades revisadas do componente.',
    input_schema: {
      type: 'object',
      properties: {
        props: { type: 'object', description: `Apenas chaves entre: ${propKeys.join(', ')}` },
        note: { type: 'string', description: 'Explicação curta (1 frase) do que mudou e por quê' },
      },
      required: ['props', 'note'],
    },
  };
}

async function callClaude({ apiKey, model, system, userContent, tool }) {
  if (!apiKey) throw new Error('Chave de API da Anthropic não configurada.');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: userContent }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const block = data.content?.find((c) => c.type === 'tool_use');
  if (!block) throw new Error('Claude não retornou uma resposta estruturada.');
  return block.input;
}

async function plan({ prompt, apiKey, model }) {
  return callClaude({
    apiKey,
    model,
    system: PLAN_SYSTEM_PROMPT,
    userContent: `Pedido do usuário: """${prompt}"""`,
    tool: PLAN_TOOL,
  });
}

async function improve({ node, propSchema, apiKey, model }) {
  const result = await callClaude({
    apiKey,
    model,
    system: IMPROVE_SYSTEM_PROMPT,
    userContent: `Tipo do componente: ${node.type}\npropSchema: ${JSON.stringify(propSchema)}\nProps atuais: ${JSON.stringify(node.props)}\n\nMelhore este componente.`,
    tool: improveTool(propSchema),
  });
  return { patch: { props: result.props || {}, style: {} }, note: result.note };
}

export const anthropicProvider = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  requiresApiKey: true,
  defaultModel: DEFAULT_MODEL,
  async generate(task) {
    if (task.task === 'plan') return plan(task);
    if (task.task === 'improve') return improve(task);
    throw new Error(`Tarefa não suportada pelo provedor Anthropic: ${task.task}`);
  },
};
