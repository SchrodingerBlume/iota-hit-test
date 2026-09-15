// 预览渲染：vector 产物 → SVG，挂进容器。会话常驻，每次只把新产物 reset 进去再重画，
// wasm 那边做 DOM 增量补丁，不整页重建。
import { createTypstRenderer, type TypstRenderer, type RenderSession } from '@myriaddreamin/typst.ts';
import * as rendererWrapper from '@myriaddreamin/typst-ts-renderer';

let renderer: TypstRenderer | null = null;
let session: RenderSession | null = null;
let ready: Promise<void> | null = null;

export function initRenderer(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    // render_svg 画完会去调 window.typstProcessSvg（typst.ts 那套文本选择增强），
    // 没定义就直接 unwrap 崩掉；预览用不上那套，给个空函数
    const w = window as unknown as { typstProcessSvg?: unknown };
    if (typeof w.typstProcessSvg !== 'function') w.typstProcessSvg = () => {};
    renderer = createTypstRenderer();
    await renderer.init({
      getWrapper: async () => rendererWrapper,
      getModule: () => fetch(new URL('../../vendor/typst-ts-renderer/typst_ts_renderer_bg.wasm', import.meta.url)).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
    });
    // 让会话活得比回调长：runWithSession 的 promise 永不 resolve
    await new Promise<void>((resolveOuter) => {
      void renderer!.runWithSession((s) => {
        session = s;
        resolveOuter();
        return new Promise<void>(() => { /* 常驻 */ });
      });
    });
  })();
  return ready;
}

export interface PageInfo { pageOffset: number; width: number; height: number }

export async function renderArtifact(artifact: Uint8Array, container: HTMLElement): Promise<PageInfo[]> {
  await initRenderer();
  if (!renderer || !session) throw new Error('renderer not ready');
  renderer.manipulateData({ renderSession: session, action: 'reset', data: artifact });
  // render_svg 见容器上 data-applied-width 与本次相同就当「已经画过」直接返回——
  // 那是给同一份文档换宽度用的缓存，我们每次都是新文档，先把它摘掉
  container.removeAttribute('data-applied-width');
  await renderer.renderToSvg({ renderSession: session, container });
  const pages = session.retrievePagesInfo();
  decoratePages(container, pages.length);
  return pages;
}

/** 页与页之间留的空当（SVG 单位 = pt） */
const PAGE_GAP = 22;

/**
 * typst.ts 把所有页画进一张 SVG、一页紧贴一页。这里把每页往下错开一个空当，
 * 每页底下垫一张带阴影的白纸，空当里印页码——看着就是一叠纸，不是一条长卷。
 */
function decoratePages(container: HTMLElement, total: number) {
  const svg = container.querySelector('svg.typst-doc') as SVGSVGElement | null;
  if (!svg) return;
  const pages = [...svg.querySelectorAll<SVGGElement>(':scope > g.typst-page')];
  if (!pages.length) return;
  const NS = 'http://www.w3.org/2000/svg';
  let y = 0;
  let width = 0;
  pages.forEach((g, i) => {
    const w = parseFloat(g.getAttribute('data-page-width') ?? '0');
    const h = parseFloat(g.getAttribute('data-page-height') ?? '0');
    width = Math.max(width, w);
    g.setAttribute('transform', `translate(0, ${y})`);
    // 白纸垫在页内容之下
    const sheet = document.createElementNS(NS, 'rect');
    sheet.setAttribute('class', 'page-sheet');
    sheet.setAttribute('x', '0'); sheet.setAttribute('y', '0');
    sheet.setAttribute('width', String(w)); sheet.setAttribute('height', String(h));
    sheet.setAttribute('rx', '1.5');
    g.insertBefore(sheet, g.firstChild);
    // 空当里的页码与一条细线
    if (i < pages.length - 1) {
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('class', 'page-label');
      label.setAttribute('x', String(w - 2));
      label.setAttribute('y', String(y + h + PAGE_GAP * 0.62));
      label.setAttribute('text-anchor', 'end');
      label.textContent = `${i + 1} / ${total}`;
      svg.appendChild(label);
    }
    y += h + PAGE_GAP;
  });
  const height = y - PAGE_GAP;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('data-height', String(height));
}
