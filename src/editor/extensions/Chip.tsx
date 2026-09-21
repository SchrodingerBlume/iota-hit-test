// 行内原子节点共用的标签与弹出编辑器。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { t } from '../../i18n';
import { isJumpModifier } from '../jump';

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
  /** 弹出框宽一些（公式编辑） */
  wide?: boolean;
  /** 变了就展开（预览里双击过来的请求） */
  openNonce?: number;
  onSelect?: () => void;
  /** ⌘ / Ctrl + 点：跳到它指的地方（引用 → 被引的图表，引文 → 文献条目…） */
  onJump?: () => void;
}

export function InlineChip({ kind, text, title, selected, editable = true, children, autoOpen, onDelete, wide, openNonce, onSelect, onJump }: Props) {
  const [open, setOpen] = useState(!!autoOpen);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (openNonce) setOpen(true); }, [openNonce]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    // Esc 收起并把焦点还给编辑器（药丸保持选中，方向键接着能走）
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); onSelect?.(); } };
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
        onMouseDown={(e) => { e.preventDefault(); if (onJump && isJumpModifier(e)) return; onSelect?.(); }}
        onClick={(e) => { if (onJump && isJumpModifier(e)) { onJump(); return; } if (editable) setOpen((o) => !o); }}
      >
        {text}
      </button>
      {open && (
        <span className={`chip-pop ${wide ? 'chip-pop-wide' : ''}`} contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          {children(() => { setOpen(false); onSelect?.(); })}
          {onDelete && (
            <button type="button" className="btn btn-danger btn-xs chip-pop-del" onClick={onDelete}>{t("删除")}</button>
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
