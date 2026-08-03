// Sistema de arquivos virtual (pastas/arquivos) sobre IndexedDB, usado pela
// área de trabalho, Explorador de Arquivos e demais apps.
//
// Conteúdo de arquivo é cifrado em repouso (AES-256-GCM, ver
// core/services/crypto.js) de forma transparente: createNode/updateNode
// cifram antes de gravar, getNode/getChildren decifram antes de devolver —
// todo o resto do app continua enxergando `node.content` como texto puro
// sempre, sem precisar saber que existe criptografia nenhuma.
import { tx, reqToPromise } from './database.js';
import { kv } from './kv-store.js';
import { getSessionDek, encryptText, decryptText } from '../services/crypto.js';

function uid() {
  return crypto.randomUUID();
}

async function encryptContent(content) {
  const dek = getSessionDek();
  // Sem chave de sessão ainda (só acontece na semeadura inicial de uma
  // conta pré-existente, antes de qualquer login — nunca com arquivo de
  // usuário de verdade, só pastas com content vazio) ou conteúdo vazio: não
  // tem o que cifrar, grava como está.
  if (!dek || typeof content !== 'string' || content === '') return content;
  return encryptText(dek, content);
}

async function decryptContent(content) {
  if (content == null || typeof content !== 'object' || !content.__enc) return content;
  const dek = getSessionDek();
  // Não deveria acontecer em uso normal (todo acesso a arquivo de verdade é
  // pós-login), mas devolve string vazia em vez do objeto cifrado cru —
  // qualquer código chamador espera `content` como string sempre.
  if (!dek) return '';
  try {
    return await decryptText(dek, content);
  } catch {
    return '';
  }
}

