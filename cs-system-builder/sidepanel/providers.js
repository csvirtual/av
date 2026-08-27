// Integração BYOK ("bring your own key"): todas as chamadas saem direto do
// side panel (extensão) para a API do provedor escolhido, usando a chave que
// o próprio usuário colou nas configurações. Nenhuma chamada passa por um
// servidor nosso — por isso o custo de operação da extensão é zero: quem
// paga (ou usa a camada gratuita) é o usuário, com a própria chave dele.

const PROVIDERS = {
  groq: {
    label: 'Groq (recomendado — tem camada gratuita generosa)',
    keyHelp: 'Crie uma chave grátis em console.groq.com/keys',
    modelSuggestions: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    defaultModel: 'llama-3.3-70b-versatile',
  },
  openai: {
    label: 'OpenAI',
    keyHelp: 'Crie uma chave em platform.openai.com/api-keys',
    modelSuggestions: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    defaultModel: 'gpt-4o-mini',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    keyHelp: 'Crie uma chave em console.anthropic.com',
    modelSuggestions: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
    defaultModel: 'claude-sonnet-4-5',
  },
  google: {
    label: 'Google (Gemini)',
    keyHelp: 'Crie uma chave grátis em aistudio.google.com/apikey',
    modelSuggestions: ['gemini-2.0-flash', 'gemini-1.5-flash'],
    defaultModel: 'gemini-2.0-flash',
  },
};

const SCHEMA_DOC = `Você gera SISTEMAS WEB (HTML/CSS/JS) representados como uma árvore JSON de componentes — não HTML solto. Responda SEMPRE com um único objeto JSON válido, sem markdown, sem texto fora do JSON, no formato:

{
  "summary": "1-2 frases explicando o que você fez, em português",
  "meta": { "title": "Título do sistema", "description": "" },
  "tree": { ...nó raiz, ver abaixo... },
  "css": "CSS adicional livre (opcional, string)",
  "js": "JavaScript adicional livre (opcional, string; roda em <script> no final do body)"
}

Cada NÓ da árvore tem este formato:
{ "type": "<tipo>", "props": { ... }, "style": { ... }, "children": [ ...nós filhos, só para container/form/card... ] }

Tipos válidos e seus props:
- container: sem props especiais. Aceita children. Use para layout (linhas/colunas via style.flexDirection).
- card: como container, com visual de cartão (fundo branco, sombra, borda). Aceita children.
- form: como container, com props.onSubmit (string JS, ex: "event.preventDefault(); ..."). Aceita children.
- heading: props.level (1-6), props.text
- text: props.text
- button: props.text, props.variant ("primary"|"secondary"|"ghost"|"danger"), props.onClick (string JS)
- image: props.src (URL), props.alt
- link: props.text, props.href
- input: props.label, props.placeholder, props.inputType ("text"|"email"|"number"|"password"|"date"), props.name
- textarea: props.label, props.placeholder, props.name
- select: props.label, props.name, props.options (array de strings)
- list: props.items (array de strings), props.ordered (bool)
- table: props.columns (array de strings), props.rows (array de arrays de strings)
- divider: sem props.

style aceita SOMENTE estas chaves (todas valores string em CSS válido): padding, margin, background, color, fontSize, fontWeight, textAlign, borderRadius, border, boxShadow, gap, flexDirection, justifyContent, alignItems, width, maxWidth, display.

O nó raiz de "tree" deve ser sempre type "container" com style.display "flex" e style.flexDirection "column".

Regras importantes:
- Gere sistemas completos e funcionais dentro desse modelo: formulários com validação simples via JS, listas, tabelas de dados, cálculos, estados salvos em variáveis JS/localStorage, várias seções na mesma página.
- props.onClick / props.onSubmit são strings JavaScript executadas inline — podem chamar funções definidas em "js".
- Não invente tipos de nó ou chaves de props/style fora do que foi listado. Se precisar de algo mais específico, resolva com "css"/"js" livres.
- Se o usuário pedir uma alteração num sistema já existente, parta da árvore atual (fornecida no contexto) e devolva a árvore inteira já modificada, não só o trecho alterado.`;

