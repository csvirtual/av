// Component contract. Every entry is a pure function of (node, childrenHtml,
// ctx) -> {html, css, js}. `css`/`js` are the same string for every instance
// of a type (the generator dedupes them by type — see codegen/generator.js),
// so render() must never bake per-instance data into css/js, only into html.

const registry = new Map();

/**
 * @param {string} type
 * @param {{
 *   meta: {label:string, category:string, icon:string},
 *   defaultProps: object,
 *   propSchema: Array<{key:string,label:string,type:string,options?:string[]}>,
 *   a11y?: object,
 *   render: (node:object, childrenHtml:string, ctx:object) => {html:string, css?:string, js?:string},
 * }} def
 */
export function registerComponent(type, def) {
  registry.set(type, { type, ...def });
}

export function getComponent(type) {
  const def = registry.get(type);
  if (!def) throw new Error(`Componente desconhecido: "${type}"`);
  return def;
}

export function hasComponent(type) {
  return registry.has(type);
}

export function listComponents() {
  return [...registry.values()];
}

export function componentsByCategory() {
  const groups = {};
  for (const def of registry.values()) {
    const cat = def.meta.category;
    (groups[cat] ??= []).push(def);
  }
  return groups;
}
