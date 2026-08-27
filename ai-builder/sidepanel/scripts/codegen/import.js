// Code -> model reimport (ARCHITECTURE.md §9). Deliberately conservative:
// only the HTML tab is reimportable (CSS/JS are read-only in the code view —
// free-form CSS/JS edits don't map back onto the token/registry model
// without a much bigger project). Structure is read back via `data-av-id`.
//
// Components that accept children mark exactly where those children go with
// `data-av-slot="children"` (on the root element when children render
// directly there — Stack/Grid/Container/Form — or on an internal wrapper —
// Card's `.av-Card__body`, Header's `.av-Header__actions`, Modal's
// `.av-Modal__body`, etc.). Only that marked slot's direct children are ever
// read back as ComponentNode children; everything else the component renders
// around them (title text, wrapper markup) is pure presentation and is never
// mistaken for a new/removed component. A node whose type has no slot
// (leaf components, or one the reimporter doesn't recognize) keeps its
// original children untouched. An element with no recognizable
// `data-av-id` becomes a `Raw` node instead of corrupting the tree.
import { createNode, walkTree } from '../data/project.js';

function findSlotChildren(el) {
  if (el.dataset?.avSlot === 'children') return Array.from(el.children);
  for (const child of el.children) {
    if (child.dataset?.avId) continue; // nested component's own subtree — not ours to search
    const found = findSlotChildren(child);
    if (found) return found;
  }
  return null;
}

function buildFromElement(el, existingIndex) {
  if (!el || el.nodeType !== 1) return null;
  const id = el.dataset?.avId;
  const type = el.dataset?.avType;
  if (id && type && existingIndex.has(id)) {
    const original = existingIndex.get(id);
    const slot = findSlotChildren(el);
    const children = slot ? slot.map((child) => buildFromElement(child, existingIndex)).filter(Boolean) : original.children;
    return { ...original, children };
  }
  return createNode('Raw', { html: el.outerHTML });
}

/**
 * Reimports edited HTML (the same string the HTML tab shows: all
 * `<section data-av-page>` blocks) back into the project's page trees.
 * Returns {project, warnings[]} — never throws on malformed markup, since
 * DOMParser's HTML mode never throws; worst case, everything downgrades to
 * `Raw` nodes.
 */
export function reimportSiteHtml(htmlString, project) {
  const existingIndex = new Map();
  for (const page of project.pages) walkTree(page.tree, (n) => existingIndex.set(n.id, n));

  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  const sections = Array.from(doc.querySelectorAll('[data-av-page]'));
  const warnings = [];

  for (const section of sections) {
    const route = section.dataset.avPage;
    const page = project.pages.find((p) => p.route === route);
    if (!page) {
      warnings.push(`Página com rota "${route}" não existe no projeto — ignorada (criar páginas pelo código ainda não é suportado).`);
      continue;
    }
    const rootEl = section.firstElementChild;
    if (!rootEl) {
      warnings.push(`Página "${page.name}" ficou sem conteúdo — mantida como estava.`);
      continue;
    }
    const newTree = buildFromElement(rootEl, existingIndex);
    if (newTree) page.tree = newTree;
  }

  const missingPages = project.pages.filter((p) => !sections.some((s) => s.dataset.avPage === p.route));
  for (const p of missingPages) warnings.push(`Página "${p.name}" não encontrada no HTML editado — mantida sem alterações.`);

  return { project, warnings };
}
