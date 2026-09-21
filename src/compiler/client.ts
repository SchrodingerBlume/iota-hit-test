// 主线程这一侧：起 worker、排队编译、把状态放进一个 zustand store 给界面用。
//
// 长文档两条道：前台 worker（fg）只管打字时那几样短活——只编一段、只编一章、公式片段、问模板；后台 worker（bg）
// 专管整编（几百页的增量整编要几秒到十几秒，与 Word 的后台分页一个意思）。整编不再排在打字的前面，
// 击键到预览永远只等章级 / 段级那一份。页数不到 LONG_DOC 的文档只有 fg 一条道。
import { create } from 'zustand';
import type { ToWorker, FromWorker, Diagnostic, Progress } from './protocol';
import type { Segment } from '../typst/sourcemap';
import { t } from '../i18n';

export interface CompileState {
  status: 'booting' | 'ready' | 'error';
  progress: Progress | null;
  fatal: string | null;
  bootMs: number | null;
  /** 前台那条道在编（预览马上要换）；后台那条道在整编（全文在后台重排，预览照旧能用） */
  compiling: boolean;
  bgCompiling: boolean;
  /** 后台整编的那条道有没有起来（起来之后整编都走它，打字不再等整编） */
  bgReady: boolean;
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
  /** 只编一章的产物（长文档打字时）：顶进整编预览的第 start 页起、顶掉 baseCount 页；chapter 是第几章，整编换了版之后按它重算落点 */
  focusArtifact: Uint8Array | null;
  focusFresh: boolean;
  focusAt: { start: number; baseCount: number; id: string; chapter: number } | null;
  /** 只编一章那份的字形表（页码是那份产物自己的，0 起）与源码映射；比它新的整编一回来就清掉 */
  focusGlyphs: Float64Array | null;
  focusSegments: Segment[];
  focusMapVersion: number;
  /** 预览区重挂后旧的一章产物接不上差分：加一代，让下一次只编一章从头来 */
  focusGen: number;
  /** 排版引擎重启了几次：wasm 里 panic 一次（unreachable）整个实例就废了，只能换一个；下一次整编要 force、图要重发 */
  engineGen: number;
  /** 哪条道起了新 worker 就加一：用户字体要重发给它（FontRecovery 看这个） */
  lanesGen: number;
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
  bgCompiling: false,
  bgReady: false,
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
  lanesGen: 0,
  wasmMem: 0,
}));

/** 页数到了这个数才算长文档：打字只编一章、整编搬到后台那条道 */
export const LONG_DOC = 40;
const TRAPPED = /unreachable|RuntimeError|recursive use of an object|memory access out of bounds/i;
/** wasm 内存过了这条线就预防性重启（一次整编再涨几百 MB，4 GB 是死线） */
const MEM_RESTART = 3600 * 1048576;

export interface ParaInput { main: string; inputs?: Record<string, string>; segments: Segment[]; version: number; key: string; from: number; to: number }
export interface CompileInput {
  /** 哪个工程的：换了工程之后路上才回来的结果按它丢掉 */
  docId?: string;
  /** 手动刷新时重建完整预览。 */
  force?: boolean;
  /** 是否生成整篇字形映射。长文档仅在预览编辑时需要。 */
  glyphs?: boolean;
  /** 只编当前一章：id 是章的标识，chapter 第几章，start / baseCount 是它在整编预览里占的页（落地时按当时的整编再算一遍） */
  focus?: { id: string; chapter: number; start: number; baseCount: number };
  /** sys.inputs：断行引擎（linebreaks=…） */
  inputs?: Record<string, string>;
  main: string;
  files: Record<string, string>;
  images: { name: string; data: ArrayBuffer }[];
  removeImages: string[];
  /** 源码映射与它对应的文档版本 */
  segments?: Segment[];
  version?: number;
  /** 只为暖缓存（后台那条道刚起来时把上一次整编再编一遍），结果不上屏 */
  warm?: boolean;
}
/** 只编一章落地时算它顶在整编的哪几页：App 装上（要读正文与字形表） */
export let placeFocus: ((chapter: number) => { start: number; baseCount: number } | null) | null = null;
export function setFocusPlacer(f: typeof placeFocus) { placeFocus = f; }

