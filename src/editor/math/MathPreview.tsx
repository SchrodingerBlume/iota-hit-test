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
    const r = await compileSnippet(src, display);
    let out: { svg?: string; error?: string };
    if (!r.artifact) out = { error: r.error ?? tx("编译失败") };
    else {
      try {
        const svg = await renderSnippetSvg(new Uint8Array(r.artifact));
        // 片段按 11pt 排，尺寸换成 em：正文多大字，公式就多大字（原来按 px 原样放，比正文小一圈）
        out = { svg: svg.replace(/<script[\s\S]*?<\/script>/g, '').replace(/ width="([\d.]+)" height="([\d.]+)"/, (_, w, h) => ` width="${(+w / 11).toFixed(3)}em" height="${(+h / 11).toFixed(3)}em"`) };
      } catch (e) { out = { error: String((e as Error)?.message ?? e) }; }
    }
    typstCache.set(key, out);
    pending.delete(key);
    return out;
  })();
  pending.set(key, p);
  return p;
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
