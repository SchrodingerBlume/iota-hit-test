// 真浏览器验证 Word 导出：使用真实 Typst worker、DOMParser、canvas 和 IndexedDB。
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { xml2js } from 'xml-js';

const entry = '\0word-export-check';
const server = await createServer({
  server: { host: '127.0.0.1', port: 5321, strictPort: true },
  plugins: [{
    name: 'word-export-check',
    resolveId(id) { if (id === '/__word_export.js') return entry; },
    load(id) {
      if (id !== entry) return;
      return `import JSZip from 'jszip';
import { sampleDoc, SAMPLE_IMAGE } from '/src/model/sample.ts';
import { defaultSettings } from '/src/model/options.ts';
import { setImageNamespace, saveImage } from '/src/model/persist.ts';
import { buildDocx } from '/src/export/docx/build.ts';
window.exportWordCase = async function(kind) {
  const settings = kind === 'interim' ? { campus: 'shenzhen', degreeLevel: 'doctor', stage: 'interim' } : kind === 'bachelor-comprehensive' ? { degreeLevel: 'bachelor', bachelorDocumentType: 'comprehensive', form: 'practice' } : kind === 'doctor-chapter' ? { degreeLevel: 'doctor' } : kind === 'foot' ? { bibStyle: 'foot' } : kind === 'author-date' ? { bibStyle: 'author-date', bibVersion: '2025' } : {};
  const d = sampleDoc({ ...defaultSettings(), ...settings });
  if (kind === 'formats') d.body.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'BROWSER_FORMAT', marks: [{ type: 'fontFamily', attrs: { role: 'heiti' } }, { type: 'fontSize', attrs: { size: '15pt' } }, { type: 'textColor', attrs: { color: '#123456' } }, { type: 'highlight', attrs: { color: '#ffff00' } }] }] });
  if (kind === 'chapter' || kind === 'doctor-chapter') { d.settings.layout = { chapters: { '1': { margin: { left: '4cm' } } } }; d.settings.localStyles = { chapters: { '1': { body: { size: '13pt', bold: true } } } }; }
  if (kind === 'header') d.settings.headerFooter = { levels: { mainmatter: { header: { size: { auto: false, value: '11pt' }, asianFont: { auto: false, value: 'heiti' } } } }, text: { auto: false, split: true, value: 'BROWSER_HEADER_ODD', even: 'BROWSER_HEADER_EVEN' } };
  if (kind === 'lists') { d.pages.listOfFigures = d.pages.listOfTables = d.pages.listOfEquations = true; d.body.content.push({ type: 'paragraph', content: [{ type: 'idx', attrs: { text: '浏览器索引' } }] }); }
  if (kind === 'interim') { d.pages.defense = true; d.defense.chair = [{ name: '浏览器检查组长', title: '教授', discipline: '机械工程', affiliation: '哈工大' }]; d.body.content.push({ type: 'paragraph', content: [{ type: 'mathInline', attrs: { src: 'x^2', mode: 'latex' } }] }); }
  setImageNamespace(d.id);
  await saveImage(SAMPLE_IMAGE, await (await fetch('/sample/sample-bearing.png')).blob(), d.id);
  const zip = await JSZip.loadAsync(await (await buildDocx(d)).arrayBuffer());
  const files = {};
  for (const file of Object.values(zip.files)) if (/\\.(xml|rels)$/.test(file.name)) files[file.name] = await file.async('string');
  return files;
};`;
    },
    configureServer(s) {
      s.middlewares.use('/__word_export__', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await s.transformIndexHtml('/__word_export__', '<!doctype html><html><head><meta charset="utf-8"><base href="/"></head><body><script type="module" src="/__word_export.js"></script></body></html>'));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5321/__word_export__');
  await page.waitForFunction(() => !!window.exportWordCase);
  for (const kind of ['formats', 'chapter', 'doctor-chapter', 'header', 'author-date', 'foot', 'lists', 'interim', 'bachelor-comprehensive']) {
    const files = await page.evaluate(kind => window.exportWordCase(kind), kind);
    for (const [name, xml] of Object.entries(files)) { xml2js(xml); assert.ok(!/="(?:NaN|undefined|Infinity)"/.test(xml), name); }
    const xml = files['word/document.xml'], styles = files['word/styles.xml'];
    assert.ok(xml.includes('<m:oMath'), `${kind}: LaTeX 必须在真实 DOM 中导出原生 Office 数学公式`);
    if (kind === 'formats') assert.ok(xml.includes('BROWSER_FORMAT') && xml.includes('w:color w:val="123456"') && xml.includes('w:highlight w:val="yellow"'));
    if (kind === 'chapter') assert.ok(xml.includes('C1Normal') && xml.includes('w:left="2268"') && !xml.includes('CHAPTER_'));
    if (kind === 'doctor-chapter') assert.ok(Object.entries(files).some(([name, value]) => /^word\/header\d+\.xml$/.test(name) && value.includes('STYLEREF &quot;heading 1 (chapter 1)&quot;')) && xml.includes('heading 1 (chapter 1)'));
    if (kind === 'header') {
      const headers = Object.entries(files).filter(([name]) => /^word\/header\d+\.xml$/.test(name)).map(([, xml]) => xml);
      assert.ok(headers.some(s => s.includes('BROWSER_HEADER_ODD')) && headers.some(s => s.includes('BROWSER_HEADER_EVEN')));
      assert.ok(headers.some(h => {
        const id = /<w:pStyle w:val="([^"]+)"/.exec(h)?.[1];
        const style = id && new RegExp('<w:style[^>]*w:styleId="' + id + '"[^>]*>([\\s\\S]*?)</w:style>').exec(styles)?.[1];
        return style && style.includes('SimHei') && style.includes('w:val="22"');
      }), '分区页眉的字体和字号必须保留');
    }
    if (kind === 'author-date') assert.ok(xml.includes('（Willis，1828）'));
    if (kind === 'foot') assert.ok(xml.includes('<w:footnoteReference') && files['word/footnotes.xml'].includes('WILLIS'));
    if (kind === 'lists') assert.ok(xml.includes('TOC \\f F') && xml.includes('TOC \\f T') && xml.includes('TOC \\f E') && xml.includes('INDEX \\h'));
    if (kind === 'interim') assert.ok(xml.includes('浏览器检查组长') && xml.includes('w:val="6180"') && xml.includes('<w:tblHeader'));
    if (kind === 'bachelor-comprehensive') assert.ok(xml.includes('本科综合论文（设计）') && xml.includes('☑综合设计') && xml.includes('且综合论文（设计）中除已标注引用文献'));
    console.log(`PASS browser Word export: ${kind}`);
  }
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await server.close(); }
