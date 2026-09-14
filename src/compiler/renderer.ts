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
  return session.retrievePagesInfo();
}
