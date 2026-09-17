// 主线程这一侧：起 worker、排队编译、把状态放进一个 zustand store 给界面用。
import { create } from 'zustand';
import type { ToWorker, FromWorker, Diagnostic, Progress } from './protocol';
import type { Segment } from '../typst/sourcemap';

export interface CompileState {
  status: 'booting' | 'ready' | 'error';
  progress: Progress | null;
  fatal: string | null;
  bootMs: number | null;
  compiling: boolean;
  /** 最近一次成功的产物（与上一版的差；fresh 表示要整个 reset） */
  artifact: Uint8Array | null;
  artifactFresh: boolean;
  diagnostics: Diagnostic[];
  lastMs: number | null;
  compileCount: number;
  /** 字体表换过几次；变了就重排 */
  fontsVersion: number;
  /** 编译器眼下认得的家族名 */
  families: string[];
  /** 与 artifact 配套的字形表、源码映射、文档版本（预览区直接编辑用） */
  glyphs: Float64Array | null;
  segments: Segment[];
  /** 诊断对着的那份 main.typ 文本与段表（编译失败也更新，产物那一套只在成功时换） */
  diagMain: string;
  diagSegments: Segment[];
  mapVersion: number;
  /** 上一次把产物画成 SVG 花的毫秒（主线程） */
  renderMs: number | null;
  /** 最近一次排版得到的页数，长文档据此降低自动排版频率。 */
  pageCount: number;
}

export const useCompileState = create<CompileState>(() => ({
  status: 'booting',
  progress: null,
  fatal: null,
  bootMs: null,
  compiling: false,
  artifact: null,
  artifactFresh: true,
  diagnostics: [],
  lastMs: null,
  compileCount: 0,
  fontsVersion: 0,
  families: [],
  glyphs: null,
  segments: [],
  diagMain: '',
  diagSegments: [],
  mapVersion: -1,
  renderMs: null,
  pageCount: 0,
}));

export interface CompileInput {
  /** 手动刷新时重建完整预览。 */
  force?: boolean;
  /** 是否生成整篇字形映射。长文档仅在预览编辑时需要。 */
  glyphs?: boolean;
  main: string;
  files: Record<string, string>;
  images: { name: string; data: ArrayBuffer }[];
  removeImages: string[];
  /** 源码映射与它对应的文档版本 */
  segments?: Segment[];
  version?: number;
}

let worker: Worker | null = null;
let nextId = 1;
let inFlight: number | null = null;
let inFlightInput: CompileInput | null = null;
let pending: CompileInput | null = null;
const pdfWaiters = new Map<number, (r: { pdf: ArrayBuffer | null; diagnostics: Diagnostic[] }) => void>();
const fontWaiters = new Map<number, (r: { families: string[]; error?: string }) => void>();
const snippetWaiters = new Map<number, (r: { artifact: ArrayBuffer | null; error?: string }) => void>();

function send(msg: ToWorker, transfer: Transferable[] = []) {
  worker?.postMessage(msg, transfer);
}

function flush() {
  if (!worker || inFlight !== null || !pending || useCompileState.getState().status !== 'ready') return;
  const input = pending;
  pending = null;
  inFlight = nextId++;
  inFlightInput = input;
  useCompileState.setState({ compiling: true });
  const { segments: _s, version: _v, ...msg } = input;
  send({ type: 'compile', id: inFlight, ...msg }, input.images.map((i) => i.data));
}

