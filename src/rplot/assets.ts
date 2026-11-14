import { create } from 'zustand';

export interface RPlotLoadState {
  phase: 'idle' | 'downloading' | 'downloaded' | 'initializing' | 'ready' | 'error';
  status: string;
  done: number;
  total: number;
  bytes: number;
  cached: number;
  error?: string;
}
export const useRPlotLoad = create<RPlotLoadState>(() => ({ phase: 'idle', status: '', done: 0, total: 0, bytes: 0, cached: 0 }));
const CORE_CACHE = 'iota-rplot-webr-0.6.1';
const MANIFEST_CACHE = 'iota-rplot-manifest';
const CORE = ['webr/webr.js', 'webr/webr-worker.js', 'webr/R.js', 'webr/R.wasm', 'webr/libRblas.so', 'webr/libRlapack.so', 'library.js.metadata', 'library.data'];
const pending = new Map<string, Promise<Response>>();
let downloading: Promise<void> | null = null;
let libraryCache: Promise<string> | null = null;

export const rPlotAssetUrl = (name: string) => new URL(`${import.meta.env.BASE_URL}rplot/${name}`, document.baseURI).href;
async function libraryCacheName(): Promise<string> {
  if (libraryCache) return libraryCache;
  libraryCache = (async () => {
    const url = rPlotAssetUrl('VERSIONS.json');
    const store = typeof caches !== 'undefined' ? await caches.open(MANIFEST_CACHE).catch(() => null) : null;
    let response;
    try {
      response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('R 组件版本索引不可用');
      try { await store?.put(url, response.clone()); } catch { /* 不影响下载 */ }
    } catch (e) { response = await store?.match(url); if (!response) throw e; }
    const v = await response.json();
    if (!/^[a-f0-9]{64}$/.test(v.libraryHash ?? '')) throw new Error('R 组件版本索引缺少运行库校验值');
    return `iota-rplot-library-${v.libraryHash}`;
  })().catch((e) => { libraryCache = null; throw e; });
  return libraryCache;
}
async function cache(name: string) { try { return typeof caches !== 'undefined' ? await caches.open(name.startsWith('webr/') ? CORE_CACHE : await libraryCacheName()) : null; } catch { return null; } }

/** 自己消费的库文件从 Cache API 读取；webR 的 worker 静态文件同时进入浏览器 HTTP 缓存。 */
export async function fetchRPlotAsset(name: string, progress?: (bytes: number, cached: boolean) => void): Promise<Response> {
  const url = rPlotAssetUrl(name);
  const old = pending.get(url);
  if (old) return (await old).clone();
  const work = (async () => {
    const store = await cache(name);
    const hit = await store?.match(url);
    if (hit) { progress?.(0, true); return hit; }
    const response = await fetch(url, { cache: name.startsWith('webr/') ? 'force-cache' : 'no-cache' });
    if (!response.ok) throw new Error(`R 组件下载失败：${name}（${response.status}）`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); total += value.length; progress?.(value.length, false); }
    } else { const bytes = new Uint8Array(await response.arrayBuffer()); chunks.push(bytes); total = bytes.length; progress?.(total, false); }
    const bytes = new Uint8Array(total);
    let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const result = new Response(bytes, { headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream' } });
    try { await store?.put(url, result.clone()); } catch { /* 存储空间不足仍可继续绘图 */ }
    return result;
  })();
  pending.set(url, work);
  try { return (await work).clone(); }
  finally { pending.delete(url); }
}

/** 下载与用户主动启动去重；两条低并发下载，进度只更新独立的小组件。 */
export function ensureRPlotAssets(progress: (s: string) => void = () => {}): Promise<void> {
  if (downloading) return downloading;
  downloading = (async () => {
    useRPlotLoad.setState({ phase: 'downloading', status: '正在后台下载 R 绘图组件…', total: CORE.length, done: 0, bytes: 0, cached: 0, error: undefined });
    progress('正在后台下载 R 绘图组件…');
    const queue = [...CORE];
    const worker = async () => {
      for (;;) {
        const name = queue.shift(); if (!name) break;
        useRPlotLoad.setState({ status: `正在下载 R 绘图组件：${name.split('/').pop()}` });
        await fetchRPlotAsset(name, (bytes, cached) => useRPlotLoad.setState((s) => ({ bytes: s.bytes + bytes, cached: s.cached + Number(cached) })));
        useRPlotLoad.setState((s) => ({ done: s.done + 1 }));
      }
    };
    await Promise.all([worker(), worker()]);
    useRPlotLoad.setState({ phase: 'downloaded', status: 'R 绘图组件已下载' });
    // 只清理本功能的旧构建缓存。
    try { const current = await libraryCacheName(); for (const name of await caches.keys()) if (name.startsWith('iota-rplot-library-') && name !== current) await caches.delete(name); } catch { /* HTTP 缓存仍然有效 */ }
  })().catch((e) => { downloading = null; useRPlotLoad.setState({ phase: 'error', error: (e as Error).message, status: 'R 绘图组件下载未完成' }); throw e; });
  return downloading;
}
