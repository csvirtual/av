// Central sanitization. Every piece of user-authored text that ends up in
// generated HTML MUST go through one of these — there is no other path to
// innerHTML/template strings in the codebase (see ARCHITECTURE.md §14).

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

/** Only alphanumerics, dash and underscore — safe for ids/classes/data-* values. */
export function safeToken(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
}

// Allow-list of CSS properties the property panel / node.style may set.
// Anything outside this list is dropped rather than passed through, so a
// crafted style value can never inject a new declaration or escape the
// style attribute (no `url()`, no `expression()`, no `;`-separated payload
// beyond a single declaration per key).
const STYLE_PROPS = new Set([
  'padding', 'margin', 'gap', 'width', 'maxWidth', 'minWidth', 'height',
  'textAlign', 'backgroundColor', 'color', 'justifyContent', 'alignItems',
  'flexDirection', 'gridTemplateColumns', 'borderRadius', 'fontSize',
  'fontWeight', 'flex', 'order', 'display', 'gridColumn', 'textTransform',
]);

const CSS_VALUE_RE = /^[a-zA-Z0-9#%.,\-\s()]*$/;

function kebab(prop) {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Turns a node.style object into a safe inline `style="..."` string (no attribute). */
export function styleToInlineCss(style) {
  if (!style || typeof style !== 'object') return '';
  const decls = [];
  for (const [prop, value] of Object.entries(style)) {
    if (!STYLE_PROPS.has(prop)) continue;
    const v = String(value ?? '').trim();
    if (!v || !CSS_VALUE_RE.test(v)) continue;
    decls.push(`${kebab(prop)}:${v}`);
  }
  return decls.join(';');
}
