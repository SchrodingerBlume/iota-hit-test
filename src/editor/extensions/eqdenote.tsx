// 公式底下的符号注释「式中　x——某某；」，对应 iota-hit 的 #eqdenote。
// 编辑器里就长成模板印出来的样子：引导词一列、符号右对齐一列、破折号、说明。
// 一行一个符号；一条挂多个符号写「x、y」。符号用 LaTeX 或 Typst 数学，点一下弹出公式编辑框。
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { MathEditor, forPreview } from '../math/MathEditor';
import { MathPreview } from '../math/MathPreview';
import { parseDenoteRows, type DenoteRow } from '../../typst/pmToTypst';
import { useOpenNonce, focusAttrInput } from '../env';
import { Trash2, Plus, X } from 'lucide-react';
import { t } from '../../i18n';

const LEADS: { value: string; label: string; hint: string }[] = [
  { value: 'auto', label: t("式中"), hint: t("引导词按文档语言取：中文「式中」、英文 where") },
  { value: 'none', label: t("不印"), hint: t("手动拆成两段时后半段用：不重复引导词，左缘照旧对齐") },
];

function SymbolCell({ row, onChange, editable }: { row: DenoteRow; onChange: (r: Partial<DenoteRow>) => void; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const mode = row.mode === 'typst' ? 'typst' : 'latex';
  // 「x、y」这种多符号：分开各自渲染
  const parts = row.symbol.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
  return (
    <span className="denote-pop" ref={ref}>
      <button type="button" className="denote-sym-btn" disabled={!editable} title={t("点击编辑符号（LaTeX 或 Typst）")} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        {parts.length ? parts.map((p, i) => <span key={i}>{i > 0 && '、'}<MathPreview src={forPreview(p, mode)} mode={mode} /></span>) : <em>{t("符号")}</em>}
      </button>
      {open && (
        <span className="chip-pop chip-pop-wide" onMouseDown={(e) => e.stopPropagation()}>
          <MathEditor value={row.symbol} mode={mode} display={false} compact autoFocus onChange={(v) => onChange({ symbol: v })} onMode={(m) => onChange({ mode: m })} onEnter={() => setOpen(false)} />
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{t("一条挂多个符号用「、」隔开，如")}{' '}<code>R_t、\omega_t</code></div>
        </span>
      )}
    </span>
  );
}

function EqDenoteView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const rows = parseDenoteRows(node.attrs.rows);
  const lead = String(node.attrs.lead ?? 'auto');
  const wrap = useRef<HTMLDivElement>(null);
  const open = useOpenNonce(getPos);
  useEffect(() => { if (open.nonce) requestAnimationFrame(() => focusAttrInput(wrap.current, open.attr ?? 'rows.0.meaning', open.offset)); }, [open]);
  const setRows = (next: DenoteRow[]) => updateAttributes({ rows: JSON.stringify(next) });
  const patch = (i: number, p: Partial<DenoteRow>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const add = (after: number) => { const next = [...rows]; next.splice(after + 1, 0, { symbol: '', mode: 'latex', meaning: '' }); setRows(next); };
  const remove = (i: number) => setRows(rows.filter((_, k) => k !== i));
  const leadText = lead === 'auto' ? t("式中") : lead === 'none' ? '' : lead;
  return (
    <NodeViewWrapper className={`blk denote ${selected ? 'is-selected' : ''}`} ref={wrap} data-drag-handle>
      <div className="denote-grid" contentEditable={false}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <span className={`denote-lead ${i === 0 && !leadText ? 'is-muted' : ''}`}>{i === 0 ? (leadText || t("（不印引导词）")) : ''}</span>
            <span className="denote-sym"><SymbolCell row={r} editable={editable} onChange={(p) => patch(i, p)} /></span>
            <span className="denote-dash">——</span>
            <span className="denote-meaning">
              <input data-attr={`rows.${i}.meaning`} value={r.meaning} placeholder={t("物理量的名称与单位，如：多孔质材料的平均粒子直径（m）")} disabled={!editable}
                onChange={(e) => patch(i, { meaning: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); add(i); requestAnimationFrame(() => focusAttrInput(wrap.current, `rows.${i + 1}.meaning`, 0)); }
                  if (e.key === 'Backspace' && !r.meaning && !r.symbol && rows.length > 1) { e.preventDefault(); remove(i); requestAnimationFrame(() => focusAttrInput(wrap.current, `rows.${Math.max(0, i - 1)}.meaning`, undefined)); }
                }} />
            </span>
            <button type="button" className="blk-tool is-btn is-danger denote-del" title={t("删掉这一条")} disabled={!editable} onClick={() => remove(i)}><X /></button>
          </div>
        ))}
      </div>
      <div className="denote-foot" contentEditable={false}>
        <button type="button" className="btn btn-xs" disabled={!editable} onClick={() => add(rows.length - 1)}><Plus />{t("加一条")}</button>
        <span className="seg" title={t("引导词")}>
          {LEADS.map((l) => <button key={l.value} type="button" className={lead === l.value ? 'on' : ''} title={l.hint} disabled={!editable} onClick={() => updateAttributes({ lead: l.value })}>{l.label}</button>)}
        </span>
        <span className="muted">{t("规范 2.11：破折号后第一个字对齐，转行悬挂；一条挂多个符号写「x、y」")}</span>
        <span className="spacer" />
        <button type="button" className="blk-tool is-btn is-danger" title={t("删除整块")} disabled={!editable} onClick={deleteNode}><Trash2 /></button>
      </div>
    </NodeViewWrapper>
  );
}

export const EqDenote = Node.create({
  name: 'eqdenote',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      rows: { default: '[]', parseHTML: (el: HTMLElement) => el.getAttribute('data-rows') ?? '[]', renderHTML: (a: any) => ({ 'data-rows': a.rows }) },
      lead: { default: 'auto', parseHTML: (el: HTMLElement) => el.getAttribute('data-lead') ?? 'auto', renderHTML: (a: any) => ({ 'data-lead': a.lead }) },
    };
  },
  parseHTML() { return [{ tag: 'div[data-node="eqdenote"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-node': 'eqdenote' })]; },
  addNodeView() { return ReactNodeViewRenderer(EqDenoteView); },
});
