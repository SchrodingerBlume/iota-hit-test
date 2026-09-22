// 编辑区用站内那套开源字体（Noto CJK、FandolKai、TeX Gyre、DejaVu），各台机器上看着一样。
// 字节从排版引擎的 Cache 里取（worker 按 url?v=size 存的），不再下载一次；引擎还没把字体拉完就等它就绪再来
import { useCompileState } from '../compiler/client';

const CACHE = 'iota4web-assets-v1';
const loaded = new Set<string>();
let running: Promise<void> | null = null;

interface Entry { file: string; size: number; lazy: boolean; info?: { info?: { family?: string; variant?: { style?: string; weight?: number } }[] } }

async function load() {
  if (!('caches' in window) || typeof FontFace === 'undefined') return;
  const base = new URL('./', document.baseURI).href;
  const fonts: Entry[] = (await fetch(`${base}fonts/manifest.json`, { cache: 'no-cache' }).then((r) => r.json())).fonts;
  const cache = await caches.open(CACHE);
  await Promise.all(fonts.filter((f) => !f.lazy && !loaded.has(f.file)).map(async (f) => {
    const info = f.info?.info?.[0];
    if (!info?.family) return;
    const res = await cache.match(`${base}fonts/${f.file}?v=${f.size}`);
    if (!res) return;
    const face = new FontFace(info.family, await res.arrayBuffer(), { weight: String(info.variant?.weight ?? 400), style: info.variant?.style === 'normal' || !info.variant?.style ? 'normal' : 'italic' });
    try { await face.load(); document.fonts.add(face); loaded.add(f.file); } catch { /* 坏了就用系统的 */ }
  }));
}

/** 起站时试一次（上回缓存过的马上就有），引擎就绪后再补一次 */
export function startBundledFonts() {
  const go = () => { if (!running) running = load().catch(() => {}).finally(() => { running = null; }); };
  go();
  let was = useCompileState.getState().status;
  useCompileState.subscribe((s) => { if (s.status === 'ready' && was !== 'ready') go(); was = s.status; });
}
