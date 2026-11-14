// 真正的 R 图形设备在 webR 的 Wasm worker 里运行。静态站不需要 COOP/COEP 或本机 R。
import adapter from './adapter.R?raw';
import { measureLabels, type MetricCache } from './metrics';
import type { RPlotData } from './files';
import { ensureRPlotAssets, fetchRPlotAsset, rPlotAssetUrl, useRPlotLoad } from './assets';
import { useCompileState } from '../compiler/client';
import { installRPackages, resetRPackageLoad } from './packages';

interface WebR {
  versionR: string;
  init(): Promise<void>;
  close(): void;
  evalRVoid(code: string): Promise<void>;
  evalRString(code: string): Promise<string>;
  evalRBoolean(code: string): Promise<boolean>;
  installPackages(packages: string[]): Promise<void>;
  FS: { mkdir(path: string): Promise<unknown>; mount(type: string, options: unknown, path: string): Promise<void>; writeFile(path: string, data: Uint8Array): Promise<void> };
}
export interface RPlotOptions { width?: number; height?: number; pointsize?: number; seed?: number; timeout?: number; signal?: AbortSignal; progress?: (status: string) => void; files?: { name: string; bytes: Uint8Array }[] }
export interface RPlotResult { plot: RPlotData; stdout: string }
let runtime: WebR | null = null;
let ready: Promise<WebR> | null = null;
let busy = false;
let epoch = 0;

const rstring = (s: string) => JSON.stringify(s).replace(/\\u([0-9a-f]{4})/gi, '\\u$1');
const asset = rPlotAssetUrl;
let cachedMetrics: { fonts: number; values: MetricCache } = { fonts: -1, values: {} };

async function getRuntime(progress: (s: string) => void): Promise<WebR> {
  if (ready) { if (useRPlotLoad.getState().phase !== 'ready') progress('R 绘图组件正在后台准备，正在等待引擎就绪…'); return ready; }
  const generation = epoch;
  ready = (async () => {
    await ensureRPlotAssets(progress);
    if (generation !== epoch) throw new DOMException('R 引擎准备已取消', 'AbortError');
    useRPlotLoad.setState({ phase: 'initializing', status: 'R 组件已下载，正在后台初始化引擎…' });
    progress('正在加载 R/Wasm 引擎…');
    // npm 分发的 webr.mjs 是 Node 入口（带 module/url/path 导入）；浏览器入口是 webr.js。
    const url = asset('webr/webr.js');
    const { WebR: Constructor } = await import(/* @vite-ignore */ url);
    if (generation !== epoch) throw new DOMException('R 引擎准备已取消', 'AbortError');
    const r: WebR = new Constructor({ baseUrl: asset('webr/'), channelType: 3, interactive: false, downloadTimeout: 60000 });
    runtime = r;
    await r.init();
    if (generation !== epoch) throw new DOMException('R 引擎准备已取消', 'AbortError');
    progress('正在加载 cetzDevice 0.5.3.1…');
    const [data, metadata] = await Promise.all([
      fetchRPlotAsset('library.data').then((v) => v.arrayBuffer()),
      fetchRPlotAsset('library.js.metadata').then((v) => v.json()),
    ]);
    await r.FS.mkdir('/iota-library');
    await r.FS.mount('WORKERFS', { packages: [{ blob: new Uint8Array(data), metadata }] }, '/iota-library');
    await r.evalRVoid('.libPaths(c("/iota-library", .libPaths())); library(cetzDevice); stopifnot(as.character(packageVersion("cetzDevice")) == "0.5.3.1")');
    await r.evalRVoid(adapter);
    await r.FS.mkdir('/data');
    if (generation !== epoch) throw new DOMException('R 引擎准备已取消', 'AbortError');
    useRPlotLoad.setState({ phase: 'ready', status: 'R 绘图已就绪', error: undefined });
    return r;
  })().catch((e) => { if (epoch === generation) { resetR(); useRPlotLoad.setState({ phase: 'error', status: 'R 绘图组件准备失败', error: (e as Error).message }); } throw e; });
  return ready;
}

export function resetR() { epoch++; resetRPackageLoad(); runtime?.close(); runtime = null; ready = null; if (['ready', 'initializing'].includes(useRPlotLoad.getState().phase)) useRPlotLoad.setState({ phase: 'downloaded', status: 'R 绘图组件已下载' }); }
export async function prepareRPlotRuntime() { await getRuntime((status) => useRPlotLoad.setState({ status })); }

