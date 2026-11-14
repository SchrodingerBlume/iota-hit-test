// 从已打包的模板读取报告文字与版面数据；Word 导出使用同一份数据，不手抄说明页。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as tar from 'tar';
import { createTypstCompiler, MemoryAccessModel, loadFonts, initOptions } from '@myriaddreamin/typst.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/packages/manifest.json')));
const pkg = manifest.packages.find(p => p.namespace === 'local' && p.name === 'iota-hit');
const dir = fs.mkdtempSync(path.join(process.env.WORD_REPORT_TMP || os.tmpdir(), 'iota-word-reports-'));
try {
  await tar.x({ file: path.join(root, 'public/packages', pkg.file), cwd: dir });
  const profiles = [];
  for (const campus of ['harbin', 'shenzhen']) for (const degree of ['bachelor', 'master', 'doctor']) for (const stage of ['proposal', 'interim']) for (const lang of ['zh', 'en']) for (const form of ['dissertation', 'practice']) {
    const key = [campus, degree, stage, lang, form].join('/');
    profiles.push(`#[
#show: iota-hit.with(campus: "${campus}", degree-level: "${degree}", stage: "${stage}", lang: "${lang}", form: "${form}", fontset: presets.webapp + (kaishu: "FandolKai"))
#context {
  let info = state("iota-hit-info").get()
  let variant = terms.variant-of(info)
  let table = terms.term-table("${lang}", "instructions")
  let payload = terms.term-for(table, "body", variant)
  let spec = data.profile(info, "${lang}")
  let cover = terms.term-table("${lang}", "cover")
  let labels = (:)
  for key in ("university", "author", "student-id", "affiliation", "specialty", "supervisor", "date", "enrollment", "stage", "seal") {
    if terms.has-term(cover, key, variant) { labels.insert(key, text-only(terms.term-for(cover, key, variant))) }
  }
  labels.insert("document-type", text-only(terms.document-type-of(cover, "${lang}", variant)))
  let sheet = if "${degree}" == "bachelor" or ("${campus}" == "shenzhen" and "${degree}" == "doctor" and "${stage}" == "interim") { (:) } else { covers._graduate-sheet.at("${campus}").at("${degree}").at("${stage}") }
  let review = (:)
  if "${campus}" == "shenzhen" and "${degree}" == "doctor" and "${stage}" == "interim" {
    let t = terms.term-table("${lang}", "defense")
    for k in ("supervisor-opinion", "supervisor-hint", "completion-question", "completion-on-time", "completion-delay", "completion-dismissal", "supervisor-signature", "resolution", "result", "result-pass", "result-revise", "result-dismissal", "chair-signature", "members-title", "committee", "column-name", "column-title", "column-discipline", "column-signature") {
      if terms.has-term(t, k, variant) { let v = terms.term-for(t, k, variant); if type(v) == function { v = v(terms.subject-of(t, variant)) }; review.insert(k, text-only(v)) }
    }
  }
  [#metadata((key: "${key}", labels: labels, cover: plain(sheet), review: review, instructions: (title: text-only(terms.term-for(table, "title", variant)), profile: plain(spec), layoutCode: repr(spec.layout), layout: plain(parts.layout-for(none, spec.layout)), blocks: all-metadata(payload, "iota-instructions-block").map(plain), source: all-metadata(payload, "iota-instructions-source").map(plain)))) <word-report-data>]
}
]`);
  }
  const source = `#import "lib.typ": *
#import "src/terms/lookup.typ" as terms
#import "src/pages/report/instructions-data.typ" as data
#import "src/pages/report/cover.typ" as covers
#import "src/layout/parts.typ" as parts
#import banshi.content as content
#let all-metadata(c, key) = if type(c) != content { () } else if c.func() == metadata { if type(c.value) == dictionary and key in c.value { (c.value.at(key),) } else { () } } else if c.has("children") { c.children.map(x => all-metadata(x, key)).flatten() } else if c.has("body") { all-metadata(c.body, key) } else if c.has("child") { all-metadata(c.child, key) } else { () }
#let text-only(v) = if type(v) == str { v } else if v == none { "" } else { let s = content.plain-text(v); if s == none { "" } else { s } }
#let plain(v) = if type(v) == length { if v.em == 0 { v.pt() } else { (abs: v.abs.pt(), em: v.em) } } else if type(v) == dictionary { v.pairs().map(((k, x)) => (k, plain(x))).to-dict() } else if type(v) == array { v.map(plain) } else if type(v) == color { v.to-hex() } else if type(v) == content { text-only(v) } else { v }
${profiles.join('\n')}`;
  const am = new MemoryAccessModel(), cache = new Map();
  const compiler = createTypstCompiler();
  const vendor = path.join(root, 'vendor/typst-ts-web-compiler');
  const fonts = fs.readdirSync(path.join(root, 'public/fonts')).filter(f => /\.(otf|ttf|ttc)$/.test(f)).map(f => new Uint8Array(fs.readFileSync(path.join(root, 'public/fonts', f))));
  await compiler.init({ getWrapper: () => import(pathToFileURL(path.join(vendor, 'wasm-pack-shim.mjs')).href), getModule: () => new Uint8Array(fs.readFileSync(path.join(vendor, 'typst_ts_web_compiler_bg.wasm'))), beforeBuild: [initOptions.withAccessModel(am), loadFonts(fonts, { assets: false }), initOptions.withPackageRegistry({ resolve(spec, context) {
    const key = `${spec.namespace}/${spec.name}/${spec.version}`;
    if (cache.has(key)) return cache.get(key);
    const p = manifest.packages.find(p => `${p.namespace}/${p.name}/${p.version}` === key);
    if (!p) throw new Error(`Word 报告数据缺少依赖：${key}`);
    const target = `/@memory/packages/${key}`;
    context.untar(new Uint8Array(fs.readFileSync(path.join(root, 'public/packages', p.file))), (file, data, time) => am.insertFile(`${target}/${file}`, data, new Date(time)));
    cache.set(key, target); return target;
  } })] });
  const map = (base, rel = '') => { for (const e of fs.readdirSync(base, { withFileTypes: true })) { const name = `${rel}${e.name}`; if (e.isDirectory()) map(path.join(base, e.name), `${name}/`); else compiler.mapShadow(`/${name}`, new Uint8Array(fs.readFileSync(path.join(base, e.name)))); } };
  map(dir);
  compiler.addSource('/word-report-data.typ', source);
  const world = compiler.compiler.snapshot(undefined, '/word-report-data.typ', []);
  let values;
  try {
    const r = world.compile(0, 3), errors = (r.diagnostics ?? []).filter(d => d.severity === 'error');
    if (errors.length) throw new Error(JSON.stringify(errors));
    values = JSON.parse(world.query(0, '<word-report-data>', 'value'));
  } finally { world.free(); }
  const out = { template: manifest.iotaHitCommit, profiles: Object.fromEntries(values.map(({ key, ...value }) => [key, value])) };
  fs.writeFileSync(path.join(root, 'src/export/docx/report-data.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`Word report profiles: ${values.length}, template ${manifest.iotaHitCommit}`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
