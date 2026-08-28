// Orchestrates the AI pipeline: REQUIREMENT ANALYSIS -> APP PLANNING ->
// ARCHITECTURE -> COMPONENT TREE (spec §9). Whichever provider is configured
// only ever returns structured data (AppPlan, or a props patch); this module
// is what turns that into an actual Project via templates/index.js — so a
// misbehaving provider response can be validated/rejected before it ever
// touches the project.
import { getProvider } from './provider.js';
import { getSettings, withCache, buildNodeContext } from './contextManager.js';
import { validateAppPlan, coerceAppPlan } from './schema.js';
import { assemblePlan } from '../templates/index.js';
import { getComponent } from '../components/registry.js';
import { findNode } from '../data/project.js';

export async function generateApp(prompt) {
  const settings = await getSettings();
  const provider = getProvider(settings.provider);
  let plan;
  let usedFallback = false;
  try {
    if (provider.requiresApiKey && !settings.apiKey) throw new Error('missing-api-key');
    const raw = await withCache({ task: 'plan', provider: provider.id, model: settings.model, prompt }, () =>
      provider.generate({ task: 'plan', prompt, apiKey: settings.apiKey, model: settings.model })
    );
    const { valid, errors } = validateAppPlan(raw);
    if (!valid) throw new Error(`plano inválido: ${errors.join('; ')}`);
    plan = coerceAppPlan(raw);
  } catch (err) {
    usedFallback = provider.id !== 'local';
    const local = getProvider('local');
    const raw = await local.generate({ task: 'plan', prompt });
    plan = coerceAppPlan(raw);
    if (usedFallback) plan.__warning = `IA (${provider.label}) indisponível (${err.message}); usando o planejador local.`;
  }
  const project = assemblePlan(plan);
  return { project, plan, usedFallback };
}

export async function improveSelection(project, nodeId) {
  const found = findAcrossPages(project, nodeId);
  if (!found) throw new Error('Componente não encontrado.');
  const def = getComponent(found.node.type);
  const settings = await getSettings();
  const provider = getProvider(settings.provider);
  const context = buildNodeContext(project, nodeId);
  const result = await provider.generate({
    task: 'improve',
    node: found.node,
    propSchema: def.propSchema,
    context,
    apiKey: settings.apiKey,
    model: settings.model,
  });
  return result; // { patch: {props, style}, note }
}

function findAcrossPages(project, nodeId) {
  for (const page of project.pages) {
    const found = findNode(page.tree, nodeId);
    if (found) return found;
  }
  return null;
}

// --- Universal command classification (spec §34-35) ---
// A small, honest classifier: full-app generation and a couple of concrete
// contextual intents are handled deterministically before any AI call, so
// the common cases work even on the local (free) provider. Anything else
// falls through to "improve selection" when something is selected.
export async function runCommand(text, { project, selectedNodeId }) {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'noop' };

  if (!project || /^(crie|criar|gere|gerar|quero)\b.*\b(sistema|app|aplica[cç][aã]o|site|dashboard|painel)\b/i.test(trimmed)) {
    const { project: newProject, plan, usedFallback } = await generateApp(trimmed);
    return { kind: 'generate', project: newProject, plan, usedFallback };
  }

  if (selectedNodeId && /melhor|otimiz|corrig|conserte|fix|deixe.*bonito/i.test(trimmed)) {
    const result = await improveSelection(project, selectedNodeId);
    return { kind: 'improve', nodeId: selectedNodeId, ...result };
  }

  return { kind: 'unrecognized' };
}
