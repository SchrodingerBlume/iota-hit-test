// 直接使用现成的 webR 二进制仓库。下载在浏览器主线程异步进行，避免 PostMessage 通道里
// R 的同步下载/交互式安装路径失效；二进制包用相同的只读 WORKERFS 挂载。
import { create } from 'zustand';

export interface RPackageLoadState {
  active: boolean; phase: 'index' | 'download' | 'install' | 'ready' | 'error';
  name: string; bytes: number; total?: number; step: number; count: number; cached?: boolean; error?: string;
}
export const useRPackageLoad = create<RPackageLoadState>(() => ({ active: false, phase: 'ready', name: '', bytes: 0, step: 0, count: 0 }));
let generation = 0;
export function resetRPackageLoad() { generation++; useRPackageLoad.setState({ active: false }); }

interface RPackageHost {
  versionR?: string;
  evalRString(code: string): Promise<string>;
  evalRVoid(code: string): Promise<void>;
  evalRBoolean(code: string): Promise<boolean>;
  FS: { mkdir(path: string): Promise<unknown>; mount(type: string, options: unknown, path: string): Promise<void> };
}
type PackageRecord = Record<string, string>;
const indexes = new Map<string, Promise<Map<string, PackageRecord>>>();
const BASE = new Set(['R', 'base', 'compiler', 'datasets', 'graphics', 'grDevices', 'grid', 'methods', 'parallel', 'splines', 'stats', 'stats4', 'tools', 'utils']);
const quote = JSON.stringify;

/** R/Wasm 的 .tgz 是已安装的包目录。索引 tar 中的文件区段，直接挂载，免去 R 的 shell/untar 路径。 */
async function packageImage(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const tar = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const decode = new TextDecoder(), files: { filename: string; start: number; end: number }[] = [];
  const links: { filename: string; target: string }[] = [];
  const text = (start: number, size: number) => decode.decode(tar.subarray(start, start + size)).replace(/\0.*$/s, '');
  let longName = '', pax: Record<string, string> = {};
  for (let offset = 0; offset + 512 <= tar.length;) {
    if (!tar.subarray(offset, offset + 512).some(Boolean)) break;
    const size = parseInt(text(offset + 124, 12).trim(), 8) || 0;
    const start = offset + 512, end = start + size, type = text(offset + 156, 1);
    if (!Number.isSafeInteger(size) || size < 0 || end > tar.length) throw new Error(`R 包 ${name} 的 tar 文件不完整`);
    let filename = longName || pax.path || [text(offset + 345, 155), text(offset, 100)].filter(Boolean).join('/');
    const link = pax.linkpath || text(offset + 157, 100);
    offset = start + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = text(start, size).trimEnd(); continue; }
    if (type === 'x' || type === 'g') {
      const fields: Record<string, string> = {};
      for (let p = start; p < end;) {
        const space = tar.indexOf(32, p), length = Number(text(p, space - p));
        if (space < p || !Number.isSafeInteger(length) || length <= 0 || p + length > end) throw new Error(`R 包 ${name} 的 tar 扩展头无效`);
        const field = decode.decode(tar.subarray(space + 1, p + length - 1)), eq = field.indexOf('=');
        if (eq > 0) fields[field.slice(0, eq)] = field.slice(eq + 1);
        p += length;
      }
      pax = fields; continue;
    }
    longName = ''; pax = {};
    filename = filename.replace(/^(\.\/)+/, '').replace(/\/$/, '');
    if (!filename || type === '5') continue;
    if ((!filename.startsWith(`${name}/`) && filename !== '.vfs-index.json') || filename.split('/').some((p) => p === '..') || filename.includes('\\')) throw new Error(`R 包 ${name} 包含无效路径：${filename}`);
    if (type === '1' || type === '2') {
      const parts = (type === '2' ? filename.slice(0, filename.lastIndexOf('/') + 1) + link : link).split('/'), resolved: string[] = [];
      for (const p of parts) { if (p === '..') resolved.pop(); else if (p && p !== '.') resolved.push(p); }
      links.push({ filename: `/${filename}`, target: `/${resolved.join('/')}` });
    } else if (!type || type === '0') files.push({ filename: `/${filename}`, start, end });
    else throw new Error(`R 包 ${name} 包含不支持的 tar 条目类型：${type}`);
  }
  for (const link of links) {
    const target = files.find((f) => f.filename === link.target);
    if (!target) throw new Error(`R 包 ${name} 的内部链接无法解析：${link.filename}`);
    files.push({ ...target, filename: link.filename });
  }
  if (!files.some((f) => f.filename === `/${name}/DESCRIPTION`)) throw new Error(`R 包 ${name} 缺少 DESCRIPTION`);
  return { blob: tar, metadata: { files, remote_package_size: tar.length } };
}

