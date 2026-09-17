// 预览渲染：vector 产物 → SVG，挂进容器。
//
// 会话常驻。worker 每次发来的是与上一版的差（增量服务），这里 merge 进会话，让渲染器
// 只吐出「与 DOM 现状的差」（renderSvgDiff），再用 typst.ts 的补丁算法按 data-tid 复用
// 没变的 <g>——改一个字只动那一页，十几页的文档主线程也就几毫秒，而不是整张 SVG 换 innerHTML。
// 页与页之间的白纸、空当、页码画在另一张 SVG（page-chrome）里，不跟补丁算法抢同一棵树。
import { createTypstRenderer, type TypstRenderer, type RenderSession } from '@myriaddreamin/typst.ts';
import * as rendererWrapper from '@myriaddreamin/typst-ts-renderer';
import { patchRoot } from './svgPatch.mjs';

let renderer: TypstRenderer | null = null;
let session: RenderSession | null = null;
let ready: Promise<void> | null = null;

export function initRenderer(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    // 旧的 render_svg 路径画完会去调 window.typstProcessSvg，没定义就崩；留个空函数保险
    const w = window as unknown as { typstProcessSvg?: unknown };
    if (typeof w.typstProcessSvg !== 'function') w.typstProcessSvg = () => {};
    renderer = createTypstRenderer();
    await renderer.init({
      getWrapper: async () => rendererWrapper,
      getModule: () => fetch(new URL('../../vendor/typst-ts-renderer/typst_ts_renderer_bg.wasm', import.meta.url)).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
    });
    await newSession();
  })();
  return ready;
}

let endSession: (() => void) | null = null;
const layoutCache = new WeakMap<HTMLElement, { signature: string; positions: { x: number; y: number; w: number; h: number; rowH: number }[]; width: number; height: number }>();
/** 会话常驻（runWithSession 的回调不结束）；整份重来时换一个新会话，旧的结束掉 */
function newSession(): Promise<void> {
  endSession?.();
  return new Promise<void>((resolveOuter) => {
    void renderer!.runWithSession((s) => {
      session = s;
      resolveOuter();
      return new Promise<void>((done) => { endSession = done; });
    });
  });
}

export interface PageInfo { pageOffset: number; width: number; height: number }

export interface RenderHooks {
  /** 补丁打进 DOM 之前（记下旧位置，给位移动画用） */
  before?: (container: HTMLElement) => void;
  /** 补丁打完、页也摆好之后 */
  after?: (container: HTMLElement, pages: PageInfo[]) => void;
}

/** 页与页之间留的空当（SVG 单位 = pt） */
export const PAGE_GAP = 22;

/**
 * 补丁打在一张藏着的「母本」SVG 上（display: none，Blink 不给它建版面对象），展示的另一张只放视口附近
 * 几页的克隆，别的页留一个空壳占位。整份 SVG 摆在版面里时（两百页四十万个版面对象）随便动一个字
 * 都要全树重排三百毫秒，页藏起来（display: none 的 <g>）也照样算在树里；把它们整个挪出版面才省得掉。
 * 母本里的字形 <defs> 与 <style> 留在文档里，克隆页的 <use href="#…"> 照样解析得到。
 */
export async function renderArtifact(artifact: Uint8Array, container: HTMLElement, fresh: boolean, hooks: RenderHooks = {}, perRow = 1): Promise<PageInfo[]> {
  await initRenderer();
  if (!renderer || !session) throw new Error('renderer not ready');
  const prev = container.querySelector(':scope > svg.typst-master') as SVGSVGElement | null;
  // 整份重来时换新会话：旧会话记着上次画过什么，renderSvgDiff 只会吐差，页里就没字了
  if (fresh && prev) await newSession();
  // 容器空着却只有增量：上一版在别的容器里画的，会话记的差打不进来（reflexo 的 module 会 unwrap 崩）
  if (!fresh && !prev) throw new Error('need a full artifact');
  renderer.manipulateData({ renderSession: session!, action: fresh ? 'reset' : 'merge', data: artifact });
  const svgStr = renderer.renderSvgDiff({ renderSession: session } as never);
  const holder = document.createElement('div');
  holder.innerHTML = svgStr;
  const next = holder.firstElementChild as SVGSVGElement | null;
  if (!next) throw new Error('renderer returned no svg');
  hooks.before?.(container);
  let master: SVGSVGElement;
  if (prev && !fresh) { patchRoot(prev, next); master = prev; }
  else {
    prev?.remove();
    container.querySelector(':scope > svg.typst-doc')?.remove();
    master = next;
    container.appendChild(master);
  }
  // 补丁会把根上的属性整个换成新的那份，藏起来的记号每次都要补回去
  master.classList.add('typst-master');
  master.classList.remove('typst-doc');
  master.style.display = 'none';
  const pages = session.retrievePagesInfo() as PageInfo[];
  syncView(container, master);
  layoutPages(container, pages, perRow);
  hooks.after?.(container, pages);
  return pages;
}

