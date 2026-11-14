// 使用同一组字体，对照官方 Typst CLI 0.15.1 与站内 fork/Wasm；验证图内字距/网格隔离。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { createTypstCompiler, MemoryAccessModel, loadFonts, initOptions } from '@myriaddreamin/typst.ts';

const root = process.cwd(), stock = process.env.TYPST_STOCK;
if (!stock) throw Error('请用 TYPST_STOCK 指向官方 Typst 0.15.1 CLI（不能使用 Word fork CLI）');
assert.match(execFileSync(stock, ['--version'], { encoding: 'utf8' }), /^typst 0\.15\.1/);
const temp = fs.mkdtempSync(path.join(process.env.RPLOT_TEMP_ROOT ?? os.tmpdir(), 'rplot-stock-'));
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { R_PLOT_STOCK_STYLES } = await server.ssrLoadModule('/src/rplot/typography.ts');
  const am = new MemoryAccessModel(), compiler = createTypstCompiler();
  const fonts = fs.readdirSync(path.join(root, 'public/fonts')).filter((f) => /\.(otf|ttf|ttc)$/.test(f)).map((f) => new Uint8Array(fs.readFileSync(path.join(root, 'public/fonts', f))));
  await compiler.init({ getModule: () => new Uint8Array(fs.readFileSync(path.join(root, 'vendor/typst-ts-web-compiler/typst_ts_web_compiler_bg.wasm'))), beforeBuild: [initOptions.withAccessModel(am), loadFonts(fonts, { assets: false })] });
  const labels = [
    ['TeX Gyre Termes', 'AVATAR 10.0 kg (x)'], ['TeX Gyre Heros', 'Weight (1000 lbs)'],
    ['Noto Serif CJK SC', '中文（括号）、标点与绘图'], ['TeX Gyre Termes', 'p = 0.001, CI [1.2, 3.4]'],
    ['Noto Sans CJK SC', '第一行\n第二行'],
  ];
  const probe = (parent, isolated) => `#set page(width: 10000pt, height: 10000pt, margin: 0pt)
${parent}
#context {
  ${isolated ? R_PLOT_STOCK_STYLES : ''}
  context {
  ${labels.map(([font, text], i) => `{
    let body = text(font: ${JSON.stringify(font)}, size: 11pt, lang: "en", hyphenate: false, ligatures: false, ${JSON.stringify(text)})
    let bounded = text(top-edge: "bounds", bottom-edge: "bounds", body)
    let s = measure(bounded)
    [#metadata((i: ${i}, w: s.width / 1pt, h: s.height / 1pt)) <metric>]
  }`).join('\n')}
  }
}`;
  const file = path.join(temp, 'stock.typ'); fs.writeFileSync(file, probe('', false));
  const expected = JSON.parse(execFileSync(stock, ['query', file, '<metric>', '--field', 'value', '--ignore-system-fonts', '--font-path', path.join(root, 'public/fonts')], { encoding: 'utf8' }));
  const query = (source) => {
    compiler.addSource('/probe.typ', source);
    const world = compiler.compiler.snapshot(undefined, '/probe.typ', []);
    try { const c = world.compile(0, 3); assert.equal((c.diagnostics ?? []).filter((d) => d.severity === 'error').length, 0, JSON.stringify(c.diagnostics)); return JSON.parse(world.query(0, '<metric>', 'value')); }
    finally { world.free(); }
  };
  const word = '#set par(linebreaks: (mode: "msword", compat: 11), justify: true, first-line-indent: 2em)\n#set text(tracking: 2pt, kerning: false)';
  const dirty = query(probe(word, false)), clean = query(probe(word, true));
  assert.ok(dirty.some((v, i) => Math.abs(v.w - expected[i].w) > 0.01), 'Probe must actually reproduce inherited typography differences');
  for (const [i, v] of clean.entries()) {
    assert.ok(Math.abs(v.w - expected[i].w) < 0.0001, `label ${i} width: ${v.w} != stock ${expected[i].w}`);
    assert.ok(Math.abs(v.h - expected[i].h) < 0.0001, `label ${i} height: ${v.h} != stock ${expected[i].h}`);
  }
  console.log('PASS official Typst 0.15.1 vs fork/Wasm: 5 label cases match within 0.0001 pt after plot-local isolation');
  console.log(JSON.stringify({ inheritedWidths: dirty.map((v) => v.w), stockWidths: expected.map((v) => v.w), isolatedWidths: clean.map((v) => v.w) }));
} finally { await server.close(); fs.rmSync(temp, { recursive: true, force: true }); }
