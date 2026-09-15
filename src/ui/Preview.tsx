import { useEffect, useRef, useState } from 'react';
import { useCompileState } from '../compiler/client';
import { renderArtifact } from '../compiler/renderer';
import { Eye, ZoomIn, ZoomOut, Maximize2, Loader2 } from 'lucide-react';
import { jumpToPreviewText } from './jump';

const fmtMB = (n: number) => (n / 1024 / 1024).toFixed(1);

export function Preview() {
  const { status, progress, fatal, compiling, artifact, diagnostics, lastMs, compileCount } = useCompileState();
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);

  /** 缩放并让光标底下那一点不动（cy 是相对滚动容器顶部的像素） */
  const zoomAt = (next: number, cy?: number) => {
    const el = scrollRef.current;
    const z = Math.min(3, Math.max(0.3, +next.toFixed(3)));
    if (el && cy !== undefined) {
      const pad = 18; // .preview-scroll 的上内边距
      const docY = (el.scrollTop + cy - pad) / zoomRef.current;
      zoomRef.current = z;
      setZoom(z);
      // 宽度改了之后 SVG 才重排，滚动位置要等下一帧再定
      requestAnimationFrame(() => { el.scrollTop = docY * z - (cy - pad); });
    } else {
      zoomRef.current = z;
      setZoom(z);
    }
  };

  // 触控板捏合：macOS/Windows 的浏览器把它发成 ctrlKey 的 wheel；Safari 另有 gesture 事件
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let idle: number | undefined;
    const mark = () => { el.classList.add('is-zooming'); window.clearTimeout(idle); idle = window.setTimeout(() => el.classList.remove('is-zooming'), 160); };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      mark();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
      zoomAt(zoomRef.current * factor, e.clientY - el.getBoundingClientRect().top);
    };
    let gestureBase = 1;
    const onGestureStart = (e: Event) => { e.preventDefault(); gestureBase = zoomRef.current; };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      mark();
      const g = e as Event & { scale: number; clientY: number };
      zoomAt(gestureBase * g.scale, g.clientY - el.getBoundingClientRect().top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart as EventListener, { passive: false });
    el.addEventListener('gesturechange', onGestureChange as EventListener, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!artifact || !containerRef.current) return;
    let alive = true;
    renderArtifact(artifact, containerRef.current)
      .then((info) => { if (alive) { setPages(info.length); setRenderError(null); } })
      .catch((e) => { if (alive) setRenderError(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [artifact, compileCount]);

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity !== 'error');
  // 探针那几条「unknown font family」是模板故意问的（windows 档才有的字），不值得吵
  const shown = [...errors, ...warnings.filter((w) => !/unknown font family: (kaiti_gb2312|lisu|stxinwei|simsun|simhei|kaiti|fangsong)/i.test(w.message))];

  return (
    <div className={`preview ${compiling ? 'is-compiling' : ''}`}>
      <div className="pane-bar">
        <span className="pane-title"><Eye />预览</span>
        {status === 'ready' && lastMs !== null && <span className="muted">{pages} 页 · {lastMs} ms{compiling ? ' · 排版中…' : ''}</span>}
        {status === 'ready' && errors.length > 0 && <span className="err-badge" title="下面列了出错的位置">{errors.length} 个错误</span>}
        <span className="spacer" />
        <span className="join">
          <button type="button" className="btn btn-xs btn-icon" title="缩小（触控板捏合、⌘/Ctrl + 滚轮也行）" onClick={() => zoomAt(zoomRef.current - 0.1)}><ZoomOut /></button>
          <button type="button" className="btn btn-xs" style={{ width: 52, justifyContent: 'center' }} title="回到 100%" onClick={() => zoomAt(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="btn btn-xs btn-icon" title="放大（触控板捏合、⌘/Ctrl + 滚轮也行）" onClick={() => zoomAt(zoomRef.current + 0.1)}><ZoomIn /></button>
          <button type="button" className="btn btn-xs btn-icon" title="适宽" onClick={() => zoomAt(1)}><Maximize2 /></button>
        </span>
      </div>
      <div className="preview-progress" aria-hidden />
      <div className="preview-scroll" ref={scrollRef}>
        {status === 'booting' && (
          <div className="boot">
            <h3><Loader2 />正在准备排版引擎</h3>
            <div className="muted">Typst 0.15.1 编译器（wasm）、Noto CJK 等开源字体与 iota-hit 模板包，共约 120 MB。只下载这一次，之后存在浏览器里离线可用。</div>
            <div className="bar"><i style={{ width: progress && progress.total ? `${Math.min(100, (progress.loaded / progress.total) * 100)}%` : '2%' }} /></div>
            <div className="detail">{progress ? `${progress.phase} · ${fmtMB(progress.loaded)} / ${fmtMB(progress.total)} MB${progress.detail ? ' · ' + progress.detail : ''}` : '…'}</div>
          </div>
        )}
        {status === 'error' && (
          <div className="boot">
            <h3>排版引擎启动失败</h3>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{fatal}</pre>
            <div className="muted">刷新重试；若反复失败，检查浏览器是否支持 WebAssembly 与 Web Worker，或存储配额是否被占满。</div>
          </div>
        )}
        {status === 'ready' && shown.length > 0 && (
          <div className={`diag ${errors.length ? 'err' : ''}`} style={{ marginBottom: 12, borderRadius: 8, border: '1px solid' }}>
            <ul>
              {shown.slice(0, 30).map((d, i) => (
                <li key={i}><span className={`sev ${d.severity}`}>{d.severity === 'error' ? '错误' : '警告'}</span><span className="where">{d.where}</span><span>{d.message}</span></li>
              ))}
            </ul>
          </div>
        )}
        {renderError && <div className="diag err" style={{ marginBottom: 12, padding: 8 }}>渲染失败：{renderError}</div>}
        {status === 'ready' && !artifact && !compiling && !errors.length && <div className="preview-empty">还没有内容</div>}
        <div ref={containerRef} className="preview-doc" style={{ width: `${Math.round(zoom * 100)}%` }} title="双击文字：在左侧编辑器里定位" onDoubleClick={(e) => jumpToPreviewText(e.target as Element)} />
      </div>
    </div>
  );
}
