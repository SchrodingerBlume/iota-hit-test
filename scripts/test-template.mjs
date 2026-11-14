// 使用站内同一颗 wasm 验证真实工程序列化、字形映射和 Word 事实查询；BASELINE 可比较旧版结果。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import * as tar from 'tar';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { createTypstCompiler, MemoryAccessModel, loadFonts, initOptions } from '@myriaddreamin/typst.ts';

const root = process.env.SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packages = process.env.PACKAGE_ROOT || path.join(root, 'public/packages');
globalThis.window = { setTimeout, clearTimeout, addEventListener() {} };
globalThis.localStorage = { getItem() { return null; } };
// 终端没有浏览器存储或 canvas；查询仍交给同一颗 wasm，公式栅格化不在此项检查内。
globalThis.document = { documentElement: { style: {} }, createElement() { return { style: {}, getContext() { return null; } }; } };
const server = await createServer({
  root, configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  plugins: [{
    name: 'template-regression-host', enforce: 'pre',
    resolveId(id, importer) {
      if (importer?.includes('/src/export/docx/') && id === '../../compiler/client') return '\0template-query';
      if (importer?.endsWith('/src/export/docx/build.ts') && id === '../../editor/imageCache') return '\0template-images';
    },
    load(id) {
      if (id === '\0template-query') return 'export const queryTypst = (...args) => globalThis.__templateQuery(...args); export const compileSnippet = async () => ({ artifact: null });';
      if (id === '\0template-images') return 'export const imageBytes = async () => globalThis.__templateImage; export const imageDimensions = async () => null;';
      if (id.endsWith('/src/editor/extensions/algorithm.tsx')) {
        const source = fs.readFileSync(id, 'utf8');
        return source.slice(source.indexOf('export interface AlgLine'), source.indexOf('const attr ='));
      }
    },
  }],
});
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
const hash = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex').slice(0, 16);
try {
  const { sampleDoc, SAMPLE_IMAGE } = await server.ssrLoadModule('/src/model/sample.ts');
  const { defaultSettings } = await server.ssrLoadModule('/src/model/options.ts');
  const { serializeProject, serializePara, linebreaksInput } = await server.ssrLoadModule('/src/typst/serialize.ts');
  const { probeSource, stylesXml, factsFromTemplate } = await server.ssrLoadModule('/src/export/docx/template.ts');
  const { buildIndex } = await server.ssrLoadModule('/src/ui/previewEdit.ts');
  const am = new MemoryAccessModel();
  class Registry {
    blobs = new Map(); cache = new Map();
    resolve(spec, context) {
      const key = `${spec.namespace}/${spec.name}/${spec.version}`;
      if (this.cache.has(key)) return this.cache.get(key);
      const bytes = this.blobs.get(key);
      assert.ok(bytes, `缺包：${key}`);
      const dir = `/@memory/packages/${key}`;
      context.untar(bytes, (p, d, time) => am.insertFile(`${dir}/${p}`, d, new Date(time)));
      this.cache.set(key, dir);
      return dir;
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(packages, 'manifest.json')));
  const registry = new Registry();
  for (const p of manifest.packages) registry.blobs.set(`${p.namespace}/${p.name}/${p.version}`, new Uint8Array(fs.readFileSync(path.join(packages, p.file))));
  const fontDir = path.join(root, 'public/fonts');
  const fonts = fs.readdirSync(fontDir).filter(f => /\.(otf|ttf|ttc)$/.test(f)).map(f => new Uint8Array(fs.readFileSync(path.join(fontDir, f))));
  assert.ok(fonts.length >= 10, '回归需要 public/fonts 中的内置字体');
  const compiler = createTypstCompiler();
  const wasm = process.env.WASM || path.join(root, 'vendor/typst-ts-web-compiler/typst_ts_web_compiler_bg.wasm');
  await compiler.init({ getWrapper: () => import(pathToFileURL(path.join(path.dirname(wasm), 'wasm-pack-shim.mjs')).href), getModule: () => new Uint8Array(fs.readFileSync(wasm)), beforeBuild: [initOptions.withAccessModel(am), initOptions.withPackageRegistry(registry), loadFonts(fonts, { assets: false })] });
  compiler.mapShadow(`/images/${SAMPLE_IMAGE}`, new Uint8Array(fs.readFileSync(path.join(root, 'public/sample/sample-bearing.png'))));
  const raw = compiler.compiler;
  globalThis.__templateImage = new Uint8Array(fs.readFileSync(path.join(root, 'public/sample/sample-bearing.png'))).buffer;
  globalThis.__templateQuery = async (source, selector) => {
    compiler.addSource('/word-export.typ', source);
    const world = raw.snapshot(undefined, '/word-export.typ', []);
    try {
      const r = world.compile(0, 3);
      assert.equal((r.diagnostics ?? []).filter(d => d.severity === 'error').length, 0, JSON.stringify(r.diagnostics));
      return { result: JSON.parse(world.query(0, selector, 'value')) };
    } finally { world.free(); }
  };
  const { buildDocx } = await server.ssrLoadModule('/src/export/docx/build.ts');
  function glyphFixture(name, source, check) {
    compiler.addSource('/glyph-fixture.typ', `#set text(font: "TeX Gyre Termes", size: 8pt)\n${source}`);
    const world = raw.snapshot(undefined, '/glyph-fixture.typ', []);
    try {
      const r = world.get_artifact(0, 3);
      assert.equal((r.diagnostics ?? []).filter(d => d.severity === 'error').length, 0, JSON.stringify(r.diagnostics));
      const values = world.glyph_map(), glyphs = [];
      for (let i = 0; i < values.length; i += 10) glyphs.push(Array.from(values.slice(i, i + 10)));
      check(glyphs);
      console.log(`PASS glyph classification: ${name}`);
    } finally { world.free(); }
  }
  glyphFixture('narrow margins with header, footer and full-page background', `
#let same = [EDGE]
#set page(width: 200pt, height: 200pt, margin: (x: 10pt, y: 3pt),
  header: same, footer: same, background: align(center + horizon, same))
#same
#v(1fr)
#same`, glyphs => {
    const copies = glyphs.filter(g => g[8] === 68);
    const body = copies.filter(g => g[7] !== 3);
    assert.equal(body.length, 2, `页边正文必须可编辑、页眉页脚及背景必须排除：${JSON.stringify(copies)}`);
    assert.equal(copies.length - body.length, 3, '三处重复装饰文字必须标为 echo');
    assert.ok(body.some(g => g[2] + g[4] < 200 * 0.085), '必须覆盖旧顶部阈值内的正文');
    assert.ok(body.some(g => g[2] > 200 * 0.93), '必须覆盖旧底部阈值内的正文');
  });
  glyphFixture('table headers remain editable at page edges', `
#set page(width: 150pt, height: 90pt, margin: 5pt)
#table(columns: 1, table.header([ECHO]), ..range(16).map(_ => [body]))`, glyphs => {
    const headers = glyphs.filter(g => g[8] === 69);
    assert.ok(headers.length > 1, '表格必须跨页重复表头');
    assert.ok(headers.every(g => g[7] !== 3), '属于正文表格的表头不能被误判为页眉');
  });
  const cases = [
    ['master-final', {}], ['doctor-final', { degreeLevel: 'doctor' }],
    ['bachelor-final', { degreeLevel: 'bachelor' }], ['hass-final', { category: 'hass' }],
    ['english-final', { lang: 'en' }], ['harbin-proposal', { stage: 'proposal' }],
    ['harbin-interim', { stage: 'interim' }],
    ['sz-bachelor-proposal', { campus: 'shenzhen', degreeLevel: 'bachelor', stage: 'proposal' }],
    ['sz-master-proposal', { campus: 'shenzhen', stage: 'proposal' }],
    ['sz-doctor-proposal', { campus: 'shenzhen', degreeLevel: 'doctor', stage: 'proposal' }],
    ['sz-doctor-interim', { campus: 'shenzhen', degreeLevel: 'doctor', stage: 'interim' }],
    ['style-override', {}, d => { d.settings.styles = { body: { bold: true }, chapter: { bold: false }, toc: { size: 10.5 } }; }],
    ['header-override', {}, d => {
      d.settings.layout = { doc: { 'font-size': '12pt', header: { style: { 'asian-font': '"heiti"' } } }, chapters: { '1': { 'font-size': '11pt' } } };
      d.settings.headerFooter = { levels: { doc: { header: { size: { auto: false, value: '10pt' }, asianFont: { auto: false, value: 'heiti' } } } } };
    }],
    ['local-style', {}, d => { d.settings.localStyles = { chapters: { '1': { body: { bold: true } } } }; }],
    ['local-dates', {}, d => { d.info.date = '2027-03'; d.info.defenseDate = '2027-04'; d.localInfo = { cover: { date: '2027-05' }, titlepage: { date: '2027-06' } }; }],
    ['simple-engine', { linebreaker: 'simple' }], ['optimized-engine', { linebreaker: 'optimized' }],
    ['word-2013', { wordCompat: '15' }],
    ['focus-chapter', {}, null, { preview: true, focus: { chapter: 1, page: 5 } }],
    ['paragraph-snippet', {}, null, 'paragraph'], ['export-typst', {}, null, { preview: false }],
  ];
  const results = {}, details = {};
  async function runCase([name, settings, edit, mode]) {
    const doc = structuredClone(sampleDoc({ ...defaultSettings(), fontset: 'webapp', ...settings }));
    edit?.(doc);
    const unchanged = JSON.stringify(doc);
    const p = mode === 'paragraph' ? serializePara(doc, 2) : serializeProject(doc, mode ?? { preview: true });
    assert.equal(JSON.stringify(doc), unchanged, `${name}: 序列化不得改写工程`);
    for (const [file, text] of Object.entries(p.files)) compiler.mapShadow(`/${mode?.focus && !file.startsWith('rplots/') ? 'focus-' : ''}${file}`, new TextEncoder().encode(text));
    compiler.addSource('/regression.typ', p.main);
    const linebreaks = mode?.preview === false ? null : linebreaksInput(doc.settings);
    const inputs = mode?.preview === false ? [] : [['preview', '1'], ...(linebreaks ? [['linebreaks', linebreaks]] : [])];
    const world = raw.snapshot(undefined, '/regression.typ', inputs);
    let layout;
    try {
      const r = world.get_artifact(0, 3);
      const errors = (r.diagnostics ?? []).filter(d => d.severity === 'error');
      assert.equal(errors.length, 0, `${name}: ${JSON.stringify(errors)}`);
      assert.ok(r.result?.length, `${name}: 未生成预览产物`);
      const glyphs = world.glyph_map();
      assert.ok(glyphs?.length > 0 && glyphs.length % 10 === 0, `${name}: 字形表无效`);
      const positions = [], characters = [];
      let pages = 0;
      for (let i = 0; i < glyphs.length; i += 10) {
        for (let j = 0; j < 10; j++) assert.ok(Number.isFinite(glyphs[i + j]), `${name}: 字形坐标无效`);
        pages = Math.max(pages, glyphs[i] + 1);
        characters.push(glyphs[i + 8]);
        positions.push([glyphs[i], ...Array.from(glyphs.slice(i + 1, i + 5), x => Math.round(x * 1000) / 1000), glyphs[i + 8]]);
      }
      const mapping = p.segments.map(({ kind, key, pmFrom, pmTo, attr, raw }) => [kind, key, pmFrom, pmTo, attr, raw]).map(JSON.stringify).sort();
      layout = { pages, glyphs: glyphs.length / 10, text: hash(characters), positions: hash(positions), mapping: hash(mapping) };
      const offsets = [];
      for (let i = 0, b = 0; i < p.main.length;) {
        const c = String.fromCodePoint(p.main.codePointAt(i));
        const size = new TextEncoder().encode(c).length;
        for (let k = 0; k < size; k++) offsets[b + k] = i;
        b += size; i += c.length;
      }
      offsets.push(p.main.length);
      const mapped = new Float64Array(glyphs);
      for (let i = 0; i < mapped.length; i += 10) {
        mapped[i + 5] = offsets[Math.min(offsets.length - 1, mapped[i + 5])];
        mapped[i + 6] = offsets[Math.min(offsets.length - 1, mapped[i + 6])];
      }
      const index = buildIndex(mapped, p.segments, 0);
      if (mode?.preview !== false) assert.ok(index.count > 0, `${name}: 未生成编辑定位索引`);
      if (name === 'sz-doctor-interim') {
        const body = index.byKey.get('body') ?? [];
        for (const s of p.segments.filter(s => s.key === 'body' && s.kind === 'text' && s.raw)) {
          for (let i = 0; i < s.raw.length; i++) {
            if (/\s/.test(s.raw[i])) continue;
            assert.ok(body.some(g => g.kind === 'text' && g.from <= s.pmFrom + i && g.to > s.pmFrom + i), `深圳博士中期正文无法定位：${s.raw}（第 ${i + 1} 个字符）`);
          }
        }
      }
      const editRecords = [...index.byKey.values()].flat().map(g => [g.key, g.kind, g.seg.attr, g.from, g.to, g.cp]).map(JSON.stringify).sort();
      layout.editMapping = hash(editRecords);
      details[name] = { positions, editRecords };
    } finally { world.free(); }
    compiler.addSource('/facts.typ', probeSource(doc));
    const query = raw.snapshot(undefined, '/facts.typ', []);
    let facts;
    try {
      const r = query.compile(0, 3);
      assert.equal((r.diagnostics ?? []).filter(d => d.severity === 'error').length, 0, `${name}: Word 查询编译失败 ${JSON.stringify(r.diagnostics)}`);
      const f = JSON.parse(query.query(0, '<docx-facts>', 'value'))[0];
      facts = factsFromTemplate ? factsFromTemplate(f) : { styles: f.front.styles, fonts: f.front.fonts, layout: { doc: f.doc, front: f.front.layout, main: f.main, back: f.back.layout }, pages: { ...f.front.pages, ...f.back.pages } };
      const xml = stylesXml(facts, doc.settings, { hangingChars: 2 });
      assert.ok(!/NaN|Infinity|undefined/.test(JSON.stringify(xml)), `${name}: Word 样式含无效值`);
      if (name === 'style-override') assert.equal(facts.styles.body.bold, true);
      if (name === 'style-override' && factsFromTemplate) {
        const heading = xml.styles.find(s => s.includes('w:styleId="Heading1"'));
        assert.ok(heading.includes('<w:b w:val="0"/>'), '不加粗的标题必须覆盖正文的加粗继承');
        assert.ok(!xml.styles[0].includes('w:hanging="0"'), '正文首行缩进不能带冲突的空悬挂缩进');
      }
      if (name === 'header-override') {
        assert.equal(facts.layout.doc.header.style.size, 10);
        assert.equal(facts.layout.doc.header.style['asian-font'], 'heiti');
      }
      layout.wordStyles = hash(xml);
      layout.pageSetup = hash(facts.layout);
      layout.body = { size: facts.styles.body.size, lineSpacing: facts.styles.body['line-spacing'], indent: facts.styles.body['first-line-indent'] };
      Object.assign(details[name], { facts, xml });
    } finally { query.free(); }
    if (mode === undefined) {
      const blob = await buildDocx(doc);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const zip = await JSZip.loadAsync(bytes);
      for (const entry of Object.values(zip.files).filter(e => /\.(xml|rels)$/.test(e.name))) {
        const xml = await entry.async('string');
        xml2js(xml);
        assert.ok(!/="(?:NaN|Infinity|undefined)"/.test(xml), `${name}: ${entry.name} 属性无效`);
      }
      const xml = await zip.file('word/document.xml').async('string');
      assert.ok(xml.includes('<w:pgSz'), `${name}: Word 缺少纸张设置`);
      layout.wordText = hash([...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]));
      layout.wordSections = (xml.match(/<w:sectPr>/g) ?? []).length;
      if (process.env.RESULTS) fs.writeFileSync(`${process.env.RESULTS}.${name}.docx`, bytes);
    }
    assert.equal(JSON.stringify(doc), unchanged, `${name}: 编译和导出不得改写工程`);
    results[name] = layout;
    console.log(`PASS ${name}: ${layout.pages} pages, ${layout.glyphs} glyphs, Word styles valid`);
  }
  for (const entry of cases) {
    try { await runCase(entry); } catch (error) {
      if (!process.env.RECORD_ERRORS) throw error;
      results[entry[0]] = { error: error.message };
      console.log(`BASELINE FAILURE ${entry[0]}: ${error.message}`);
    }
    raw.evict?.(0);
  }
  const docxtyp = manifest.packages.find(p => p.name === 'docxtyp');
  if (docxtyp) {
    await tar.t({ file: path.join(packages, docxtyp.file), onReadEntry(e) {
      assert.ok(!/^(output|tmp|tests|docs|tools)\//.test(e.path), `docxtyp 包含非运行文件：${e.path}`);
      assert.ok(!/\.(ttf|otf|ttc)$/i.test(e.path), `docxtyp 包含测试字体：${e.path}`);
    } });
    assert.ok(docxtyp.size < 1024 * 1024, 'docxtyp 包体积异常');
    console.log(`PASS docxtyp runtime package: ${docxtyp.size} bytes`);
  }
  if (factsFromTemplate) {
    const doc = structuredClone(sampleDoc({ ...defaultSettings(), fontset: 'webapp' }));
    const file = 'rplots/0123456789abcdef0123456789abcdef.typ';
    const source = `#import "@preview/cetz:0.5.3": canvas, draw
#import "@preview/mitex:0.2.6": mitex
#let r-figure() = canvas(length: 1pt, {
  draw.rect((0, 0), (432, 288), fill: rgb("#eef3ff"))
  draw.content((216, 144), mitex("x^2"))
})`;
    const figure = { type: 'figure', attrs: { uid: 'rplot-regression', rPlot: JSON.stringify({ version: '0.5.3.1', code: 'plot(1:5)', width: 6, height: 4, pointsize: 12, seed: 1, path: file, source, pages: 1 }) } };
    doc.body.content.push(figure);
    const projects = [serializeProject(doc), serializeProject(doc, { preview: true, focus: { chapter: 1 } }), serializePara(doc, doc.body.content.length - 1)];
    for (const project of projects) {
      assert.equal(project.files[file], source, 'R 图旁文件必须随整编、单章和单段产物交给编译器');
    }
    console.log('PASS R plot virtual files: full, chapter, paragraph');
    // 图放在首章，确保单章样例实际导入它，而非只检查整份工程收集到的旁文件。
    doc.body = { type: 'doc', content: [figure] };
    for (const [name, project] of [['full', serializeProject(doc)], ['chapter', serializeProject(doc, { preview: true, focus: { chapter: 1 } })], ['paragraph', serializePara(doc, 0)]]) {
      assert.ok(project.main.includes(file), `${name}: R 图没有导入旁文件`);
      for (const [file, text] of Object.entries(project.files)) compiler.mapShadow(`/${file}`, new TextEncoder().encode(text));
      const main = `/rplot-${name}.typ`;
      compiler.addSource(main, project.main);
      const world = raw.snapshot(undefined, main, [['preview', '1']]);
      try {
        const r = world.get_artifact(0, 3);
        assert.equal((r.diagnostics ?? []).filter(d => d.severity === 'error').length, 0, JSON.stringify(r.diagnostics));
        assert.ok(r.result?.length, `${name}: R 图未生成预览产物`);
        console.log(`PASS R plot ${name}: CeTZ virtual file + LaTeX label`);
      } finally { world.free(); }
    }
    assert.ok(registry.blobs.has('preview/cetz/0.5.3'), '离线包缺少 CeTZ 0.5.3');
    assert.ok(registry.blobs.has('preview/mitex/0.2.6'), 'R 插图的 LaTeX 标签缺少 mitex 0.2.6');
    compiler.addSource('/cetz-regression.typ', `#import "@preview/cetz:0.5.3": canvas, draw
#import "@preview/mitex:0.2.6": mitex
#set text(font: "TeX Gyre Termes")
#show math.equation: set text(font: "TeX Gyre Termes Math")
#canvas({
  import draw: *
  rect((0, 0), (4, 2), fill: rgb("#eef3ff"))
  line((0, 0), (4, 2), mark: (end: ">"))
  circle((2, 1), radius: 0.4, stroke: blue)
  content((2, 1.7), [R / CeTZ])
  content((3, 0.5), mitex("x^2"))
})`);
    const world = raw.snapshot(undefined, '/cetz-regression.typ', []);
    try {
      const r = world.get_artifact(0, 3);
      assert.equal((r.diagnostics ?? []).filter(d => d.severity === 'error').length, 0, JSON.stringify(r.diagnostics));
      assert.ok(r.result?.length, 'CeTZ 未生成预览产物');
      assert.ok(registry.cache.has('preview/oxifmt/1.0.0'), 'CeTZ 的 oxifmt 依赖未加载');
      console.log('PASS CeTZ 0.5.3 + oxifmt 1.0.0 + mitex 0.2.6: offline wasm compilation');
    } finally { world.free(); }
  }
  if (process.env.RESULTS) fs.writeFileSync(process.env.RESULTS, JSON.stringify({ template: manifest.iotaHitCommit, cases: results, details }, null, 2));
  if (process.env.BASELINE) {
    const baseline = JSON.parse(fs.readFileSync(process.env.BASELINE)).cases;
    for (const [name, next] of Object.entries(results)) {
      const old = baseline[name];
      const fields = Object.keys(next).filter(key => JSON.stringify(old?.[key]) !== JSON.stringify(next[key]));
      console.log(`COMPARE ${name}: ${fields.length ? fields.join(', ') : 'identical'}`);
    }
  }
} finally { await server.close(); }
