// 富文本编辑器：TipTap + 我们的节点。value 是 ProseMirror JSON，onChange 回同样的 JSON。
// 工具栏一行：常用的摆在外面，插入类的收进「插入」菜单；选中文字时浮出气泡菜单。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit, createTable } from '@tiptap/extension-table';
import { AlignedTableCell, AlignedTableHeader, SizedTableRow, TableExtras, currentCellInfo } from './extensions/table';
import { NodeSelection } from '@tiptap/pm/state';
import type { RichDoc } from '../model/types';
import { HeadingEn } from './extensions/HeadingEn';
import { UniqueId } from './extensions/UniqueId';
import { MathInline, Cite, Ref, Abbr, Footnote, Ccwd, Idx } from './extensions/inline';
import { Figure, TableFigure, Equation, PageBreak } from './extensions/blocks';
import { EqDenote } from './extensions/eqdenote';
import { useEditorEnv, NumberingContext, RichKeyContext } from './env';
import { computeNumbering, type Part } from '../typst/numbering';
import { useStore, type RichKey } from '../model/store';
import { registerEditor, unregisterEditor } from './registry';
import { recordTransaction, invalidatePositions } from './versions';
import { usePreviewSurface } from '../ui/PreviewEditLayer';
import { ListTree, IndentDecrease, Rows2, AArrowDown, AArrowUp, Grid3x3, Undo2, Redo2, Pilcrow, Heading1, Heading2, Heading3, Heading4, Bold, Italic, Underline, Superscript as SuperscriptIcon, Subscript as SubscriptIcon, Code, List, ListOrdered, CodeXml, Sigma, SquareFunction, BookMarked, Link2, MessageSquareQuote, BookmarkPlus, Space, Image, Table, SeparatorHorizontal, BetweenHorizontalStart, BetweenHorizontalEnd, BetweenVerticalStart, BetweenVerticalEnd, Rows3, Columns3, Minus, TableCellsMerge, PanelTop, Plus, ChevronDown } from 'lucide-react';

/** 段落多一个「不缩进」属性：接在公式、列表后面的续段，模板里就是 first-line-indent: 0pt */
const NoIndentParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      noIndent: { default: false, parseHTML: (el) => el.getAttribute('data-noindent') === 'true', renderHTML: (a) => (a.noIndent ? { 'data-noindent': 'true', class: 'no-indent' } : {}) },
    };
  },
});

export interface RichEditorProps {
  value: RichDoc;
  onChange: (v: RichDoc) => void;
  /** 允许标题（正文、附录） */
  headings?: boolean;
  /** 允许图表公式这些块 */
  blocks?: boolean;
  placeholder?: string;
  className?: string;
  /** 换节时强制重建 */
  instanceKey: string;
  /** 编号按哪一部分算：正文按章，附录按 A / 1 / 一 */
  part?: Part;
  /** 这个编辑器对应工程里的哪一份富文本（预览双击定位用） */
  richKey?: RichKey;
}