async function download(url: string, signal?: AbortSignal, onBytes?: (bytes: number, total?: number, cached?: boolean) => void): Promise<Response> {
  let cache: Cache | null = null;
  try { cache = await caches.open('iota-rplot-rpackages-v1'); } catch { /* 隐私模式仍可安装 */ }
  if (!url.endsWith('PACKAGES.gz')) { const hit = await cache?.match(url); if (hit) { onBytes?.(0, undefined, true); return hit; } }
  try {
    const r = await fetch(url, { signal, cache: url.endsWith('PACKAGES.gz') ? 'no-cache' : 'force-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const length = Number(r.headers.get('Content-Length')) || undefined;
    const chunks: Uint8Array[] = []; let bytes = 0;
    if (r.body) {
      const reader = r.body.getReader();
      for (;;) { const value = await reader.read(); if (value.done) break; chunks.push(value.value); bytes += value.value.length; onBytes?.(bytes, length); }
    } else { const b = new Uint8Array(await r.arrayBuffer()); chunks.push(b); bytes = b.length; onBytes?.(bytes, length); }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const b of chunks) { body.set(b, offset); offset += b.length; }
    const result = new Response(body, { headers: { 'Content-Type': r.headers.get('Content-Type') ?? 'application/octet-stream' } });
    try { await cache?.put(url, result.clone()); } catch { /* 存储不足不影响本次安装 */ }
    return result;
  } catch (e) { const hit = await cache?.match(url); if (hit && !signal?.aborted) return hit; throw e; }
}

async function packageIndex(repo: string, signal?: AbortSignal): Promise<Map<string, PackageRecord>> {
  let pending = indexes.get(repo);
  if (!pending) {
    pending = (async () => {
      const bytes = new Uint8Array(await (await download(`${repo}PACKAGES.gz`, signal)).arrayBuffer());
      const text = bytes[0] === 0x1f && bytes[1] === 0x8b
        ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : new TextDecoder().decode(bytes);
      const records = new Map<string, PackageRecord>();
      for (const block of text.split(/\n\s*\n/)) {
        const record: PackageRecord = {}; let key = '';
        for (const line of block.split('\n')) {
          if (/^\s/.test(line) && key) record[key] += ' ' + line.trim();
          else { const m = /^([^:]+):\s*(.*)$/.exec(line); if (m) { key = m[1]; record[key] = m[2]; } }
        }
        if (record.Package) records.set(record.Package, record);
      }
      return records;
    })().catch((e) => { indexes.delete(repo); throw e; });
    indexes.set(repo, pending);
  }
  return pending;
}

export async function installRPackages(r: RPackageHost, requested: string[], progress: (s: string) => void, signal?: AbortSignal) {
  const current = ++generation;
  const update = (patch: Partial<RPackageLoadState>) => { if (current === generation) useRPackageLoad.setState(patch); };
  update({ active: true, phase: 'index', name: requested.join('、'), bytes: 0, total: undefined, step: 0, count: 0, cached: false, error: undefined });
  let stage = '识别 R/Wasm 版本';
  try {
    const version = (r.versionR ?? await r.evalRString('as.character(getRversion())')).match(/\d+\.\d+/)?.[0];
    if (!version) throw new Error('无法识别 R/Wasm 的版本');
    const repo = `https://repo.r-wasm.org/bin/emscripten/contrib/${version}/`;
    progress(`正在检查 R/Wasm ${version} 包仓库…`);
    stage = '读取 R/Wasm 包仓库索引';
    const index = await packageIndex(repo, signal);
    stage = '检查已安装的 R 包';
    // installed.packages() 在 webR 的只读镜像/PostMessage 路径不可用；
    // 包目录足以避免重复下载，完成后仍用 requireNamespace 验证实际可加载。
    const installedText = await r.evalRString('paste(unlist(lapply(.libPaths(), list.files), use.names = FALSE), collapse = "\\n")');
    const installed = new Set(installedText.split('\n').filter(Boolean));
    const ordered: PackageRecord[] = [], visited = new Set<string>();
    const visit = (name: string) => {
      if (BASE.has(name) || installed.has(name) || visited.has(name)) return;
      if (!/^[A-Za-z][\w.]*$/.test(name)) throw new Error(`无效的 R 包名：${name}`);
      visited.add(name);
      const p = index.get(name);
      if (!p) throw new Error(`R/Wasm ${version} 仓库尚未提供 ${name} 的二进制构建；桌面 R 包不能直接用于浏览器`);
      for (const field of ['Depends', 'Imports', 'LinkingTo']) for (const dep of (p[field] ?? '').split(',').map((s) => s.replace(/\s*\([^)]*\)/g, '').trim()).filter(Boolean)) visit(dep);
      ordered.push(p);
    };
    for (const name of requested) visit(name);
    for (const [i, pkg] of ordered.entries()) {
      signal?.throwIfAborted();
      update({ phase: 'download', name: `${pkg.Package} ${pkg.Version}`, bytes: 0, total: undefined, step: i + 1, count: ordered.length, cached: false });
      progress(`正在安装 ${pkg.Package} ${pkg.Version}（${i + 1}/${ordered.length}）…`);
      const file = pkg.File || `${pkg.Package}_${pkg.Version}.tgz`;
      if (!/^[\w.+-]+\.tgz$/.test(file)) throw new Error(`R 包仓库返回了无效文件名：${file}`);
      stage = `下载 ${pkg.Package}`;
      const bytes = new Uint8Array(await (await download(repo + file, signal, (bytes, total, cached) => update({ bytes, total, cached }))).arrayBuffer());
      update({ phase: 'install' });
      progress(`已下载 ${pkg.Package}，正在解包安装（${i + 1}/${ordered.length}）…`);
      stage = `解包安装 ${pkg.Package}`;
      const image = await packageImage(bytes, pkg.Package);
      signal?.throwIfAborted();
      const target = `/iota-extra-${pkg.Package}-${crypto.randomUUID()}`;
      await r.FS.mkdir(target);
      await r.FS.mount('WORKERFS', { packages: [image] }, target);
      await r.evalRVoid(`.libPaths(c(${quote(target)}, .libPaths()))`);
    }
    stage = '加载安装后的 R 包';
    for (const name of requested) if (!await r.evalRBoolean(`requireNamespace(${quote(name)}, quietly = TRUE)`)) {
      let detail = '';
      try { await r.evalRVoid(`loadNamespace(${quote(name)})`); } catch (e) { detail = (e as Error).message; }
      throw new Error(`R 包 ${name} 下载后仍无法加载${detail ? `：${detail}` : ''}`);
    }
    update({ phase: 'ready' });
  } catch (e) { const error = new Error(`${stage}：${(e as Error)?.message || String(e)}`); update({ phase: 'error', error: error.message }); throw error; }
  finally { update({ active: false }); }
}