let nextId = 1;
let activeDoc = '';
/** 最近一次整编的输入：后台那条道起来时先拿它暖一遍（冷的第一次整编几百页要几十秒，与前台那次并行着做） */
let lastFull: CompileInput | null = null;
/** 渲染端眼下那份整编是哪一版：后台那条道暖身编的正是这一版的话，它的第一份差分接得上，不必整份重画（几百页重画主线程要卡两秒） */
let appliedFullVersion = -1;
/** main.typ 到了这么长（约六十页）就先把后台那条道起了，不等第一次整编数出页数 */
const LONG_MAIN = 120_000;
/** 图片字节留一份：起后台那条道、或哪条道重启时照样能补齐（发给 worker 的是拷贝） */
const imageStore = new Map<string, ArrayBuffer>();

/** 一条道 = 一个 worker：自己的编译队列、自己映射过的图、自己的等待者 */
class Lane {
  worker: Worker | null = null;
  ready = false;
  inFlight: number | null = null;
  inFlightInput: CompileInput | null = null;
  pending: CompileInput | null = null;
  paraInFlight: { id: number; input: ParaInput } | null = null;
  paraPending: ParaInput | null = null;
  images = new Set<string>();
  /** 后台那条道的差分基线立了没有：暖身那一遍不算，第一次真整编要 force 一次让渲染端从整份起 */
  baselined = false;
  warmed = false;
  /** 暖身编的是哪一版 */
  warmVersion = -2;
  pdfWaiters = new Map<number, (r: { pdf: ArrayBuffer | null; diagnostics: Diagnostic[] }) => void>();
  fontWaiters = new Map<number, (r: { families: string[]; error?: string }) => void>();
  snippetWaiters = new Map<number, (r: { artifact: ArrayBuffer | null; error?: string }) => void>();
  queryWaiters = new Map<number, (r: { result: unknown; error?: string }) => void>();
  constructor(public name: 'fg' | 'bg') {}
  send(msg: ToWorker, transfer: Transferable[] = []) { this.worker?.postMessage(msg, transfer); }
  get busy() { return this.inFlight !== null || this.pending !== null; }
  start() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => onMessage(this, ev.data);
    this.worker.onerror = (e) => { if (TRAPPED.test(e.message ?? '')) restartLane(this, e.message); else if (this.name === 'fg') useCompileState.setState({ status: 'error', fatal: e.message }); };
    // base：index.html 所在目录，static 部署到子路径也对
    this.send({ type: 'init', baseUrl: new URL('./', document.baseURI).href });
  }
  fail(reason: string) {
    for (const w of this.pdfWaiters.values()) w({ pdf: null, diagnostics: [{ severity: 'error', message: reason, where: '' }] });
    for (const w of this.fontWaiters.values()) w({ families: [], error: reason });
    for (const w of this.snippetWaiters.values()) w({ artifact: null, error: reason });
    for (const w of this.queryWaiters.values()) w({ result: null, error: reason });
    this.pdfWaiters.clear(); this.fontWaiters.clear(); this.snippetWaiters.clear(); this.queryWaiters.clear();
  }
  /** 发一次编译：图按这条道缺什么补什么 */
  flush() {
    if (!this.worker || !this.ready || this.inFlight !== null || !this.pending) return;
    const input = this.pending;
    this.pending = null;
    this.inFlight = nextId++;
    this.inFlightInput = input;
    useCompileState.setState(compiling());
    const { segments: _s, version: _v, focus, images: _i, removeImages: _r, warm: _w, ...msg } = input;
    if (this.name === 'bg' && input.warm) this.warmVersion = input.version ?? -2;
    if (this.name === 'bg' && !input.warm && !this.baselined) { if (this.warmVersion !== appliedFullVersion) msg.force = true; this.baselined = true; }
    const images: { name: string; data: ArrayBuffer }[] = [];
    for (const [name, data] of imageStore) if (!this.images.has(name)) { images.push({ name, data: data.slice(0) }); this.images.add(name); }
    const removeImages = [...this.images].filter((n) => !imageStore.has(n));
    for (const n of removeImages) this.images.delete(n);
    this.send({ type: 'compile', id: this.inFlight, ...msg, focus: focus?.id, images, removeImages }, images.map((i) => i.data));
  }
  flushPara() {
    if (!this.worker || !this.ready || this.paraInFlight || !this.paraPending) return;
    const input = this.paraPending;
    this.paraPending = null;
    this.paraInFlight = { id: nextId++, input };
    this.send({ type: 'para', id: this.paraInFlight.id, main: input.main, inputs: input.inputs });
  }
}
const fg = new Lane('fg');
const bg = new Lane('bg');
const lanes = () => [fg, bg].filter((l) => l.worker);
const compiling = () => ({ compiling: fg.inFlight !== null, bgCompiling: bg.inFlight !== null });

