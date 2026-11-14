import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const entry = '\0r-language-check';
const server = await createServer({ cacheDir: 'node_modules/.vite-r-language-test', server: { host: '127.0.0.1', port: 5317, strictPort: true, hmr: false, ws: false, watch: null }, plugins: [{
  name: 'r-language-check', resolveId(id) { if (id === '/__r_language.js') return entry; },
  load(id) { if (id === entry) return `import * as language from '/src/rplot/languageService.ts';
import React from 'react'; import {createRoot} from 'react-dom/client';
import {FluentProvider,webLightTheme} from '@fluentui/react-components';
import {RPlotDialog} from '/src/ui/RPlotDialog.tsx'; import '/src/styles/app.css';
window.rls=language; language.useRLanguageService.subscribe(s=>window.progress(s.status+(s.error?' '+s.error:'')));
const root=createRoot(document.getElementById('root')); window.showEditor=()=>root.render(React.createElement(FluentProvider,{theme:webLightTheme},React.createElement(RPlotDialog,{onApply:()=>{},onClose:()=>{}})));`; },
  configureServer(s) { s.middlewares.use('/__r_language__', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml('/__r_language__', '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/__r_language.js"></script></body></html>')); }); },
}] });
let browser;
try {
  await server.listen(); const options = { headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }) };
  browser = process.env.R_LANGUAGE_PROFILE ? await chromium.launchPersistentContext(process.env.R_LANGUAGE_PROFILE, options) : await chromium.launch(options);
  const page = await browser.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const requests = []; page.on('request', r => requests.push(r.url()));
  await page.route('https://repo.r-wasm.org/**', route => route.abort('internetdisconnected'));
  await page.exposeFunction('progress', console.log); await page.goto('http://127.0.0.1:5317/__r_language__'); await page.waitForFunction(() => !!window.rls);
  await page.evaluate(() => { localStorage.removeItem('iota-r-lsp-enabled'); window.showEditor(); });
  const code = page.getByRole('textbox', { name: 'R 绘图代码', exact: true });
  await code.fill('library(ggplot2)\n# comment\nx <- 1\nplot(x)');
  assert.ok(await page.locator('.cm-content span').count() > 3, 'R syntax must be highlighted');
  const number = page.locator('.cm-content span').filter({hasText:/^1$/}).first();
  const light = await number.evaluate(el=>getComputedStyle(el).color);
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  const dark = await number.evaluate(el=>getComputedStyle(el).color);
  assert.notEqual(light,dark,'Syntax colors must adapt to the dark theme');
  await page.evaluate(()=>delete document.documentElement.dataset.theme);
  assert.equal(requests.some(u => u.includes('repo.r-wasm.org')), false, 'LSP packages must not download without opting in');
  console.log('PASS CodeMirror R highlighting and optional download remains off by default');
  const result = await page.evaluate(async () => {
    const a = window.rls, messages = []; a.onRLanguageMessage(m => messages.push(m));
    await a.prepareRLanguageService();
    const init = await a.sendRLanguageMessage('initialize', { processId: null, rootUri: null, capabilities: { textDocument: { completion: { completionItem: { snippetSupport: false } }, hover: { contentFormat: ['plaintext'] } } } }, true);
    await a.sendRLanguageMessage('initialized', {});
    const uri = 'file:///home/web_user/plot.R';
    await a.sendRLanguageMessage('textDocument/didOpen', { textDocument: { uri, languageId: 'r', version: 1, text: 'custom_value <- 1\nmea' } });
    const completion = await a.sendRLanguageMessage('textDocument/completion', { textDocument: { uri }, position: { line: 1, character: 3 } }, true);
    const ggLine = 'ggplot2::geom_po';
    await a.sendRLanguageMessage('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: 'library(ggplot2)\n' + ggLine }] });
    const ggCompletion = await a.sendRLanguageMessage('textDocument/completion', { textDocument: { uri }, position: { line: 1, character: ggLine.length } }, true);
    await a.sendRLanguageMessage('textDocument/didChange', { textDocument: { uri, version: 3 }, contentChanges: [{ text: 'mean(1:3)\nplot(' }] });
    const hover = await a.sendRLanguageMessage('textDocument/hover', { textDocument: { uri }, position: { line: 0, character: 2 } }, true);
    await a.sendRLanguageMessage('textDocument/didClose', { textDocument: { uri } });
    return { init, completion, ggCompletion, hover, messages };
  });
  assert.ok(result.init.capabilities.completionProvider);
  const items = Array.isArray(result.completion) ? result.completion : result.completion.items;
  assert.ok(items.some(i => i.label === 'mean'));
  assert.ok(result.ggCompletion.items.some(i => i.label === 'geom_point'));
  assert.ok(result.hover?.contents);
  assert.ok(result.messages.some(m => m.method === 'textDocument/publishDiagnostics' && m.params.version === 3 && m.params.diagnostics.some(d=>/unexpected end/.test(d.message))));
  await page.getByRole('button', { name: '下载并启用 R LSP', exact: true }).click();
  await page.waitForFunction(() => window.rls.useRLanguageService.getState().phase === 'ready');
  await code.fill('mea'); await code.press('Control+Space');
  await page.locator('.cm-completionLabel').filter({hasText:/^mean$/}).waitFor({timeout:30000});
  await page.locator('.cm-completionLabel').filter({hasText:/^mean$/}).click();
  await code.fill('mean(1:3)');
  await page.locator('.cm-line').first().hover({position:{x:12,y:8}});
  await page.locator('.rplot-lsp-hover').filter({hasText:'mean(x, ...)'}).waitFor({timeout:30000});
  await code.fill('mean(1:3)\nplot(');
  await page.locator('.cm-lint-marker-error').first().waitFor({timeout:30000});
  if(process.env.R_LANGUAGE_SCREENSHOT)await page.screenshot({path:process.env.R_LANGUAGE_SCREENSHOT});
  await page.getByRole('button', { name: '关闭 R LSP', exact: true }).click();
  assert.equal(await page.evaluate(()=>window.rls.useRLanguageService.getState().phase), 'off');
  await code.fill('plot(1:3)'); assert.match(await code.innerText(), /plot/);
  assert.deepEqual(errors, []);
  assert.equal(requests.some(u => u.includes('repo.r-wasm.org')), false, 'Optional LSP dependencies must download from this site');
  console.log('PASS real optional R/Wasm languageserver: protocol + UI completion/hover/diagnostics, opt-out preserves editor');
} finally { await browser?.close(); await server.close(); }
