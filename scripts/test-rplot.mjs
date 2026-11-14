// 真浏览器 + R/Wasm + cetzDevice + Typst/Wasm 集成回归，无 mock 图形设备。
// CHROME_PATH 可指定已有 Chromium；不指定时使用 Playwright 安装的浏览器。
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const entry = '\0rplot-integration';
const server = await createServer({
  server: { host: '127.0.0.1', port: 5313, strictPort: true },
  plugins: [{
    name: 'rplot-integration-check',
    resolveId(id) { if (id === '/__rplot_integration.js') return entry; },
    load(id) {
      if (id !== entry) return;
      return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { RPlotDialog } from '/src/ui/RPlotDialog.tsx';
import { createRPlot, saveRPlot } from '/src/rplot/render.ts';
import { runRPlot, resetR } from '/src/rplot/runtime.ts';
import { useStore } from '/src/model/store.ts';
import { sampleDoc } from '/src/model/sample.ts';
import { serializeProject, serializePara } from '/src/typst/serialize.ts';
import { toMarkdown, fromMarkdown } from '/src/editor/markdown.ts';
import { compileDrawing } from '/src/compiler/client.ts';
import { setImageNamespace, saveProject, loadProject, loadImage } from '/src/model/persist.ts';
import { buildDocx } from '/src/export/docx/build.ts';
import { runTool } from '/src/ai/tools.ts';
import '/src/styles/app.css';
window.rplot = { createRPlot, saveRPlot, runRPlot, resetR, useStore, sampleDoc, serializeProject, serializePara, toMarkdown, fromMarkdown, compileDrawing, setImageNamespace, saveProject, loadProject, loadImage, buildDocx, runTool };
const root = createRoot(document.getElementById('root'));
window.rplot.showDialog = (initial) => {
  root.render(React.createElement(FluentProvider, { theme: webLightTheme }, React.createElement(RPlotDialog, {
    initial, onApply: (attrs) => { window.rplot.inserted = attrs; }, onClose: () => root.render(React.createElement(FluentProvider, { theme: webLightTheme })),
  })));
};`;
    },
    configureServer(s) {
      s.middlewares.use('/__rplot_test__', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await s.transformIndexHtml('/__rplot_test__', '<!doctype html><html lang="zh"><head><meta charset="utf-8"><base href="/"></head><body><div id="root"></div><script type="module" src="/__rplot_integration.js"></script></body></html>'));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], remote = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:5313/')) remote.push(r.url()); });
  await page.exposeFunction('rProgress', (s) => console.log('  ' + s));
  await page.goto('http://127.0.0.1:5313/__rplot_test__');
  await page.waitForFunction(() => !!window.rplot);

  const base = await page.evaluate(async () => {
    const a = window.rplot;
    const r = await a.createRPlot('plot(mtcars$wt, mtcars$mpg, pch=19, col="#166183", xlab="Weight", ylab="MPG")', { width: 5.5, height: 3.5, progress: window.rProgress });
    window.lastRPlot = r;
    return { size: r.png.size, version: r.plot.version, pages: r.plot.pages, source: r.plot.source };
  });
  assert.equal(base.version, '0.5.3.1'); assert.equal(base.pages, 1);
  assert.ok(base.size > 2000); assert.match(base.source, /@preview\/cetz:0\.5\.3/); assert.match(base.source, /#let r-layers/);
  console.log('PASS real R device produces CeTZ and PNG');

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
    const r = await window.rplot.createRPlot('library(ggplot2)\nggplot(mtcars, aes(wt, mpg, colour=factor(cyl))) + geom_point() + theme_classic(base_family="TeX Gyre Termes")', { width: 5, height: 3.5, progress: window.rProgress });
    return { size: r.png.size, pages: r.plot.pages };
  });
  assert.ok(ggplot.size > 2000); assert.equal(ggplot.pages, 1);
  assert.deepEqual(remote, [], 'Core R/ggplot2 drawing must not depend on an external CDN');
  console.log('PASS bundled ggplot2, no external runtime/package requests');

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

  const tool = await page.evaluate(async () => {
    const a = window.rplot;
    const out = await a.runTool('r_plot', { part: 'body', code: 'plot(1:4, c(3,1,4,2), type="l")', width: 12, height: 8, caption: 'Agent R 图', label: 'fig:agent-rplot' });
    return { out, attrs: a.useStore.getState().doc.body.content.at(-1)?.attrs };
  });
  assert.match(tool.out, /R 图已插入/); assert.ok(tool.attrs?.rPlot);
  console.log('PASS Agent r_plot tool inserts an editable R figure');

  await page.evaluate(() => window.rplot.showDialog());
  await page.getByRole('textbox', { name: 'R 绘图代码', exact: true }).fill('plot(1:4, type="b", main="用户界面测试")');
  await page.getByRole('button', { name: '运行预览', exact: true }).click();
  await page.locator('.rplot-preview img').waitFor({ timeout: 120000 });
  if (process.env.RPLOT_SCREENSHOT) await page.screenshot({ path: process.env.RPLOT_SCREENSHOT });
  await page.getByRole('button', { name: '插入', exact: true }).click();
  await page.waitForFunction(() => !!window.rplot.inserted);
  assert.ok(await page.evaluate(() => !!window.rplot.inserted.rPlot));
  console.log('PASS user R editor: run, preview and insert');

  await page.evaluate(() => { const previous = window.rplot.inserted; window.rplot.inserted = null; window.rplot.showDialog(previous); });
  assert.match(await page.getByRole('textbox', { name: 'R 绘图代码', exact: true }).inputValue(), /用户界面测试/);
  await page.getByRole('textbox', { name: 'R 绘图代码', exact: true }).fill('plot(4:1, type="l", main="编辑已有 R 图")');
  await page.getByRole('button', { name: '运行预览', exact: true }).click();
  await page.locator('.rplot-preview img').waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await page.waitForFunction(() => !!window.rplot.inserted);
  assert.match(await page.evaluate(() => JSON.parse(window.rplot.inserted.rPlot).code), /编辑已有 R 图/);
  console.log('PASS existing R figure reopens with source and applies regenerated plot');

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
  assert.deepEqual(errors, []);
  console.log('PASS concurrent drawing rejected, timeout terminates worker, next drawing recovers');
} finally { await browser?.close(); await server.close(); }
