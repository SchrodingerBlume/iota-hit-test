/// <reference lib="webworker" />
// 编译 worker：wasm 编译器、字体、包全住在这里，主线程只发源码收结果。
// 大文件（wasm 30 MB、字体 49 MB）走 Cache API，第二次进站不再下载。
import { createTypstCompiler, createTypstFontBuilder, MemoryAccessModel, loadFonts, initOptions, type TypstCompiler } from '@myriaddreamin/typst.ts';
import * as compilerWrapper from '@myriaddreamin/typst-ts-web-compiler';
import type { ToWorker, FromWorker, Diagnostic, Progress } from './protocol';

const { withAccessModel, withPackageRegistry } = initOptions;

const CACHE = 'iota4web-assets-v1';
const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

interface PackageSpec { namespace: string; name: string; version: string }
interface PackageCtx { untar(data: Uint8Array, cb: (path: string, data: Uint8Array, mtime: number) => void): void }

/** 包一律来自站内 public/packages/*.tar.gz，manifest 列的全部预取进内存 */
class StaticPackageRegistry {
  private blobs = new Map<string, Uint8Array>();
  private dirs = new Map<string, string>();
  constructor(private am: MemoryAccessModel) {}
  add(spec: PackageSpec, data: Uint8Array) { this.blobs.set(this.key(spec), data); }
  private key(s: PackageSpec) { return `${s.namespace}/${s.name}/${s.version}`; }
  resolve(spec: PackageSpec, ctx: PackageCtx): string | undefined {
    const key = this.key(spec);
    const hit = this.dirs.get(key);
    if (hit) return hit;
    const data = this.blobs.get(key);
    if (!data) { console.error('[iota4web] 缺包', key); return undefined; }
    const dir = `/@memory/packages/${key}`;
    ctx.untar(data, (p, d, mtime) => this.am.insertFile(`${dir}/${p}`, d, new Date(mtime)));
    this.dirs.set(key, dir);
    return dir;
  }
}

