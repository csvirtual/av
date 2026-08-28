// Deterministic diagnostic rules (spec §10). Each rule is `(project) -> Issue[]`
// and is pure — no DOM, no IndexedDB — so it is unit-testable and, for large
// projects, safe to run inside a Worker without a message-passing rewrite.
import { hasComponent, getComponent } from '../components/registry.js';
import { walkTree } from '../data/project.js';

const NEEDS_LABEL_TYPES = new Set(['Input', 'Textarea', 'Select']);

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function relativeLuminance({ r, g, b }) {
  const [R, G, B] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hex1, hex2) {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  if (!c1 || !c2) return null;
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

export function validateProject(project) {
  const issues = [];
  const push = (issue) => issues.push(issue);
  const seenIds = new Set();
  const entityNames = new Set((project.entities || []).map((e) => e.name));

  if (!project.pages?.length) {
    push({ code: 'no-pages', severity: 'warning', message: 'O projeto não tem nenhuma página.' });
    return issues;
  }

  const routes = new Map();
  for (const page of project.pages) {
    if (routes.has(page.route)) {
      push({ code: 'duplicate-route', severity: 'error', message: `Rota duplicada "${page.route}" (páginas "${routes.get(page.route)}" e "${page.name}").`, pageId: page.id });
    }
    routes.set(page.route, page.name);

    let nodeCount = 0;
    walkTree(page.tree, (node) => {
      nodeCount++;
      if (seenIds.has(node.id)) {
        push({ code: 'duplicate-id', severity: 'error', message: `Id de componente duplicado: ${node.id}.`, pageId: page.id, nodeId: node.id });
      }
      seenIds.add(node.id);

      if (!hasComponent(node.type)) {
        push({ code: 'unknown-type', severity: 'error', message: `Tipo de componente desconhecido: "${node.type}".`, pageId: page.id, nodeId: node.id });
        return;
      }

      if (node.bind?.entity && !entityNames.has(node.bind.entity)) {
        push({ code: 'broken-bind', severity: 'error', message: `"${node.type}" está ligado à entidade inexistente "${node.bind.entity}".`, pageId: page.id, nodeId: node.id });
      }

      if (NEEDS_LABEL_TYPES.has(node.type) && !String(node.props?.label || '').trim()) {
        push({ code: 'missing-label', severity: 'warning', message: `Campo "${node.type}" sem rótulo — leitores de tela não conseguirão identificá-lo.`, pageId: page.id, nodeId: node.id });
      }

      if (node.type === 'Button' && !String(node.props?.label || '').trim()) {
        push({ code: 'empty-button', severity: 'warning', message: 'Botão sem texto.', pageId: page.id, nodeId: node.id });
      }

      if (node.style?.width && /^\d+(\.\d+)?px$/.test(node.style.width) && parseFloat(node.style.width) > 390) {
        push({ code: 'fixed-width', severity: 'warning', message: `Largura fixa de ${node.style.width} pode quebrar em telas pequenas — prefira max-width ou %.`, pageId: page.id, nodeId: node.id });
      }

      if (node.style?.color && node.style?.backgroundColor) {
        const ratio = contrastRatio(node.style.color, node.style.backgroundColor);
        if (ratio != null && ratio < 4.5) {
          push({ code: 'low-contrast', severity: 'warning', message: `Contraste de texto baixo (${ratio.toFixed(2)}:1, mínimo recomendado 4.5:1).`, pageId: page.id, nodeId: node.id });
        }
      }
    });

    if (nodeCount <= 1) {
      push({ code: 'empty-page', severity: 'info', message: `A página "${page.name}" está vazia.`, pageId: page.id });
    }
  }

  return issues;
}
