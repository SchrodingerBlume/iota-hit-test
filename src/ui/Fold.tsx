// 收起 / 展开一律一个样：一枚朝右的 chevron，展开时转 90°。
// Fold 是独立的钮；FoldIcon 塞在别的按钮里（整行可点的那种），转法一样
import { ChevronRight20Regular } from '@fluentui/react-icons';

export function Fold({ open, onClick, title, className }: { open: boolean; onClick: () => void; title: string; className?: string }) {
  return <button type="button" className={`fold-btn ${open ? 'is-open' : ''} ${className ?? ''}`} title={title} aria-label={title} aria-expanded={open} onClick={onClick}><ChevronRight20Regular /></button>;
}

export function FoldIcon({ open }: { open: boolean }) {
  return <span className={`fold-ico ${open ? 'is-open' : ''}`} aria-hidden><ChevronRight20Regular /></span>;
}
