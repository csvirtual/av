// Sistema de arquivos virtual (pastas/arquivos) sobre IndexedDB, usado pela
// área de trabalho, Explorador de Arquivos e demais apps.
import { tx, reqToPromise } from './database.js';
import { kv } from './kv-store.js';

function uid() {
  return crypto.randomUUID();
}

export const fs = {
  async getNode(id) {
    const store = await tx('nodes', 'readonly');
    return reqToPromise(store.get(id));
  },

  async getChildren(parentId) {
    const store = await tx('nodes', 'readonly');
    const idx = store.index('byParent');
    const rows = await reqToPromise(idx.getAll(parentId));
    return rows.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
  },

  async createNode({ parentId, name, type, content = '', mimeType = 'text/plain' }) {
    const store = await tx('nodes', 'readwrite');
    const now = Date.now();
    const node = {
      id: uid(),
      parentId,
      name,
      type, // 'folder' | 'file'
      content,
      mimeType,
      createdAt: now,
      modifiedAt: now,
      trashed: false,
    };
    await reqToPromise(store.add(node));
    return node;
  },

  async updateNode(id, patch) {
    const store = await tx('nodes', 'readwrite');
    const node = await reqToPromise(store.get(id));
    if (!node) return null;
    Object.assign(node, patch, { modifiedAt: Date.now() });
    await reqToPromise(store.put(node));
    return node;
  },

  async deleteNodePermanently(id) {
    const node = await this.getNode(id);
    if (!node) return;
    if (node.type === 'folder') {
      const children = await this.getChildren(id);
      for (const child of children) await this.deleteNodePermanently(child.id);
    }
    const store = await tx('nodes', 'readwrite');
    await reqToPromise(store.delete(id));
  },

  async trash(id, trashFolderId) {
    return this.updateNode(id, { trashed: true, previousParentId: (await this.getNode(id)).parentId, parentId: trashFolderId });
  },

  async restore(id) {
    const node = await this.getNode(id);
    if (!node) return;
    return this.updateNode(id, { trashed: false, parentId: node.previousParentId || node.parentId });
  },

  async move(id, newParentId) {
    return this.updateNode(id, { parentId: newParentId });
  },

  async rename(id, name) {
    return this.updateNode(id, { name });
  },

  async getPath(id) {
    const parts = [];
    let current = await this.getNode(id);
    while (current) {
      parts.unshift(current);
      if (!current.parentId) break;
      current = await this.getNode(current.parentId);
    }
    return parts;
  },

  async findChildByName(parentId, name) {
    const children = await this.getChildren(parentId);
    return children.find((c) => c.name.toLowerCase() === name.toLowerCase());
  },
};

export async function ensureSeed() {
  let rootId = await kv.get('rootId');
  if (rootId) {
    return {
      rootId,
      desktopId: await kv.get('desktopId'),
      documentsId: await kv.get('documentsId'),
      picturesId: await kv.get('picturesId'),
      downloadsId: await kv.get('downloadsId'),
      trashId: await kv.get('trashId'),
    };
  }

  const root = await fs.createNode({ parentId: null, name: 'Este Computador', type: 'folder' });
  const desktop = await fs.createNode({ parentId: root.id, name: 'Área de Trabalho', type: 'folder' });
  const documents = await fs.createNode({ parentId: root.id, name: 'Documentos', type: 'folder' });
  const pictures = await fs.createNode({ parentId: root.id, name: 'Imagens', type: 'folder' });
  const downloads = await fs.createNode({ parentId: root.id, name: 'Downloads', type: 'folder' });
  const trash = await fs.createNode({ parentId: root.id, name: 'Lixeira', type: 'folder' });

  await fs.createNode({
    parentId: desktop.id,
    name: 'Bem-vindo.txt',
    type: 'file',
    content: 'Bem-vindo ao seu Windows 11 no navegador!\n\nTudo o que você criar aqui fica salvo neste navegador (IndexedDB).\nUse o Explorador de Arquivos para organizar suas pastas e o Bloco de Notas para escrever.',
  });

  await kv.set('rootId', root.id);
  await kv.set('desktopId', desktop.id);
  await kv.set('documentsId', documents.id);
  await kv.set('picturesId', pictures.id);
  await kv.set('downloadsId', downloads.id);
  await kv.set('trashId', trash.id);

  return {
    rootId: root.id,
    desktopId: desktop.id,
    documentsId: documents.id,
    picturesId: pictures.id,
    downloadsId: downloads.id,
    trashId: trash.id,
  };
}
