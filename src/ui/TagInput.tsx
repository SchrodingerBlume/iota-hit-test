// 关键词这种「一串短项」的输入：一项一个标签。
//   输入框里回车 / 逗号 / 分号 / 失焦 → 加进去；粘贴一串按分隔符拆开
//   单击标签后可通过两端箭头或 ⌥ + ← / → 调整顺序；← → 可在输入框与标签之间移动，
//   Backspace 先选中最后一个、再按才删，Delete 直接删；双击或选中后回车就地改，改空 = 删；✕ 删
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { t as tx } from '../i18n';
import { textWidth } from './textWidth';

const SEP = /[;；,，\n]/;

export function TagInput({ value, onChange, placeholder, dataInfo }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; dataInfo?: string }) {
  const [draft, setDraft] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ i: number; text: string } | null>(null);
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
  const [editW, setEditW] = useState(24);
  useLayoutEffect(() => { if (edit && editRef.current) setEditW(Math.max(24, Math.ceil(textWidth(editRef.current, edit.text)) + 16)); }, [edit?.text, edit?.i]);
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
    else if (e.altKey && sel !== null && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); const to = e.key === 'ArrowLeft' ? Math.max(0, sel - 1) : Math.min(value.length - 1, sel + 1); move(sel, to); setSel(to); }
    else if (e.key === 'ArrowLeft' && atStart && value.length) { e.preventDefault(); setSel(sel === null ? value.length - 1 : Math.max(0, sel - 1)); }
    else if (e.key === 'ArrowRight' && sel !== null) { e.preventDefault(); setSel(sel + 1 < value.length ? sel + 1 : null); }
    else if (e.key === 'Escape' && sel !== null) { e.preventDefault(); setSel(null); }
    else if (e.key.length === 1 && sel !== null) setSel(null);
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...value];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  // FLIP：顺序一变（拖动让位、松手落位、⌥ 方向键），每个标签从旧位置滑到新位置
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    for (const [k, el] of items.current) next.set(k, el.getBoundingClientRect());
    for (const [k, r] of next) {
      const p = prevRects.current.get(k);
      const el = items.current.get(k);
      if (!p || !el) continue;
      const dx = p.left - r.left, dy = p.top - r.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => { el.style.transition = 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)'; el.style.transform = ''; });
    }
    prevRects.current = next;
  });

  return (
    <div className="tags" onPointerDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); setSel(null); } }}>
      {value.map((t, i) => {
        if (edit && edit.i === i) {
          return (
            <span key={t} className="tag-item is-editing" ref={(el) => { if (el) items.current.set(t, el); else items.current.delete(t); }}>
              <input ref={editRef} value={edit.text} style={{ width: editW }} onChange={(e) => setEdit({ i, text: e.target.value })} onBlur={() => finishEdit(true)}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); } else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); } }} />
            </span>
          );
        }
        const on = sel === i;
        return (
          <span
            key={t}
            ref={(el) => { if (el) items.current.set(t, el); else items.current.delete(t); }}
            className={`tag-item ${on ? 'is-selected' : ''}`}
            title={tx("单击可选择，拖动两端箭头可调整范围，双击可编辑。")}
            onPointerDown={(e) => { e.preventDefault(); if ((e.target as HTMLElement).closest('button')) return; setSel(on ? null : i); input.current?.focus(); }}
            onDoubleClick={() => startEdit(i)}
          >
            {on && i > 0 && <button type="button" className="tag-move" title={tx("向前移动")} tabIndex={-1} onClick={() => { move(i, i - 1); setSel(i - 1); input.current?.focus(); }}><ChevronLeft /></button>}
            {t}
            {on && i < value.length - 1 && <button type="button" className="tag-move" title={tx("向后移动")} tabIndex={-1} onClick={() => { move(i, i + 1); setSel(i + 1); input.current?.focus(); }}><ChevronRight /></button>}
            <button type="button" title={tx("删除")} tabIndex={-1} onClick={() => remove(i)}><X /></button>
          </span>
        );
      })}
      <input ref={input} data-info={dataInfo} value={draft} placeholder={value.length ? tx("按 Enter 添加") : placeholder ?? tx("输入后按 Enter")} onChange={(e) => { setDraft(e.target.value); if (sel !== null) setSel(null); }} onKeyDown={onKey}
        onPaste={(e) => { const text = e.clipboardData.getData('text'); if (SEP.test(text)) { e.preventDefault(); add(draft + text); setDraft(''); } }}
        onBlur={() => { commit(); setSel(null); }} />
    </div>
  );
}
