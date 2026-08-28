// Hand-rolled validator for AppPlan — the only shape any AI provider is
// allowed to return. No ajv/zod dependency: the shape is small and stable
// enough that ~30 lines of plain checks are more legible than a schema DSL.

/**
 * @typedef {{
 *   name: string,
 *   entities: Array<{name:string, fields?: Array<{key:string,label:string,type:string}>}>,
 *   features: string[],
 * }} AppPlan
 */

export function validateAppPlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return { valid: false, errors: ['plano não é um objeto'] };
  if (!plan.name || typeof plan.name !== 'string') errors.push('"name" ausente ou não é texto');
  if (!Array.isArray(plan.entities)) errors.push('"entities" ausente ou não é lista');
  else {
    plan.entities.forEach((e, i) => {
      if (!e || typeof e.name !== 'string' || !e.name.trim()) errors.push(`entities[${i}].name inválido`);
      if (e.fields && !Array.isArray(e.fields)) errors.push(`entities[${i}].fields deveria ser lista`);
    });
    if (plan.entities.length > 12) errors.push('mais de 12 entidades — plano provavelmente inválido');
  }
  if (plan.features && !Array.isArray(plan.features)) errors.push('"features" deveria ser lista');
  return { valid: errors.length === 0, errors };
}

export function coerceAppPlan(raw) {
  return {
    name: typeof raw?.name === 'string' ? raw.name.slice(0, 80) : 'Novo projeto',
    entities: Array.isArray(raw?.entities)
      ? raw.entities.slice(0, 12).map((e) => ({
          name: String(e?.name || '').slice(0, 40),
          fields: Array.isArray(e?.fields)
            ? e.fields.slice(0, 12).map((f) => ({
                key: String(f?.key || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30),
                label: String(f?.label || f?.key || '').slice(0, 40),
                type: ['text', 'number', 'date', 'email', 'tel'].includes(f?.type) ? f.type : 'text',
              }))
            : undefined,
        }))
      : [],
    features: Array.isArray(raw?.features) ? raw.features.slice(0, 20).map((f) => String(f).slice(0, 80)) : [],
  };
}