const NS = 'http://www.w3.org/2000/svg';
const COPY_ATTRS = ['data-tid', 'data-page-width', 'data-page-height'];
/** 展示用的那张 SVG：母本的页一一对应，视口附近的是克隆，其余是空壳 */
function syncView(container: HTMLElement, master: SVGSVGElement) {
  let view = container.querySelector(':scope > svg.typst-doc') as SVGSVGElement | null;
  if (!view) {
    view = document.createElementNS(NS, 'svg') as SVGSVGElement;
    view.setAttribute('class', 'typst-doc');
    for (const a of ['xmlns', 'xmlns:xlink', 'viewBox', 'width', 'height', 'data-width', 'data-height']) { const v = master.getAttribute(a); if (v != null) view.setAttribute(a, v); }
    container.insertBefore(view, master);
  }
  const src = [...master.querySelectorAll<SVGGElement>(':scope > g.typst-page')];
  const cur = [...view.querySelectorAll<SVGGElement>(':scope > g.typst-page')];
  // 多了的页删掉、少了的补空壳；已经克隆出来的页按母本对应页的 data-tid 判要不要重克隆
  for (let i = cur.length - 1; i >= src.length; i--) cur[i].remove();
  for (let i = 0; i < src.length; i++) {
    const m = src[i];
    let g = cur[i];
    if (!g) { g = shell(m); view.appendChild(g); continue; }
    for (const a of COPY_ATTRS) { const v = m.getAttribute(a); if (v == null) g.removeAttribute(a); else if (g.getAttribute(a) !== v) g.setAttribute(a, v); }
    // 页变了（tid 变）且是克隆出来的：换成新克隆
    if (g.getAttribute('data-shown') === '1' && g.getAttribute('data-src-tid') !== m.getAttribute('data-tid')) { const n = clone(m); n.setAttribute('transform', g.getAttribute('transform') ?? ''); view.replaceChild(n, g); }
  }
}
function shell(m: SVGGElement): SVGGElement {
  const g = document.createElementNS(NS, 'g') as SVGGElement;
  g.setAttribute('class', 'typst-page is-virtual');
  for (const a of COPY_ATTRS) { const v = m.getAttribute(a); if (v != null) g.setAttribute(a, v); }
  return g;
}
function clone(m: SVGGElement): SVGGElement {
  const g = m.cloneNode(true) as SVGGElement;
  g.setAttribute('data-shown', '1');
  g.setAttribute('data-src-tid', m.getAttribute('data-tid') ?? '');
  g.classList.remove('is-virtual');
  return g;
}

/** 哪些页要真画出来：视口附近的克隆母本，离开的换回空壳。返回有没有动过 */
export function showPages(container: HTMLElement, visible: (i: number, y: number, h: number) => boolean): boolean {
  const master = container.querySelector(':scope > svg.typst-master') as SVGSVGElement | null;
  const view = container.querySelector(':scope > svg.typst-doc') as SVGSVGElement | null;
  if (!master || !view) return false;
  const src = [...master.querySelectorAll<SVGGElement>(':scope > g.typst-page')];
  const cur = [...view.querySelectorAll<SVGGElement>(':scope > g.typst-page')];
  const chrome = container.querySelectorAll<SVGGElement>(':scope > svg.page-chrome > g.page-chrome-page');
  let changed = false;
  for (let i = 0; i < cur.length && i < src.length; i++) {
    const g = cur[i];
    const y = parseFloat(g.getAttribute('data-layout-y') ?? '0');
    const h = parseFloat(g.getAttribute('data-page-height') ?? '0');
    const want = visible(i, y, h);
    const shown = g.getAttribute('data-shown') === '1';
    if (want === shown) continue;
    const n = want ? clone(src[i]) : shell(src[i]);
    for (const a of ['transform', 'data-layout-x', 'data-layout-y']) { const v = g.getAttribute(a); if (v != null) n.setAttribute(a, v); }
    view.replaceChild(n, g);
    changed = true;
    chrome[i]?.classList.toggle('is-virtual', !want);
  }
  return changed;
}

/**
 * typst.ts 把所有页画进一张 SVG、一页紧贴一页。这里把每页往下错开一个空当，
 * 底下另一张 SVG 给每页垫一张带阴影的白纸、空当里印页码——看着就是一叠纸，不是一条长卷。
 */