/** 固定随机种子与局部环境重放，直到使用的全部文字都用 Typst 精确测过才交付输出。 */
export async function runRPlot(code: string, options: RPlotOptions = {}): Promise<RPlotResult> {
  if (busy) throw new Error('另一个 R 绘图任务正在运行，请等它结束');
  if (!code.trim()) throw new Error('请先输入 R 绘图代码');
  const width = options.width ?? 6, height = options.height ?? 4, pointsize = options.pointsize ?? 11, seed = options.seed ?? 1;
  if (![width, height].every((n) => Number.isFinite(n) && n >= 1 && n <= 20) || !Number.isFinite(pointsize) || pointsize < 4 || pointsize > 72) throw new Error('画布宽高需在 1–20 英寸之间，字号需在 4–72 pt 之间');
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('随机种子需为 0–2147483647 的整数');
  if ((options.files ?? []).reduce((n, f) => n + f.bytes.byteLength, 0) > 20 * 1024 * 1024) throw new Error('单张 R 图的数据附件总大小不能超过 20 MB');
  options.signal?.throwIfAborted();
  busy = true;
  const progress = options.progress ?? (() => {});
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const killed = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); resetR(); reject(new Error(options.signal?.aborted ? 'R 绘图已取消' : 'R 绘图超时，引擎已重置')); };
    timer = setTimeout(abort, (options.timeout ?? 120) * 1000);
    options.signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([killed, (async () => {
      const r = await getRuntime(progress);
      controller.signal.throwIfAborted();
      for (const file of options.files ?? []) {
        if (!file.name || /[\\/\0]/.test(file.name)) throw new Error('R 数据文件名不能包含路径');
        await r.FS.writeFile(`/data/${file.name}`, file.bytes);
      }
      // ggplot2 等包只在代码确实引用它时装；基础绘图和 grid 随 R 引擎分发。
      const pkgs = [...code.matchAll(/(?:library|require)\s*\(\s*["']?([A-Za-z][\w.]*)|([A-Za-z][\w.]*)::/g)].map((m) => m[1] ?? m[2]);
      const extra = [...new Set(pkgs)].filter((p) => !['base', 'stats', 'graphics', 'grDevices', 'grid', 'utils', 'datasets', 'cetzDevice'].includes(p));
      for (const pkg of extra) {
        if (await r.evalRBoolean(`requireNamespace(${rstring(pkg)}, quietly = TRUE)`)) continue;
        try { await installRPackages(r, [pkg], progress, controller.signal); }
        catch (e) { throw new Error(`无法加载 R 包 ${pkg}：${(e as Error).message}`); }
      }
      const fonts = useCompileState.getState().fontsVersion;
      if (cachedMetrics.fonts !== fonts || Object.keys(cachedMetrics.values).length > 4000) cachedMetrics = { fonts, values: {} };
      const metrics: MetricCache = { ...cachedMetrics.values };
      await r.evalRVoid(`.iota_metrics <- jsonlite::fromJSON(${rstring(JSON.stringify(metrics))}, simplifyVector = FALSE)`);
      for (let pass = 0; pass < 8; pass++) {
        controller.signal.throwIfAborted();
        progress(pass ? `正在按 Typst 字体重新排图（第 ${pass + 1} 次）…` : '正在运行 R 绘图代码…');
        const result = JSON.parse(await r.evalRString(`.iota_draw(${rstring(code)}, ${width}, ${height}, ${pointsize}, ${seed})`)) as { source: string; missing: Record<string, string>; pages: number; stdout: string };
        const missing = result.missing && !Array.isArray(result.missing) ? result.missing : {};
        if (!Object.keys(missing).length) {
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(result.source)))].map((v) => v.toString(16).padStart(2, '0')).join('').slice(0, 32);
          const dataFiles = (options.files ?? []).map((f) => {
            let binary = '';
            for (let i = 0; i < f.bytes.length; i += 8192) binary += String.fromCharCode(...f.bytes.subarray(i, i + 8192));
            return { name: f.name, data: btoa(binary) };
          });
          return { plot: { version: '0.5.3.1' as const, code, width, height, pointsize, seed, source: result.source, path: `rplots/${hash}.typ`, pages: result.pages, ...(dataFiles.length ? { dataFiles } : {}) }, stdout: result.stdout };
        }
        progress(`正在用 Typst 测量图中文字（${Object.keys(missing).length} 项）…`);
        const measured = await measureLabels(missing);
        Object.assign(metrics, measured);
        if (cachedMetrics.fonts === fonts) Object.assign(cachedMetrics.values, measured);
        await r.evalRVoid(`.iota_metrics <- jsonlite::fromJSON(${rstring(JSON.stringify(metrics))}, simplifyVector = FALSE)`);
      }
      throw new Error('R 图的文字度量在多次重排后仍不稳定；请固定随机种子或简化动态标签');
    })()]);
  } finally {
    clearTimeout(timer);
    if (abort) options.signal?.removeEventListener('abort', abort);
    busy = false;
  }
}
