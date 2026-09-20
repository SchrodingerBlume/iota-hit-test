// 主线程这一侧：起 worker、排队编译、把状态放进一个 zustand store 给界面用。
import { create } from 'zustand';
import type { ToWorker, FromWorker, Diagnostic, Progress } from './protocol';
import type { Segment } from '../typst/sourcemap';
import { t } from '../i18n';

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
  /** 只编一章的产物（长文档打字时）：顶进整编预览的第 start 页起、顶掉 baseCount 页 */
  focusArtifact: Uint8Array | null;
  focusFresh: boolean;
  focusAt: { start: number; baseCount: number; id: string } | null;
  /** 只编一章那份的字形表（页码是那份产物自己的，0 起）与源码映射；整编一回来就清掉 */
  focusGlyphs: Float64Array | null;
  focusSegments: Segment[];
  focusMapVersion: number;
  /** 预览区重挂后旧的一章产物接不上差分：加一代，让下一次只编一章从头来 */
  focusGen: number;
  /** 排版引擎重启了几次：wasm 里 panic 一次（unreachable）整个实例就废了，只能换一个；字体要重发、下一次整编要 force */
  engineGen: number;
  /** 编译器 wasm 的线性内存（字节），看它离 4 GB 还有多远 */
  wasmMem: number;
  /** 只编一段（打字即时回显）：产物、字形表、这一段在编辑器里的区间（按 version）；整编或只编一章追上来就清 */
  para: { artifact: Uint8Array; glyphs: Float64Array; segments: Segment[]; version: number; key: string; from: number; to: number; ms: number } | null;
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
  focusArtifact: null,
  focusFresh: false,
  focusAt: null,
  focusGlyphs: null,
  focusSegments: [],
  focusMapVersion: -1,
  focusGen: 0,
  para: null,
  engineGen: 0,
  wasmMem: 0,
}));

const TRAPPED = /unreachable|RuntimeError|recursive use of an object|memory access out of bounds/i;
/** wasm 内存过了这条线就预防性重启（一次整编再涨几百 MB，4 GB 是死线） */
const MEM_RESTART = 3600 * 1048576;
/** wasm 陷了（Rust panic → unreachable）：换一个 worker 从头来，字体由 FontRecovery 看着 engineGen 重发 */
export function restartCompiler(reason: string) {
  if (!worker) return;
  console.warn('[iota4web] 排版引擎重启：', reason);
  worker.terminate();
  worker = null;
  inFlight = null; inFlightInput = null; paraInFlight = null; paraPending = null;
  for (const w of pdfWaiters.values()) w({ pdf: null, diagnostics: [{ severity: 'error', message: reason, where: '' }] });
  pdfWaiters.clear();
  for (const w of fontWaiters.values()) w({ families: [], error: reason });
  fontWaiters.clear();
  for (const w of snippetWaiters.values()) w({ artifact: null, error: reason });
  snippetWaiters.clear();
  for (const w of queryWaiters.values()) w({ result: null, error: reason });
  queryWaiters.clear();
  useCompileState.setState((s) => ({ status: 'booting', progress: null, compiling: false, engineGen: s.engineGen + 1, families: [], focusArtifact: null, focusAt: null, focusGlyphs: null, para: null }));
  startCompiler();
}

export interface ParaInput { main: string; inputs?: Record<string, string>; segments: Segment[]; version: number; key: string; from: number; to: number }
let paraInFlight: { id: number; input: ParaInput } | null = null;
let paraPending: ParaInput | null = null;
/** 只编一段：不排在整编的队里，永远只留最新的一份等着 */
export function requestPara(input: ParaInput) {
  paraPending = input;
  flushPara();
}
function flushPara() {
  if (!worker || paraInFlight || !paraPending || useCompileState.getState().status !== 'ready') return;
  const input = paraPending;
  paraPending = null;
  paraInFlight = { id: nextId++, input };
  send({ type: 'para', id: paraInFlight.id, main: input.main, inputs: input.inputs });
}
export function cancelPara() { paraPending = null; }