/** 后台那条道起来后先拿上一次整编暖一遍缓存（几百页冷编要几十秒），但等前台那次整编落地再暖——两边同时冷编会互相拖慢 */
function warmBg() {
  if (!bg.ready || bg.warmed || bg.baselined || bg.pending || bg.inFlight !== null || !lastFull || fg.inFlight !== null) return;
  bg.warmed = true;
  bg.pending = { ...lastFull, warm: true };
  bg.flush();
}
/** 整编走哪条道：后台那条起来了就走它；只编一章、只编一段永远在前台 */
const laneFor = (input: CompileInput) => (input.focus || !bg.ready ? fg : bg);

/** wasm 陷了（Rust panic → unreachable）或内存快满：换一个 worker 从头来。前台那条重启算引擎重启（整编要 force），
 *  后台那条悄悄换 */
function restartLane(lane: Lane, reason: string) {
  if (!lane.worker) return;
  console.warn(`[iota4web] 排版引擎（${lane.name}）重启：`, reason);
  lane.worker.terminate();
  lane.worker = null;
  lane.ready = false;
  lane.inFlight = null; lane.inFlightInput = null; lane.paraInFlight = null; lane.paraPending = null;
  lane.images.clear();
  lane.baselined = false;
  lane.warmed = false;
  lane.fail(reason);
  if (lane.name === 'fg') {
    useCompileState.setState((s) => ({ status: 'booting', progress: null, ...compiling(), engineGen: s.engineGen + 1, families: [], focusArtifact: null, focusAt: null, focusGlyphs: null, para: null }));
  } else {
    useCompileState.setState({ bgReady: false, ...compiling() });
  }
  lane.start();
}
export function restartCompiler(reason: string) { restartLane(fg, reason); }

/** 只编一段：不排在整编的队里，永远只留最新的一份等着 */
export function requestPara(input: ParaInput) {
  fg.paraPending = input;
  fg.flushPara();
}
export function cancelPara() { fg.paraPending = null; }

/** 换工程：上一份的产物、字形表、诊断、页数、只编一章的状态一律清掉；排着队的也不发了 */
export function resetForProject(docId: string) {
  activeDoc = docId;
  fg.pending = null; bg.pending = null;
  useCompileState.setState({
    artifact: null, artifactFresh: false, glyphs: null, segments: [], mapVersion: -1,
    diagnostics: [], diagMain: '', diagSegments: [], lastMs: null, renderMs: null, pageCount: 0,
    focusArtifact: null, focusFresh: false, focusAt: null, focusGlyphs: null, focusSegments: [], focusMapVersion: -1, para: null,
  });
  fg.paraPending = null;
}