export function startCompiler() {
  if (worker) return;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    switch (m.type) {
      case 'progress':
        useCompileState.setState({ progress: m.progress });
        break;
      case 'ready':
        useCompileState.setState({ status: 'ready', bootMs: m.ms, progress: null, families: m.families });
        flush();
        break;
      case 'fatal':
        useCompileState.setState({ status: 'error', fatal: m.message });
        break;
      case 'compiled': {
        if (m.id !== inFlight) break;
        inFlight = null;
        const s = useCompileState.getState();
        const input = inFlightInput;
        inFlightInput = null;
        const failed = m.diagnostics.some((d) => d.severity === 'error');
        // 富文本的中间状态不应把底层 Typst 诊断推给用户。失败版本不覆盖上一份
        // 可用预览；公式语法由公式编辑器就地提示，其余情况会在下一次输入时自动重试。
        if (failed) console.warn('[iota4web] 已忽略未能排版的中间版本', m.diagnostics);
        useCompileState.setState({
          compiling: false,
          artifact: m.artifact ? new Uint8Array(m.artifact) : s.artifact,
          artifactFresh: m.artifact ? m.fresh : s.artifactFresh,
          diagnostics: [],
          diagMain: input?.main ?? s.diagMain,
          diagSegments: input?.segments ?? s.diagSegments,
          lastMs: m.ms,
          compileCount: s.compileCount + 1,
          ...(m.glyphs ? { glyphs: new Float64Array(m.glyphs), segments: input?.segments ?? [], mapVersion: input?.version ?? -1 } : {}),
        });
        flush();
        break;
      }
      case 'pdf': {
        pdfWaiters.get(m.id)?.({ pdf: m.pdf, diagnostics: m.diagnostics });
        pdfWaiters.delete(m.id);
        break;
      }
      case 'snippet': {
        snippetWaiters.get(m.id)?.({ artifact: m.artifact, error: m.error });
        snippetWaiters.delete(m.id);
        break;
      }
      case 'fontsSet': {
        const s = useCompileState.getState();
        useCompileState.setState({ fontsVersion: s.fontsVersion + 1, families: m.families });
        fontWaiters.get(m.id)?.({ families: m.families, error: m.error });
        fontWaiters.delete(m.id);
        break;
      }
    }
  };
  worker.onerror = (e) => useCompileState.setState({ status: 'error', fatal: e.message });
  // base：index.html 所在目录，static 部署到子路径也对
  const base = new URL('./', document.baseURI).href;
  send({ type: 'init', baseUrl: base });
}

/** 排队一次编译；正在编译时只保留最新的一份 */
export function requestCompile(input: CompileInput) {
  if (pending) {
    // 合并：图片增删累积，源码取最新
    input = {
      ...input,
      force: input.force || pending.force,
      images: [...pending.images.filter((p) => !input.removeImages.includes(p.name) && !input.images.some((i) => i.name === p.name)), ...input.images],
      removeImages: [...new Set([...pending.removeImages, ...input.removeImages])].filter((name) => !input.images.some((i) => i.name === name)),
    };
  }
  pending = input;
  flush();
}

/** 等到没有排队、没有在编的那一刻——PDF 要的是编辑器里最新的那一版 */
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => { if (inFlight === null && pending === null) resolve(); else setTimeout(check, 100); };
    check();
  });
}

export async function exportPdf(main: string): Promise<{ pdf: ArrayBuffer | null; diagnostics: Diagnostic[] }> {
  await whenIdle();
  return new Promise((resolve) => {
    const id = nextId++;
    pdfWaiters.set(id, resolve);
    send({ type: 'pdf', id, main });
  });
}

/** 增删用户字体。等到引擎就绪、且没有在编的那一刻再换；字节转移过去，调用方不再持有 */
export async function updateUserFonts(add: { id: string; data: ArrayBuffer }[], remove: string[]): Promise<{ families: string[]; error?: string }> {
  await new Promise<void>((resolve) => {
    const check = () => { if (useCompileState.getState().status === 'ready') resolve(); else setTimeout(check, 200); };
    check();
  });
  await whenIdle();
  return new Promise((resolve) => {
    const id = nextId++;
    fontWaiters.set(id, resolve);
    send({ type: 'setFonts', id, add, remove }, add.map((a) => a.data));
  });
}

/** 编一段 Typst 数学：等引擎就绪，不排队（片段很小，插在正文编译之间无妨） */
export function compileSnippet(src: string, display: boolean): Promise<{ artifact: ArrayBuffer | null; error?: string }> {
  return new Promise((resolve) => {
    const go = () => {
      if (useCompileState.getState().status !== 'ready') { setTimeout(go, 300); return; }
      const id = nextId++;
      snippetWaiters.set(id, resolve);
      send({ type: 'snippet', id, src, display });
    };
    go();
  });
}
