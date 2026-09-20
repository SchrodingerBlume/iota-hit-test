// 关键词这种「一串短项」的输入：一项一个标签。
//   输入框里回车 / 逗号 / 分号 / 失焦 → 加进去；粘贴一串按分隔符拆开
//   ← → 在输入框首尾往标签上走（选中态），Backspace 先选中最后一个、再按才删，Delete 直接删
//   双击或选中后回车 → 就地改；改空 = 删
//   ✕ 删；拖着换位置（别的标签让开），⌥ + ← / → 也能挪
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { t as tx } from '../i18n';

interface Drag { from: number; to: number; x: number; y: number; w: number; h: number; ox: number; oy: number; active: boolean }
const SEP = /[;；,，\n]/;

export function TagInput({ value, onChange, placeholder, dataInfo }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; dataInfo?: string }) {
  const [draft, setDraft] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ i: number; text: string } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const items = useRef(new Map<string, HTMLSpanElement>());
  const prevRects = useRef(new Map<string, DOMRect>());

  const add = (text: string) => {
    const parts = text.split(SEP).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...value, ...new Set(parts.filter((p) => !value.includes(p)))]);
  };
  const commit = () => { add(draft); setDraft(''); };
  const remove = (i: number) => { onChange(value.filter((_, j) => j !== i)); setSel(null); input.current?.focus(); };
  const startEdit = (i: number) => { setEdit({ i, text: value[i] }); setSel(null); };
  const finishEdit = (keep: boolean) => {
    if (!edit) return;
    const text = edit.text.trim();
    if (keep && text && text !== value[edit.i]) onChange(value.map((v, j) => (j === edit.i ? text : v)).filter((v, j, a) => a.indexOf(v) === j));
    else if (keep && !text) onChange(value.filter((_, j) => j !== edit.i));
    setEdit(null);
    requestAnimationFrame(() => input.current?.focus());
  };
  useEffect(() => { if (edit) { editRef.current?.focus(); editRef.current?.select(); } }, [edit?.i]);
  useEffect(() => { if (sel !== null && sel >= value.length) setSel(value.length ? value.length - 1 : null); }, [value.length, sel]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (sel !== null && !draft) startEdit(sel); else commit();
    } else if (e.key === ',' || e.key === '，' || e.key === ';' || e.key === '；') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !draft && value.length) {
      e.preventDefault();
      if (sel === null) setSel(value.length - 1); else remove(sel);
    } else if (e.key === 'Delete' && !draft && sel !== null) { e.preventDefault(); remove(sel); }
    else if (e.key === 'ArrowLeft' && atStart && value.length) { e.preventDefault(); setSel(sel === null ? value.length - 1 : Math.max(0, sel - 1)); }
    else if (e.key === 'ArrowRight' && sel !== null) { e.preventDefault(); setSel(sel + 1 < value.length ? sel + 1 : null); }
    else if (e.key === 'Escape' && sel !== null) { e.preventDefault(); setSel(null); }
    else if (e.altKey && sel !== null && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); const to = e.key === 'ArrowLeft' ? Math.max(0, sel - 1) : Math.min(value.length - 1, sel + 1); move(sel, to); setSel(to); }
    else if (e.key.length === 1 && sel !== null) setSel(null);
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
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return;
    e.preventDefault();
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
  const onPointerUp = (i: number) => {
    if (!drag) return;
    if (drag.active) { move(drag.from, drag.to); setSel(drag.to); }
    else { setSel(i); input.current?.focus(); }
    setDrag(null);
  };

  return (
    <div className={`tags ${drag?.active ? 'is-dragging' : ''}`} onPointerDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); setSel(null); } }}>
      {order.map((t) => {
        const i = value.indexOf(t);
        const ghost = drag?.active && drag.from === i;
        if (edit && edit.i === i) {
          return (
            <span key={t} className="tag-item is-editing" ref={(el) => { if (el) items.current.set(t, el); else items.current.delete(t); }}>
              <input ref={editRef} value={edit.text} size={Math.max(2, edit.text.length + 1)} onChange={(e) => setEdit({ i, text: e.target.value })} onBlur={() => finishEdit(true)}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); } else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); } }} />
            </span>
          );
        }
        return (
          <span
            key={t}
            ref={(el) => { if (el) items.current.set(t, el); else items.current.delete(t); }}
            className={`tag-item ${ghost ? 'is-ghost' : ''} ${sel === i ? 'is-selected' : ''}`}
            title={tx("双击改；拖动换位置")}
            onPointerDown={(e) => onPointerDown(e, i)}
            onPointerMove={onPointerMove}
            onPointerUp={() => onPointerUp(i)}
            onPointerCancel={() => setDrag(null)}
            onDoubleClick={() => startEdit(i)}
          >
            {t}
            <button type="button" title={tx("删除")} tabIndex={-1} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); remove(i); }}><X /></button>
          </span>
        );
      })}
      <input ref={input} data-info={dataInfo} value={draft} placeholder={value.length ? tx("回车添加") : placeholder ?? tx("输入后回车")} onChange={(e) => { setDraft(e.target.value); if (sel !== null) setSel(null); }} onKeyDown={onKey}
        onPaste={(e) => { const text = e.clipboardData.getData('text'); if (SEP.test(text)) { e.preventDefault(); add(draft + text); setDraft(''); } }}
        onBlur={() => { commit(); setSel(null); }} />
      {/* 提起来的那个挂到 body 上：编辑区容器有 container-type（布局包含），position: fixed 会以它为准，跟着滚动一起跑偏 */}
      {drag?.active && createPortal(
        <span className="tag-item is-lifted" style={{ position: 'fixed', left: drag.x - drag.ox, top: drag.y - drag.oy, width: drag.w, height: drag.h, pointerEvents: 'none', zIndex: 50 }}>
          {value[drag.from]}
        </span>,
        document.body,
      )}
    </div>
  );
}
