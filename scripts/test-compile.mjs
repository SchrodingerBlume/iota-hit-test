// 用浏览器那颗 wasm 编译器（typst-ts-web-compiler）在 Node 里编译一份 webapp 档的
// 样张——字体、包、模板全走 public/ 里的静态资源，与网页端完全同一条路。
// 用法：node scripts/test-compile.mjs [main.typ] [out.pdf]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTypstCompiler, MemoryAccessModel, loadFonts, initOptions } from '@myriaddreamin/typst.ts';
const { withAccessModel, withPackageRegistry } = initOptions;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pub = path.join(root, 'public');

const mainArg = process.argv[2];
const outArg = process.argv[3] ?? path.join(root, 'test-out.pdf');

// 与 src/compiler/registry.ts 同一套逻辑：manifest 里的每个包预先读进内存
class StaticPackageRegistry {
  constructor(am) { this.am = am; this.blobs = new Map(); this.cache = new Map(); }
  add(ns, name, version, data) { this.blobs.set(`${ns}/${name}/${version}`, data); }
  resolve(spec, context) {
    const key = `${spec.namespace}/${spec.name}/${spec.version}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const data = this.blobs.get(key);
    if (!data) { console.error('缺包', key); return undefined; }
    const dir = `/@memory/packages/${key}`;
    context.untar(data, (p, d, mtime) => this.am.insertFile(`${dir}/${p}`, d, new Date(mtime)));
    this.cache.set(key, dir);
    return dir;
  }
}

async function main() {
  const t0 = Date.now();
  const am = new MemoryAccessModel();
  const registry = new StaticPackageRegistry(am);
  const manifest = JSON.parse(fs.readFileSync(path.join(pub, 'packages', 'manifest.json'), 'utf8'));
  for (const p of manifest.packages) {
    registry.add(p.namespace, p.name, p.version, new Uint8Array(fs.readFileSync(path.join(pub, 'packages', p.file))));
  }
  const fontDir = path.join(pub, 'fonts');
  // EXTRA_FONTS=目录：再加一批本机字体（比如 Windows 档要的 SimSun / Times New Roman）
  const fontDirs = [fontDir, ...(process.env.EXTRA_FONTS ? process.env.EXTRA_FONTS.split(':') : [])];
  const fonts = fontDirs.flatMap((d) => fs.readdirSync(d).filter((f) => /\.(otf|ttf|ttc)$/i.test(f)).map((f) => new Uint8Array(fs.readFileSync(path.join(d, f)))));

  const wasmPath = path.join(root, 'vendor', 'typst-ts-web-compiler', 'typst_ts_web_compiler_bg.wasm');
  const compiler = createTypstCompiler();
  await compiler.init({
    getModule: () => new Uint8Array(fs.readFileSync(wasmPath)),
    beforeBuild: [
      withAccessModel(am),
      withPackageRegistry(registry),
      loadFonts(fonts, { assets: false }),
    ],
  });
  console.log(`初始化 ${Date.now() - t0} ms`);

  let src;
  if (mainArg) {
    src = fs.readFileSync(mainArg, 'utf8');
    const dir = path.dirname(path.resolve(mainArg));
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile() && f !== path.basename(mainArg)) compiler.mapShadow(`/${f}`, new Uint8Array(fs.readFileSync(p)));
    }
    const img = path.join(dir, 'images');
    if (fs.existsSync(img)) for (const f of fs.readdirSync(img)) compiler.mapShadow(`/images/${f}`, new Uint8Array(fs.readFileSync(path.join(img, f))));
  } else {
    src = `#import "@local/iota-hit:${manifest.iotaHit}": *
#show: iota-hit.with(degree-level: "master", fontset: presets.webapp + (kaishu: "FandolKai"), title: [浏览器端编译测试], author: [张三])
#show: frontmatter
#cover()
#titlepage()
#abstract(en: [English abstract.])[中文摘要。]
#table-of-contents()
#show: mainmatter
= 绪论#en[Introduction]
正文段落，楷体#kaishu[楷体]，黑体#heiti[黑体]。公式 $E = m c^2$。
== 节#en[Section]
#figure(table(columns: 2, [a], [b]), caption: [表])
#conclusion[结论。]
#acknowledgement[致谢。]
`;
  }
  compiler.addSource('/main.typ', src);

  const t1 = Date.now();
  const res = await compiler.compile({ mainFilePath: '/main.typ', format: 1 /* CompileFormatEnum.pdf */, diagnostics: 'unix' });
  console.log(`编译 ${Date.now() - t1} ms`);
  if (res.diagnostics?.length) for (const d of res.diagnostics) console.log(d);
  if (res.result) {
    fs.writeFileSync(outArg, res.result);
    console.log(`写出 ${outArg} (${res.result.length} 字节)`);
  } else {
    console.error('编译失败');
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
