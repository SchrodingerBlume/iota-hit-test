import { useEffect, useRef, useState } from 'react';
import { useCompileState } from '../compiler/client';
import { renderArtifact } from '../compiler/renderer';
import { flipBefore, flipAfter } from './flip';
import { usePreviewZoom } from './previewZoom';
import { Eye, ZoomIn, ZoomOut, Maximize2, Loader2 } from 'lucide-react';
import { PreviewEditLayer } from './PreviewEditLayer';

const fmtMB = (n: number) => (n / 1024 / 1024).toFixed(1);

export function Preview() {
  // 只订阅要画的几项：glyphs / segments 那些大数组换了不必重画这里
  const status = useCompileState((s) => s.status);
  const progress = useCompileState((s) => s.progress);
  const fatal = useCompileState((s) => s.fatal);
  const compiling = useCompileState((s) => s.compiling);
  const artifact = useCompileState((s) => s.artifact);
  const artifactFresh = useCompileState((s) => s.artifactFresh);
  const diagnostics = useCompileState((s) => s.diagnostics);
  const lastMs = useCompileState((s) => s.lastMs);
  const compileCount = useCompileState((s) => s.compileCount);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderTick, setRenderTick] = useState(0);

  // ── 缩放 ──────────────────────────────────────────────────────
  // 捏合的每一帧都改宽度会让整张 SVG 重排（十几页文字），必卡。做法照 PDF 阅读器：
  // 手势进行中只给版面套一个 transform: scale()（合成层，不重排），外面一层 canvas 撑出
  // 缩放后的尺寸好让滚动条对得上；手势停 150 ms 后再真正改宽度、摘掉 transform——两者算出
  // 的画面一模一样，所以看不出切换。光标底下那一点每一帧都钉住。
  const canvasRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ w: number; h: number; top: number; target: number; raf: number; commit: number; cx: number; cy: number; factor: number } | null>(null);

  const applyGestureFrame = () => {
    const g = gesture.current;
    const sc = scrollRef.current, stage = stageRef.current, canvas = canvasRef.current;
    if (!g || !sc || !stage || !canvas) return;
    g.raf = 0;
    const from = zoomRef.current;
    const target = Math.min(3, Math.max(0.3, g.target * g.factor));
    g.factor = 1;
    g.target = target;
    const sPrev = parseFloat(stage.dataset.scale ?? '1');
    const sNew = target / from;
    const scRect = sc.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    // 指尖底下那一点在版面（未缩放）坐标里的位置
    const X = (g.cx - canvasRect.left) / sPrev;
    const Y = (g.cy - canvasRect.top) / sPrev;
    canvas.style.width = `${g.w * sNew}px`;
    canvas.style.height = `${g.h * sNew}px`;
    stage.style.transform = `scale(${sNew})`;
    stage.dataset.scale = String(sNew);
    // 横向：canvas 居中，比容器窄时算不出滚动量，只能让它随中线走
    const contentW = sc.clientWidth - 36;
    const centered = Math.max(0, (contentW - g.w * sNew) / 2);
    sc.scrollTop = g.top + Y * sNew - (g.cy - scRect.top);
    sc.scrollLeft = 18 + centered + X * sNew - (g.cx - scRect.left);
    setZoom(target);
    window.clearTimeout(g.commit);
    g.commit = window.setTimeout(commitGesture, 150);
  };

  const commitGesture = () => {
    const g = gesture.current;
    const sc = scrollRef.current, stage = stageRef.current, canvas = canvasRef.current;
    if (!g || !sc || !stage || !canvas) return;
    gesture.current = null;
    const sNew = g.target / zoomRef.current;
    const top = sc.scrollTop, left = sc.scrollLeft;
    zoomRef.current = g.target;
    // 真正改宽度：与 transform 画出来的完全一样，滚动位置照旧
    stage.style.transform = '';
    stage.style.margin = '';
    stage.style.willChange = '';
    delete stage.dataset.scale;
    stage.style.width = `${Math.round(g.target * 10000) / 100}%`;
    canvas.style.width = '';
    canvas.style.height = '';
    setZoom(g.target);
    sc.classList.remove('is-zooming');
    // 宽度按百分比取整会差一点点，按实际尺寸修正滚动量
    const ratio = stage.getBoundingClientRect().width / (g.w * sNew);
    sc.scrollTop = top * ratio;
    sc.scrollLeft = left * ratio;
  };

  /** 以视口里 (clientX, clientY) 为中心缩放 factor 倍；不给坐标就以视口中心 */
  const zoomBy = (factor: number, clientX?: number, clientY?: number) => {
    const sc = scrollRef.current, stage = stageRef.current, canvas = canvasRef.current;
    if (!sc || !stage || !canvas) return;
    const scRect = sc.getBoundingClientRect();
    const cx = clientX ?? scRect.left + scRect.width / 2;
    const cy = clientY ?? scRect.top + scRect.height / 2;
    if (!gesture.current) {
      const canvasRect = canvas.getBoundingClientRect();
      // 尺寸取带小数的：offsetWidth 取整会让 SVG 的高度差出几个像素，一开手势画面就跳
      const stageRect = stage.getBoundingClientRect();
      gesture.current = { w: stageRect.width, h: stageRect.height, top: canvasRect.top - scRect.top + sc.scrollTop, target: zoomRef.current, raf: 0, commit: 0, cx, cy, factor: 1 };
      stage.style.width = `${gesture.current.w}px`;
      // canvas 撑大后 margin: auto 会把版面居中到中间去，手势里钉在左上角
      stage.style.margin = '0';
      stage.style.transformOrigin = '0 0';
      stage.style.willChange = 'transform';
      canvas.style.width = `${gesture.current.w}px`;
      canvas.style.height = `${gesture.current.h}px`;
      sc.classList.add('is-zooming');
    }
    const g = gesture.current;
    g.factor *= factor;
    g.cx = cx; g.cy = cy;
    if (!g.raf) g.raf = requestAnimationFrame(applyGestureFrame);
  };
  const zoomTo = (z: number) => zoomBy(Math.min(3, Math.max(0.3, z)) / (gesture.current?.target ?? zoomRef.current));
  // 功能区「视图」页也要能缩放
  useEffect(() => { usePreviewZoom.getState().set({ zoomBy, zoomTo }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { usePreviewZoom.getState().set({ zoom }); }, [zoom]);

  // 触控板捏合：macOS/Windows 的浏览器把它发成 ctrlKey 的 wheel；Safari 另有 gesture 事件
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)), e.clientX, e.clientY);
    };
    let lastScale = 1;
    const onGestureStart = (e: Event) => { e.preventDefault(); lastScale = 1; };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomBy(g.scale / lastScale, g.clientX, g.clientY);
      lastScale = g.scale;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart as EventListener, { passive: false });
    el.addEventListener('gesturechange', onGestureChange as EventListener, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!artifact || !containerRef.current) return;
    let alive = true;
    const t0 = performance.now();
    const sc = scrollRef.current;
    const view = () => { const r = sc?.getBoundingClientRect(); return r ? [r.top, r.bottom] as const : [0, window.innerHeight] as const; };
    renderArtifact(artifact, containerRef.current, artifactFresh, {
      before: (c) => { const [a, b] = view(); flipBefore(c, a, b); },
      after: (c) => { const [a, b] = view(); flipAfter(c, a, b); },
    })
      .then((info) => { if (alive) { useCompileState.setState({ renderMs: Math.round(performance.now() - t0) }); setPages(info.length); setRenderError(null); setRenderTick((t) => t + 1); } })
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
          <button type="button" className="btn btn-xs btn-icon" title="缩小（触控板捏合、⌘/Ctrl + 滚轮也行）" onClick={() => zoomBy(1 / 1.1)}><ZoomOut /></button>
          <button type="button" className="btn btn-xs" style={{ width: 52, justifyContent: 'center' }} title="回到 100%" onClick={() => zoomTo(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="btn btn-xs btn-icon" title="放大（触控板捏合、⌘/Ctrl + 滚轮也行）" onClick={() => zoomBy(1.1)}><ZoomIn /></button>
          <button type="button" className="btn btn-xs btn-icon" title="适宽" onClick={() => zoomTo(1)}><Maximize2 /></button>
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
        {/* 渲染器会整个改写 preview-doc 的内容，编辑层只能做它的兄弟盖在上面 */}
        <div ref={canvasRef} className="preview-canvas">
          <div ref={stageRef} className="preview-stage" style={{ width: '100%' }}>
            <div ref={containerRef} className="preview-doc" />
            <PreviewEditLayer docRef={stageRef} scrollRef={scrollRef} renderTick={renderTick} />
          </div>
        </div>
      </div>
    </div>
  );
}