export const fs = {
  async getNode(id) {
    const store = await tx('nodes', 'readonly');
    const node = await reqToPromise(store.get(id));
    if (node) node.content = await decryptContent(node.content);
    return node;
  },

  async getChildren(parentId) {
    const store = await tx('nodes', 'readonly');
    const idx = store.index('byParent');
    const rows = await reqToPromise(idx.getAll(parentId));
    for (const row of rows) row.content = await decryptContent(row.content);
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
      content: await encryptContent(content),
      mimeType,
      createdAt: now,
      modifiedAt: now,
      trashed: false,
    };
    await reqToPromise(store.add(node));
    node.content = content; // devolve pro chamador em texto puro, não cifrado
    return node;
  },

  async updateNode(id, patch) {
    const store = await tx('nodes', 'readwrite');
    const node = await reqToPromise(store.get(id));
    if (!node) return null;
    const finalPatch = { ...patch };
    if ('content' in finalPatch) finalPatch.content = await encryptContent(finalPatch.content);
    Object.assign(node, finalPatch, { modifiedAt: Date.now() });
    await reqToPromise(store.put(node));
    node.content = await decryptContent(node.content); // devolve pro chamador em texto puro
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

/** Instalações antigas tinham Área de Trabalho/Documentos/Imagens/Downloads/
 * Lixeira soltas direto em "Este Computador". Reorganiza para o caminho real
 * do Windows — Este Computador › Disco Local (C:) › Usuários › <nome> › ... —
 * sem perder nenhum arquivo já criado (só move os nós de lugar). */
async function migrateToLocalDisk(rootId) {
  const userName = await kv.get('user.name', 'Usuário');
  const desktopId = await kv.get('desktopId');
  const documentsId = await kv.get('documentsId');
  const picturesId = await kv.get('picturesId');
  const downloadsId = await kv.get('downloadsId');
  const trashId = await kv.get('trashId');

  const cDrive = await fs.createNode({ parentId: rootId, name: 'Disco Local (C:)', type: 'folder' });
  const users = await fs.createNode({ parentId: cDrive.id, name: 'Usuários', type: 'folder' });
  const userFolder = await fs.createNode({ parentId: users.id, name: userName, type: 'folder' });

  if (desktopId) await fs.move(desktopId, userFolder.id);
  if (documentsId) await fs.move(documentsId, userFolder.id);
  if (picturesId) await fs.move(picturesId, userFolder.id);
  if (downloadsId) await fs.move(downloadsId, userFolder.id);
  if (trashId) await fs.move(trashId, cDrive.id);

  await kv.set('cDriveId', cDrive.id);
  await kv.set('usersId', users.id);
  await kv.set('userFolderId', userFolder.id);
  return cDrive.id;
}

export async function ensureSeed() {
  let rootId = await kv.get('rootId');
  if (rootId) {
    const cDriveId = (await kv.get('cDriveId')) || (await migrateToLocalDisk(rootId));
    const userFolderId = await kv.get('userFolderId');
    // Instalações antigas (antes da pasta Vídeos existir) não têm videosId
    // salvo — cria na hora, uma única vez, pra quem já tinha conta aberta.
    let videosId = await kv.get('videosId');
    if (!videosId && userFolderId) {
      const videos = await fs.createNode({ parentId: userFolderId, name: 'Vídeos', type: 'folder' });
      videosId = videos.id;
      await kv.set('videosId', videosId);
    }
    return {
      rootId,
      cDriveId,
      usersId: await kv.get('usersId'),
      userFolderId,
      desktopId: await kv.get('desktopId'),
      documentsId: await kv.get('documentsId'),
      picturesId: await kv.get('picturesId'),
      downloadsId: await kv.get('downloadsId'),
      videosId,
      trashId: await kv.get('trashId'),
    };
  }

  const userName = await kv.get('user.name', 'Usuário');
  const root = await fs.createNode({ parentId: null, name: 'Este Computador', type: 'folder' });
  const cDrive = await fs.createNode({ parentId: root.id, name: 'Disco Local (C:)', type: 'folder' });
  const users = await fs.createNode({ parentId: cDrive.id, name: 'Usuários', type: 'folder' });
  const userFolder = await fs.createNode({ parentId: users.id, name: userName, type: 'folder' });
  const desktop = await fs.createNode({ parentId: userFolder.id, name: 'Área de Trabalho', type: 'folder' });
  const documents = await fs.createNode({ parentId: userFolder.id, name: 'Documentos', type: 'folder' });
  const pictures = await fs.createNode({ parentId: userFolder.id, name: 'Imagens', type: 'folder' });
  const downloads = await fs.createNode({ parentId: userFolder.id, name: 'Downloads', type: 'folder' });
  const videos = await fs.createNode({ parentId: userFolder.id, name: 'Vídeos', type: 'folder' });
  const trash = await fs.createNode({ parentId: cDrive.id, name: 'Lixeira', type: 'folder' });

  await fs.createNode({
    parentId: desktop.id,
    name: 'Bem-vindo.txt',
    type: 'file',
    content: 'Bem-vindo ao seu Windows 11 no navegador!\n\nTudo o que você criar aqui fica salvo neste navegador (IndexedDB).\nUse o Explorador de Arquivos para organizar suas pastas e o Bloco de Notas para escrever.',
  });

  await kv.set('rootId', root.id);
  await kv.set('cDriveId', cDrive.id);
  await kv.set('usersId', users.id);
  await kv.set('userFolderId', userFolder.id);
  await kv.set('desktopId', desktop.id);
  await kv.set('documentsId', documents.id);
  await kv.set('picturesId', pictures.id);
  await kv.set('downloadsId', downloads.id);
  await kv.set('videosId', videos.id);
  await kv.set('trashId', trash.id);

  return {
    rootId: root.id,
    cDriveId: cDrive.id,
    usersId: users.id,
    userFolderId: userFolder.id,
    desktopId: desktop.id,
    documentsId: documents.id,
    picturesId: pictures.id,
    downloadsId: downloads.id,
    videosId: videos.id,
    trashId: trash.id,
  };
}
