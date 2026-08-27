import { db, STORES } from './db.js';
import { makeId } from '../utils/id.js';

/** @typedef {{id:string,type:string,props:object,style:object,bind?:{entity:string,field:string},children:ComponentNode[]}} ComponentNode */

export function createNode(type, props = {}, children = []) {
  return { id: makeId('c'), type, props, style: {}, children };
}

export function createPage(name, route, tree) {
  return { id: makeId('p'), name, route, tree, order: 0 };
}

export function createEntity(name, fields = []) {
  return { id: makeId('e'), name, fields };
}

export function createProject(name) {
  const now = Date.now();
  return {
    id: makeId('proj'),
    name,
    createdAt: now,
    updatedAt: now,
    theme: {},
    entities: [],
    pages: [],
    settings: { density: 'comfortable' },
  };
}

export async function saveProject(project) {
  project.updatedAt = Date.now();
  await db.put(STORES.projects, project);
  return project;
}

export function loadProject(id) {
  return db.get(STORES.projects, id);
}

export function listProjects() {
  return db.getAll(STORES.projects);
}

export function deleteProject(id) {
  return db.delete(STORES.projects, id);
}

/** Finds a node and its parent array by id. Returns null if not found. */
export function findNode(tree, id) {
  if (tree.id === id) return { node: tree, parent: null, index: -1 };
  const stack = [{ node: tree, parent: null }];
  while (stack.length) {
    const { node } = stack.pop();
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.id === id) return { node: child, parent: node, index: i };
      stack.push({ node: child, parent: node });
    }
  }
  return null;
}

export function walkTree(tree, visit) {
  visit(tree);
  for (const child of tree.children) walkTree(child, visit);
}

// --- Snapshots (histórico de versões, §26) ---

async function gzip(text) {
  if (typeof CompressionStream === 'undefined') return { data: text, compressed: false };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return { data: buf, compressed: true };
}

async function gunzip(payload) {
  if (!payload.compressed || typeof DecompressionStream === 'undefined') return payload.data;
  const stream = new Blob([payload.data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function createSnapshot(project, label = '') {
  const { data, compressed } = await gzip(JSON.stringify(project));
  const snapshot = { id: makeId('snap'), projectId: project.id, label, createdAt: Date.now(), data, compressed };
  await db.put(STORES.snapshots, snapshot);
  return snapshot;
}

export function listSnapshots(projectId) {
  return db.getAllByIndex(STORES.snapshots, 'byProject', projectId);
}

export async function restoreSnapshot(snapshot) {
  const text = await gunzip(snapshot);
  return JSON.parse(text);
}
