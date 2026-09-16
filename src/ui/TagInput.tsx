// 关键词这种「一串短项」的输入：一项一个标签，✕ 删，回车 / 逗号 / 分号 / 失焦时把输入框里的加进去。
// 标签可以拖着换位置：按住拖，别的标签让开（滑过去），松手落位；也可以选中标签后按 ⌥←/→ 挪。
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { X } from 'lucide-react';
import { t as tx } from '../i18n';

interface Drag { from: number; to: number; x: number; y: number; w: number; h: number; ox: number; oy: number; active: boolean }

export function TagInput({ value, onChange, placeholder, dataInfo }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; dataInfo?: string }) {
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<string, HTMLSpanElement>());
  const prevRects = useRef(new Map<string, DOMRect>());

  const commit = () => {
    const parts = draft.split(/[;；,，]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...value, ...new Set(parts.filter((p) => !value.includes(p)))]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === ';' || e.key === '；') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...value];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  // 拖动中的显示顺序：被拖的那个先挪到目标位，别的让开
  const order = drag?.active && drag.from !== drag.to ? (() => { const next = [...value]; const [it] = next.splice(drag.from, 1); next.splice(drag.to, 0, it); return next; })() : value;

  // FLIP：顺序一变（拖动让位、松手落位、⌥ 方向键），每个标签从旧位置滑到新位置
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    for (const [k, el] of items.current) next.set(k, el.getBoundingClientRect());
    for (const [k, r] of next) {
      const p = prevRects.current.get(k);
      const el = items.current.get(k);
      if (!p || !el || (drag?.active && value[drag.from] === k)) continue;
      const dx = p.left - r.left, dy = p.top - r.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => { el.style.transition = 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)'; el.style.transform = ''; });
    }
    prevRects.current = next;
  });

  const onPointerDown = (e: RPointerEvent<HTMLSpanElement>, i: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: i, to: i, x: e.clientX, y: e.clientY, w: r.width, h: r.height, ox: e.clientX - r.left, oy: e.clientY - r.top, active: false });
  };
  const onPointerMove = (e: RPointerEvent<HTMLSpanElement>) => {
    if (!drag) return;
    const active = drag.active || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4;
    if (!active) return;
    // 目标位：按阅读顺序数有多少个标签的中心在指针前面（先比行，再比同行里的横向）
    const key = value[drag.from];
    let to = 0;
    for (const [k, el] of items.current) {
      if (k === key) continue;
      const r = el.getBoundingClientRect();
      const cy = r.top + r.height / 2, cx = r.left + r.width / 2;
      if (cy < e.clientY - r.height / 2 || (Math.abs(cy - e.clientY) <= r.height / 2 && cx < e.clientX)) to++;
    }
    setDrag({ ...drag, x: e.clientX, y: e.clientY, to: Math.min(to, value.length - 1), active: true });
  };
  const onPointerUp = () => {
    if (!drag) return;
    if (drag.active) move(drag.from, drag.to);
    setDrag(null);
  };
  const onTagKey = (e: KeyboardEvent<HTMLSpanElement>, i: number) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const to = e.key === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(value.length - 1, i + 1);
      move(i, to);
      requestAnimationFrame(() => items.current.get(value[i])?.focus());
    } else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onChange(value.filter((_, j) => j !== i)); }
  };

  return (
    <div ref={box} className={`tags ${drag?.active ? 'is-dragging' : ''}`} onClick={(e) => { if (!drag) (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus(); }}>
      {order.map((t) => {
        const i = value.indexOf(t);
        const ghost = drag?.active && drag.from === i;
        return (
          <span
            key={t}
            ref={(el) => { if (el) items.current.set(t, el); else items.current.delete(t); }}
            className={`tag-item ${ghost ? 'is-ghost' : ''}`}
            tabIndex={0}
            title={tx("拖动换位置；⌥ + ← / → 也行")}
            onPointerDown={(e) => onPointerDown(e, i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={(e) => onTagKey(e, i)}
          >
            {t}
            <button type="button" title={tx("删除")} tabIndex={-1} onClick={(e) => { e.stopPropagation(); onChange(value.filter((_, j) => j !== i)); }}><X /></button>
          </span>
        );
      })}
      <input data-info={dataInfo} value={draft} placeholder={value.length ? '' : placeholder ?? tx("输入后回车")} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit} />
      {drag?.active && (
        <span className="tag-item is-lifted" style={{ position: 'fixed', left: drag.x - drag.ox, top: drag.y - drag.oy, width: drag.w, height: drag.h, pointerEvents: 'none', zIndex: 50 }}>
          {value[drag.from]}
        </span>
      )}
    </div>
  );
}
