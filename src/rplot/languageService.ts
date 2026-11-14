import { create } from 'zustand';
import { ensureRPlotAssets, fetchRPlotAsset, rPlotAssetUrl } from './assets';
import { installRPackages, resetRPackageLoad } from './packages';
import adapter from './language-service.R?raw';

interface LanguageHost {
  init(): Promise<void>; close(): void; versionR?: string;
  evalRVoid(code: string): Promise<void>; evalRString(code: string): Promise<string>; evalRBoolean(code: string): Promise<boolean>;
  FS: { mkdir(path: string): Promise<unknown>; mount(type: string, options: unknown, path: string): Promise<void> };
}
export interface LspMessage { jsonrpc?: string; id?: number; method?: string; params?: any; result?: any; error?: { message: string; code: number } }
export const useRLanguageService = create<{ phase: 'off' | 'loading' | 'ready' | 'error'; status: string; error?: string }>(() => ({ phase: 'off', status: '' }));
let host: LanguageHost | null = null, preparing: Promise<void> | null = null, controller: AbortController | null = null;
let epoch = 0, ticket = 0, tail: Promise<unknown> = Promise.resolve();
let connecting: Promise<void> | null = null;
const listeners = new Set<(message: LspMessage) => void>();
export const onRLanguageMessage = (callback: (message: LspMessage) => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; };
const status = (status: string) => useRLanguageService.setState({ status });

export function stopRLanguageService() {
  epoch++; controller?.abort(); resetRPackageLoad('language'); host?.close(); host = null; preparing = null; connecting = null; tail = Promise.resolve();
  useRLanguageService.setState({ phase: 'off', status: '' });
}
export function prepareRLanguageService(): Promise<void> {
  if (preparing) return preparing;
  const generation = epoch, abort = new AbortController(); controller = abort;
  useRLanguageService.setState({ phase: 'loading', status: '正在准备可选 R 语言服务…', error: undefined });
  const check = () => { if (generation !== epoch) throw new DOMException('语言服务已关闭', 'AbortError'); };
  preparing = (async () => {
    await ensureRPlotAssets(); check();
    const url = rPlotAssetUrl('webr/webr.js');
    const { WebR } = await import(/* @vite-ignore */ url); check();
    const r: LanguageHost = new WebR({ baseUrl: rPlotAssetUrl('webr/'), channelType: 3, interactive: false }); host = r;
    await r.init(); check();
    const [data, metadata] = await Promise.all([fetchRPlotAsset('library.data').then((r) => r.arrayBuffer()), fetchRPlotAsset('library.js.metadata').then((r) => r.json())]); check();
    await r.FS.mkdir('/iota-library');
    await r.FS.mount('WORKERFS', { packages: [{ blob: new Uint8Array(data), metadata }] }, '/iota-library');
    // LSP 枚举包/帮助时会访问这些延迟包；主线程挂到原路径，避免 R 内同步下载。
    for (const packageName of ['parallel', 'tcltk', 'translations']) {
      status(`正在准备 R 语言服务基础包：${packageName}…`);
      const base = `webr/vfs/usr/lib/R/library/${packageName}`;
      const [packed, metadata] = await Promise.all([fetchRPlotAsset(`${base}.data.gz`).then(r => r.blob()), fetchRPlotAsset(`${base}.js.metadata`).then(r => r.json())]); check();
      const bytes = new Uint8Array(await packed.arrayBuffer());
      const compression = bytes[0] === 0x1f && bytes[1] === 0x8b ? 'gzip' : bytes[0] === 0x78 ? 'deflate' : null;
      const data = compression ? new Uint8Array(await new Response(packed.stream().pipeThrough(new DecompressionStream(compression))).arrayBuffer()) : bytes;
      if (data.length !== metadata.remote_package_size) throw new Error(`${packageName} 数据长度与索引不一致`);
      check(); await r.FS.mount('WORKERFS', { packages: [{ blob: data, metadata: { ...metadata, gzip: false } }] }, `/usr/lib/R/library/${packageName}`);
    }
    await r.evalRVoid('.libPaths(c("/iota-library", .libPaths()))');
    await r.evalRVoid('dyn.load("/usr/lib/R/library/parallel/libs/parallel.so")');
    await installRPackages(r, ['languageserver'], status, abort.signal, false, 'language');
    // webR 动态库在同一 worker 中按依赖顺序初始化，再创建服务对象。
    for (const name of ['parallel', 'tools', 'utils', 'ps', 'processx', 'callr', 'collections', 'fs', 'lintr', 'roxygen2', 'stringi', 'styler', 'languageserver']) {
      check(); status(`正在载入 R 语言服务依赖：${name}`);
      const result = await r.evalRString(`tryCatch({loadNamespace(${JSON.stringify(name)}); "IOTA_LSP_OK"}, error=function(e) paste("LOAD_FAIL", conditionMessage(e)))`);
      if (result !== 'IOTA_LSP_OK') throw new Error(`${name}：${result}`);
    }
    check();
    status('正在启动 languageserver（独立 R/Wasm worker）…');
    await r.evalRVoid(adapter); check();
    useRLanguageService.setState({ phase: 'ready', status: 'R LSP 已就绪：补全、悬停签名和诊断' });
  })().catch((e) => {
    if (generation === epoch) { host?.close(); host = null; preparing = null; useRLanguageService.setState({ phase: 'error', status: 'R 语言服务启动失败', error: (e as Error).message }); }
    throw e;
  });
  return preparing;
}

export function connectRLanguageService(): Promise<void> {
  if (!connecting) connecting = prepareRLanguageService().then(async () => {
    await sendRLanguageMessage('initialize', { processId: null, rootUri: null, capabilities: { textDocument: { completion: { completionItem: { snippetSupport: false } }, hover: { contentFormat: ['plaintext'] } } } }, true);
    await sendRLanguageMessage('initialized', {});
  }).catch((e) => { connecting = null; throw e; });
  return connecting;
}

/** 标准 JSON-RPC 消息在专用 R worker 内顺序处理；不 eval 用户正在编辑的绘图代码。 */
export function sendRLanguageMessage(method: string, params: unknown, request = false): Promise<any> {
  const generation = epoch, id = request ? ++ticket : undefined;
  const work = tail.catch(() => {}).then(async () => {
    if (generation !== epoch) throw new Error('R 语言服务已关闭');
    await prepareRLanguageService();
    if (generation !== epoch || !host) throw new Error('R 语言服务已关闭');
    const payload = JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params });
    const signal = controller!.signal;
    let off = () => {};
    const closed = new Promise<never>((_, reject) => {
      const abort = () => reject(new Error('R 语言服务已关闭'));
      off = () => signal.removeEventListener('abort', abort);
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
    let json: string;
    try { json = await Promise.race([host.evalRString(`.iota_lsp_safe_send(${JSON.stringify(payload)})`), closed]); }
    finally { off(); }
    const messages: LspMessage[] = JSON.parse(json);
    if (generation !== epoch) throw new Error('R 语言服务已关闭');
    for (const message of messages) for (const listener of listeners) listener(message);
    const response = messages.find((m) => id !== undefined && m.id === id);
    if (response?.error) throw new Error(response.error.message);
    if (request && !response) throw new Error(`R LSP 未返回 ${method} 的结果`);
    return response?.result;
  });
  tail = work; return work;
}