function buildSystemPrompt() {
  return `Você é um gerador de sistemas web dentro de uma extensão de navegador. ${SCHEMA_DOC}`;
}

function buildUserContent(userPrompt, currentProject) {
  const hasContent = currentProject && currentProject.tree && currentProject.tree.children && currentProject.tree.children.length > 0;
  const contextBlock = hasContent
    ? `Projeto atual (JSON, para você editar/estender):\n${JSON.stringify({ meta: currentProject.meta, tree: currentProject.tree, css: currentProject.css, js: currentProject.js })}\n\n`
    : '';
  return `${contextBlock}Pedido do usuário: ${userPrompt}`;
}

function extractJson(text) {
  if (!text) throw new Error('Resposta vazia do modelo.');
  let cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Não encontrei JSON na resposta do modelo.');
  cleaned = cleaned.slice(start, end + 1);
  return JSON.parse(cleaned);
}

async function friendlyFetchError(res, providerLabel) {
  let bodyText = '';
  try { bodyText = await res.text(); } catch { /* ignore */ }
  if (res.status === 401 || res.status === 403) {
    return new Error(`Chave de API rejeitada por ${providerLabel} (${res.status}). Confira se colou a chave certa nas configurações.`);
  }
  if (res.status === 429) {
    return new Error(`${providerLabel} recusou por limite de uso (429) — camada gratuita/cota estourada. Tente novamente em instantes ou troque de provedor/modelo.`);
  }
  return new Error(`Erro de ${providerLabel} (${res.status}): ${bodyText.slice(0, 300)}`);
}

async function callGroqOrOpenAI(baseUrl, apiKey, model, systemPrompt, userContent, providerLabel) {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 8000,
    }),
  });
  if (!res.ok) throw await friendlyFetchError(res, providerLabel);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  return extractJson(content);
}

async function callAnthropic(apiKey, model, systemPrompt, userContent) {
  const toolSchema = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      meta: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } } },
      tree: { type: 'object' },
      css: { type: 'string' },
      js: { type: 'string' },
    },
    required: ['tree'],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      tools: [{ name: 'emit_system', description: 'Emite o sistema web gerado como JSON estruturado.', input_schema: toolSchema }],
      tool_choice: { type: 'tool', name: 'emit_system' },
    }),
  });
  if (!res.ok) throw await friendlyFetchError(res, 'Anthropic');
  const data = await res.json();
  const toolUse = (data.content || []).find((b) => b.type === 'tool_use' && b.name === 'emit_system');
  if (!toolUse) throw new Error('Claude não retornou o JSON esperado. Tente reformular o pedido.');
  return toolUse.input;
}

async function callGemini(apiKey, model, systemPrompt, userContent) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 8000 },
    }),
  });
  if (!res.ok) throw await friendlyFetchError(res, 'Google Gemini');
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  return extractJson(text);
}

async function generateProject({ provider, apiKey, model, userPrompt, currentProject }) {
  if (!apiKey) throw new Error('Cole sua chave de API nas configurações antes de gerar (BYOK).');
  const systemPrompt = buildSystemPrompt();
  const userContent = buildUserContent(userPrompt, currentProject);
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Provedor desconhecido: ${provider}`);
  const chosenModel = model || cfg.defaultModel;

  let raw;
  if (provider === 'groq') {
    raw = await callGroqOrOpenAI('https://api.groq.com/openai/v1/chat/completions', apiKey, chosenModel, systemPrompt, userContent, 'Groq');
  } else if (provider === 'openai') {
    raw = await callGroqOrOpenAI('https://api.openai.com/v1/chat/completions', apiKey, chosenModel, systemPrompt, userContent, 'OpenAI');
  } else if (provider === 'anthropic') {
    raw = await callAnthropic(apiKey, chosenModel, systemPrompt, userContent);
  } else if (provider === 'google') {
    raw = await callGemini(apiKey, chosenModel, systemPrompt, userContent);
  } else {
    throw new Error(`Provedor sem integração: ${provider}`);
  }
  return window.CSB_SCHEMA.sanitizeProject(raw, userPrompt.slice(0, 40));
}

window.CSB_PROVIDERS = { PROVIDERS, generateProject };
