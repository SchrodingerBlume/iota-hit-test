// 公式预览：LaTeX 走 KaTeX（同步、纯前端），Typst 数学交给页面里的 wasm 引擎编一个
// 小片段再画成 SVG（与正文同一套字体，所见即所得）。结果按源码缓存。
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { compileSnippet } from '../../compiler/client';
import { renderSnippetSvg } from '../../compiler/renderer';
import { t as tx } from '../../i18n';

const typstCache = new Map<string, { svg?: string; error?: string }>();
const pending = new Map<string, Promise<{ svg?: string; error?: string }>>();

export function renderTypstMath(src: string, display: boolean): Promise<{ svg?: string; error?: string }> {
  const key = `${display ? 'D' : 'I'}:${src}`;
  const hit = typstCache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    const r = await compileSnippet(src, display, false, !display);
    let out: { svg?: string; error?: string };
    if (!r.artifact) out = { error: r.error ?? tx("编译失败") };
    else {
      try {
        const svg = (await renderSnippetSvg(new Uint8Array(r.artifact))).replace(/<script[\s\S]*?<\/script>/g, '');
        // 片段按 11pt 排，尺寸换成 em：正文多大字，公式就多大字（原来按 px 原样放，比正文小一圈）
        out = { svg: display ? svg.replace(/ width="([\d.]+)" height="([\d.]+)"/, (_, w, h) => ` width="${(+w / 11).toFixed(3)}em" height="${(+h / 11).toFixed(3)}em"`) : alignInline(svg) };
      } catch (e) { out = { error: String((e as Error)?.message ?? e) }; }
    }
    typstCache.set(key, out);
    pending.delete(key);
    return out;
  })();
  pending.set(key, p);
  return p;
}

/** 行内片段：页底往上 2pt 边距 + 24pt 悬空盒（worker 里挂的）就是基线。量出字形真正占的范围裁掉悬空的空白，
 *  再按公式落到基线下面多少给 vertical-align，让公式的基线压在正文基线上 */
const HANG = 24, MARGIN = 2, SIZE = 11;
function alignInline(svg: string): string {
  const m = / width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  if (!m) return svg;
  const W = +m[1], H = +m[2];
  const ink = measureInk(svg, W, H);
  if (!ink) return svg.replace(m[0], ` width="${(W / SIZE).toFixed(3)}em" height="${(H / SIZE).toFixed(3)}em"`);
  const pad = 0.5;
  const x = ink.x - pad, y = ink.y - pad, w = ink.w + pad * 2, h = ink.h + pad * 2;
  const depth = y + h - (H - MARGIN - HANG);
  const va = `vertical-align:${(-depth / SIZE).toFixed(3)}em`;
  const out = svg
    .replace(/ viewBox="[^"]*"/, '')
    .replace(m[0], ` width="${(w / SIZE).toFixed(3)}em" height="${(h / SIZE).toFixed(3)}em" viewBox="${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}"`);
  // typst.ts 给根元素带着 style="overflow: visible"，并进去（两个 style 属性浏览器只认头一个）
  return /<svg[^>]*\sstyle="/.test(out) ? out.replace(/(<svg[^>]*\sstyle=")/, `$1${va};`) : out.replace(/<svg/, `<svg style="${va}"`);
}
/** 把 svg 挂到看不见的地方按 1pt = 1px 量一遍，取有墨的元素（字形、分数线、根号……）的并集，页面那张透明的纸不算 */
function measureInk(svg: string, W: number, H: number): { x: number; y: number; w: number; h: number } | null {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
  host.innerHTML = svg.replace(/ width="[\d.]+" height="[\d.]+"/, ` width="${W}" height="${H}"`);
  document.body.appendChild(host);
  try {
    const root = host.querySelector('svg');
    if (!root) return null;
    const base = root.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of root.querySelectorAll<SVGGraphicsElement>('use, path, line, polyline, polygon, circle, ellipse, rect')) {
      const cs = getComputedStyle(el);
      if ((cs.fill === 'none' || cs.fill === 'transparent') && (cs.stroke === 'none' || cs.stroke === 'transparent')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      x0 = Math.min(x0, r.left - base.left); y0 = Math.min(y0, r.top - base.top); x1 = Math.max(x1, r.right - base.left); y1 = Math.max(y1, r.bottom - base.top);
    }
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  } finally { host.remove(); }
}

export function katexHtml(src: string, display: boolean): { html: string; error?: string } {
  try {
    return { html: katex.renderToString(src, { displayMode: display, throwOnError: true, strict: 'ignore', output: 'html' }) };
  } catch (e) {
    return { html: katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' }), error: String((e as Error)?.message ?? e).replace(/^KaTeX parse error: /, '') };
  }
}

interface Props {
  src: string;
  mode: 'typst' | 'latex';
  display?: boolean;
  /** 出错时把错误交给上层显示 */
  onError?: (msg: string | null) => void;
  className?: string;
  /** 源码为空时显示什么 */
  empty?: ReactElement | string;
}

export function MathPreview({ src, mode, display = false, onError, className, empty }: Props) {
  const trimmed = src.trim();
  const [typst, setTypst] = useState<{ svg?: string; error?: string; key?: string }>({});

  useEffect(() => {
    if (mode !== 'typst' || !trimmed) return;
    let alive = true;
    const t = window.setTimeout(() => {
      void renderTypstMath(trimmed, display).then((r) => { if (alive) { setTypst({ ...r, key: trimmed }); onError?.(r.error ?? null); } });
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [trimmed, mode, display]);

  useEffect(() => {
    if (mode === 'latex') onError?.(trimmed ? katexHtml(trimmed, display).error ?? null : null);
  }, [trimmed, mode, display]);

  // KaTeX 每次几毫秒，父组件重画时别跟着重算
  const katexOut = useMemo(() => (mode === 'latex' && trimmed ? katexHtml(trimmed, display) : null), [mode, trimmed, display]);
  if (!trimmed) return <span className={`math-preview is-empty ${className ?? ''}`}>{empty ?? tx("（空公式）")}</span>;
  if (mode === 'latex' && katexOut) {
    const r = katexOut;
    return <span className={`math-preview katex-host ${r.error ? 'has-error' : ''} ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: r.html }} />;
  }
  const stale = typst.key !== trimmed;
  if (typst.svg) return <span className={`math-preview typst-host ${stale ? 'is-stale' : ''} ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: typst.svg }} />;
  if (typst.error && !stale) return <span className={`math-preview has-error ${className ?? ''}`} title={typst.error}><code>{trimmed}</code></span>;
  return <span className={`math-preview is-loading ${className ?? ''}`}><code>{trimmed}</code></span>;
}
