// Unit tests for every module that doesn't touch chrome.* or the DOM (see
// ARCHITECTURE.md §15). Run with: node ai-builder/tests/run-tests.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

import { escapeHtml, escapeAttr, styleToInlineCss, safeToken } from '../sidepanel/scripts/codegen/sanitize.js';
import '../sidepanel/scripts/components/library.js';
import { hasComponent, listComponents, getComponent } from '../sidepanel/scripts/components/registry.js';
import { generateSite, wrapPreviewDocument, renderTree } from '../sidepanel/scripts/codegen/generator.js';
import { createProject, createPage, createNode, createEntity, findNode, walkTree } from '../sidepanel/scripts/data/project.js';
import { assemblePlan, fieldsForEntity, seedRowsForEntity } from '../sidepanel/scripts/templates/index.js';
import { validateProject } from '../sidepanel/scripts/validate/validator.js';
import { repairIssue, REPAIRABLE_CODES } from '../sidepanel/scripts/validate/repair.js';
import { localProvider } from '../sidepanel/scripts/ai/providers/local.js';
import { coerceAppPlan, validateAppPlan } from '../sidepanel/scripts/ai/schema.js';
import { generateApp } from '../sidepanel/scripts/ai/planner.js';
import { createZip, crc32 } from '../sidepanel/scripts/export/zip.js';
import { buildExportFiles } from '../sidepanel/scripts/export/exporter.js';
import * as cmd from '../sidepanel/scripts/builder/commands.js';
import { createHistory } from '../sidepanel/scripts/state/history.js';

// ------------------------------------------------------------- sanitize --

