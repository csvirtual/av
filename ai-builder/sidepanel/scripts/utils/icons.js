// Shared inline-SVG icon set (stroke-based, currentColor, 18x18 viewBox) for
// anything rendered from JS. Static chrome (topbar, toolbars) uses the same
// visual language inlined directly in index.html — see that file for those.
// One system, one source, instead of mixing OS emoji glyphs (inconsistent
// weight/color across platforms) with hand-drawn ones.
function svg(paths, viewBox = '0 0 18 18') {
  return `<svg viewBox="${viewBox}" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export const icons = {
  chevronRight: svg('<path d="M6.5 4l5 5-5 5"/>'),
  chevronDown: svg('<path d="M4 6.5l5 5 5-5"/>'),
  duplicate: svg('<rect x="6.5" y="6.5" width="8" height="8" rx="1.6"/><path d="M3.5 11.5v-7a1 1 0 0 1 1-1h7"/>'),
  trash: svg('<path d="M3.5 5h11"/><path d="M7 5V3.6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V5"/><path d="M5 5l.6 8a1.4 1.4 0 0 0 1.4 1.3h4a1.4 1.4 0 0 0 1.4-1.3L13 5"/>'),
  plus: svg('<path d="M9 3.5v11M3.5 9h11"/>'),
};
