// Agent 面板的「壳」：停在右边一列 / 盖在主区上 / 窄屏上堆叠的一格时就是面板本身；浮着时是一扇能拖能拉的小窗。
// 按住面板头部（.ag-head 里非按钮处）拖：停着的拖一下就撕成小窗，小窗里拖就是挪；右下角拉大小；双击头部停回去
import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { AgentPane } from './AgentPane';
import { useAgentWindow, clampRect, WIN_MIN_W, WIN_MIN_H, type Rect } from './agentWindow';

const TEAR = 8;

export function AgentHost({ mode, hostRef }: { mode: 'dock' | 'overlay' | 'stack' | 'float'; hostRef: React.RefObject<HTMLDivElement | null> }) {
  const rect = useAgentWindow((s) => s.rect);
  const winRef = useRef<HTMLDivElement>(null);
  const live = useRef<Rect | null>(null);
  const hostSize = () => { const r = hostRef.current?.getBoundingClientRect(); return { width: r?.width ?? window.innerWidth, height: r?.height ?? window.innerHeight }; };
  const paint = (r: Rect) => { const el = winRef.current; if (el) { el.style.left = `${r.x}px`; el.style.top = `${r.y}px`; el.style.width = `${r.w}px`; el.style.height = `${r.h}px`; } };

  // 窗口变小了把窗拉回来
  useLayoutEffect(() => {
    if (mode !== 'float') return;
    const fit = () => { const r = clampRect(useAgentWindow.getState().rect, hostSize()); live.current = r; paint(r); };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [mode, rect]);

  const drag = (e: ReactPointerEvent, kind: 'move' | 'resize') => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (kind === 'move' && (mode === 'stack' || !t.closest('.ag-head') || t.closest('button, input, textarea, a, [role=button], [role=combobox]'))) return;
    // 挪窗那次不 preventDefault：拦了 pointerdown 就没有后面的 dblclick（双击头部停回去）；选字由 .ag-head 的 user-select: none 挡
    if (kind === 'resize') e.preventDefault();
    const host = hostRef.current?.getBoundingClientRect();
    if (!host) return;
    const x0 = e.clientX, y0 = e.clientY;
    let start: Rect | null = mode === 'float' ? clampRect(useAgentWindow.getState().rect, host) : null;
    let torn = mode === 'float';
    let raf = 0;
    let next = start;
    const apply = () => { raf = 0; if (next) paint(next); };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!torn) {
        if (Math.hypot(dx, dy) < TEAR) return;
        // 撕下来：窗的头部跟着指尖走（start 退回 dx、dy，后面按同一套「起点 + 位移」算）
        torn = true;
        const w = 400, h = Math.min(620, host.height - 32);
        const head = (e.target as HTMLElement).closest('.ag-head')?.getBoundingClientRect();
        const grab = Math.min(w - 40, Math.max(20, ev.clientX - (head?.left ?? ev.clientX - 40)));
        const at = clampRect({ x: ev.clientX - host.left - grab, y: ev.clientY - host.top - 14, w, h }, host);
        start = { ...at, x: at.x - dx, y: at.y - dy };
        next = at; live.current = at;
        useAgentWindow.getState().setRect(at);
        useAgentWindow.getState().setFloat(true);
        document.body.classList.add('is-dragging-window');
        return;
      }
      if (!start) return;
      next = kind === 'move'
        ? clampRect({ ...start, x: start.x + dx, y: start.y + dy }, host)
        : { ...start, w: Math.min(Math.max(WIN_MIN_W, start.w + dx), host.width - start.x - 8), h: Math.min(Math.max(WIN_MIN_H, start.h + dy), host.height - start.y - 8) };
      live.current = next;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const up = () => {
      if (raf) cancelAnimationFrame(raf);
      document.body.classList.remove('is-dragging-window');
      if (torn && next) useAgentWindow.getState().setRect(next);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    if (mode === 'float') document.body.classList.add('is-dragging-window');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  // 撕下来那一刻窗还没挂上：挂上后按拖到哪儿画
  useEffect(() => { if (mode === 'float' && live.current) paint(live.current); }, [mode]);

  if (mode !== 'float') return <div className="agent-host" onPointerDown={(e) => drag(e, 'move')}><AgentPane overlay={mode === 'overlay'} /></div>;
  return (
    <div ref={winRef} className="agent-window" onPointerDown={(e) => drag(e, 'move')} onDoubleClick={(e) => { const t = e.target as HTMLElement; if (t.closest('.ag-head') && !t.closest('button, input, a')) useAgentWindow.getState().setFloat(false); }}>
      <AgentPane />
      <div className="agent-window-resize" onPointerDown={(e) => { e.stopPropagation(); drag(e, 'resize'); }} />
    </div>
  );
}
