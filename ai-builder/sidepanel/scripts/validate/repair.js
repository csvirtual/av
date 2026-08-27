// Mechanical auto-repair for a subset of validator issues (spec §11). Only
// fixes that are safe by construction get a handler here — anything that
// requires judgment (e.g. "this app is confusing") is out of scope for
// auto-repair and stays a suggestion a human or the AI "improve" path acts on.
import { findNode, walkTree } from '../data/project.js';
import { makeId } from '../utils/id.js';
import { validateProject } from './validator.js';

function locate(project, issue) {
  const page = project.pages.find((p) => p.id === issue.pageId);
  if (!page) return null;
  const found = findNode(page.tree, issue.nodeId);
  return found ? { page, ...found } : { page, node: page.tree };
}

const FIXERS = {
  'missing-label': (project, issue) => {
    const { node } = locate(project, issue);
    node.props.label = node.props.label || 'Campo';
  },
  'empty-button': (project, issue) => {
    const { node } = locate(project, issue);
    node.props.label = 'Continuar';
  },
  'fixed-width': (project, issue) => {
    const { node } = locate(project, issue);
    node.style.width = `min(${node.style.width}, 100%)`;
  },
  'broken-bind': (project, issue) => {
    const { node } = locate(project, issue);
    delete node.bind;
  },
  'duplicate-id': (project, issue) => {
    const { page, node } = locate(project, issue);
    if (page) walkTree(page.tree, (n) => { if (n === node) n.id = makeId('c'); });
  },
};

export const REPAIRABLE_CODES = new Set(Object.keys(FIXERS));

/** Applies the fix, then re-runs the validator to confirm the issue is actually gone. */
export function repairIssue(project, issue) {
  const fixer = FIXERS[issue.code];
  if (!fixer) return { fixed: false, reason: 'Sem correção automática disponível para este problema.' };
  fixer(project, issue);
  const stillPresent = validateProject(project).some((i) => i.code === issue.code && i.nodeId === issue.nodeId);
  return stillPresent ? { fixed: false, reason: 'A correção foi aplicada, mas o problema persiste.' } : { fixed: true };
}

export function repairAll(project, issues) {
  const results = [];
  for (const issue of issues) {
    if (REPAIRABLE_CODES.has(issue.code)) results.push({ issue, ...repairIssue(project, issue) });
  }
  return results;
}