export interface CompileInput {
  /** 哪个工程的：换了工程之后路上才回来的结果按它丢掉 */
  docId?: string;
  /** 手动刷新时重建完整预览。 */
  force?: boolean;
  /** 是否生成整篇字形映射。长文档仅在预览编辑时需要。 */
  glyphs?: boolean;
  /** 只编当前一章：id 是章的标识，start / baseCount 是它在整编预览里占的页 */
  focus?: { id: string; start: number; baseCount: number };
  /** sys.inputs：断行引擎（linebreaks=…） */
  inputs?: Record<string, string>;
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
let activeDoc = '';

/** 换工程：上一份的产物、字形表、诊断、页数、只编一章的状态一律清掉；排着队的也不发了 */
export function resetForProject(docId: string) {
  activeDoc = docId;
  pending = null;
  useCompileState.setState({
    artifact: null, artifactFresh: false, glyphs: null, segments: [], mapVersion: -1,
    diagnostics: [], diagMain: '', diagSegments: [], lastMs: null, renderMs: null, pageCount: 0,
    focusArtifact: null, focusFresh: false, focusAt: null, focusGlyphs: null, focusSegments: [], focusMapVersion: -1, para: null,
  });
  paraPending = null;
}
let inFlight: number | null = null;
let inFlightInput: CompileInput | null = null;
let pending: CompileInput | null = null;
const pdfWaiters = new Map<number, (r: { pdf: ArrayBuffer | null; diagnostics: Diagnostic[] }) => void>();
const fontWaiters = new Map<number, (r: { families: string[]; error?: string }) => void>();
const snippetWaiters = new Map<number, (r: { artifact: ArrayBuffer | null; error?: string }) => void>();
const queryWaiters = new Map<number, (r: { result: unknown; error?: string }) => void>();

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
  const { segments: _s, version: _v, focus, ...msg } = input;
  send({ type: 'compile', id: inFlight, ...msg, focus: focus?.id }, input.images.map((i) => i.data));
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
        if (TRAPPED.test(m.message)) { restartCompiler(m.message); break; }
        useCompileState.setState({ status: 'error', fatal: m.message });
        break;
      case 'compiled': {
        if (m.id !== inFlight) break;
        inFlight = null;
        const s = useCompileState.getState();
        const input = inFlightInput;
        inFlightInput = null;
        // 换了工程之后才回来的：丢掉，接着发新工程排着的那份
        if (input?.docId && activeDoc && input.docId !== activeDoc) { flush(); break; }
        if (!m.artifact && m.diagnostics.some((d) => TRAPPED.test(d.message))) { restartCompiler(m.diagnostics.find((d) => TRAPPED.test(d.message))!.message); break; }
        // 编不过的版本不覆盖上一份能看的预览，但诊断照给（预览区里人话化、可跳转）
        const focus = input?.focus;
        useCompileState.setState({
          compiling: false,
          ...(focus
            ? (m.artifact ? { focusArtifact: new Uint8Array(m.artifact), focusFresh: m.fresh, focusAt: focus } : {})
            : { artifact: m.artifact ? new Uint8Array(m.artifact) : s.artifact, artifactFresh: m.artifact ? m.fresh : s.artifactFresh, ...(m.artifact ? { focusArtifact: null, focusAt: null, focusGlyphs: null } : {}) }),
          diagnostics: m.diagnostics,
          diagMain: input?.main ?? s.diagMain,
          diagSegments: input?.segments ?? s.diagSegments,
          lastMs: m.ms,
          wasmMem: m.mem ?? s.wasmMem,
          compileCount: s.compileCount + 1,
          ...(m.glyphs
            ? (focus
              ? { focusGlyphs: new Float64Array(m.glyphs), focusSegments: input?.segments ?? [], focusMapVersion: input?.version ?? -1 }
              : { glyphs: new Float64Array(m.glyphs), segments: input?.segments ?? [], mapVersion: input?.version ?? -1 })
            : {}),
          ...(m.glyphs && s.para && (input?.version ?? -1) >= s.para.version ? { para: null } : {}),
        });
        // 线性内存只涨不缩，快顶到 4 GB 时趁没在打字先换个 worker，别等它陷进去
        if ((m.mem ?? 0) > MEM_RESTART && !pending) restartCompiler(t("排版引擎占用 {{v0}} MB 内存，正在重新启动", { v0: Math.round((m.mem ?? 0) / 1048576) }));
        else flush();
        break;
      }
      case 'para-done': {
        if (paraInFlight?.id !== m.id) break;
        const input = paraInFlight.input;
        paraInFlight = null;
        if (m.error && TRAPPED.test(m.error)) { restartCompiler(m.error); break; }
        // 整编 / 只编一章已经追过这一版就不用了
        const s = useCompileState.getState();
        if (m.artifact && m.glyphs && input.version >= Math.max(s.mapVersion, s.focusMapVersion)) {
          useCompileState.setState({ para: { artifact: new Uint8Array(m.artifact), glyphs: new Float64Array(m.glyphs), segments: input.segments, version: input.version, key: input.key, from: input.from, to: input.to, ms: m.ms } });
        }
        flushPara();
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
      case 'query': {
        queryWaiters.get(m.id)?.({ result: m.result, error: m.error });
        queryWaiters.delete(m.id);
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
  worker.onerror = (e) => { if (TRAPPED.test(e.message ?? '')) restartCompiler(e.message); else useCompileState.setState({ status: 'error', fatal: e.message }); };
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

/** 编一份小文档、读它的 metadata（selector 是标签）：导出 Word 时问模板要样式表与版面 */
export function queryTypst(main: string, selector: string): Promise<{ result: unknown; error?: string }> {
  return new Promise((resolve) => {
    const go = () => {
      if (useCompileState.getState().status !== 'ready') { setTimeout(go, 300); return; }
      const id = nextId++;
      queryWaiters.set(id, resolve);
      send({ type: 'query', id, main, selector });
    };
    go();
  });
}

/** 编一段 Typst 数学：等引擎就绪，不排队（片段很小，插在正文编译之间无妨） */
export function compileSnippet(src: string, display: boolean, latex = false): Promise<{ artifact: ArrayBuffer | null; error?: string }> {
  return new Promise((resolve) => {
    const go = () => {
      if (useCompileState.getState().status !== 'ready') { setTimeout(go, 300); return; }
      const id = nextId++;
      snippetWaiters.set(id, resolve);
      send({ type: 'snippet', id, src, display, latex });
    };
    go();
  });
}
