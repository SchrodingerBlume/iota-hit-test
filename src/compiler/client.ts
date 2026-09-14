// 主线程这一侧：起 worker、排队编译、把状态放进一个 zustand store 给界面用。
import { create } from 'zustand';
import type { ToWorker, FromWorker, Diagnostic, Progress } from './protocol';

export interface CompileState {
  status: 'booting' | 'ready' | 'error';
  progress: Progress | null;
  fatal: string | null;
  bootMs: number | null;
  compiling: boolean;
  /** 最近一次成功的产物 */
  artifact: Uint8Array | null;
  diagnostics: Diagnostic[];
  lastMs: number | null;
  compileCount: number;
}

export const useCompileState = create<CompileState>(() => ({
  status: 'booting',
  progress: null,
  fatal: null,
  bootMs: null,
  compiling: false,
  artifact: null,
  diagnostics: [],
  lastMs: null,
  compileCount: 0,
}));

export interface CompileInput {
  main: string;
  files: Record<string, string>;
  images: { name: string; data: ArrayBuffer }[];
  removeImages: string[];
}

let worker: Worker | null = null;
let nextId = 1;
let inFlight: number | null = null;
let pending: CompileInput | null = null;
const pdfWaiters = new Map<number, (r: { pdf: ArrayBuffer | null; diagnostics: Diagnostic[] }) => void>();

function send(msg: ToWorker, transfer: Transferable[] = []) {
  worker?.postMessage(msg, transfer);
}

function flush() {
  if (!worker || inFlight !== null || !pending || useCompileState.getState().status !== 'ready') return;
  const input = pending;
  pending = null;
  inFlight = nextId++;
  useCompileState.setState({ compiling: true });
  send({ type: 'compile', id: inFlight, ...input }, input.images.map((i) => i.data));
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
        useCompileState.setState({ status: 'ready', bootMs: m.ms, progress: null });
        flush();
        break;
      case 'fatal':
        useCompileState.setState({ status: 'error', fatal: m.message });
        break;
      case 'compiled': {
        if (m.id !== inFlight) break;
        inFlight = null;
        const s = useCompileState.getState();
        useCompileState.setState({
          compiling: false,
          artifact: m.artifact ? new Uint8Array(m.artifact) : s.artifact,
          diagnostics: m.diagnostics,
          lastMs: m.ms,
          compileCount: s.compileCount + 1,
        });
        flush();
        break;
      }
      case 'pdf': {
        pdfWaiters.get(m.id)?.({ pdf: m.pdf, diagnostics: m.diagnostics });
        pdfWaiters.delete(m.id);
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
      images: [...pending.images.filter((p) => !input.images.some((i) => i.name === p.name)), ...input.images],
      removeImages: [...new Set([...pending.removeImages, ...input.removeImages])],
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

export async function exportPdf(): Promise<{ pdf: ArrayBuffer | null; diagnostics: Diagnostic[] }> {
  await whenIdle();
  return new Promise((resolve) => {
    const id = nextId++;
    pdfWaiters.set(id, resolve);
    send({ type: 'pdf', id });
  });
}
