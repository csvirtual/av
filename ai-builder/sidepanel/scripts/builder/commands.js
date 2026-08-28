// Command factories for the undo/redo stack (state/history.js). Every
// factory returns {label, do, undo} that mutates the tree/project in place —
// no deep clone of the whole tree per edit, which is what keeps undo O(1)
// even on a project with hundreds of nodes (ARCHITECTURE.md §13).
import { findNode } from '../data/project.js';
import { makeId } from '../utils/id.js';

function cloneWithNewIds(node) {
  return { ...node, id: makeId('c'), props: { ...node.props }, style: { ...node.style }, children: node.children.map(cloneWithNewIds) };
}

export function cmdAddNode(tree, parentId, index, node) {
  return {
    label: `Adicionar ${node.type}`,
    do() {
      const found = findNode(tree, parentId);
      if (!found) throw new Error('Contêiner de destino não encontrado.');
      found.node.children.splice(index, 0, node);
    },
    undo() {
      const found = findNode(tree, parentId);
      const i = found.node.children.findIndex((c) => c.id === node.id);
      if (i > -1) found.node.children.splice(i, 1);
    },
  };
}

export function cmdRemoveNode(tree, nodeId) {
  let removed = null;
  let parentId = null;
  let index = -1;
  return {
    label: 'Remover componente',
    do() {
      const found = findNode(tree, nodeId);
      if (!found || !found.parent) return;
      parentId = found.parent.id;
      index = found.index;
      removed = found.node;
      found.parent.children.splice(index, 1);
    },
    undo() {
      if (!removed) return;
      const parent = findNode(tree, parentId);
      parent.node.children.splice(index, 0, removed);
    },
  };
}

export function cmdMoveNode(tree, nodeId, newParentId, newIndex) {
  let oldParentId = null;
  let oldIndex = -1;
  return {
    label: 'Mover componente',
    do() {
      const found = findNode(tree, nodeId);
      oldParentId = found.parent.id;
      oldIndex = found.index;
      found.parent.children.splice(oldIndex, 1);
      const newParent = findNode(tree, newParentId);
      newParent.node.children.splice(newIndex, 0, found.node);
    },
    undo() {
      const found = findNode(tree, nodeId);
      found.parent.children.splice(found.index, 1);
      const oldParent = findNode(tree, oldParentId);
      oldParent.node.children.splice(oldIndex, 0, found.node);
    },
  };
}

export function cmdUpdateProps(tree, nodeId, patch) {
  let before = null;
  return {
    label: 'Editar propriedades',
    do() {
      const { node } = findNode(tree, nodeId);
      before = { ...node.props };
      Object.assign(node.props, patch);
    },
    undo() {
      const { node } = findNode(tree, nodeId);
      node.props = before;
    },
  };
}

export function cmdUpdateStyle(tree, nodeId, patch) {
  let before = null;
  return {
    label: 'Editar estilo',
    do() {
      const { node } = findNode(tree, nodeId);
      before = { ...node.style };
      Object.assign(node.style, patch);
    },
    undo() {
      const { node } = findNode(tree, nodeId);
      node.style = before;
    },
  };
}

export function cmdDuplicateNode(tree, nodeId) {
  let clone = null;
  return {
    label: 'Duplicar componente',
    newId: () => clone?.id,
    do() {
      const found = findNode(tree, nodeId);
      if (!found?.parent) return;
      clone = cloneWithNewIds(found.node);
      found.parent.children.splice(found.index + 1, 0, clone);
    },
    undo() {
      if (!clone) return;
      const found = findNode(tree, clone.id);
      if (found?.parent) found.parent.children.splice(found.index, 1);
    },
  };
}

export function cmdAddPage(project, page) {
  return {
    label: `Adicionar página ${page.name}`,
    do() {
      project.pages.push(page);
    },
    undo() {
      const i = project.pages.findIndex((p) => p.id === page.id);
      if (i > -1) project.pages.splice(i, 1);
    },
  };
}

export function cmdRemovePage(project, pageId) {
  let removed = null;
  let index = -1;
  return {
    label: 'Remover página',
    do() {
      index = project.pages.findIndex((p) => p.id === pageId);
      if (index === -1) return;
      removed = project.pages[index];
      project.pages.splice(index, 1);
    },
    undo() {
      if (!removed) return;
      project.pages.splice(index, 0, removed);
    },
  };
}

export { cloneWithNewIds };
