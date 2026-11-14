// Zotero API 固定响应 + 真实 PDF.js/IndexedDB/React/Agent 工具，不使用个人凭证。
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

function pdf(lines) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${lines.length} /Kids [${lines.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const [i, text] of lines.entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    const content = text ? `BT /F1 16 Tf 30 240 Td (${text}) Tj ET` : '';
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  let source = '%PDF-1.4\n', offsets = [0];
  objects.forEach((o, i) => { offsets.push(source.length); source += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = source.length;
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source);
}
const article = pdf(['Zotero alpha calibration experiment.', 'Beta spectroscopy measured value 42.']), scanned = pdf(['']);
const entry = '\0library-integration';
const server = await createServer({ cacheDir: 'node_modules/.vite-library-test', server: { host: '127.0.0.1', port: 5315, strictPort: true, hmr: false, ws: false, watch: null }, plugins: [{
  name: 'library-integration', resolveId(id) { if (id === '/__library.js') return entry; }, load(id) {
    if (id !== entry) return;
    return `import React from 'react';
import {createRoot} from 'react-dom/client';
import {FluentProvider, webLightTheme} from '@fluentui/react-components';
import {LibraryPanel} from '/src/ui/LibraryPanel.tsx';
import {ZoteroDialog} from '/src/ui/ZoteroDialog.tsx';
import {RPlotBackground} from '/src/ui/RPlotBackground.tsx';
import {useRPlotLoad} from '/src/rplot/assets.ts';
import * as library from '/src/library/store.ts';
import {importZoteroPdfs} from '/src/library/zotero.ts';
import * as zotero from '/src/bib/zotero.ts';
import {entriesFromCsl} from '/src/bib/csl.ts';
import {useStore, newDoc} from '/src/model/store.ts';
import {runTool, takeDerived} from '/src/ai/tools.ts';
import '/src/styles/app.css';
const root = createRoot(document.getElementById('root'));
const render = c => root.render(React.createElement(FluentProvider,{theme:webLightTheme},c));
window.app = {library, importZoteroPdfs, zotero, entriesFromCsl, useStore, runTool, takeDerived,
 showLibrary:()=>render(React.createElement(LibraryPanel)),
 showZotero:()=>render(React.createElement(ZoteroDialog,{open:true, entries:useStore.getState().doc.references,onChange:e=>useStore.getState().setReferences(e),onClose:()=>render(React.createElement(ZoteroDialog,{open:false,entries:useStore.getState().doc.references,onChange:()=>{},onClose:()=>{}}))})),
 showBackground:()=>{useRPlotLoad.setState({phase:'downloading',status:'fixture download',done:2,total:8,bytes:1234});render(React.createElement(RPlotBackground));}};
useStore.setState({doc:newDoc(),loaded:true}); window.app.showLibrary();`;
  }, configureServer(s) {
    s.middlewares.use('/__library_test__', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml('/__library_test__', '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/__library.js"></script></body></html>')); });
    s.middlewares.use('/article.pdf', (_req, res) => { res.setHeader('Content-Type', 'application/pdf'); res.end(article); });
    s.middlewares.use('/scanned.pdf', (_req, res) => { res.setHeader('Content-Type', 'application/pdf'); res.end(scanned); });
    s.middlewares.use('/redirected.pdf', (req, res) => { assert.equal(req.headers.authorization, undefined, 'API 密钥不能转发到附件存储域'); res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/pdf'); res.end(article); });
  },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }) });
  const page = await browser.newPage({ viewport: { width: 1250, height: 900 } }), errors = [], downloads = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Zotero-API-Key, Zotero-API-Version', 'Access-Control-Expose-Headers': 'Total-Results', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  await page.route('https://api.zotero.org/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    assert.equal(req.method(), 'GET');
    let body = [], total = 0;
    if (path.endsWith('/collections')) body = [{ key: 'COLLECT1', data: { name: 'Papers', parentCollection: false } }];
    else if (path.endsWith('/items')) body = ['PARENT01', 'PARENT02'].map((key) => ({ key, version: 7, data: { citationKey: 'NewKey' }, csljson: { id: key, type: 'article-journal', title: key === 'PARENT01' ? 'Calibration paper' : 'Missing PDF paper', author: [{ family: 'Smith' }], issued: { 'date-parts': [[2024]] } } }));
    else if (path.endsWith('/PARENT01/children')) body = [{ key: 'ATTACH01', version: 3, data: { itemType: 'attachment', contentType: 'application/pdf', filename: 'paper.pdf', linkMode: 'imported_file', md5: 'fixture-v1' } }, ...(path.startsWith('/users/') ? [{ key: 'ATTACH02', version: 2, data: { itemType: 'attachment', contentType: 'application/pdf', filename: 'local.pdf', linkMode: 'linked_file' } }] : [])];
    else if (path.endsWith('/file')) {
      assert.equal(req.headers().authorization, 'Bearer fixture-secret-not-real');
      downloads.push(path);
      if (path.startsWith('/groups/999/')) await new Promise((r) => setTimeout(r, 500));
      return route.fulfill({ status: 302, headers: { ...cors, Location: 'http://127.0.0.1:5315/redirected.pdf' } });
    }
    total = body.length;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { ...cors, 'Total-Results': String(total) } });
  });
  await page.goto('http://127.0.0.1:5315/__library_test__'); await page.waitForFunction(() => !!window.app);
  await page.evaluate(() => window.app.showBackground());
  await page.getByRole('button', { name: '收起后台提示', exact: true }).click();
  assert.ok((await page.locator('.rplot-background').boundingBox()).width <= 50);
  await page.getByRole('button', { name: '展开 R 后台任务', exact: true }).click();
  await page.locator('.rplot-background-body').waitFor();
  console.log('PASS background task minimizes to an icon and restores details');

  await page.evaluate(async () => {
    const a = window.app;
    await a.zotero.saveAuth({ key: 'fixture-secret-not-real', userID: 123, username: 'fixture', groups: false });
    a.useStore.getState().setReferences([{ id: 'legacy-reference', type: 'article', key: 'ExistingKey', source: 'zotero:PARENT01', fields: { title: 'Old title' } }]);
    a.showZotero();
  });
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await page.getByText('PDF：导入 1 份，未变化 0 份，1 条文献没有 PDF', { exact: true }).waitFor({ timeout: 60000 }).catch(async (e) => { console.error(await page.locator('.zt-dialog').textContent(), errors, downloads); throw e; });
  await page.getByText('1 个附件未导入', { exact: true }).click();
  await page.getByText(/本机链接附件/).waitFor();
  const imported = await page.evaluate(async () => ({ docs: await window.app.library.listLibrary(), refs: window.app.useStore.getState().doc.references }));
  assert.equal(imported.docs.length, 1); assert.equal(imported.docs[0].status, 'ready'); assert.equal(imported.docs[0].pageCount, 2);
  assert.equal(imported.docs[0].bib.key, 'ExistingKey'); assert.equal(imported.refs[0].id, 'legacy-reference');
  assert.equal(imported.refs[0].source, 'zotero:users/123/PARENT01');
  assert.ok(!JSON.stringify(imported.docs).includes('fixture-secret'));
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await page.getByText('PDF：导入 0 份，未变化 1 份，1 条文献没有 PDF', { exact: true }).waitFor();
  assert.equal(downloads.length, 1);
  console.log('PASS Zotero PDF redirect/download, partial failure, scoped source migration and unchanged-file deduplication');

  const tools = await page.evaluate(async () => {
    const a = window.app, list = JSON.parse(await a.runTool('library_list', {})), id = list.documents[0].id;
    const search = JSON.parse(await a.runTool('library_search', { query: 'spectroscopy 42' }));
    const text = await a.runTool('library_read', { id, from_page: 2, to_page: 2 });
    let invalid = false; try { await a.runTool('library_read', { id, from_page: 3 }); } catch { invalid = true; }
    await a.runTool('library_render', { id, page: 2 }); const images = a.takeDerived();
    return { search, text, invalid, image: images[0]?.data.slice(0, 12), size: images[0]?.size };
  });
  assert.equal(tools.search.matches[0].page, 2); assert.match(tools.text, /PDF 第 2 页/); assert.match(tools.text, /spectroscopy measured value 42/); assert.equal(tools.invalid, true);
  assert.ok(tools.image.startsWith('iVBOR')); assert.ok(tools.size > 1000);
  console.log('PASS Agent can discover/search/read actual PDF pages and receive rendered original-page images');

  await page.getByRole('button', { name: '打开资料库', exact: true }).click();
  await page.locator('.zt-dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.getElementById('root').getAttribute('aria-hidden') !== 'true');
  await page.evaluate(() => window.app.showLibrary());
  await page.getByRole('textbox', { name: '搜索资料', exact: true }).fill('spectroscopy');
  await page.getByRole('button', { name: '全文检索', exact: true }).click();
  await page.locator('.library-hits button').first().click();
  await page.locator('.library-text').filter({ hasText: 'spectroscopy' }).waitFor();
  if (process.env.LIBRARY_SCREENSHOT) await page.screenshot({ path: process.env.LIBRARY_SCREENSHOT });
  await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({ name: 'local-copy.pdf', mimeType: 'application/pdf', buffer: article });
  await page.locator('.library-reader h3').filter({ hasText: 'local-copy.pdf' }).waitFor();
  await page.getByLabel('关联本篇文献', { exact: true }).selectOption('legacy-reference');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  assert.equal((await download).suggestedFilename(), 'local-copy.pdf');
  await page.getByRole('button', { name: '移除资料', exact: true }).click();
  await page.waitForFunction(async () => (await window.app.library.listLibrary()).length === 1);
  console.log('PASS local PDF upload, bibliographic association, original download and removal');
  await page.reload(); await page.waitForFunction(() => !!window.app);
  await page.getByText('可检索全文', { exact: false }).waitFor();
  assert.equal(await page.evaluate(async () => (await window.app.library.listLibrary()).length), 1);
  const extras = await page.evaluate(async () => {
    const a = window.app, auth = await a.zotero.loadAuth();
    const csl = a.entriesFromCsl([{ id: 'https://zotero.org/groups/7/items/PARENT01', type: 'article-journal', title: 'Group paper' }], new Set());
    if (csl[0].source !== 'zotero:groups/7/PARENT01') throw Error('CSL file import lost library scope');
    const bib = { id: 'group-reference', key: 'GroupKey', type: 'article', source: 'zotero:groups/7/PARENT01', fields: { title: 'Group paper' } };
    const group = await a.importZoteroPdfs(auth, 'groups/7', [{ itemKey: 'PARENT01', bib }]);
    const scan = await a.library.importLibraryPdf(await (await fetch('/scanned.pdf')).blob(), { name: 'scanned.pdf' });
    await a.runTool('library_render', { id: scan.id, page: 1 }); const image = a.takeDerived()[0];
    let html = false; try { await a.library.importLibraryPdf(new Blob(['<html>login required</html>']), { name: 'not-a-pdf.pdf' }); } catch { html = true; }
    const abort = new AbortController(), cancelled = a.importZoteroPdfs(auth, 'groups/999', [{ itemKey: 'PARENT01', bib }], { signal: abort.signal }).then(() => false, () => true);
    setTimeout(() => abort.abort(), 30);
    const stopped = await cancelled;
    const docs = await a.library.listLibrary();
    return { group: group.imported, scan: scan.status, image: image?.kind, html, stopped, keys: docs.map((d) => d.id), cancelledSaved: !!await a.library.getLibraryDocument('zotero:groups/999/ATTACH01') };
  });
  assert.equal(extras.group, 1); assert.equal(extras.scan, 'scanned'); assert.equal(extras.image, 'image'); assert.equal(extras.html, true); assert.equal(extras.stopped, true); assert.equal(extras.cancelledSaved, false);
  assert.ok(extras.keys.includes('zotero:users/123/ATTACH01') && extras.keys.includes('zotero:groups/7/ATTACH01'));
  assert.deepEqual(errors, []);
  console.log('PASS persistence/reopen, UI full-text reading, group isolation, scanned pages, invalid download rejection and cancellation');
} finally { await browser?.close(); await server.close(); }