test('escapeHtml neutralizes tags and quotes', () => {
  assert.equal(escapeHtml(`<script>alert('x')</script>`), '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
  assert.equal(escapeHtml(undefined), '');
});

test('styleToInlineCss drops disallowed properties and unsafe values', () => {
  const css = styleToInlineCss({ padding: '1rem', color: 'red; background:url(evil)', notAllowed: '10px', width: '100%' });
  assert.match(css, /padding:1rem/);
  assert.match(css, /width:100%/);
  assert.doesNotMatch(css, /notAllowed/);
  assert.doesNotMatch(css, /url\(/);
});

test('safeToken strips everything but word chars and dashes', () => {
  assert.equal(safeToken('abc <script>_-123'), 'abcscript_-123');
});

// ------------------------------------------------------------- registry --

test('every registered component has the required contract shape', () => {
  const all = listComponents();
  assert.ok(all.length >= 20, `expected at least 20 components, got ${all.length}`);
  for (const def of all) {
    assert.ok(def.meta?.label, `${def.type} missing meta.label`);
    assert.ok(Array.isArray(def.propSchema), `${def.type} missing propSchema`);
    assert.equal(typeof def.render, 'function', `${def.type} missing render()`);
  }
  assert.ok(hasComponent('Button') && hasComponent('DataTable') && hasComponent('Raw'));
});

test('component render() never throws on default props and always returns html', () => {
  for (const def of listComponents()) {
    const node = createNode(def.type, { ...def.defaultProps });
    const { html } = def.render(node, '<span>child</span>', { attrs: `data-av-id="${node.id}" data-av-type="${node.type}"` });
    assert.equal(typeof html, 'string');
    assert.ok(html.includes(node.id), `${def.type} render output must carry data-av-id`);
  }
});

// ------------------------------------------------------------ generator --

test('generateSite produces html/css/js with no unescaped user input', () => {
  const project = createProject('Teste <script>');
  const evil = createNode('Alert', { text: `<img src=x onerror=alert(1)>`, variant: 'danger' });
  project.pages = [createPage('Início', '/', createNode('Stack', {}, [evil]))];
  const site = generateSite(project);
  assert.doesNotMatch(site.html, /<img src=x onerror/);
  assert.match(site.html, /&lt;img/);
  assert.match(site.css, /--av-color-primary:/);
  assert.match(site.js, /AV\.store/);
});

test('generateSite dedupes css/js per component type regardless of instance count', () => {
  const buttons = Array.from({ length: 12 }, () => createNode('Button', { label: 'x' }));
  const project = createProject('Muitos botões');
  project.pages = [createPage('Início', '/', createNode('Stack', {}, buttons))];
  const site = generateSite(project);
  const occurrences = site.css.split('.av-Button{').length - 1;
  assert.equal(occurrences, 1, 'Button CSS should appear exactly once no matter how many instances exist');
});

test('wrapPreviewDocument embeds an isolating CSP and the extra design-mode script only when given one', () => {
  const site = generateSite(createProject('X'));
  const withoutExtra = wrapPreviewDocument(site, 'X');
  const withExtra = wrapPreviewDocument(site, 'X', 'window.__extra = true;');
  assert.match(withoutExtra, /Content-Security-Policy/);
  assert.doesNotMatch(withoutExtra, /__extra/);
  assert.match(withExtra, /__extra/);
});

test('renderTree throws a clear error for an unknown component type (never silently drops it)', () => {
  const bad = createNode('TotallyMadeUpComponent', {});
  assert.throws(() => renderTree(bad), /desconhecido/);
});

// --------------------------------------------------------------- model ---

test('findNode locates nested nodes and reports parent/index', () => {
  const leaf = createNode('Button', { label: 'ok' });
  const tree = createNode('Stack', {}, [createNode('Card', {}, [leaf])]);
  const found = findNode(tree, leaf.id);
  assert.equal(found.node.id, leaf.id);
  assert.equal(found.parent.type, 'Card');
  assert.equal(found.index, 0);
});

test('walkTree visits every node exactly once', () => {
  const tree = createNode('Stack', {}, [createNode('Card', {}, [createNode('Button', {}), createNode('Badge', {})]), createNode('Alert', {})]);
  let count = 0;
  walkTree(tree, () => count++);
  assert.equal(count, 5);
});

// ------------------------------------------------------------ templates --

test('fieldsForEntity recognizes known domain nouns and falls back for unknown ones', () => {
  assert.ok(fieldsForEntity('Produto').some((f) => f.key === 'estoqueMinimo'));
  assert.ok(fieldsForEntity('Fornecedor').some((f) => f.key === 'telefone'));
  assert.deepEqual(fieldsForEntity('Xablau').map((f) => f.key), ['nome', 'descricao', 'status']);
});

test('assemblePlan builds a project with a dashboard, one page per entity, and settings', () => {
  const project = assemblePlan({ name: 'Estoque', entities: [{ name: 'Produto' }, { name: 'Fornecedor' }], features: ['Pesquisa'] });
  assert.equal(project.pages.length, 4); // dashboard + 2 entities + settings
  assert.equal(project.pages[0].route, '/');
  assert.equal(project.entities.length, 2);
  assert.ok(project.seedData.Produto.length > 0);
  const issues = validateProject(project).filter((i) => i.severity === 'error');
  assert.deepEqual(issues, [], `assembled project should have zero validator errors, got: ${JSON.stringify(issues)}`);
});

test('seedRowsForEntity produces deterministic-shaped rows matching the field list', () => {
  const fields = fieldsForEntity('Produto');
  const rows = seedRowsForEntity('Produto', fields, 3);
  assert.equal(rows.length, 3);
  for (const row of rows) for (const f of fields) assert.ok(f.key in row, `row missing ${f.key}`);
});

// -------------------------------------------------------------- local AI --

test('local provider extracts entities and features from a Portuguese prompt', async () => {
  const plan = await localProvider.generate({
    task: 'plan',
    prompt: 'Sistema de controle de estoque para uma loja de materiais de construção, com produtos, fornecedores, entradas, saídas e estoque mínimo.',
  });
  const names = plan.entities.map((e) => e.name);
  assert.ok(names.includes('Produto'), JSON.stringify(names));
  assert.ok(names.includes('Fornecedor'), JSON.stringify(names));
  assert.ok(plan.features.some((f) => /estoque mínimo/i.test(f)));
});

test('coerceAppPlan bounds a hostile/oversized plan to sane limits', () => {
  const huge = { name: 'x'.repeat(500), entities: Array.from({ length: 50 }, (_, i) => ({ name: `E${i}` })), features: Array.from({ length: 100 }, (_, i) => `F${i}`) };
  const coerced = coerceAppPlan(huge);
  assert.ok(coerced.name.length <= 80);
  assert.ok(coerced.entities.length <= 12);
  assert.ok(coerced.features.length <= 20);
});

test('validateAppPlan rejects malformed shapes', () => {
  assert.equal(validateAppPlan(null).valid, false);
  assert.equal(validateAppPlan({ name: 'x', entities: 'not-a-list' }).valid, false);
  assert.equal(validateAppPlan({ name: 'x', entities: [{ name: 'A' }], features: [] }).valid, true);
});

test('generateApp (end-to-end, local provider, no network) never throws and yields a validator-clean project', async () => {
  const { project, plan, usedFallback } = await generateApp('Crie um sistema de gestão de estoque com produtos, fornecedores, entradas e saídas.');
  assert.equal(usedFallback, false);
  assert.ok(project.pages.length >= 2);
  assert.ok(plan.entities.length > 0);
  const errors = validateProject(project).filter((i) => i.severity === 'error');
  assert.deepEqual(errors, []);
});

// ------------------------------------------------------------ validator --

test('validateProject flags a broken entity binding and repair removes it', () => {
  const table = Object.assign(createNode('DataTable', { columns: [{ key: 'nome', label: 'Nome' }] }), { bind: { entity: 'NaoExiste' } });
  const project = createProject('X');
  project.pages = [createPage('Início', '/', createNode('Stack', {}, [table]))];
  const issues = validateProject(project);
  const brokenBind = issues.find((i) => i.code === 'broken-bind');
  assert.ok(brokenBind);
  const result = repairIssue(project, brokenBind);
  assert.equal(result.fixed, true);
  assert.equal(validateProject(project).some((i) => i.code === 'broken-bind'), false);
});

test('REPAIRABLE_CODES only lists codes that actually have a fixer', () => {
  assert.ok(REPAIRABLE_CODES.has('missing-label'));
  assert.ok(REPAIRABLE_CODES.has('broken-bind'));
});

// -------------------------------------------------------------- history --

test('undo/redo restores exact prior state via the command stack (O(1) per op)', () => {
  const tree = createNode('Stack', {}, []);
  const history = createHistory();
  const btn = createNode('Button', { label: 'A' });
  history.push(cmd.cmdAddNode(tree, tree.id, 0, btn));
  assert.equal(tree.children.length, 1);
  history.push(cmd.cmdUpdateProps(tree, btn.id, { label: 'B' }));
  assert.equal(tree.children[0].props.label, 'B');
  history.undo();
  assert.equal(tree.children[0].props.label, 'A');
  history.undo();
  assert.equal(tree.children.length, 0);
  assert.equal(history.canUndo, false);
  history.redo();
  history.redo();
  assert.equal(tree.children[0].props.label, 'B');
});

test('cmdRemoveNode + undo puts the node back in the same position', () => {
  const a = createNode('Button', { label: 'a' });
  const b = createNode('Button', { label: 'b' });
  const c = createNode('Button', { label: 'c' });
  const tree = createNode('Stack', {}, [a, b, c]);
  const history = createHistory();
  history.push(cmd.cmdRemoveNode(tree, b.id));
  assert.deepEqual(tree.children.map((n) => n.props.label), ['a', 'c']);
  history.undo();
  assert.deepEqual(tree.children.map((n) => n.props.label), ['a', 'b', 'c']);
});

// ------------------------------------------------------------------ zip --

function readZipEntries(bytes) {
  const entries = [];
  let offset = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const uncompSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? inflateRawSync(Buffer.from(raw)) : Buffer.from(raw);
    assert.equal(data.length, uncompSize);
    entries.push({ name, data: data.toString('utf-8') });
    offset = dataStart + compSize;
  }
  return entries;
}

test('crc32 is stable and distinguishes different inputs', () => {
  const a = crc32(new TextEncoder().encode('hello'));
  const b = crc32(new TextEncoder().encode('hello'));
  const c = crc32(new TextEncoder().encode('hellp'));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('createZip round-trips file contents exactly (store or deflate-raw)', async () => {
  const files = [
    { name: 'index.html', content: '<h1>Olá</h1>'.repeat(50) },
    { name: 'styles.css', content: 'body{color:red}' },
  ];
  const { bytes } = await createZip(files);
  const entries = readZipEntries(bytes);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'index.html');
  assert.equal(entries[0].data, files[0].content);
  assert.equal(entries[1].data, files[1].content);
});

test('buildExportFiles produces a self-contained static project referencing styles.css/app.js', () => {
  const project = assemblePlan({ name: 'Loja', entities: [{ name: 'Produto' }], features: [] });
  const files = buildExportFiles(project);
  const names = files.map((f) => f.name);
  assert.deepEqual(names, ['index.html', 'styles.css', 'app.js', 'README.md']);
  const indexHtml = files[0].content;
  assert.match(indexHtml, /<link rel="stylesheet" href="styles.css">/);
  assert.match(indexHtml, /<script src="app.js"><\/script>/);
});

console.log('\nAll checks defined — see results above.');
