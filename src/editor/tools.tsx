// 工具栏与气泡菜单共用的零件：按钮、分隔线、插入动作、表格对齐、编辑区字号。
// 按钮的命令作用于「当前编辑器」——人在预览区里打字时，预览的光标就是编辑器的选区，
// 命令照样生效；命令一般会把焦点拉到左侧编辑器，按完再把焦点还给预览。
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { createTable } from '@tiptap/extension-table';
import { currentCellInfo } from './extensions/table';
import { useEditorEnv } from './env';
import { usePreviewSurface } from '../ui/PreviewEditLayer';
import { Grid3x3, Rows2, AArrowDown, AArrowUp } from 'lucide-react';

/** 编辑器每一笔事务都重画（按钮的亮暗跟着选区走） */
export function useEditorTick(editor: Editor | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const bump = () => setTick((t) => t + 1);
    editor.on('transaction', bump);
    editor.on('selectionUpdate', bump);
    return () => { editor.off('transaction', bump); editor.off('selectionUpdate', bump); };
  }, [editor]);
}

/** 按完把焦点还给预览（除非命令自己打开了别的输入框，新建公式那种） */
export function refocusPreviewAfter(run: () => void) {
  const wasPreview = usePreviewSurface.getState().focused;
  run();
  // TipTap 的 focus() 是下一帧才真正聚焦的，等它落定再抢回来
  if (wasPreview) setTimeout(() => {
    const ae = document.activeElement as HTMLElement | null;
    if (!ae || ae.classList.contains('rich') || ae === document.body) usePreviewSurface.getState().refocus();
  }, 60);
}

export const B = ({ on, run, title, children, disabled, wide, big }: { on?: boolean; run: () => void; title: string; children: React.ReactNode; disabled?: boolean; wide?: boolean; big?: boolean }) => (
  <button type="button" className={`tb ${on ? 'on' : ''} ${wide ? 'tb-wide' : ''} ${big ? 'tb-big' : ''}`} title={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => refocusPreviewAfter(run)}>{children}</button>
);
export const Sep = () => <span className="tb-sep" aria-hidden />;

export function useInsertActions(editor: Editor | null) {
  const env = useEditorEnv();
  const ed = () => editor!;
  const insertInline = (type: string, attrs: Record<string, any> = {}) => ed().chain().focus().insertContent({ type, attrs }).run();
  const insertTable = () => {
    const table = createTable(ed().schema, 3, 3, true);
    ed().chain().focus().insertContent({ type: 'tableFigure', attrs: {}, content: [table.toJSON()] }).run();
  };
  const insertFigure = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/svg+xml,image/gif';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const r = await env.addImage(f);
      const width = r.width ? Math.min(14, Math.max(4, Math.round((r.width / 96) * 2.54 * 10) / 10)) : 8;
      ed().chain().focus().insertContent({ type: 'figure', attrs: { image: r.name, width } }).run();
    };
    input.click();
  };
  const insertEquation = () => ed().chain().focus().insertContent({ type: 'equation', attrs: {} }).run();
  const insertDenote = () => ed().chain().focus().insertContent({ type: 'eqdenote', attrs: { rows: JSON.stringify([{ symbol: '', mode: 'latex', meaning: '' }]), lead: 'auto' } }).run();
  const insertPageBreak = () => ed().chain().focus().insertContent({ type: 'pageBreak' }).run();
  return { insertInline, insertTable, insertFigure, insertEquation, insertDenote, insertPageBreak };
}

