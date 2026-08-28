// Layers panel: a real tree of the page's component hierarchy (spec §7).
// Uses event delegation (one listener per gesture type on the container) so
// perf doesn't degrade as the tree grows to hundreds of nodes.
import { getComponent } from '../components/registry.js';
import { escapeHtml } from '../codegen/sanitize.js';
import { icons } from '../utils/icons.js';

const collapsed = new Set();

function nodeLabel(node) {
  const text = node.props?.title || node.props?.label || node.props?.text || node.props?.name;
  return text ? `${node.type} — ${String(text).slice(0, 24)}` : node.type;
}

function renderRow(node, depth, selectedId) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  let icon = '▢';
  try {
    icon = getComponent(node.type).meta.icon;
  } catch {
    /* unknown type — keep default icon, validator will flag it */
  }
  const childrenHtml = hasChildren ? node.children.map((c) => renderRow(c, depth + 1, selectedId)).join('') : '';
  // Indent is capped: past ~7 levels a 220px panel has no room left for the
  // label no matter what, so further depth is shown by the guide rail
  // (border on .av-tree-children) rather than by eating more padding.
  const indent = Math.min(depth, 7) * 11;
  return `<div class="av-tree-node" data-node-id="${node.id}">
    <div class="av-tree-row${node.id === selectedId ? ' is-selected' : ''}" draggable="true" data-node-id="${node.id}" style="padding-inline-start:${indent}px">
      <span class="av-tree-row__toggle" data-action="toggle">${hasChildren ? icons[isCollapsed ? 'chevronRight' : 'chevronDown'] : ''}</span>
      <span class="av-tree-row__icon" aria-hidden="true">${icon}</span>
      <span class="av-tree-row__label" title="${escapeHtml(nodeLabel(node))}">${escapeHtml(nodeLabel(node))}</span>
      <span class="av-tree-row__actions">
        <button class="av-btn av-btn--icon av-btn--small" data-action="duplicate" title="Duplicar" tabindex="-1">${icons.duplicate}</button>
        <button class="av-btn av-btn--icon av-btn--small" data-action="delete" title="Excluir" tabindex="-1">${icons.trash}</button>
      </span>
    </div>
    <div class="av-tree-children" ${isCollapsed ? 'hidden' : ''}>${childrenHtml}</div>
  </div>`;
}

export function renderLayers(container, tree, selectedId) {
  container.innerHTML = tree ? renderRow(tree, 0, selectedId) : '<p class="av-prop-empty">Nenhuma página ativa.</p>';
}

let dragNodeId = null;

/** Wires delegated events once; call renderLayers() separately to (re)paint. */
export function initLayersPanel(container, handlers) {
  container.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-action="toggle"]');
    const delBtn = e.target.closest('[data-action="delete"]');
    const dupBtn = e.target.closest('[data-action="duplicate"]');
    const row = e.target.closest('.av-tree-row');
    if (!row) return;
    const nodeId = row.dataset.nodeId;
    if (toggleBtn) {
      collapsed.has(nodeId) ? collapsed.delete(nodeId) : collapsed.add(nodeId);
      handlers.onRepaint?.();
    } else if (delBtn) {
      handlers.onDelete?.(nodeId);
    } else if (dupBtn) {
      handlers.onDuplicate?.(nodeId);
    } else {
      handlers.onSelect?.(nodeId);
    }
  });

  container.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.av-tree-row');
    if (!row) return;
    dragNodeId = row.dataset.nodeId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragNodeId);
  });

  container.addEventListener('dragover', (e) => {
    const row = e.target.closest('.av-tree-row');
    if (!row || !dragNodeId) return;
    e.preventDefault();
    row.classList.add('is-dragover');
  });

  container.addEventListener('dragleave', (e) => {
    e.target.closest('.av-tree-row')?.classList.remove('is-dragover');
  });

  container.addEventListener('drop', (e) => {
    const row = e.target.closest('.av-tree-row');
    container.querySelectorAll('.is-dragover').forEach((el) => el.classList.remove('is-dragover'));
    if (!row || !dragNodeId) return;
    e.preventDefault();
    const targetId = row.dataset.nodeId;
    if (targetId !== dragNodeId) handlers.onDropInto?.(dragNodeId, targetId);
    dragNodeId = null;
  });
}