/** 只重新摆页（每行几页变了），不重画字形 */
export function relayoutPages(container: HTMLElement, perRow = 1) {
  layoutPages(container, [], perRow);
}

function layoutPages(container: HTMLElement, pages: PageInfo[], perRow = 1) {
  const svg = container.querySelector(':scope > svg.typst-doc') as SVGSVGElement | null;
  if (!svg) return;
  const groups = [...svg.querySelectorAll<SVGGElement>(':scope > g.typst-page')];
  let chrome = container.querySelector(':scope > svg.page-chrome') as SVGSVGElement | null;
  if (!chrome) {
    chrome = document.createElementNS(NS, 'svg');
    chrome.setAttribute('class', 'page-chrome');
    container.insertBefore(chrome, svg);
  }
  // 每行 perRow 页（Word 的「多页」视图）：一行里按最高的那页定行高
  const cols = Math.max(1, Math.min(3, perRow));
  const size = (i: number) => {
    const g = groups[i];
    return {
      w: pages[i]?.width ?? parseFloat(g.getAttribute('data-page-width') ?? '0'),
      h: pages[i]?.height ?? parseFloat(g.getAttribute('data-page-height') ?? '0'),
    };
  };
  const signature = `${cols}|${groups.map((_, i) => { const s = size(i); return `${s.w}x${s.h}`; }).join(',')}`;
  let cached = layoutCache.get(container);
  if (!cached || cached.signature !== signature) {
    let y = 0;
    let width = 0;
    const positions: { x: number; y: number; w: number; h: number; rowH: number }[] = [];
    for (let r = 0; r * cols < groups.length; r++) {
      const rowH = Math.max(...Array.from({ length: Math.min(cols, groups.length - r * cols) }, (_, k) => size(r * cols + k).h));
      let x = 0;
      for (let c = 0; c < cols && r * cols + c < groups.length; c++) {
        const i = r * cols + c;
        const { w, h } = size(i);
        positions[i] = { x, y, w, h, rowH };
        x += w + PAGE_GAP;
        width = Math.max(width, x - PAGE_GAP);
      }
      y += rowH + PAGE_GAP;
    }
    cached = { signature, positions, width, height: Math.max(0, y - PAGE_GAP) };
    layoutCache.set(container, cached);
    // 页数和纸张尺寸没变时沿用纸张层，避免一次输入就重建数百个 SVG 节点。
    chrome.replaceChildren();
    for (let i = 0; i < cached.positions.length; i++) {
      const { x, y: py, w, h, rowH } = cached.positions[i];
      const pageChrome = document.createElementNS(NS, 'g');
      pageChrome.setAttribute('class', 'page-chrome-page');
      pageChrome.setAttribute('data-page-index', String(i));
      pageChrome.setAttribute('data-layout-y', String(py));
      pageChrome.setAttribute('data-page-height', String(h));
      const sheet = document.createElementNS(NS, 'rect');
      sheet.setAttribute('class', 'page-sheet');
      sheet.setAttribute('x', String(x)); sheet.setAttribute('y', String(py));
      sheet.setAttribute('width', String(w)); sheet.setAttribute('height', String(h));
      sheet.setAttribute('rx', '1.5');
      pageChrome.appendChild(sheet);
      if (i < groups.length - 1 || cols > 1) {
        const label = document.createElementNS(NS, 'text');
        label.setAttribute('class', 'page-label');
        label.setAttribute('x', String(x + w - 2));
        label.setAttribute('y', String(py + rowH + PAGE_GAP * 0.62));
        label.setAttribute('text-anchor', 'end');
        label.textContent = `${i + 1} / ${groups.length}`;
        pageChrome.appendChild(label);
      }
      chrome!.appendChild(pageChrome);
    }
  }
  // SVG 补丁会还原页组自身的 transform，因此每次只恢复轻量的位置信息。
  groups.forEach((g, i) => {
    const p = cached!.positions[i];
    if (!p) return;
    g.setAttribute('transform', `translate(${p.x}, ${p.y})`);
    g.setAttribute('data-layout-x', String(p.x));
    g.setAttribute('data-layout-y', String(p.y));
  });
  for (const el of [svg, chrome]) {
    el.setAttribute('viewBox', `0 0 ${cached.width} ${cached.height}`);
    el.setAttribute('width', String(cached.width));
    el.setAttribute('height', String(cached.height));
  }
  svg.setAttribute('data-height', String(cached.height));
}

/** 小片段：产物 → SVG 字符串（临时会话，用完即弃） */
export async function renderSnippetSvg(artifact: Uint8Array): Promise<string> {
  await initRenderer();
  if (!renderer) throw new Error('renderer not ready');
  const svg = await renderer.renderSvg({ artifactContent: artifact, format: 'vector' } as any);
  return svg;
}
