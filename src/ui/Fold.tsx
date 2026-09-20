// 收起与展开控件。Fold 可单独使用，FoldIcon 可嵌入其他按钮。
export function Fold({ open, onClick, title, className }: { open: boolean; onClick: () => void; title: string; className?: string }) {
  return <button type="button" className={`fold-btn ${open ? 'is-open' : ''} ${className ?? ''}`} title={title} aria-label={title} aria-expanded={open} onClick={onClick}><i className="rb-caret" /></button>;
}

export function FoldIcon({ open }: { open: boolean }) {
  return <span className={`fold-ico ${open ? 'is-open' : ''}`} aria-hidden><i className="rb-caret" /></span>;
}