export function RichEditor({ value, onChange, headings = true, blocks = true, placeholder, className, instanceKey, part = 'other', richKey }: RichEditorProps) {
  const lastEmitted = useRef<RichDoc | null>(null);
  const [richSize] = useRichSize();
  const env = useEditorEnv();
  const settings = useStore((s) => s.doc.settings);
  // 编号表没变就沿用同一个 Map：它是 context 值，换了对象所有节点视图都要重画一遍
  const numRef = useRef<{ sig: string; map: ReturnType<typeof computeNumbering> } | null>(null);
  const numbering = useMemo(() => {
    const map = computeNumbering(value as any, settings, part);
    const sig = JSON.stringify([...map.entries()]);
    if (numRef.current?.sig === sig) return numRef.current.map;
    numRef.current = { sig, map };
    return map;
  }, [value, settings, part]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, link: false, paragraph: false, codeBlock: { defaultLanguage: 'python' } }),
      NoIndentParagraph,
      ...(headings ? [HeadingEn] : []),
      Superscript, Subscript,
      Placeholder.configure({ placeholder: placeholder ?? '在这里写……' }),
      TableKit.configure({ table: { resizable: true, cellMinWidth: 40 }, tableCell: false, tableHeader: false, tableRow: false }),
      AlignedTableCell, AlignedTableHeader, SizedTableRow, TableExtras,
      Figure, TableFigure, Equation, PageBreak, EqDenote,
      MathInline, Cite, Ref, Abbr, Footnote, Ccwd, Idx,
      UniqueId,
    ],
    content: value,
    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as RichDoc;
      lastEmitted.current = json;
      onChange(json);
    },
    // 每一笔改动的 mapping 记下来：预览区的字形表要靠它把老位置换算成新位置
    onTransaction: ({ transaction }) => { if (richKey) recordTransaction(richKey, transaction); },
    editorProps: {
      attributes: { class: 'rich', spellcheck: 'false' },
      handlePaste: (view, event) => {
        // 直接粘贴图片：存库、插图
        const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
        if (!file) return false;
        void env.addImage(file).then((r) => {
          view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.figure.create({ image: r.name, width: r.width ? Math.min(14, Math.max(4, Math.round((r.width / 96) * 2.54 * 10) / 10)) : 8 })));
        });
        return true;
      },
    },
  }, [instanceKey]);

  // 外面换了文档（打开工程、换节）才 setContent；自己发出去的不回灌
  useEffect(() => {
    if (!editor) return;
    // 第一次：编辑器就是拿 value 建的，不用灌，也别把预览的位置表作废
    if (lastEmitted.current === null) { lastEmitted.current = value; return; }
    if (value === lastEmitted.current) return;
    invalidatePositions();
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  // 登记到编辑器表里：预览区直接编辑要找到它（挂上来时内容就是工程里那份，位置不必作废）
  useEffect(() => {
    if (!editor || !richKey) return;
    registerEditor(richKey, editor);
    return () => unregisterEditor(richKey, editor);
  }, [editor, richKey]);

  return (
    <NumberingContext.Provider value={numbering}>
      <RichKeyContext.Provider value={richKey}>
        <div className={`editor ${className ?? ''}`} style={{ '--rich-size': `${richSize}px` } as React.CSSProperties}>
          {editor && <Toolbar editor={editor} headings={headings} blocks={blocks} />}
          {editor && <Bubble editor={editor} />}
          <EditorContent editor={editor} className="editor-body" />
        </div>
      </RichKeyContext.Provider>
    </NumberingContext.Provider>
  );
}

// ── 工具栏 ──────────────────────────────────────────────────────

function useEditorTick(editor: Editor) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    editor.on('transaction', bump);
    editor.on('selectionUpdate', bump);
    return () => { editor.off('transaction', bump); editor.off('selectionUpdate', bump); };
  }, [editor]);
}

/**
 * 工具栏按钮。人在预览区里打字时按它，命令照样作用于同一份选区（预览的光标就是编辑器的
 * 选区）；命令一般会把焦点拉到左侧编辑器，按完再把焦点还给预览——除非命令自己打开了别的
 * 输入框（新建公式那种），那就随它。
 */
const B = ({ on, run, title, children, disabled, wide }: { on?: boolean; run: () => void; title: string; children: React.ReactNode; disabled?: boolean; wide?: boolean }) => {
  const click = () => {
    const wasPreview = usePreviewSurface.getState().focused;
    run();
    // TipTap 的 focus() 是下一帧才真正聚焦的，等它落定再抢回来
    if (wasPreview) setTimeout(() => {
      const ae = document.activeElement as HTMLElement | null;
      if (!ae || ae.classList.contains('rich') || ae === document.body) usePreviewSurface.getState().refocus();
    }, 60);
  };
  return <button type="button" className={`tb ${on ? 'on' : ''} ${wide ? 'tb-wide' : ''}`} title={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={click}>{children}</button>;
};
const Sep = () => <span className="tb-sep" aria-hidden />;

function useInsertActions(editor: Editor) {
  const env = useEditorEnv();
  const insertInline = (type: string, attrs: Record<string, any> = {}) => editor.chain().focus().insertContent({ type, attrs }).run();
  const insertTable = () => {
    const table = createTable(editor.schema, 3, 3, true);
    editor.chain().focus().insertContent({ type: 'tableFigure', attrs: {}, content: [table.toJSON()] }).run();
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
      editor.chain().focus().insertContent({ type: 'figure', attrs: { image: r.name, width } }).run();
    };
    input.click();
  };
  const insertEquation = () => editor.chain().focus().insertContent({ type: 'equation', attrs: {} }).run();
  const insertDenote = () => editor.chain().focus().insertContent({ type: 'eqdenote', attrs: { rows: JSON.stringify([{ symbol: '', mode: 'latex', meaning: '' }]), lead: 'auto' } }).run();
  const insertPageBreak = () => editor.chain().focus().insertContent({ type: 'pageBreak' }).run();
  return { insertInline, insertTable, insertFigure, insertEquation, insertDenote, insertPageBreak };
}

