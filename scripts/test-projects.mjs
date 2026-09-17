// Project lifecycle regression checks; no browser storage or user documents are touched.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const records = new Map();
const images = new Map();
let namespace = '';
let active = null;
globalThis.window = { setTimeout, clearTimeout, addEventListener() {} };
globalThis.__projectTestPersistence = {
  async saveProject(id, doc) { records.set(id, structuredClone(doc)); },
  async loadProject(id) { return records.get(id); },
  async deleteProjectRecord(id) { records.delete(id); },
  async allProjects() { return [...records.values()]; },
  async getActiveProjectId() { return active; },
  async setActiveProjectId(id) { active = id; },
  async loadLegacyDoc() { return null; },
  async clearLegacyDoc() {},
  setImageNamespace(id) { namespace = id; },
  async saveImage(name, blob, projectId = namespace) { images.set(`${projectId}/${name}`, blob); },
  async loadImage(name) { return images.get(`${namespace}/${name}`); },
  async listImageKeys() { return [...images.keys()]; },
  async copyImageRaw(from, to) { images.set(to, images.get(from)); },
  async deleteImageKey(key) { images.delete(key); },
};
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  plugins: [{
    name: 'project-test-storage',
    enforce: 'pre',
    resolveId(id) {
      if (id === './persist') return '\0test-persist';
      if (id === '../editor/imageCache') return '\0test-image-cache';
    },
    load(id) {
      if (id === '\0test-persist') return `export const { ${Object.keys(globalThis.__projectTestPersistence).join(', ')} } = globalThis.__projectTestPersistence;`;
      if (id === '\0test-image-cache') return 'export function clearImageCache() {}';
    },
  }],
});
try {
  const { useStore, newDoc } = await server.ssrLoadModule('/src/model/store.ts');
  const state = () => useStore.getState();
  assert.equal(state().view, 'projects');
  await state().load();
  assert.equal(state().view, 'projects');
  assert.equal(records.size, 0, 'first visit must not create a sample');

  const first = await state().createProject({ name: '第一篇', settings: {}, template: 'blank' });
  assert.equal(state().view, 'editor');
  state().setInfo({ title: '未到自动保存时间的内容' });
  await state().renameProject(first, '新名称');
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(records.get(first).name, '新名称', 'autosave must not undo rename');
  assert.equal(records.get(first).info.title, '未到自动保存时间的内容');

  const incoming = newDoc();
  incoming.name = '导入文档';
  incoming.images = [{ name: 'test.png', mime: 'image/png' }];
  await state().importProject(incoming, [{ name: 'test.png', blob: new Blob(['test']) }]);
  const imported = state().doc.id;
  assert.notEqual(imported, first);
  assert.notEqual(imported, incoming.id);
  assert.equal(records.size, 2, 'opening a file preserves the existing document');
  assert.equal(records.get(first).info.title, '未到自动保存时间的内容');
  assert.ok(images.has(`${imported}/test.png`));

  state().setInfo({ title: '即将删除' });
  await state().deleteProject(imported);
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.ok(!records.has(imported), 'pending autosave must not resurrect a deleted document');
  assert.ok(!images.has(`${imported}/test.png`));
  assert.equal(state().doc.id, first);
  await state().deleteProject(first);
  assert.equal(records.size, 0);
  assert.equal(state().view, 'projects');
  assert.notEqual(state().doc.id, first, 'last deleted document cannot remain active');

  const report = await state().createProject({ name: '', settings: { campus: 'shenzhen', degreeLevel: 'bachelor', stage: 'proposal', lang: 'en' }, template: 'sample' });
  assert.match(state().doc.body.content[0].content[0].text, /Background/);
  assert.match(state().doc.name, /开题报告/);
  assert.equal(state().doc.images.length, 0, 'report samples must not retain an unused thesis image');
  await state().deleteProject(report);

  const humanities = await state().createProject({ name: '', settings: { category: 'hass', stage: 'final' }, template: 'sample' });
  assert.match(state().doc.body.content[1].content[0].text, /研究背景/);
  assert.ok(state().doc.appendix.content.length > 0, 'final sample should demonstrate appendix numbering');
  await state().deleteProject(humanities);
  // A manual refresh must survive a newer edit queued behind an active compile.
  let worker;
  globalThis.Worker = class {
    sent = [];
    constructor() { worker = this; }
    postMessage(message) { this.sent.push(message); }
    emit(data) { this.onmessage({ data }); }
  };
  globalThis.document = { baseURI: 'http://localhost/' };
  const compiler = await server.ssrLoadModule('/src/compiler/client.ts');
  compiler.startCompiler();
  worker.emit({ type: 'ready', ms: 0, families: [] });
  const input = (main, extra = {}) => ({ main, files: {}, images: [], removeImages: [], ...extra });
  compiler.requestCompile(input('first'));
  const firstCompile = worker.sent.at(-1);
  compiler.requestCompile(input('refresh', { force: true, removeImages: ['same.png'] }));
  compiler.requestCompile(input('latest text', { images: [{ name: 'same.png', data: new ArrayBuffer(1) }] }));
  worker.emit({ type: 'compiled', id: firstCompile.id, artifact: null, glyphs: null, fresh: false, diagnostics: [], ms: 0 });
  const refreshCompile = worker.sent.at(-1);
  assert.equal(refreshCompile.force, true);
  assert.equal(refreshCompile.main, 'latest text');
  assert.deepEqual(refreshCompile.removeImages, [], 'newly added image must not also be removed');
  assert.equal(refreshCompile.images.length, 1);
  worker.emit({ type: 'compiled', id: refreshCompile.id, artifact: new ArrayBuffer(1), glyphs: null, fresh: true, diagnostics: [], ms: 0 });
  assert.equal(compiler.useCompileState.getState().artifactFresh, true);
  assert.equal(compiler.useCompileState.getState().compiling, false);
  console.log('PASS: manual refresh queue, latest text, image replacement, fresh preview');
  console.log('PASS: first visit, creation, branch-specific samples, rename/autosave, import isolation, deletion/autosave, empty library');
} finally {
  await server.close();
  delete globalThis.__projectTestPersistence;
}
