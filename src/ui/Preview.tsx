import { useEffect, useRef, useState } from 'react';
import { useCompileState } from '../compiler/client';
import { renderArtifact, relayoutPages } from '../compiler/renderer';
import { flipBefore, flipAfter } from './flip';
import { usePreviewZoom } from './previewZoom';
import { Eye, ZoomIn, ZoomOut, Maximize2, Minimize2, Loader2, RefreshCw } from 'lucide-react';
import { PreviewEditLayer } from './PreviewEditLayer';

const fmtMB = (n: number) => (n / 1024 / 1024).toFixed(1);

export function Preview({ onRefresh, refreshDisabled = false }: { onRefresh: () => void; refreshDisabled?: boolean }) {
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
  /** 整页：第一行的页高正好放进视口（Word 的「单页」视图） */
  const fitPage = () => {
    const sc = scrollRef.current, svg = containerRef.current?.querySelector('svg.typst-doc') as SVGSVGElement | null;
    if (!sc || !svg) return;
    const vb = svg.viewBox.baseVal;
    const first = svg.querySelector('g.typst-page');
    const pageH = parseFloat(first?.getAttribute('data-page-height') ?? '0') || vb.height;
    if (!vb.width || !pageH) return;
    // 100% 时版面宽 = 视口内宽；一页的像素高 = 版面宽 × 页高 / 版面宽（用户单位）
    const contentW = sc.clientWidth - 36;
    const z = (sc.clientHeight - 44) / (contentW * pageH / vb.width);
    zoomTo(z);
  };
  const perRow = usePreviewZoom((s) => s.perRow);
  const setPerRow = usePreviewZoom((s) => s.setPerRow);
  // 功能区「视图」页也要能缩放
  useEffect(() => { usePreviewZoom.getState().set({ zoomBy, zoomTo, fitPage }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { usePreviewZoom.getState().set({ zoom }); }, [zoom]);
  // 每行几页变了：只重摆页，字形层重新量一次几何
  const firstLayout = useRef(true);
  useEffect(() => {
    if (firstLayout.current) { firstLayout.current = false; return; }
    if (containerRef.current) { relayoutPages(containerRef.current, perRow); setRenderTick((t) => t + 1); }
  }, [perRow]);

  // 触屏：两指捏合缩放（浏览器自己的页面缩放被 touch-action 关掉了）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let lastD = 0;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const down = (e: PointerEvent) => { if (e.pointerType !== 'touch') return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) lastD = dist(); };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size !== 2) return;
      const d = dist();
      if (lastD > 0 && d > 0) { const [a, b] = [...pts.values()]; zoomBy(d / lastD, (a.x + b.x) / 2, (a.y + b.y) / 2); }
      lastD = d;
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); lastD = 0; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    }, usePreviewZoom.getState().perRow)
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
        <button type="button" className="btn btn-xs" title="重新排版当前文档" disabled={refreshDisabled || status !== 'ready' || compiling} onMouseDown={(e) => e.preventDefault()} onClick={onRefresh}><RefreshCw />{compiling ? '正在刷新…' : '刷新预览'}</button>
        {status === 'ready' && lastMs !== null && <span className="muted">{pages} 页{compiling ? ' · 排版中…' : ''}</span>}
        {status === 'ready' && errors.length > 0 && <span className="err-badge" title="下面列了出错的位置">{errors.length} 个错误</span>}
        <span className="spacer" />
        <span className="join">
          <button type="button" className="btn btn-xs btn-icon" title="缩小（触控板捏合、⌘/Ctrl + 滚轮也行）" onClick={() => zoomBy(1 / 1.1)}><ZoomOut /></button>
          <button type="button" className="btn btn-xs" style={{ width: 52, justifyContent: 'center' }} title="回到 100%" onClick={() => zoomTo(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="btn btn-xs btn-icon" title="放大（触控板捏合、⌘/Ctrl + 滚轮也行）" onClick={() => zoomBy(1.1)}><ZoomIn /></button>
          <button type="button" className="btn btn-xs btn-icon" title="适宽" onClick={() => zoomTo(1)}><Maximize2 /></button>
          <button type="button" className="btn btn-xs btn-icon" title="整页：一页正好放进视口" onClick={fitPage}><Minimize2 /></button>
        </span>
        <span className="join" title="每行几页（Word 的「多页」视图）">
          {([1, 2, 3] as const).map((n) => <button key={n} type="button" className={`btn btn-xs per-row ${perRow === n ? 'on' : ''}`} title={`每行 ${n} 页`} onClick={() => setPerRow(n)}>{n}</button>)}
        </span>
        <div className="preview-progress" aria-hidden />
      </div>
      <div className="preview-scroll" ref={scrollRef}>
        {status === 'booting' && (
          <div className="boot">
            <h3><Loader2 />正在准备排版引擎</h3>
            <div className="muted">首次使用需要下载排版资源，可能需要一些时间。</div>
            <div className="bar"><i style={{ width: progress && progress.total ? `${Math.min(100, (progress.loaded / progress.total) * 100)}%` : '2%' }} /></div>
            <div className="detail">{progress ? `${progress.phase} · ${fmtMB(progress.loaded)} / ${fmtMB(progress.total)} MB${progress.detail ? ' · ' + progress.detail : ''}` : '…'}</div>
          </div>
        )}
        {status === 'error' && (
          <div className="boot">
            <h3>排版引擎启动失败</h3>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{fatal}</pre>
            <div className="muted">请刷新页面重试。</div>
          </div>
        )}
        {status === 'ready' && shown.length > 0 && (
          <div className={`diag ${errors.length ? 'err' : ''}`} style={{ marginBottom: 12, borderRadius: 'var(--r-m)', border: '1px solid' }}>
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