/** 带进度、走 Cache API 的下载 */
async function fetchCached(url: string, onBytes?: (n: number) => void): Promise<Uint8Array> {
  let cache: Cache | undefined;
  try { cache = await caches.open(CACHE); } catch { cache = undefined; }
  const cached = cache && (await cache.match(url));
  if (cached) {
    const buf = new Uint8Array(await cached.arrayBuffer());
    onBytes?.(buf.length);
    return buf;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${url}: ${res.status}`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      onBytes?.(value.length);
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    chunks.push(buf); total = buf.length; onBytes?.(buf.length);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  if (cache) { try { await cache.put(url, new Response(out, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch { /* 配额不够就算了 */ } }
  return out;
}

/** 有的服务器（Vite 开发服务器就是）把 .tar.gz 当 Content-Encoding: gzip 发，浏览器
 *  透明解压后到手的是裸 tar；untar 只认 gzip，那就再压回去 */
async function ensureGzip(buf: Uint8Array): Promise<Uint8Array> {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return buf;
  const stream = new Blob([buf as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let compiler: TypstCompiler | undefined;
/** 上一次编译的世界快照：留着给字形表用，下次编译再释放 */
let world: any = null;
/** 增量服务：每次只给渲染器发「与上一版的差」，主线程只补丁变了的页 */
let incr: any = null;
let incrFresh = true;
const mappedImages = new Map<string, number>();
/** 站内字体留一份，换字体表时要连它们一起重建 */
let bundledFonts: Uint8Array[] = [];
let bundledFamilies: string[] = [];
/** 用户字体：id → 字节。主线程不留副本 */
const userFonts = new Map<string, Uint8Array>();
const userFamilies = new Map<string, string[]>();
let wasmBytes: Uint8Array | undefined;

async function init(base: string) {
  const t0 = performance.now();
  const progress: Progress = { phase: '准备', loaded: 0, total: 0 };
  const report = (detail?: string) => post({ type: 'progress', progress: { ...progress, detail } });

  const [fontManifest, pkgManifest] = await Promise.all([
    fetch(`${base}fonts/manifest.json`).then((r) => r.json()),
    fetch(`${base}packages/manifest.json`).then((r) => r.json()),
  ]);
  const fonts: { file: string; size: number; lazy: boolean; info: { info?: { family?: string }[] } }[] = fontManifest.fonts;
  bundledFamilies = [...new Set(fonts.flatMap((f) => (f.info?.info ?? []).map((i) => i.family ?? '').filter(Boolean)))];
  const packages: { namespace: string; name: string; version: string; file: string; size: number }[] = pkgManifest.packages;

  const wasmUrl = new URL('../../vendor/typst-ts-web-compiler/typst_ts_web_compiler_bg.wasm', import.meta.url).href;
  const wasmSize = 30_200_000; // 进度条用的估计值
  progress.total = wasmSize + fonts.filter((f) => !f.lazy).reduce((s, f) => s + f.size, 0) + packages.reduce((s, p) => s + p.size, 0);

  progress.phase = '下载排版引擎';
  report('typst 0.15.1 · wasm');
  let wasmLoaded = 0;
  const wasm = wasmBytes = await fetchCached(wasmUrl, (n) => { wasmLoaded += n; progress.loaded += n; report('typst 0.15.1 · wasm'); });
  progress.loaded += Math.max(0, wasmSize - wasmLoaded);

  progress.phase = '下载字体';
  const fontBuffers: (Uint8Array | { info: unknown; url: string })[] = [];
  // 大字体并发拉，小的顺序无所谓
  await Promise.all(fonts.map(async (f) => {
    const url = `${base}fonts/${f.file}`;
    if (f.lazy) { fontBuffers.push({ ...(f.info as object), url } as any); return; }
    const buf = await fetchCached(url, (n) => { progress.loaded += n; report(f.file); });
    fontBuffers.push(buf);
  }));
  bundledFonts = fontBuffers.filter((f): f is Uint8Array => f instanceof Uint8Array);

  progress.phase = '下载模板与依赖包';
  const am = new MemoryAccessModel();
  const registry = new StaticPackageRegistry(am);
  await Promise.all(packages.map(async (p) => {
    const buf = await fetchCached(`${base}packages/${p.file}`, (n) => { progress.loaded += n; report(`${p.name} ${p.version}`); });
    registry.add(p, await ensureGzip(buf));
  }));

  progress.phase = '启动编译器';
  progress.loaded = progress.total;
  report();
  compiler = createTypstCompiler();
  await compiler.init({
    getWrapper: async () => compilerWrapper,
    getModule: () => wasm,
    beforeBuild: [
      withAccessModel(am),
      withPackageRegistry(registry),
      loadFonts(fontBuffers as any, { assets: false }),
    ],
  });
  post({ type: 'ready', ms: Math.round(performance.now() - t0), families: bundledFamilies });
}

function normalizeDiagnostics(raw: unknown): Diagnostic[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((d: any) => {
    if (typeof d === 'string') return { severity: /error/.test(d) ? 'error' : 'warning', message: d, where: '' };
    const path = String(d.path ?? '').replace(/^\/+/, '');
    return {
      severity: String(d.severity ?? 'error').toLowerCase(),
      message: String(d.message ?? ''),
      where: `${d.package ? d.package + '@' : ''}${path}${d.range ? ':' + d.range : ''}`,
      package: d.package, path: d.path, range: d.range,
    };
  });
}

const enc = new TextEncoder();

/** UTF-8 字节偏移 → UTF-16 下标的查表（编译器给的是字节，编辑器认的是 JS 字符串下标） */
function byteToUnitTable(s: string): Uint32Array {
  const bytes = enc.encode(s).length;
  const table = new Uint32Array(bytes + 1);
  let b = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let n: number;
    if (c < 0x80) n = 1;
    else if (c < 0x800) n = 2;
    else if (c >= 0xd800 && c <= 0xdbff) n = 4; // 代理对：高位算 4 字节，低位不占
    else if (c >= 0xdc00 && c <= 0xdfff) n = 0;
    else n = 3;
    for (let k = 0; k < n; k++) table[b + k] = i;
    b += n;
  }
  table[bytes] = s.length;
  return table;
}

import { GLYPH_STRIDE } from './protocol';

/** 字形表：wasm 给的字节偏移换成 UTF-16 下标，拷出 wasm 内存 */
function glyphMap(main: string): ArrayBuffer | null {
  if (!world || typeof world.glyph_map !== 'function') return null;
  try {
    const raw = world.glyph_map() as Float64Array | null;
    if (!raw || !raw.length) return null;
    const out = new Float64Array(raw); // 拷贝
    const table = byteToUnitTable(main);
    const last = table.length - 1;
    for (let i = 0; i < out.length; i += GLYPH_STRIDE) {
      out[i + 5] = table[Math.min(last, out[i + 5])];
      out[i + 6] = table[Math.min(last, out[i + 6])];
    }
    return out.buffer;
  } catch (e) {
    console.warn('[iota4web] 字形表失败', e);
    return null;
  }
}

async function compile(msg: Extract<ToWorker, { type: 'compile' }>) {
  if (!compiler) return;
  const t0 = performance.now();
  compiler.addSource('/main.typ', msg.main);
  for (const [name, text] of Object.entries(msg.files)) compiler.mapShadow(`/${name}`, enc.encode(text));
  for (const img of msg.images) {
    compiler.mapShadow(`/images/${img.name}`, new Uint8Array(img.data));
    mappedImages.set(img.name, img.data.byteLength);
  }
  for (const name of msg.removeImages) {
    if (mappedImages.delete(name)) compiler.unmapShadow(`/images/${name}`);
  }
  try {
    // 不走 typst.ts 的 compile() 包装：自己拿世界快照，编完留着，字形表从同一份文档上取
    const raw = (compiler as any).compiler;
    try { world?.free(); } catch { /* 已经释放过 */ }
    // sys.inputs.preview：main.typ 里预览专用的东西（空行上的隐形 ¶）只在这儿生效，PDF 不带
    world = raw.snapshot(undefined, '/main.typ', [['preview', '1']]);
    if (!incr) { incr = raw.create_incr_server(); incrFresh = true; }
    const res = world.incr_compile(incr, 3); // 3 = full diagnostics；结果是与上一版的差
    // 成功那一支只带 result，诊断（警告）另问一次——编译结果是缓存的，不重编
    const diagnostics = res?.diagnostics ?? (res?.result ? world.compile(0, 3)?.diagnostics : undefined);
    // 拷贝一份：结果是 wasm 内存上的视图，直接拿 .buffer 会把整块内存搬走
    const artifact = res?.result ? new Uint8Array(res.result as Uint8Array).buffer : null;
    const glyphs = artifact ? glyphMap(msg.main) : null;
    const fresh = incrFresh;
    if (artifact) incrFresh = false;
    post({ type: 'compiled', id: msg.id, artifact, fresh, diagnostics: normalizeDiagnostics(diagnostics), ms: Math.round(performance.now() - t0), glyphs }, [artifact, glyphs].filter((x): x is ArrayBuffer => !!x));
  } catch (e) {
    post({ type: 'compiled', id: msg.id, artifact: null, fresh: false, diagnostics: [{ severity: 'error', message: String((e as Error)?.message ?? e), where: '' }], ms: Math.round(performance.now() - t0), glyphs: null });
  }
}

async function pdf(msg: Extract<ToWorker, { type: 'pdf' }>) {
  if (!compiler) return;
  // 正式排版用的 main.typ（不带预览记号）；下一次预览编译会再把预览那份换回来
  compiler.addSource('/main.typ', msg.main);
  try {
    const res = await compiler.compile({ mainFilePath: '/main.typ', format: 1 as any, diagnostics: 'full' });
    const buf = res.result ? new Uint8Array(res.result as Uint8Array).buffer : null;
    post({ type: 'pdf', id: msg.id, pdf: buf, diagnostics: normalizeDiagnostics(res.diagnostics) }, buf ? [buf] : []);
  } catch (e) {
    post({ type: 'pdf', id: msg.id, pdf: null, diagnostics: [{ severity: 'error', message: String((e as Error)?.message ?? e), where: '' }] });
  }
}

/** 公式预览：把一段 Typst 数学编成一页刚好包住它的小文档，主线程再画成 SVG */
async function snippet(msg: Extract<ToWorker, { type: 'snippet' }>) {
  if (!compiler) return;
  const body = msg.display ? `$ ${msg.src} $` : `$${msg.src}$`;
  const src = `#set page(width: auto, height: auto, margin: (x: 1pt, y: 2pt), fill: none)
#set text(size: 11pt, font: ("Times New Roman", "TeX Gyre Termes", "Noto Serif CJK SC"))
#show math.equation: set text(font: ("Cambria Math", "TeX Gyre Termes Math"))
#set math.equation(numbering: none)
${body}
`;
  compiler.addSource('/snippet.typ', src);
  try {
    const res = await compiler.compile({ mainFilePath: '/snippet.typ', format: 0 as any, diagnostics: 'full' });
    const errors = normalizeDiagnostics(res.diagnostics).filter((d) => d.severity === 'error');
    if (!res.result || errors.length) {
      post({ type: 'snippet', id: msg.id, artifact: null, error: errors.map((e) => e.message).join('；') || '编译失败' });
      return;
    }
    const artifact = new Uint8Array(res.result as Uint8Array).buffer;
    post({ type: 'snippet', id: msg.id, artifact }, [artifact]);
  } catch (e) {
    post({ type: 'snippet', id: msg.id, artifact: null, error: String((e as Error)?.message ?? e) });
  }
}

/** 换字体表：站内字体 + 用户给的字体，整表重建后塞给编译器（编译器只借用，建完就释放） */
async function setFonts(msg: Extract<ToWorker, { type: 'setFonts' }>) {
  if (!compiler) return;
  try {
    const fb = createTypstFontBuilder();
    await fb.init({ getWrapper: async () => compilerWrapper, getModule: () => wasmBytes! });
    for (const id of msg.remove) { userFonts.delete(id); userFamilies.delete(id); }
    for (const f of msg.add) {
      const bytes = new Uint8Array(f.data);
      const info = (await fb.getFontInfo(bytes)) as { info?: { family?: string }[] };
      userFonts.set(f.id, bytes);
      userFamilies.set(f.id, (info?.info ?? []).map((i) => i.family ?? '').filter(Boolean));
    }
    for (const f of bundledFonts) await fb.addFontData(f);
    for (const f of userFonts.values()) await fb.addFontData(f);
    await fb.build(async (resolver) => { compiler!.setFonts(resolver); });
    const families = new Set(bundledFamilies);
    for (const fams of userFamilies.values()) for (const f of fams) families.add(f);
    post({ type: 'fontsSet', id: msg.id, families: [...families] });
  } catch (e) {
    post({ type: 'fontsSet', id: msg.id, families: [], error: String((e as Error)?.message ?? e) });
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  const run = async () => {
    switch (msg.type) {
      case 'init': await init(msg.baseUrl); break;
      case 'compile': await compile(msg); break;
      case 'pdf': await pdf(msg); break;
      case 'setFonts': await setFonts(msg); break;
      case 'snippet': await snippet(msg); break;
    }
  };
  run().catch((e) => post({ type: 'fatal', message: String((e as Error)?.stack ?? e) }));
};
