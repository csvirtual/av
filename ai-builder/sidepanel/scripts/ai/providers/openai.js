// OpenAI-compatible provider (OpenAI itself, or any server implementing the
// same Chat Completions + tools contract — Azure OpenAI, local llama.cpp
// servers, etc.). Kept structurally identical to anthropic.js on purpose:
// swapping providers should never require touching planner.js.

const API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

const PLAN_SYSTEM_PROMPT = `Você é uma engenheira de software sênior planejando uma aplicação web CRUD a partir de um pedido em português.
Só planeje (entidades, campos, features) — não gere HTML/CSS/JS. Tome decisões razoáveis sozinha; não peça esclarecimentos desnecessários.
Nomeie entidades no singular, em português. No máximo 6 entidades (3-6 campos cada), no máximo 8 features.
Chame a função submit_app_plan com o resultado.`;

const PLAN_TOOL = {
  type: 'function',
  function: {
    name: 'submit_app_plan',
    description: 'Envia o plano estruturado da aplicação.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
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
                    key: { type: 'string' },
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
  },
};

const IMPROVE_SYSTEM_PROMPT = `Você revisa UM componente de UI já gerado. Sugira só propriedades permitidas pelo propSchema informado. Chame submit_improvement com o resultado.`;

function improveTool(propSchema) {
  const propKeys = (propSchema || []).map((p) => p.key);
  return {
    type: 'function',
    function: {
      name: 'submit_improvement',
      description: 'Envia as propriedades revisadas.',
      parameters: {
        type: 'object',
        properties: {
          props: { type: 'object', description: `Apenas chaves entre: ${propKeys.join(', ')}` },
          note: { type: 'string' },
        },
        required: ['props', 'note'],
      },
    },
  };
}

async function callOpenAi({ apiKey, model, system, userContent, tool, baseUrl }) {
  if (!apiKey) throw new Error('Chave de API não configurada.');
  const res = await fetch(baseUrl || API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      tools: [tool],
      tool_choice: { type: 'function', function: { name: tool.function.name } },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error('O modelo não retornou uma resposta estruturada.');
  return JSON.parse(call.function.arguments);
}

async function plan({ prompt, apiKey, model, baseUrl }) {
  return callOpenAi({ apiKey, model, baseUrl, system: PLAN_SYSTEM_PROMPT, userContent: `Pedido do usuário: """${prompt}"""`, tool: PLAN_TOOL });
}

async function improve({ node, propSchema, apiKey, model, baseUrl }) {
  const result = await callOpenAi({
    apiKey, model, baseUrl,
    system: IMPROVE_SYSTEM_PROMPT,
    userContent: `Tipo: ${node.type}\npropSchema: ${JSON.stringify(propSchema)}\nProps atuais: ${JSON.stringify(node.props)}`,
    tool: improveTool(propSchema),
  });
  return { patch: { props: result.props || {}, style: {} }, note: result.note };
}

export const openaiProvider = {
  id: 'openai',
  label: 'OpenAI-compatível',
  requiresApiKey: true,
  defaultModel: DEFAULT_MODEL,
  async generate(task) {
    if (task.task === 'plan') return plan(task);
    if (task.task === 'improve') return improve(task);
    throw new Error(`Tarefa não suportada pelo provedor OpenAI: ${task.task}`);
  },
};
