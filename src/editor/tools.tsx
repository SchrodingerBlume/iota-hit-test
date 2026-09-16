// 功能区与气泡菜单共用的零件：按钮（Fluent UI 的）、分隔线、插入动作、表格对齐、编辑区字号。
// 按钮的命令作用于「当前编辑器」——人在预览区里打字时，预览的光标就是编辑器的选区，
// 命令照样生效；命令一般会把焦点拉到左侧编辑器，按完再把焦点还给预览。
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { createTable } from '@tiptap/extension-table';
import { Button, ToggleButton, Tooltip, Divider, Popover, PopoverTrigger, PopoverSurface } from '@fluentui/react-components';
import { TextAlignCenter20Regular, TableCellEdit20Regular, TextFontSize20Regular } from '@fluentui/react-icons';
import { currentCellInfo } from './extensions/table';
import { parseTableText, tableNodeFromParsed } from './tableImport';
import { LengthInput } from '../ui/LengthInput';
import { parseLength, toPx } from '../model/length';
import { useEditorEnv } from './env';
import { usePreviewSurface } from '../ui/PreviewEditLayer';
import { t as tx } from '../i18n';

/** 编辑器每一笔事务都重画（按钮的亮暗跟着选区走），一帧合成一次 */
export function useEditorTick(editor: Editor | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    const bump = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; setTick((t) => t + 1); }); };
    editor.on('transaction', bump);
    editor.on('selectionUpdate', bump);
    return () => { editor.off('transaction', bump); editor.off('selectionUpdate', bump); cancelAnimationFrame(raf); };
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

export interface BProps {
  /** 亮着（切换类按钮） */
  on?: boolean;
  run: () => void;
  title: string;
  /** 图标（Fluent 的 20 号图标） */
  icon?: ReactElement;
  children?: ReactNode;
  disabled?: boolean;
  /** 大按钮：图标在上、字在下（Word 的样子） */
  big?: boolean;
  /** 带下拉箭头 */
  menu?: boolean;
  className?: string;
}

/**
 * 功能区按钮：Fluent 的 Button / ToggleButton，按下时不夺焦点（mousedown 拦掉），
 * 命令跑完把焦点还给预览。
 */
export function B({ on, run, title, icon, children, disabled, big, menu, className }: BProps) {
  const cls = `rb-btn ${big ? 'rb-big' : ''} ${menu ? 'rb-menu' : ''} ${className ?? ''}`;
  const common = { as: 'button' as const, appearance: 'subtle' as const, icon, disabled, className: cls, onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onClick: () => refocusPreviewAfter(run), 'aria-label': children ? undefined : title };
  const btn = on !== undefined
    ? <ToggleButton {...common} checked={!!on}>{children}</ToggleButton>
    : <Button {...common}>{children}</Button>;
  return <Tooltip content={title} relationship={children ? 'description' : 'label'} withArrow positioning="below">{btn}</Tooltip>;
}
export const Sep = () => <Divider vertical className="rb-sep" />;

