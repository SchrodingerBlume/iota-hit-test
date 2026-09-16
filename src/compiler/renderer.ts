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

export async function renderArtifact(artifact: Uint8Array, container: HTMLElement, fresh: boolean, hooks: RenderHooks = {}, perRow = 1): Promise<PageInfo[]> {
  await initRenderer();
  if (!renderer || !session) throw new Error('renderer not ready');
  const prev = container.querySelector(':scope > svg.typst-doc') as SVGSVGElement | null;
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
  if (prev && !fresh) patchRoot(prev, next);
  else { container.querySelector(':scope > svg.typst-doc')?.remove(); container.appendChild(next); }
  const pages = session.retrievePagesInfo() as PageInfo[];
  layoutPages(container, pages, perRow);
  hooks.after?.(container, pages);
  return pages;
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
  const NS = 'http://www.w3.org/2000/svg';
  let chrome = container.querySelector(':scope > svg.page-chrome') as SVGSVGElement | null;
  if (!chrome) {
    chrome = document.createElementNS(NS, 'svg');
    chrome.setAttribute('class', 'page-chrome');
    container.insertBefore(chrome, svg);
  }
  chrome.replaceChildren();
  // 每行 perRow 页（Word 的「多页」视图）：一行里按最高的那页定行高
  const cols = Math.max(1, Math.min(3, perRow));
  const size = (i: number) => {
    const g = groups[i];
    return {
      w: pages[i]?.width ?? parseFloat(g.getAttribute('data-page-width') ?? '0'),
      h: pages[i]?.height ?? parseFloat(g.getAttribute('data-page-height') ?? '0'),
    };
  };
  let y = 0;
  let width = 0;
  for (let r = 0; r * cols < groups.length; r++) {
    const rowH = Math.max(...Array.from({ length: Math.min(cols, groups.length - r * cols) }, (_, k) => size(r * cols + k).h));
    let x = 0;
    for (let c = 0; c < cols && r * cols + c < groups.length; c++) {
      const i = r * cols + c;
      const g = groups[i];
      const { w, h } = size(i);
      g.setAttribute('transform', `translate(${x}, ${y})`);
      const sheet = document.createElementNS(NS, 'rect');
      sheet.setAttribute('class', 'page-sheet');
      sheet.setAttribute('x', String(x)); sheet.setAttribute('y', String(y));
      sheet.setAttribute('width', String(w)); sheet.setAttribute('height', String(h));
      sheet.setAttribute('rx', '1.5');
      chrome!.appendChild(sheet);
      if (i < groups.length - 1 || cols > 1) {
        const label = document.createElementNS(NS, 'text');
        label.setAttribute('class', 'page-label');
        label.setAttribute('x', String(x + w - 2));
        label.setAttribute('y', String(y + rowH + PAGE_GAP * 0.62));
        label.setAttribute('text-anchor', 'end');
        label.textContent = `${i + 1} / ${groups.length}`;
        chrome!.appendChild(label);
      }
      x += w + PAGE_GAP;
      width = Math.max(width, x - PAGE_GAP);
    }
    y += rowH + PAGE_GAP;
  }
  const height = Math.max(0, y - PAGE_GAP);
  for (const el of [svg, chrome]) {
    el.setAttribute('viewBox', `0 0 ${width} ${height}`);
    el.setAttribute('width', String(width));
    el.setAttribute('height', String(height));
  }
  svg.setAttribute('data-height', String(height));
}

/** 小片段：产物 → SVG 字符串（临时会话，用完即弃） */
export async function renderSnippetSvg(artifact: Uint8Array): Promise<string> {
  await initRenderer();
  if (!renderer) throw new Error('renderer not ready');
  const svg = await renderer.renderSvg({ artifactContent: artifact, format: 'vector' } as any);
  return svg;
}
