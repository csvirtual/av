// Design tokens for GENERATED APPS (the projects the user builds), distinct
// from sidepanel/styles/tokens.css which themes the builder's own chrome.
// A project's `theme` field is a partial override merged on top of DEFAULT_TOKENS
// — "change the whole theme by editing tokens" (spec §5) without touching any
// component.

export const DEFAULT_TOKENS = {
  color: {
    primary: '#2f5fd9',
    secondary: '#12b886',
    background: '#f6f7fb',
    surface: '#ffffff',
    border: '#e3e6ef',
    text: '#1a1d29',
    muted: '#6b7280',
    success: '#1f9d55',
    warning: '#b7791f',
    danger: '#d64545',
    info: '#2f6fd9',
  },
  space: { 0: '0', 1: '.25rem', 2: '.5rem', 3: '.75rem', 4: '1rem', 5: '1.5rem', 6: '2rem', 7: '3rem', 8: '4rem' },
  radius: { sm: '.25rem', md: '.5rem', lg: '.875rem', full: '999px' },
  font: {
    family: "-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
    mono: "ui-monospace,'SFMono-Regular',Consolas,monospace",
    xs: 'clamp(.6875rem,.66rem + .15vw,.75rem)',
    sm: 'clamp(.8125rem,.78rem + .15vw,.875rem)',
    md: 'clamp(.9375rem,.9rem + .2vw,1rem)',
    lg: 'clamp(1.0625rem,1rem + .35vw,1.25rem)',
    xl: 'clamp(1.25rem,1.15rem + .5vw,1.625rem)',
    '2xl': 'clamp(1.75rem,1.4rem + 1.4vw,2.5rem)',
  },
  elevation: {
    0: 'none',
    1: '0 1px 2px rgba(20,22,40,.06),0 1px 1px rgba(20,22,40,.04)',
    2: '0 2px 8px rgba(20,22,40,.10),0 1px 2px rgba(20,22,40,.06)',
    3: '0 8px 24px rgba(20,22,40,.16),0 2px 6px rgba(20,22,40,.08)',
  },
  breakpoint: { mobile: 390, tablet: 834, desktop: 1280 },
  duration: { fast: '120ms', normal: '200ms' },
};

function mergeDeep(base, override) {
  const out = {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    const o = override?.[key];
    out[key] = b && typeof b === 'object' && !Array.isArray(b) ? mergeDeep(b, o) : o ?? b;
  }
  return out;
}

export function resolveTokens(overrides) {
  return mergeDeep(DEFAULT_TOKENS, overrides || {});
}

/** Serializes tokens to a standalone CSS custom-properties block (:root { ... }). */
export function tokensToCss(tokens) {
  const lines = [':root {'];
  for (const [group, values] of Object.entries(tokens)) {
    if (typeof values !== 'object') continue;
    for (const [name, value] of Object.entries(values)) {
      lines.push(`  --av-${group}-${name}: ${value};`);
    }
  }
  lines.push(
    '  --av-color-primary-hover: color-mix(in srgb, var(--av-color-primary) 88%, white);',
    '  --av-color-primary-active: color-mix(in srgb, var(--av-color-primary) 80%, black);',
    '  --av-color-surface-hover: color-mix(in srgb, var(--av-color-surface) 94%, black);',
    '  --av-color-danger-hover: color-mix(in srgb, var(--av-color-danger) 88%, white);',
    '  --av-color-on-primary: #ffffff;',
    '}'
  );
  return lines.join('\n');
}
