// 真浏览器 + R/Wasm + cetzDevice + Typst/Wasm 集成回归，无 mock 图形设备。
// CHROME_PATH 可指定已有 Chromium；不指定时使用 Playwright 安装的浏览器。
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const entry = '\0rplot-integration';
const server = await createServer({
  server: { host: '127.0.0.1', port: 5313, strictPort: true, hmr: false, ws: false, watch: null },
  plugins: [{
    name: 'rplot-integration-check',
    resolveId(id) { if (id === '/__rplot_integration.js') return entry; },
    load(id) {
      if (id !== entry) return;
      return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { RPlotDialog, RPlotInsertDialog } from '/src/ui/RPlotDialog.tsx';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Figure } from '/src/editor/extensions/blocks.tsx';
import { registerEditor, unregisterEditor } from '/src/editor/registry.ts';
import * as jobs from '/src/rplot/jobs.ts';
import { useRPlotLoad } from '/src/rplot/assets.ts';
import { useRPackageLoad } from '/src/rplot/packages.ts';
import { createRPlot, saveRPlot } from '/src/rplot/render.ts';
import { runRPlot, resetR, prepareRPlotRuntime } from '/src/rplot/runtime.ts';
import { useStore } from '/src/model/store.ts';
import { sampleDoc } from '/src/model/sample.ts';
import { serializeProject, serializePara } from '/src/typst/serialize.ts';
import { toMarkdown, fromMarkdown } from '/src/editor/markdown.ts';
import { compileDrawing } from '/src/compiler/client.ts';
import { setImageNamespace, saveProject, loadProject, loadImage } from '/src/model/persist.ts';
import { buildDocx } from '/src/export/docx/build.ts';
import { runTool } from '/src/ai/tools.ts';
import '/src/styles/app.css';
window.rplot = { createRPlot, saveRPlot, runRPlot, resetR, prepareRPlotRuntime, useRPlotLoad, useRPackageLoad, jobs, registerEditor, useStore, sampleDoc, serializeProject, serializePara, toMarkdown, fromMarkdown, compileDrawing, setImageNamespace, saveProject, loadProject, loadImage, buildDocx, runTool };
const root = createRoot(document.getElementById('root'));
const clear = () => root.render(React.createElement(FluentProvider, { theme: webLightTheme }));
window.rplot.showBackgroundDialog = () => {
  const ed = new Editor({ element: document.getElementById('editor'), extensions: [StarterKit, Figure.extend({ addNodeView: () => undefined })], content: useStore.getState().doc.body,
    onUpdate: ({ editor }) => useStore.getState().setRich('body', editor.getJSON()) });
  registerEditor('body', ed, { blocks: true, headings: true, docId: useStore.getState().doc.id }); window.rplot.ed = ed;
  ed.commands.setTextSelection(ed.state.doc.content.size);
  root.render(React.createElement(FluentProvider, { theme: webLightTheme }, React.createElement(RPlotInsertDialog, { editor: ed, richKey: 'body', onClose: clear })));
};
window.rplot.closeEditor = () => { const ed = window.rplot.ed; if (ed) { unregisterEditor('body', ed); ed.destroy(); } };
window.rplot.showDialog = (initial) => {
  root.render(React.createElement(FluentProvider, { theme: webLightTheme }, React.createElement(RPlotDialog, {
    initial, onApply: (attrs) => { window.rplot.inserted = attrs; }, onClose: clear,
  })));
};`;
    },
    configureServer(s) {
      s.middlewares.use('/__rplot_test__', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await s.transformIndexHtml('/__rplot_test__', '<!doctype html><html lang="zh"><head><meta charset="utf-8"><base href="/"></head><body><div id="root"></div><div id="editor"></div><script type="module" src="/__rplot_integration.js"></script></body></html>'));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], remote = [], local = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:5313/')) remote.push(r.url()); else local.push(r.url()); });
  await page.exposeFunction('rProgress', (s) => console.log('  ' + s));
  await page.goto('http://127.0.0.1:5313/__rplot_test__');
  await page.waitForFunction(() => !!window.rplot);

  const warm = await page.evaluate(async () => {
    const a = window.rplot, phases = [];
    const off = a.useRPlotLoad.subscribe((s) => phases.push(s.phase));
    await Promise.all([a.prepareRPlotRuntime(), a.prepareRPlotRuntime()]); off();
    return { ...a.useRPlotLoad.getState(), phases };
  });
  assert.equal(warm.phase, 'ready'); assert.equal(warm.done, warm.total); assert.ok(warm.bytes > 20000000, JSON.stringify(warm));
  assert.ok(warm.phases.includes('downloading') && warm.phases.includes('initializing'));
  assert.equal(local.filter((u) => u.endsWith('/rplot/library.data')).length, 1);
  console.log('PASS shared background prewarm downloads once and exposes real component progress');

  const base = await page.evaluate(async () => {
    const a = window.rplot;
    const r = await a.createRPlot('plot(mtcars$wt, mtcars$mpg, pch=19, col="#166183", xlab="Weight", ylab="MPG")', { width: 5.5, height: 3.5, progress: window.rProgress });
    window.lastRPlot = r;
    return { size: r.png.size, version: r.plot.version, pages: r.plot.pages, source: r.plot.source };
  });
  assert.equal(base.version, '0.5.3.1'); assert.equal(base.pages, 1);
  assert.ok(base.size > 2000); assert.match(base.source, /@preview\/cetz:0\.5\.3/); assert.match(base.source, /#let r-layers/);
  console.log('PASS real R device produces CeTZ and PNG');

  const typography = await page.evaluate(async () => {
    const a = window.rplot;
    const automatic = await a.runRPlot('plot(1:3, main="Auto font")', { width: 5.5, height: 3.5 });
    const manual = await a.runRPlot('plot(1:3)', { width: 5.5, height: 3.5, pointsize: 10.8 });
    const explicit = await a.runRPlot('grid::grid.text("Explicit 10.8", gp=grid::gpar(fontsize=10.8))', { width: 5.5, height: 3.5 });
    await a.runRPlot('plot.new(); f <- function(x=99,y=99) { stopifnot(is.null(x), missing(y)); text(.5,.5,"Literal NULL preserved") }; f(NULL,)', { width: 5.5, height: 3.5 });
    const panels = await a.runRPlot('par(mfrow=c(2,2)); plot(1:3); plot(3:1)', { width: 8, height: 7 });
    const smallPanels = await a.runRPlot('par(mfrow=c(2,2)); plot(1:3)', { width: 3, height: 3 });
    const explicitCex = await a.runRPlot('par(mfrow=c(2,2), cex=.9); plot(1:3)', { width: 8, height: 7 });
    const theme = await a.runRPlot('library(ggplot2)\nggplot(mtcars, aes(wt,mpg))+geom_point()+theme_classic()', { width: 5.5, height: 3.5 });
    const manualTheme = await a.runRPlot('library(ggplot2)\nggplot(mtcars, aes(wt,mpg))+geom_point()+theme_classic()', { width: 5.5, height: 3.5, pointsize: 10.8 });
    const explicitTheme = await a.runRPlot('library(ggplot2)\nggplot(mtcars, aes(wt,mpg))+geom_point()+theme_classic(base_size=11)+theme(axis.text=element_text(size=8.2))', { width: 5.5, height: 3.5 });
    const dense = await a.runRPlot('plot.new(); plot.window(xlim=c(0,1), ylim=c(0,1), xaxs="i", yaxs="i"); text(c(.49,.51), c(.5,.5), c("abcdef","ghijkl"))', { width: 3, height: 3 });
    return { auto: automatic.plot, manual: manual.plot, explicit: explicit.plot, panels: panels.plot, smallPanels: smallPanels.plot, explicitCex: explicitCex.plot, theme: theme.plot, manualTheme: manualTheme.plot, explicitTheme: explicitTheme.plot, dense: dense.plot };
  });
  assert.equal(typography.auto.pointsize, 10.5); assert.equal(typography.auto.fontMode, 'auto');
  assert.match(typography.auto.source, /size: 10\.5pt/);
  assert.equal(typography.manual.fontMode, 'manual'); assert.match(typography.manual.source, /size: 10\.8pt/);
  assert.match(typography.explicit.source, /size: 10\.8pt/);
  assert.equal(typography.panels.pointsize, 10.5); assert.doesNotMatch(typography.panels.source, /size: 8\.715pt/);
  assert.ok([9, 7.5].includes(typography.smallPanels.pointsize));
  assert.match(typography.explicitCex.source, /size: 9\.45pt/);
  assert.equal(typography.theme.pointsize, 10.5); assert.match(typography.theme.source, /size: 10\.5pt/);
  assert.match(typography.manualTheme.source, /size: 10\.8pt/); assert.equal(typography.manualTheme.fontMode, 'manual');
  assert.match(typography.explicitTheme.source, /size: 8\.2pt/); assert.match(typography.explicitTheme.source, /size: 11pt/);
  assert.ok([9, 7.5].includes(typography.dense.pointsize), JSON.stringify(typography.dense.fontReport));
  assert.ok(typography.dense.fontReport.overlaps > 0, 'Unresolved crowding must be reported, not hidden by further shrinking');
  console.log('PASS five-point-Chinese font preference, dense fallback and exact explicit pt in base/grid/ggplot');

  const saved = await page.evaluate(async () => {
    const a = window.rplot, d = a.sampleDoc();
    for (const k of ['abstractZh','abstractEn','body','conclusion','appendix','acknowledgement','resume']) d[k] = { type: 'doc', content: [] };
    a.useStore.setState({ doc: d, loaded: true }); a.setImageNamespace(d.id);
    const attrs = await a.saveRPlot(window.lastRPlot, d.id, 12);
    const fig = { type: 'figure', attrs: { ...attrs, uid: 'rplot-integration-figure', caption: 'R 绘图测试', label: 'fig:rplot-test' } };
    d.body = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1, uid: 'rplot-integration-chapter' }, content: [{ type: 'text', text: 'R 绘图' }] }, fig] };
    const restored = a.fromMarkdown(a.toMarkdown(d.body), true);
    if (!restored.content.find((n) => n.type === 'figure')?.attrs.rPlot) throw Error('Markdown lost R source');
    const p = a.serializeProject(d);
    if (!p.files[window.lastRPlot.plot.path]) throw Error('Missing independent .typ file');
    const drawing = await a.compileDrawing(p.main, p.files);
    if (!drawing.artifact) throw Error(drawing.error);
    const para = a.serializePara(d, 1);
    if (!para.files[window.lastRPlot.plot.path]) throw Error('Paragraph compile lost .typ file');
    await a.saveProject(d.id, d);
    const reopened = await a.loadProject(d.id), image = await a.loadImage(attrs.image);
    if (!image?.size || !reopened.body.content.find((n) => n.type === 'figure')?.attrs.rPlot) throw Error('Saved project lost R source/preview');
    a.useStore.setState({ doc: d });
    return { artifact: drawing.artifact.byteLength, docx: (await a.buildDocx(d)).size };
  });
  assert.ok(saved.artifact > 10000); assert.ok(saved.docx > 10000);
  console.log('PASS independent typ import, Markdown roundtrip, save/reopen and Word export');

  const labels = await page.evaluate(async () => {
    const r = await window.rplot.createRPlot('plot(1:4, c(4,2,3,1), main="中文绘图", xlab=cetzDevice::cetz_typst("$alpha$"), ylab=cetzDevice::cetz_latex("$x^2$"))', { width: 5, height: 3.5, progress: window.rProgress });
    return { size: r.png.size, source: r.plot.source };
  });
  assert.ok(labels.size > 2000); assert.match(labels.source, /mitex:0\.2\.6/); assert.match(labels.source, /中文绘图/);
  console.log('PASS Chinese, Typst and MiTeX labels with real font metrics');

  const ggplot = await page.evaluate(async () => {
    const r = await window.rplot.createRPlot('library(ggplot2)\nlibrary(ggrepel)\nggplot(mtcars, aes(wt, mpg, colour=factor(cyl), label=rownames(mtcars))) + geom_point() + geom_text_repel(max.overlaps=Inf, max.time=0, max.iter=50, seed=1) + theme_classic(base_family="TeX Gyre Termes")', { width: 5, height: 3.5, progress: window.rProgress });
    return { size: r.png.size, pages: r.plot.pages };
  });
  assert.ok(ggplot.size > 2000); assert.equal(ggplot.pages, 1);
  assert.deepEqual(remote, [], 'Core R/ggplot2 drawing must not depend on an external CDN');
  console.log('PASS bundled ggplot2 + ggrepel, no external runtime/package requests');

  const extra = await page.evaluate(async () => {
    const a = window.rplot, states = [];
    const off = a.useRPackageLoad.subscribe((s) => states.push({ phase: s.phase, bytes: s.bytes, name: s.name }));
    const r = await a.createRPlot('library(patchwork)\nlibrary(ggplot2)\np <- ggplot(mtcars, aes(wt, mpg)) + geom_point()\np + p', { width: 5, height: 3.5, progress: window.rProgress }); off();
    return { size: r.png.size, states, cached: (await (await caches.open('iota-rplot-rpackages-v1')).keys()).map((k) => k.url) };
  });
  assert.ok(extra.size > 2000); assert.ok(extra.states.some((s) => s.phase === 'download' && s.bytes > 0)); assert.ok(extra.states.some((s) => s.phase === 'install'));
  assert.ok(local.some((u) => /patchwork_.*\.tgz$/.test(u)));
  assert.ok(extra.cached.some((u) => /patchwork_.*\.tgz$/.test(u)));
  console.log('PASS optional Wasm package installs from same-origin archive with byte/install progress');

  const data = await page.evaluate(async () => {
    const a = window.rplot, code = 'd <- read.csv("/data/test.csv")\nplot(d$x, d$y, type="b")';
    const files = [{ name: 'test.csv', bytes: new TextEncoder().encode('x,y\n1,3\n2,1\n3,4\n') }];
    const first = await a.runRPlot(code, { files, width: 5, height: 3.5, progress: window.rProgress });
    const kept = first.plot.dataFiles;
    const second = await a.runRPlot(code, { width: 5, height: 3.5, files: kept.map((f) => ({ name: f.name, bytes: Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)) })), progress: window.rProgress });
    return { kept: kept.length, same: first.plot.source === second.plot.source };
  });
  assert.equal(data.kept, 1); assert.equal(data.same, true);
  console.log('PASS data file retention and deterministic replay');
  const isolated = await page.evaluate(async () => {
    const a = window.rplot;
    const file = { name: 'isolated.csv', bytes: new TextEncoder().encode('x,y\n1,3\n2,4\n') };
    await a.runRPlot('stopifnot(!file.exists("/data/generated.txt")); writeLines("temporary", "/data/generated.txt"); d <- read.csv("isolated.csv"); plot(d$x, d$y, main="isolation-label-新")', { files: [file], width: 5, height: 3.5 });
    const next = await a.runRPlot('stopifnot(!file.exists("/data/isolated.csv"), !file.exists("/data/generated.txt"), !file.exists("/data/test.csv")); plot(1:3)', { width: 5, height: 3.5 });
    let duplicate = false;
    try { await a.runRPlot('plot(1:3)', { files: [file, file] }); } catch (e) { duplicate = /文件名重复/.test(e.message); }
    return { next: !!next.plot.source, duplicate };
  });
  assert.equal(isolated.next, true); assert.equal(isolated.duplicate, true);
  console.log('PASS per-job/per-replay data isolation, relative filenames and duplicate rejection');

  const tool = await page.evaluate(async () => {
    const a = window.rplot;
    const out = await a.runTool('r_plot', { part: 'body', code: 'plot(1:4, c(3,1,4,2), type="l")', width: 12, height: 8, caption: 'Agent R 图', label: 'fig:agent-rplot' });
    return { out, attrs: a.useStore.getState().doc.body.content.at(-1)?.attrs };
  });
  assert.match(tool.out, /R 图已插入/); assert.ok(tool.attrs?.rPlot);
  console.log('PASS Agent r_plot tool inserts an editable R figure');

  await page.evaluate(() => window.rplot.showDialog());
  const dataInput = page.locator('input[type="file"]');
  await dataInput.setInputFiles({ name: 'replace.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y\n1,2\n') });
  await dataInput.setInputFiles({ name: 'replace.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y\n3,4\n') });
  assert.equal(await page.locator('.rplot-files button').count(), 1, '同名附件应替换而不是重复添加');
  await page.locator('.rplot-files button').click();
  assert.equal(await page.locator('.rplot-files button').count(), 0, '附件应能移除');
  console.log('PASS attachment replacement and removal in R dialog');
  await page.getByRole('textbox', { name: 'R 绘图代码', exact: true }).fill('plot(1:4, type="b", main="用户界面测试")');
  await page.getByRole('button', { name: '运行预览', exact: true }).click();
  await page.locator('.rplot-preview img').waitFor({ timeout: 120000 });
  if (process.env.RPLOT_SCREENSHOT) await page.screenshot({ path: process.env.RPLOT_SCREENSHOT });
  await page.getByRole('button', { name: '插入', exact: true }).click();
  await page.waitForFunction(() => !!window.rplot.inserted);
  assert.ok(await page.evaluate(() => !!window.rplot.inserted.rPlot));
  console.log('PASS user R editor: run, preview and insert');

  await page.evaluate(() => { const previous = window.rplot.inserted; window.rplot.inserted = null; window.rplot.showDialog(previous); });
  assert.match(await page.getByRole('textbox', { name: 'R 绘图代码', exact: true }).innerText(), /用户界面测试/);
  await page.getByRole('textbox', { name: 'R 绘图代码', exact: true }).fill('plot(4:1, type="l", main="编辑已有 R 图")');
  await page.getByRole('button', { name: '运行预览', exact: true }).click();
  await page.locator('.rplot-preview img').waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await page.waitForFunction(() => !!window.rplot.inserted);
  assert.match(await page.evaluate(() => JSON.parse(window.rplot.inserted.rPlot).code), /编辑已有 R 图/);
  console.log('PASS existing R figure reopens with source and applies regenerated plot');

  await page.evaluate(() => window.rplot.showBackgroundDialog());
  await page.getByRole('textbox', { name: 'R 绘图代码', exact: true }).fill('Sys.sleep(2); plot(1:4, type="b", main="后台插图")');
  await page.getByRole('button', { name: '运行预览', exact: true }).click();
  await page.getByRole('button', { name: '后台生成，继续编辑', exact: true }).click();
  await page.locator('.rplot-dialog').waitFor({ state: 'detached' });
  const background = await page.evaluate(async () => {
    const a = window.rplot, ed = a.ed, j = a.jobs;
    const placeholder = ed.getJSON().content.find((n) => n.attrs?.rPlotTask);
    if (!placeholder) throw Error('Missing background placeholder');
    const pending = JSON.parse(placeholder.attrs.rPlotTask), uid = placeholder.attrs.uid;
    const md = a.fromMarkdown(a.toMarkdown({ type: 'doc', content: [placeholder] }), true);
    if (JSON.parse(md.content[0].attrs.rPlotTask).id !== pending.id) throw Error('Markdown lost pending task');
    ed.commands.setTextSelection(2); ed.commands.insertContent('继续编辑');
    const selection = ed.state.selection.from;
    await j.waitRPlotJob(pending.id);
    const node = ed.getJSON().content.find((n) => n.attrs?.uid === uid);
    return { editable: ed.state.doc.textContent.includes('继续编辑'), samePosition: ed.state.selection.from === selection, complete: !!node?.attrs.rPlot && !node?.attrs.rPlotTask };
  });
  assert.equal(background.editable, true); assert.equal(background.samePosition, true); assert.equal(background.complete, true);
  console.log('PASS close to background, preserve pending source, continue editing and fill same node without moving cursor');

  const lifecycle = await page.evaluate(async () => {
    const a = window.rplot, ed = a.ed, j = a.jobs;
    const draft = { code: 'Sys.sleep(1); plot(1:3)', width: 12, height: 8, pointsize: 11, seed: 1, caption: '', captionEn: '', label: '' };
    const attach = (d) => {
      const id = j.startRPlotJob(d, a.useStore.getState().doc.id), attrs = j.pendingFigureAttrs(id, d);
      ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'figure', attrs });
      j.attachRPlotJob(id, { docId: a.useStore.getState().doc.id, key: 'body', uid: attrs.uid });
      return { id, attrs };
    };
    const deleted = attach(draft);
    let pos; ed.state.doc.descendants((n, p) => { if (n.attrs.uid === deleted.attrs.uid) pos = p; });
    ed.view.dispatch(ed.state.tr.delete(pos, pos + 1));
    let notRevived = false;
    try { await j.waitRPlotJob(deleted.id); } catch { notRevived = !ed.getJSON().content.some((n) => n.attrs?.uid === deleted.attrs.uid); }
    const switched = attach(draft), original = a.useStore.getState().doc;
    a.useStore.setState({ doc: { ...a.sampleDoc(), id: 'other-rplot-project' } });
    const ready = await j.waitRPlotJob(switched.id);
    const notCrossWritten = a.useStore.getState().doc.id === 'other-rplot-project' && !a.useStore.getState().doc.body.content.some((n) => n.attrs?.uid === switched.attrs.uid);
    // React 切工程的提交前，登记表可能还留着另一个工程的编辑器；应回填工程数据而不是判作删除。
    a.registerEditor('body', ed, { blocks: true, headings: true, docId: 'other-rplot-project' });
    a.useStore.setState({ doc: original });
    await j.waitRPlotJob(switched.id);
    const restored = a.useStore.getState().doc.body.content.some((n) => n.attrs?.uid === switched.attrs.uid && n.attrs.rPlot);
    ed.commands.setContent(a.useStore.getState().doc.body);
    a.registerEditor('body', ed, { blocks: true, headings: true, docId: original.id });
    const failed = attach({ ...draft, code: 'stop("intentional retry check")' });
    try { await j.waitRPlotJob(failed.id); } catch { /* expected */ }
    const node = ed.getJSON().content.find((n) => n.attrs?.uid === failed.attrs.uid), pending = JSON.parse(node.attrs.rPlotTask);
    const retry = j.retryRPlotJob({ ...pending, draft: { ...pending.draft, code: 'plot(1:3)' } }, { docId: original.id, key: 'body', uid: failed.attrs.uid });
    await j.waitRPlotJob(retry);
    const retried = ed.getJSON().content.some((n) => n.attrs?.uid === failed.attrs.uid && n.attrs.rPlot && !n.attrs.rPlotTask);
    const cancelled = attach({ ...draft, code: 'Sys.sleep(20); plot(1:3)' });
    j.cancelRPlotJob(cancelled.id);
    const cancelledState = JSON.parse(ed.getJSON().content.find((n) => n.attrs?.uid === cancelled.attrs.uid).attrs.rPlotTask).state;
    a.closeEditor();
    return { notRevived, deferred: ready.phase === 'ready', notCrossWritten, restored, failed: pending.state === 'failed', retried, cancelled: cancelledState === 'cancelled' };
  });
  assert.deepEqual(lifecycle, { notRevived: true, deferred: true, notCrossWritten: true, restored: true, failed: true, retried: true, cancelled: true });
  console.log('PASS deleted placeholder stays deleted, project switch defers result, failure retries and cancellation persist');

  const recovery = await page.evaluate(async () => {
    const a = window.rplot;
    const stalled = a.createRPlot('while(TRUE) {}', { timeout: 1 }).catch((e) => /超时/.test(e.message));
    let concurrent = false;
    try { await a.createRPlot('plot(1:3)'); } catch (e) { concurrent = /另一个 R 绘图任务/.test(e.message); }
    const timed = await stalled;
    const r = await a.createRPlot('plot(1:3)', { width: 5, height: 3.5, progress: window.rProgress });
    return { timed, concurrent, recovered: !!r.plot.source };
  });
  assert.equal(recovery.timed, true); assert.equal(recovery.concurrent, true); assert.equal(recovery.recovered, true);
  const cachedPackage = await page.evaluate(async () => {
    const a = window.rplot; let hit = false;
    const off = a.useRPackageLoad.subscribe((s) => { if (s.cached) hit = true; });
    await a.createRPlot('library(patchwork); plot(1:3)', { width: 5, height: 3.5 }); off();
    return hit;
  });
  assert.equal(cachedPackage, true);
  assert.equal(local.filter((u) => /patchwork_.*\.tgz$/.test(u)).length, 1);
  assert.equal(local.filter((u) => u.endsWith('/rplot/library.data')).length, 1);
  assert.deepEqual(errors, []);
  console.log('PASS timeout/cancellation recovery and package reuse without downloading again');
} finally { await browser?.close(); await server.close(); }