function onMessage(lane: Lane, m: FromWorker) {
  switch (m.type) {
    case 'progress':
      if (lane.name === 'fg') useCompileState.setState({ progress: m.progress });
      break;
    case 'ready':
      lane.ready = true;
      if (lane.name === 'fg') useCompileState.setState({ status: 'ready', bootMs: m.ms, progress: null, families: m.families });
      else useCompileState.setState({ bgReady: true });
      useCompileState.setState((s) => ({ lanesGen: s.lanesGen + 1 }));
      warmBg();
      lane.flush();
      lane.flushPara();
      break;
    case 'fatal':
      if (TRAPPED.test(m.message)) { restartLane(lane, m.message); break; }
      if (lane.name === 'fg') useCompileState.setState({ status: 'error', fatal: m.message });
      break;
    case 'compiled': {
      if (m.id !== lane.inFlight) break;
      lane.inFlight = null;
      const s = useCompileState.getState();
      const input = lane.inFlightInput;
      lane.inFlightInput = null;
      // 换了工程之后才回来的：丢掉，接着发新工程排着的那份
      if (input?.docId && activeDoc && input.docId !== activeDoc) { lane.flush(); break; }
      if (!m.artifact && m.diagnostics.some((d) => TRAPPED.test(d.message))) { restartLane(lane, m.diagnostics.find((d) => TRAPPED.test(d.message))!.message); break; }
      // 暖身那一遍：缓存热了就行，产物不上屏
      if (input?.warm) { useCompileState.setState(compiling()); lane.flush(); break; }
      const focus = input?.focus;
      const version = input?.version ?? -1;
      if (!focus && m.artifact) appliedFullVersion = version;
      // 只编一章的产物顶在整编的哪几页：按眼下这份整编算（发出去之后整编可能换过版、章的起始页挪了）
      const at = focus ? { ...(placeFocus?.(focus.chapter) ?? { start: focus.start, baseCount: focus.baseCount }), id: focus.id, chapter: focus.chapter } : null;
      // 整编回来时手里的那章产物比它还新（用户接着敲了字）：留着，预览层按新整编重新顶进去
      const keepFocus = !focus && !!m.artifact && !!s.focusArtifact && s.focusMapVersion > version;
      useCompileState.setState({
        ...compiling(),
        ...(focus
          ? (m.artifact ? { focusArtifact: new Uint8Array(m.artifact), focusFresh: m.fresh, focusAt: at } : {})
          : { artifact: m.artifact ? new Uint8Array(m.artifact) : s.artifact, artifactFresh: m.artifact ? m.fresh : s.artifactFresh, ...(m.artifact && !keepFocus ? { focusArtifact: null, focusAt: null, focusGlyphs: null } : {}) }),
        diagnostics: m.diagnostics,
        diagMain: input?.main ?? s.diagMain,
        diagSegments: input?.segments ?? s.diagSegments,
        lastMs: m.ms,
        wasmMem: m.mem ?? s.wasmMem,
        compileCount: s.compileCount + 1,
        ...(m.glyphs
          ? (focus
            ? { focusGlyphs: new Float64Array(m.glyphs), focusSegments: input?.segments ?? [], focusMapVersion: version }
            : { glyphs: new Float64Array(m.glyphs), segments: input?.segments ?? [], mapVersion: version })
          : {}),
        ...(m.glyphs && s.para && version >= s.para.version ? { para: null } : {}),
      });
      // 线性内存只涨不缩，快顶到 4 GB 时趁没在打字先换个 worker，别等它陷进去
      if ((m.mem ?? 0) > MEM_RESTART && !lane.pending) restartLane(lane, t("排版引擎占用 {{v0}} MB 内存，正在重新启动", { v0: Math.round((m.mem ?? 0) / 1048576) }));
      else lane.flush();
      if (lane === fg && !focus) warmBg();
      break;
    }
    case 'para-done': {
      if (lane.paraInFlight?.id !== m.id) break;
      const input = lane.paraInFlight.input;
      lane.paraInFlight = null;
      if (m.error && TRAPPED.test(m.error)) { restartLane(lane, m.error); break; }
      // 整编 / 只编一章已经追过这一版就不用了
      const s = useCompileState.getState();
      if (m.artifact && m.glyphs && input.version >= Math.max(s.mapVersion, s.focusMapVersion)) {
        useCompileState.setState({ para: { artifact: new Uint8Array(m.artifact), glyphs: new Float64Array(m.glyphs), segments: input.segments, version: input.version, key: input.key, from: input.from, to: input.to, ms: m.ms } });
      }
      lane.flushPara();
      break;
    }
    case 'pdf': {
      lane.pdfWaiters.get(m.id)?.({ pdf: m.pdf, diagnostics: m.diagnostics });
      lane.pdfWaiters.delete(m.id);
      break;
    }
    case 'snippet': {
      lane.snippetWaiters.get(m.id)?.({ artifact: m.artifact, error: m.error });
      lane.snippetWaiters.delete(m.id);
      break;
    }
    case 'query': {
      lane.queryWaiters.get(m.id)?.({ result: m.result, error: m.error });
      lane.queryWaiters.delete(m.id);
      break;
    }
    case 'fontsSet': {
      if (lane.name === 'fg') { const s = useCompileState.getState(); useCompileState.setState({ fontsVersion: s.fontsVersion + 1, families: m.families }); }
      lane.fontWaiters.get(m.id)?.({ families: m.families, error: m.error });
      lane.fontWaiters.delete(m.id);
      break;
    }
  }
}