/** 表格：九宫格对齐（像 Word）、作用于单元格或整行、列宽、行高 */
export function TableAlignTools({ editor }: { editor: Editor }) {
  const [rowScope, setRowScope] = useState(false);
  const [open, setOpen] = useState(false);
  const info = currentCellInfo(editor.state);
  const apply = (align: string | null, valign: string | null) => {
    const chain = editor.chain().focus();
    if (rowScope) chain.setRowCellsAttribute('align', align).setRowCellsAttribute('valign', valign);
    else chain.setCellAttribute('align', align).setCellAttribute('valign', valign);
    chain.run();
    setOpen(false);
  };
  const H = ['left', 'center', 'right'] as const;
  const V = ['top', 'horizon', 'bottom'] as const;
  const HN = { left: '左', center: '中', right: '右' };
  const VN = { top: '上', horizon: '中', bottom: '下' };
  const cw = info.colwidth ? +(info.colwidth / 37.8).toFixed(1) : '';
  const cur = info.align || info.valign ? `${VN[(info.valign ?? 'horizon') as keyof typeof VN]}${HN[(info.align ?? 'center') as keyof typeof HN]}` : '默认';
  return (
    <>
      <span className="menu">
        <B title={`单元格对齐：${cur}（点开九宫格）`} on={open} run={() => setOpen((o) => !o)}><Grid3x3 /><span className="tb-text">{cur}</span></B>
        {open && (
          <span className="menu-pop align-pop" onMouseLeave={() => setOpen(false)}>
            <div className="align-grid">
              {V.map((v) => H.map((h) => (
                <button key={v + h} type="button" className={`align-cell ${info.align === h && info.valign === v ? 'on' : ''}`} title={`${VN[v]}${HN[h]}`} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(h, v)}>
                  <span className="align-glyph" data-h={h} data-v={v}><i /><i /><i /></span>
                </button>
              )))}
            </div>
            <button type="button" className="btn btn-xs" style={{ width: '100%', marginTop: 6 }} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(null, null)}>恢复默认（居中）</button>
          </span>
        )}
      </span>
      <B title={rowScope ? '对齐作用于整行（点击改为只作用于当前 / 选中的单元格）' : '对齐只作用于当前 / 选中的单元格（点击改为整行）'} on={rowScope} run={() => setRowScope((r) => !r)}><Rows2 /><span className="tb-text">整行</span></B>
      <Sep />
      <label className="tb-field" title="当前列的宽度（厘米）；也可以直接拖列线。留空 = 自动">
        列宽 <input type="number" min={0.5} max={16} step={0.1} value={cw} placeholder="自动" onChange={(e) => { const v = parseFloat(e.target.value); editor.chain().focus().setColumnWidth(Number.isFinite(v) && v > 0 ? Math.round(v * 37.8) : null).run(); }} /> cm
      </label>
      <label className="tb-field" title="当前行的高度（厘米）。留空 = 自动">
        行高 <input type="number" min={0.3} max={10} step={0.1} value={info.rowHeight ?? ''} placeholder="自动" onChange={(e) => { const v = parseFloat(e.target.value); editor.chain().focus().setRowAttribute('height', Number.isFinite(v) && v > 0 ? String(v) : null).run(); }} /> cm
      </label>
    </>
  );
}

/** 编辑区的显示字号（只影响编辑器，不影响排版），记在本机 */
const SIZE_KEY = 'iota4web-rich-size';
const sizeListeners = new Set<() => void>();
function readSize(): number { try { const v = Number(localStorage.getItem(SIZE_KEY)); return v >= 13 && v <= 24 ? v : 16.5; } catch { return 16.5; } }
export function useRichSize(): [number, (n: number) => void] {
  const [size, setSize] = useState(readSize);
  useEffect(() => { const fn = () => setSize(readSize()); sizeListeners.add(fn); return () => { sizeListeners.delete(fn); }; }, []);
  const set = (n: number) => { const v = Math.min(24, Math.max(13, +n.toFixed(1))); try { localStorage.setItem(SIZE_KEY, String(v)); } catch { /* */ } sizeListeners.forEach((fn) => fn()); };
  return [size, set];
}
export function FontSizeTool() {
  const [size, setSize] = useRichSize();
  return (
    <span className="tb-size" title="编辑区显示字号（只影响这里，不影响排版结果）">
      <B title="字号小一点" run={() => setSize(size - 1)} disabled={size <= 13}><AArrowDown /></B>
      <span className="tb-size-val">{Math.round(size)}</span>
      <B title="字号大一点" run={() => setSize(size + 1)} disabled={size >= 24}><AArrowUp /></B>
    </span>
  );
}