function Toolbar({ editor, headings, blocks }: { editor: Editor; headings: boolean; blocks: boolean }) {
  useEditorTick(editor);
  const { insertInline, insertTable, insertFigure, insertEquation, insertDenote, insertPageBreak } = useInsertActions(editor);
  const inTable = editor.isActive('table');
  const [menu, setMenu] = useState(false);

  return (
    <div className="toolbar">
      <div className="toolbar-row">
        <B title="撤销 (⌘Z)" run={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 /></B>
        <B title="重做 (⌘⇧Z)" run={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 /></B>
        {headings && (
          <>
            <Sep />
            <B title="正文段落" on={editor.isActive('paragraph')} run={() => editor.chain().focus().setParagraph().run()}><Pilcrow /></B>
            {([1, 2, 3, 4] as const).map((l) => {
              const Icon = [Heading1, Heading2, Heading3, Heading4][l - 1];
              return <B key={l} title={['章', '节', '条', '款'][l - 1] + `（${l} 级标题）`} on={editor.isActive('heading', { level: l })} run={() => editor.chain().focus().toggleHeading({ level: l }).run()}><Icon /></B>;
            })}
          </>
        )}
        <Sep />
        <B title="加粗 (⌘B)" on={editor.isActive('bold')} run={() => editor.chain().focus().toggleBold().run()}><Bold /></B>
        <B title="强调（排楷体）(⌘I)" on={editor.isActive('italic')} run={() => editor.chain().focus().toggleItalic().run()}><Italic /></B>
        <B title="下划线 (⌘U)" on={editor.isActive('underline')} run={() => editor.chain().focus().toggleUnderline().run()}><Underline /></B>
        <B title="上标" on={editor.isActive('superscript')} run={() => editor.chain().focus().toggleSuperscript().run()}><SuperscriptIcon /></B>
        <B title="下标" on={editor.isActive('subscript')} run={() => editor.chain().focus().toggleSubscript().run()}><SubscriptIcon /></B>
        <B title="等宽代码" on={editor.isActive('code')} run={() => editor.chain().focus().toggleCode().run()}><Code /></B>
        <B title="这一段不首行缩进（接在公式、列表后面的续段）" on={editor.isActive('paragraph', { noIndent: true })} run={() => editor.chain().focus().updateAttributes('paragraph', { noIndent: !editor.getAttributes('paragraph').noIndent }).run()}><IndentDecrease /></B>
        <Sep />
        <B title="无序列表" on={editor.isActive('bulletList')} run={() => editor.chain().focus().toggleBulletList().run()}><List /></B>
        <B title="编号列表" on={editor.isActive('orderedList')} run={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></B>
        <Sep />
        <B title="行内公式" run={() => insertInline('mathInline')}><Sigma /></B>
        <B title="引用参考文献" run={() => insertInline('cite')}><BookMarked /></B>
        <B title="交叉引用图 / 表 / 式 / 节" run={() => insertInline('ref')}><Link2 /></B>
        <B title="缩略语（首次出现自动展开）" run={() => insertInline('abbr')}><span className="tb-text">Ab</span></B>
        <span className="tb-spacer" />
        <FontSizeTool />
        <Sep />
        <span className="menu">
          <button type="button" className="tb tb-wide" onMouseDown={(e) => e.preventDefault()} onClick={() => setMenu((m) => !m)} title="插入…"><Plus />插入<ChevronDown /></button>
          {menu && (
            <span className="menu-pop insert-menu" onMouseLeave={() => setMenu(false)}>
              {blocks && <button type="button" onClick={() => { setMenu(false); insertFigure(); }}><Image />插图…</button>}
              {blocks && <button type="button" onClick={() => { setMenu(false); insertTable(); }}><Table />表格（3 × 3，带题注）</button>}
              {blocks && <button type="button" onClick={() => { setMenu(false); insertEquation(); }}><SquareFunction />行间公式（编号）</button>}
              {blocks && <button type="button" onClick={() => { setMenu(false); insertDenote(); }}><ListTree />式中符号注释（式中 x——…）</button>}
              {blocks && <button type="button" onClick={() => { setMenu(false); editor.chain().focus().toggleCodeBlock().run(); }}><CodeXml />代码块</button>}
              {blocks && <hr />}
              <button type="button" onClick={() => { setMenu(false); insertInline('footnote'); }}><MessageSquareQuote />脚注</button>
              <button type="button" onClick={() => { setMenu(false); insertInline('idx'); }}><BookmarkPlus />索引词</button>
              <button type="button" onClick={() => { setMenu(false); insertInline('ccwd', { n: 1 }); }}><Space />空一个汉字宽</button>
              {blocks && <hr />}
              {blocks && <button type="button" onClick={() => { setMenu(false); insertPageBreak(); }}><SeparatorHorizontal />分页</button>}
            </span>
          )}
        </span>
      </div>
      {inTable && (
        <div className="toolbar-row tb-table">
          <span className="tb-label">表格</span>
          <B title="上方插行" run={() => editor.chain().focus().addRowBefore().run()}><BetweenHorizontalStart /></B>
          <B title="下方插行" run={() => editor.chain().focus().addRowAfter().run()}><BetweenHorizontalEnd /></B>
          <B title="删行" run={() => editor.chain().focus().deleteRow().run()}><Rows3 /><Minus /></B>
          <Sep />
          <B title="左侧插列" run={() => editor.chain().focus().addColumnBefore().run()}><BetweenVerticalStart /></B>
          <B title="右侧插列" run={() => editor.chain().focus().addColumnAfter().run()}><BetweenVerticalEnd /></B>
          <B title="删列" run={() => editor.chain().focus().deleteColumn().run()}><Columns3 /><Minus /></B>
          <Sep />
          <B title="合并 / 拆分单元格" run={() => editor.chain().focus().mergeOrSplit().run()}><TableCellsMerge /></B>
          <B title="表头行切换" run={() => editor.chain().focus().toggleHeaderRow().run()}><PanelTop /></B>
          <Sep />
          <TableAlignTools editor={editor} />
        </div>
      )}
    </div>
  );
}

/** 选中文字时浮出来的小菜单 */
// BubbleMenu 每次拿到新的 shouldShow / options 就重新注册插件（会发一次事务），
// 而我们又靠事务触发重绘——两个对象必须是稳定的，否则互相触发无限循环
const bubbleOptions = { placement: 'top' as const, offset: 8 };
const bubbleShouldShow = ({ editor, state }: { editor: Editor; state: Editor['state'] }) => {
  const { from, to } = state.selection;
  if (from === to || state.selection instanceof NodeSelection) return false;
  return editor.isEditable && !editor.isActive('codeBlock');
};
function Bubble({ editor }: { editor: Editor }) {
  useEditorTick(editor);
  const { insertInline } = useInsertActions(editor);
  return (
    <BubbleMenu editor={editor} className="bubble" options={bubbleOptions} shouldShow={bubbleShouldShow}>
      <B title="加粗" on={editor.isActive('bold')} run={() => editor.chain().focus().toggleBold().run()}><Bold /></B>
      <B title="强调" on={editor.isActive('italic')} run={() => editor.chain().focus().toggleItalic().run()}><Italic /></B>
      <B title="下划线" on={editor.isActive('underline')} run={() => editor.chain().focus().toggleUnderline().run()}><Underline /></B>
      <B title="上标" on={editor.isActive('superscript')} run={() => editor.chain().focus().toggleSuperscript().run()}><SuperscriptIcon /></B>
      <B title="下标" on={editor.isActive('subscript')} run={() => editor.chain().focus().toggleSubscript().run()}><SubscriptIcon /></B>
      <B title="等宽代码" on={editor.isActive('code')} run={() => editor.chain().focus().toggleCode().run()}><Code /></B>
      <Sep />
      <B title="变成行内公式（LaTeX）" run={() => { const { from, to } = editor.state.selection; const text = editor.state.doc.textBetween(from, to, ' '); editor.chain().focus().insertContent({ type: 'mathInline', attrs: { src: text, mode: 'latex' } }).run(); }}><Sigma /></B>
      <B title="在此引用文献" run={() => { editor.chain().focus().setTextSelection(editor.state.selection.to).run(); insertInline('cite'); }}><BookMarked /></B>
      <B title="登记为索引词" run={() => { const { from, to } = editor.state.selection; const text = editor.state.doc.textBetween(from, to, ' '); editor.chain().focus().insertContent({ type: 'idx', attrs: { text } }).run(); }}><BookmarkPlus /></B>
    </BubbleMenu>
  );
}

/** 表格：九宫格对齐（像 Word）、作用于单元格或整行、列宽、行高 */
function TableAlignTools({ editor }: { editor: Editor }) {
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
function FontSizeTool() {
  const [size, setSize] = useRichSize();
  return (
    <span className="tb-size" title="编辑区显示字号（只影响这里，不影响排版结果）">
      <B title="字号小一点" run={() => setSize(size - 1)} disabled={size <= 13}><AArrowDown /></B>
      <span className="tb-size-val">{Math.round(size)}</span>
      <B title="字号大一点" run={() => setSize(size + 1)} disabled={size >= 24}><AArrowUp /></B>
    </span>
  );
}
