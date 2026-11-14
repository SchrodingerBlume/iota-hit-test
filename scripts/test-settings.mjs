// 使用真实设置面板验证互斥选项，避免把非法组合留到 Typst 编译时才报错。
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const entry = '\0settings-constraints-test';
const server = await createServer({
  server: { host: '127.0.0.1', port: 5323, strictPort: true },
  plugins: [{
    name: 'settings-constraints-test',
    resolveId(id) { if (id === '/__settings_test.js') return entry; },
    load(id) {
      if (id !== entry) return;
      return `import React from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { SettingsPanel } from '/src/ui/SettingsPanel.tsx';
import { useStore } from '/src/model/store.ts';
import { sampleDoc } from '/src/model/sample.ts';
import { defaultSettings } from '/src/model/options.ts';
import { serializeProject } from '/src/typst/serialize.ts';
import { compileDrawing } from '/src/compiler/client.ts';
import '/src/styles/app.css';
const doc = sampleDoc({ ...defaultSettings(), campus: 'harbin', degreeLevel: 'master', form: 'practice', stage: 'interim', category: 'stem', lang: 'zh' });
useStore.setState({ doc });
createRoot(document.getElementById('root')).render(React.createElement(FluentProvider, { theme: webLightTheme }, React.createElement(SettingsPanel)));
window.settingsTest = { get: () => useStore.getState().doc.settings, set: patch => useStore.getState().setSettings(patch), runTool: async (...args) => (await import('/src/ai/tools.ts')).runTool(...args), compile: async () => { const p = serializeProject(useStore.getState().doc, { preview: true }); return compileDrawing(p.main, p.files); } };`;
    },
    configureServer(s) {
      s.middlewares.use('/__settings_test__', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await s.transformIndexHtml('/__settings_test__', '<!doctype html><html><head><meta charset="utf-8"><base href="/"></head><body><div id="root"></div><script type="module" src="/__settings_test.js"></script></body></html>'));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }) });
  const page = await browser.newPage();
  const errors = [], packageRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/packages/local-iota-hit-0.1.0.tar.gz')) packageRequests.push(request.url()); });
  await page.goto('http://127.0.0.1:5323/__settings_test__');
  await page.waitForFunction(() => !!window.settingsTest);
  const degree = page.getByRole('radiogroup', { name: '学位类别', exact: true });
  const academic = degree.getByRole('radio', { name: '学术', exact: true });
  const professional = degree.getByRole('radio', { name: '专业', exact: true });
  const hidden = degree.getByRole('radio', { name: '不显示', exact: true });
  await academic.waitFor();
  assert.equal(await academic.isDisabled(), true);
  assert.equal(await professional.isEnabled(), true);
  assert.equal(await hidden.isDisabled(), true, '报告不使用终稿封面的学位类别隐藏选项');
  await academic.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => window.settingsTest.get().degreeType), 'auto', '原生 disabled 按钮不能写入学术学位');
  if (process.env.TEST_AGENT_SETTINGS) {
    const rejection = await page.evaluate(() => Promise.race([window.settingsTest.runTool('settings_set', { key: 'degreeType', value: 'academic' }), new Promise((_, reject) => setTimeout(() => reject(new Error('非法设置不应进入确认流程')), 5000))]));
    assert.match(rejection, /实践成果仅适用于专业学位/);
    assert.match(await page.evaluate(() => window.settingsTest.runTool('settings_set', { key: 'degreeType', value: 'none' })), /仅用于硕博终稿封面/);
    assert.equal(await page.evaluate(() => window.settingsTest.get().degreeType), 'auto');
    console.log('PASS Agent rejects incompatible degree settings');
  }
  console.log('PASS practice report disables academic degree in UI');

  const form = page.locator('.axis').filter({ has: page.getByText('成果形式', { exact: true }) }).locator('select');
  await form.selectOption('dissertation');
  await academic.click();
  assert.equal(await form.locator('option[value="practice"]').isDisabled(), true);
  await professional.click();
  await form.selectOption('practice');
  assert.equal(await page.evaluate(() => window.settingsTest.get().degreeType), 'professional');
  assert.equal(await hidden.isDisabled(), true);
  console.log('PASS academic degree disables practice outcome; inactive hide option stays disabled');

  await page.evaluate(() => window.settingsTest.set({ degreeType: 'academic' }));
  await degree.getByRole('radio').first().click();
  assert.equal(await page.evaluate(() => window.settingsTest.get().degreeType), 'auto', '旧的非法设置可以通过自动档恢复');
  const level = page.locator('.axis').filter({ has: page.getByText('学位级别', { exact: true }) }).locator('select');
  await level.selectOption('bachelor');
  assert.equal(await degree.isVisible(), true, '本科仍须显示学位类别设置');
  assert.equal(await degree.getAttribute('aria-disabled'), 'true');
  assert.equal(await degree.getByRole('radio').count(), 4);
  assert.equal(await degree.locator('button:disabled').count(), 4, '本科整组按钮必须置灰，包括自动');
  await professional.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => window.settingsTest.get().degreeType), 'auto');
  if (process.env.TEST_AGENT_SETTINGS) assert.match(await page.evaluate(() => window.settingsTest.runTool('settings_set', { key: 'degreeType', value: 'professional' })), /本科不区分学术与专业学位/);
  assert.equal(await form.locator('option[value="practice"]').isEnabled(), true);
  console.log('PASS bachelor degree group remains visible and entirely disabled without restricting design');
  const stage = page.locator('.axis').filter({ has: page.getByText('阶段', { exact: true }) }).locator('select');
  const campus = page.locator('.axis').filter({ has: page.getByText('校区', { exact: true }) }).locator('select');
  for (const lv of ['master', 'doctor']) for (const site of ['harbin', 'shenzhen']) {
    await level.selectOption(lv);
    await campus.selectOption(site);
    for (const st of ['proposal', 'interim', 'final']) {
      await stage.selectOption(st);
      assert.equal(await hidden.isDisabled(), st !== 'final', `${lv}/${site}/${st}: 隐藏选项适用范围错误`);
    }
  }
  console.log('PASS hide option is enabled only for graduate final covers across campuses');
  await hidden.click();
  await page.evaluate(async () => {
    const manifest = await (await fetch('/packages/manifest.json', { cache: 'no-cache' })).json();
    const pkg = manifest.packages.find(p => p.name === 'iota-hit');
    const key = new URL(`/packages/${pkg.file}?v=${pkg.sha}`, location.href);
    await (await caches.open('iota4web-assets-v1')).put(key, new Response('stale template from an older client'));
  });
  const compile = await page.evaluate(async () => { const r = await window.settingsTest.compile(); return { bytes: r.artifact?.byteLength, error: r.error }; });
  assert.ok(compile.bytes > 0, compile.error);
  const sha = await page.evaluate(async () => (await (await fetch('/packages/manifest.json', { cache: 'no-cache' })).json()).packages.find(p => p.name === 'iota-hit').sha);
  assert.ok(packageRequests.length && packageRequests.every(url => new URL(url).searchParams.get('v') === sha), '模板下载的 HTTP 缓存键必须包含清单版本');
  assert.deepEqual(errors, []);
  console.log('PASS invalid saved setting is recoverable and bachelor design is not restricted');
  console.log('PASS hidden degree category compiles, stale package cache is replaced and HTTP request is versioned');
} finally { await browser?.close(); await server.close(); }
