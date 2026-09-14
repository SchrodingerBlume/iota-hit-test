// 行内原子节点（公式、引用、交叉引用、缩略语、脚注）共用的「小药丸 + 弹出编辑框」。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NodeViewWrapper } from '@tiptap/react';

interface Props {
  kind: string;
  /** 药丸上印的字 */
  text: ReactNode;
  title?: string;
  selected?: boolean;
  editable?: boolean;
  /** 弹出框里的表单 */
  children: (close: () => void) => ReactNode;
  /** 一插入就展开（新建时） */
  autoOpen?: boolean;
  onDelete?: () => void;
}

export function InlineChip({ kind, text, title, selected, editable = true, children, autoOpen, onDelete }: Props) {
  const [open, setOpen] = useState(!!autoOpen);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <NodeViewWrapper as="span" className={`chip-wrap ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        type="button"
        className={`chip chip-${kind} ${selected ? 'is-selected' : ''}`}
        title={title}
        contentEditable={false}
        onMouseDown={(e) => { e.preventDefault(); }}
        onClick={() => editable && setOpen((o) => !o)}
      >
        {text}
      </button>
      {open && (
        <span className="chip-pop" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          {children(() => setOpen(false))}
          {onDelete && (
            <button type="button" className="btn btn-danger btn-xs chip-pop-del" onClick={onDelete}>删除</button>
          )}
        </span>
      )}
    </NodeViewWrapper>
  );
}

/** 弹出框里的一行：标签 + 控件 */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