export function startCompiler() { fg.start(); }

/** 排队一次编译；正在编译时只保留最新的一份。整编走后台那条道（起来了的话），只编一章走前台 */
export function requestCompile(input: CompileInput) {
  for (const i of input.images) imageStore.set(i.name, i.data);
  for (const n of input.removeImages) imageStore.delete(n);
  if (!input.focus) lastFull = input;
  // 长文档：后台那条道还没起就起——页数数出来了按页数，还没数出来按 main.typ 的长短
  if (!input.focus && !bg.worker && (useCompileState.getState().pageCount >= LONG_DOC || input.main.length >= LONG_MAIN)) bg.start();
  const lane = laneFor(input);
  if (lane.pending) input = { ...input, force: input.force || lane.pending.force };
  lane.pending = input;
  // 换道了（后台刚起来）：前台队里的整编不必再发
  if (lane === bg && fg.pending && !fg.pending.focus) fg.pending = null;
  lane.flush();
}

/** 等到这条道没有排队、没有在编的那一刻——PDF 要的是编辑器里最新的那一版 */
function whenIdle(lane: Lane): Promise<void> {
  return new Promise((resolve) => {
    const check = () => { if (!lane.busy) resolve(); else setTimeout(check, 100); };
    check();
  });
}

export async function exportPdf(main: string): Promise<{ pdf: ArrayBuffer | null; diagnostics: Diagnostic[] }> {
  // 后台那条道有整编的热缓存，长文档的 PDF 在它上面编快得多，也不占前台
  const lane = bg.ready ? bg : fg;
  await whenIdle(lane);
  return new Promise((resolve) => {
    const id = nextId++;
    lane.pdfWaiters.set(id, resolve);
    lane.send({ type: 'pdf', id, main });
  });
}

/** 增删用户字体：两条道都要换；等到就绪、且没有在编的那一刻再换，字节各发一份拷贝 */
export async function updateUserFonts(add: { id: string; data: ArrayBuffer }[], remove: string[]): Promise<{ families: string[]; error?: string }> {
  await new Promise<void>((resolve) => {
    const check = () => { if (useCompileState.getState().status === 'ready') resolve(); else setTimeout(check, 200); };
    check();
  });
  const targets = lanes().filter((l) => l.ready);
  const results = await Promise.all(targets.map(async (lane) => {
    await whenIdle(lane);
    return new Promise<{ families: string[]; error?: string }>((resolve) => {
      const id = nextId++;
      lane.fontWaiters.set(id, resolve);
      const copies = add.map((a) => ({ id: a.id, data: a.data.slice(0) }));
      lane.send({ type: 'setFonts', id, add: copies, remove }, copies.map((a) => a.data));
    });
  }));
  return results.find((r) => r.error) ?? results[0] ?? { families: [] };
}

/** 编一份小文档、读它的 metadata（selector 是标签）：导出 Word 时问模板要样式表与版面 */
export function queryTypst(main: string, selector: string): Promise<{ result: unknown; error?: string }> {
  return new Promise((resolve) => {
    const go = () => {
      if (!fg.ready) { setTimeout(go, 300); return; }
      const id = nextId++;
      fg.queryWaiters.set(id, resolve);
      fg.send({ type: 'query', id, main, selector });
    };
    go();
  });
}

/** 编一段 Typst 数学：等引擎就绪，不排队（片段很小，插在正文编译之间无妨） */
export function compileSnippet(src: string, display: boolean, latex = false): Promise<{ artifact: ArrayBuffer | null; error?: string }> {
  return new Promise((resolve) => {
    const go = () => {
      if (!fg.ready) { setTimeout(go, 300); return; }
      const id = nextId++;
      fg.snippetWaiters.set(id, resolve);
      fg.send({ type: 'snippet', id, src, display, latex });
    };
    go();
  });
}