export function useInsertActions(editor: Editor | null) {
  const env = useEditorEnv();
  const ed = () => editor!;
  const insertInline = (type: string, attrs: Record<string, any> = {}) => ed().chain().focus().insertContent({ type, attrs }).run();
  /** 插进去后光标放进第一格，功能区顺势切到「表格工具」 */
  const insertTableJson = (tableJson: JSONContent) => {
    const at = ed().state.selection.from;
    ed().chain().focus().insertContent({ type: 'tableFigure', attrs: {}, content: [tableJson] }).run();
    let first = -1;
    ed().state.doc.nodesBetween(at, ed().state.doc.content.size, (node, pos) => {
      if (first >= 0) return false;
      if (node.type.name === 'tableFigure') { node.descendants((n, p) => { if (first < 0 && n.isTextblock) first = pos + 1 + p + 1; return first < 0; }); return false; }
      return true;
    });
    if (first >= 0) ed().commands.setTextSelection(first);
  };
  /** 从 Markdown / 制表符 / CSV 文本插表 */
  const insertTableFromText = (text: string, header?: boolean) => {
    const parsed = parseTableText(text);
    if (!parsed) return false;
    insertTableJson(tableNodeFromParsed(parsed, { header }));
    return true;
  };
  const insertTable = (rows = 3, cols = 3, header = true, fit: 'content' | 'window' | 'fixed' = 'content', colWidth: number | string = 2.5) => {
    const table = createTable(ed().schema, rows, cols, header);
    const at = ed().state.selection.from;
    ed().chain().focus().insertContent({ type: 'tableFigure', attrs: { fit, colWidth }, content: [table.toJSON()] }).run();
    // 光标放进第一格（Word 也是）——功能区顺势切到「表格工具」
    let first = -1;
    ed().state.doc.nodesBetween(at, ed().state.doc.content.size, (node, pos) => {
      if (first >= 0) return false;
      if (node.type.name === 'tableFigure') { node.descendants((n, p) => { if (first < 0 && n.isTextblock) first = pos + 1 + p + 1; return first < 0; }); return false; }
      return true;
    });
    if (first >= 0) ed().commands.setTextSelection(first);
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
  /** 伪代码（模板的 lovelace 那一路） */
  const insertAlgorithm = () => ed().chain().focus().insertContent({ type: 'algorithm', attrs: { io: JSON.stringify(['input: ', 'output: ']), lines: JSON.stringify([{ text: '', level: 0 }]) } }).run();
  /** 代码清单：光标在代码块里就给它套上题注壳，否则插一个新的 */
  const insertCodeFigure = () => {
    const e = ed();
    const $p = e.state.selection.$from;
    for (let d = $p.depth; d > 0; d--) {
      if ($p.node(d).type.name === 'codeBlock' && $p.node(d - 1).type.name !== 'codeFigure') {
        const pos = $p.before(d);
        const code = $p.node(d);
        e.view.dispatch(e.state.tr.replaceWith(pos, pos + code.nodeSize, e.schema.nodes.codeFigure.create({}, code)));
        return;
      }
    }
    const at = e.state.selection.from;
    e.chain().focus().insertContent({ type: 'codeFigure', attrs: {}, content: [{ type: 'codeBlock', attrs: { language: 'python' } }] }).run();
    // 光标放进代码块
    let inside = -1;
    e.state.doc.nodesBetween(at, e.state.doc.content.size, (node, pos) => { if (inside >= 0) return false; if (node.type.name === 'codeFigure') { inside = pos + 2; return false; } return true; });
    if (inside >= 0) e.commands.setTextSelection(inside);
  };
  return { insertInline, insertTable, insertTableFromText, insertFigure, insertEquation, insertDenote, insertPageBreak, insertAlgorithm, insertCodeFigure };
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
  const HN = { left: tx("左"), center: tx("中"), right: tx("右") };
  const VN = { top: tx("上"), horizon: tx("中"), bottom: tx("下") };
  const cw = info.colwidth ? +(info.colwidth / 37.8).toFixed(1) : '';
  // 相对单位（fr / % / em）的列宽存在 tableFigure.cols 上，绝对单位折成像素进单元格 colwidth（列线跟着动）
  const raw = editor.getAttributes('tableFigure').cols;
  const cols = (raw && typeof raw === 'object' ? raw : {}) as Record<string, string>;
  const col = info.colIndex ?? 0;
  const setCol = (v: string | undefined) => {
    const l = v ? parseLength(v, 'cm') : null;
    const abs = l && ['cm', 'mm', 'in', 'pt'].includes(l.unit);
    const next = { ...cols };
    if (l && !abs) next[col] = v!; else delete next[col];
    const px = l && abs ? toPx(l) : null;
    editor.chain().setColumnWidth(px ? Math.max(1, Math.round(px)) : null).updateAttributes('tableFigure', { cols: Object.keys(next).length ? next : null }).run();
  };
  const cur = info.align || info.valign ? `${VN[(info.valign ?? 'horizon') as keyof typeof VN]}${HN[(info.align ?? 'center') as keyof typeof HN]}` : tx("默认");
  return (
    <>
      <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} positioning="below-start" trapFocus={false}>
        <PopoverTrigger disableButtonEnhancement>
          <ToggleButton appearance="subtle" className="rb-btn rb-menu" icon={<TextAlignCenter20Regular />} checked={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)} title={tx("单元格对齐：{{cur}}（点开九宫格）", { cur: cur })}>{cur}</ToggleButton>
        </PopoverTrigger>
        <PopoverSurface className="align-pop">
          <div className="align-grid">
            {V.map((v) => H.map((h) => (
              <button key={v + h} type="button" className={`align-cell ${info.align === h && info.valign === v ? 'on' : ''}`} title={`${VN[v]}${HN[h]}`} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(h, v)}>
                <span className="align-glyph" data-h={h} data-v={v}><i /><i /><i /></span>
              </button>
            )))}
          </div>
          <Button size="small" style={{ width: '100%', marginTop: 6 }} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(null, null)}>{tx("恢复默认（居中）")}</Button>
        </PopoverSurface>
      </Popover>
      <B title={rowScope ? tx("对齐作用于整行（点击改为只作用于当前 / 选中的单元格）") : tx("对齐只作用于当前 / 选中的单元格（点击改为整行）")} on={rowScope} icon={<TableCellEdit20Regular />} run={() => setRowScope((r) => !r)}>{tx("整行")}</B>
      <Sep />
      <label className="tb-field" title={tx("当前列的宽度：cm / mm / in / pt / em / %（相对版心）/ fr（按份分剩余宽度；列线可拖，拖的是像素）。留空 = 自动")}>
        {tx("列宽")}{' '}<LengthInput value={cols[col] ?? (cw === '' ? '' : `${cw}cm`)} defaultUnit="cm" allowed={['cm', 'mm', 'in', 'pt', 'em', '%', 'fr']} placeholder={tx("自动")} width={84} onChange={setCol} />
      </label>
      <label className="tb-field" title={tx("当前行的高度：cm / mm / pt / em。留空 = 自动")}>
        {tx("行高")}{' '}<LengthInput value={info.rowHeight ?? ''} defaultUnit="cm" placeholder={tx("自动")} width={84} onChange={(v) => editor.chain().setRowAttribute('height', v ?? null).run()} />
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
    <span className="tb-size" title={tx("编辑区显示字号（只影响这里，不影响排版结果）")}>
      <TextFontSize20Regular className="tb-size-ico" />
      <B title={tx("字号小一点")} run={() => setSize(size - 1)} disabled={size <= 13}>A−</B>
      <span className="tb-size-val">{Math.round(size)}</span>
      <B title={tx("字号大一点")} run={() => setSize(size + 1)} disabled={size >= 24}>A+</B>
    </span>
  );
}
