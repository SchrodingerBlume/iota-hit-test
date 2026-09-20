// 收起 / 展开一律一个样：跟展开钮同一颗小三角，收着朝右、开着朝下。
// Fold 是独立的钮；FoldIcon 塞在别的按钮里（整行可点的那种），转法一样
export function Fold({ open, onClick, title, className }: { open: boolean; onClick: () => void; title: string; className?: string }) {
  return <button type="button" className={`fold-btn ${open ? 'is-open' : ''} ${className ?? ''}`} title={title} aria-label={title} aria-expanded={open} onClick={onClick}><i className="rb-caret" /></button>;
}

export function FoldIcon({ open }: { open: boolean }) {
  return <span className={`fold-ico ${open ? 'is-open' : ''}`} aria-hidden><i className="rb-caret" /></span>;
}
