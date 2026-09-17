// 增量编译基准：按 worker 的路径（snapshot + incr_compile），量各种变体
import fs from 'node:fs';
import path from 'node:path';
import { createTypstCompiler, MemoryAccessModel, loadFonts, initOptions } from '@myriaddreamin/typst.ts';
const { withAccessModel, withPackageRegistry } = initOptions;
const root = '/Users/wujunhao/Documents/Typst 包/iota4web';
const pub = path.join(root, 'public');
class Reg { constructor(am) { this.am = am; this.blobs = new Map(); this.cache = new Map(); } add(ns, n, v, d) { this.blobs.set(`${ns}/${n}/${v}`, d); } resolve(spec, ctx) { const k = `${spec.namespace}/${spec.name}/${spec.version}`; if (this.cache.has(k)) return this.cache.get(k); const d = this.blobs.get(k); if (!d) return undefined; const dir = `/@memory/packages/${k}`; ctx.untar(d, (p, b, m) => this.am.insertFile(`${dir}/${p}`, b, new Date(m))); this.cache.set(k, dir); return dir; } }
const am = new MemoryAccessModel(); const reg = new Reg(am);
const manifest = JSON.parse(fs.readFileSync(path.join(pub, 'packages/manifest.json'), 'utf8'));
for (const p of manifest.packages) reg.add(p.namespace, p.name, p.version, new Uint8Array(fs.readFileSync(path.join(pub, 'packages', p.file))));
const dirs = [path.join(pub, 'fonts'), ...(process.env.EXTRA_FONTS ? process.env.EXTRA_FONTS.split(':') : [])];
const fonts = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => /\.(otf|ttf|ttc)$/i.test(f)).map((f) => new Uint8Array(fs.readFileSync(path.join(d, f)))));
const compiler = createTypstCompiler();
await compiler.init({ getModule: () => new Uint8Array(fs.readFileSync(process.env.WASM ?? path.join(root, 'vendor/typst-ts-web-compiler/typst_ts_web_compiler_bg.wasm'))), beforeBuild: [withAccessModel(am), withPackageRegistry(reg), loadFonts(fonts, { assets: false })] });
const dir = process.argv[2];
let main = fs.readFileSync(path.join(dir, 'main.typ'), 'utf8');
const enc = new TextEncoder();
for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isFile() && f !== 'main.typ') compiler.mapShadow(`/${f}`, new Uint8Array(fs.readFileSync(p))); }
const img = path.join(dir, 'images'); if (fs.existsSync(img)) for (const f of fs.readdirSync(img)) compiler.mapShadow(`/images/${f}`, new Uint8Array(fs.readFileSync(path.join(img, f))));
const raw = compiler.compiler;
let world = null, incr = null;
function run(label, src, { remapBib = false, newWorld = true } = {}) {
  const t0 = performance.now();
  compiler.addSource('/main.typ', src);
  if (remapBib) compiler.mapShadow('/refs.bib', new Uint8Array(fs.readFileSync(path.join(dir, 'refs.bib'))));
  if (newWorld) { try { world?.free(); } catch {} world = raw.snapshot(undefined, '/main.typ', [['preview', '1']]); }
  if (!incr) incr = raw.create_incr_server();
  const res = world.incr_compile(incr, 3);
  const ms = Math.round(performance.now() - t0);
  const errs = (res?.diagnostics ?? []).filter((d) => /error/i.test(String(d.severity ?? d)));
  console.log(label.padEnd(40), `${ms} ms`, res?.result ? `artifact ${res.result.length}` : 'no artifact', errs.length ? `errors ${errs.length}` : '');
  return ms;
}
const edit = (s, k) => { const at = s.indexOf(process.env.EDIT_AFTER ?? '#show: mainmatter'); const i = s.indexOf('细胞', at); return s.slice(0, i) + '测'.repeat(k) + s.slice(i); };
const variant = process.env.VARIANT ?? 'base';
if (variant === 'nobib') main = main.replace(/#bibliography\([^\n]*\n/, '');
if (variant === 'stock') main = main.replace(/set par\(linebreaks: \(mode: "msword"[^\n]*\n/g, 'set par(linebreaks: "optimized")\n');
if (variant === 'noimg') main = main.replace(/image\("images\/[^"]+", width: [^)]+\)/g, 'rect(width: 8cm, height: 5cm)');
if (variant === 'nomath') main = main.replace(/#mitex\(`[^`]*`\)/g, '$x$').replace(/#mi\(`[^`]*`\)/g, '$x$');
console.log('variant', variant, 'main', main.length);
run('full (fresh incr)', main);
run('no change', main);
run('no change', main);
run('edit 1 char', edit(main, 1));
run('edit 2 chars', edit(main, 2));
run('edit 3 chars', edit(main, 3));
run('edit 4 chars', edit(main, 4));
