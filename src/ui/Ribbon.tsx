// 功能区：横贯左右、哪里都能用的工具栏，分组与手感照 Word——
//   选项卡（开始 / 插入 / 引用 / 表格 / 视图），大按钮图标在上字在下，小按钮三个一摞，
//   组名印在组底下；再点一下当前选项卡或右端的 ^ 就收起，只剩一行选项卡，点选项卡临时
//   弹出来、用完自动收；光标进表格自动切「表格」上下文页；插表格是拖一个格子选大小。
// 命令作用于「当前编辑器」——最近聚焦的那份富文本，或预览区里正在编辑的那份；
// 预览的光标就是编辑器的选区，所以在预览里选中一段再按加粗照样生效。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import { createTable } from '@tiptap/extension-table';
import { useStore, type RichKey } from '../model/store';
import { getEditor, getEditorMeta, onRegistryChange } from '../editor/registry';
import { usePreviewSurface } from './PreviewEditLayer';
import { usePreviewZoom } from './previewZoom';
import { B, Sep, useEditorTick, useInsertActions, TableAlignTools, FontSizeTool, refocusPreviewAfter } from '../editor/tools';
import { searchKey, selectCurrentMatch } from '../editor/extensions/Search';
import { levelLabels } from '../typst/numbering';
import { create } from 'zustand';
import {
  Undo2, Redo2, Bold, Italic, Underline, Strikethrough, Superscript, Subscript, Code, RemoveFormatting, PaintRoller, Scissors, Copy, ClipboardPaste,
  List, ListOrdered, IndentDecrease, Search as SearchIcon, Replace, TextSelect,
  Sigma, SquareFunction, ListTree, Image, Table, CodeXml, MessageSquareQuote, BookmarkPlus, Space, SeparatorHorizontal, Omega, CornerDownLeft,
  BookMarked, Link2, Library, ListChecks, TableOfContents,
  BetweenHorizontalStart, BetweenHorizontalEnd, Rows3, Columns3, Minus, BetweenVerticalStart, BetweenVerticalEnd, TableCellsMerge, PanelTop, Trash2,
  PanelLeftClose, PanelLeftOpen, PanelLeft, Columns2, PanelRight, ZoomIn, ZoomOut, Maximize2, MousePointerClick, ChevronUp, ChevronDown, X, ChevronLeft, ChevronRight, SlidersHorizontal, Info, LayoutGrid,
} from 'lucide-react';

type LayoutMode = 'editor' | 'split' | 'preview';
type Tab = 'home' | 'insert' | 'cite' | 'table' | 'view';
const TABS: { key: Tab; label: string }[] = [
  { key: 'home', label: '开始' },
  { key: 'insert', label: '插入' },
  { key: 'cite', label: '引用' },
  { key: 'table', label: '表格工具' },
  { key: 'view', label: '视图' },
];
const COLLAPSE_KEY = 'iota4web-ribbon-collapsed';

/** 查找栏开关，⌘F 也从这儿开 */
export const useFindBar = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

/** 一个分组：一排东西，底下一行小字组名（Word 的样子） */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rb-group">
      <div className="rb-items">{children}</div>
      <div className="rb-label">{label}</div>
    </div>
  );
}
/** 三个小按钮一摞（Word 把次要命令这么排） */
const Stack = ({ children }: { children: ReactNode }) => <div className="rb-stack">{children}</div>;
/** 小按钮带字（摞里用） */
const S = ({ title, run, disabled, on, icon, children }: { title: string; run: () => void; disabled?: boolean; on?: boolean; icon: ReactNode; children: ReactNode }) => (
  <B title={title} run={run} disabled={disabled} on={on} wide>{icon}<span className="rb-small-label">{children}</span></B>
);

export interface RibbonLayout {
  navOpen: boolean;
  setNavOpen: (v: boolean) => void;
  mode: LayoutMode;
  setMode: (m: LayoutMode) => void;
}

/** 常用符号：论文里常打的（破折号、间隔号、单位、希腊字母、上下标数字…） */
const SYMBOLS = ['—', '–', '·', '…', '「', '」', '『', '』', '《', '》', '〈', '〉', '【', '】', '×', '÷', '±', '≈', '≠', '≤', '≥', '∞', '°', '℃', 'µ', 'Ω', '‰', '′', '″', '²', '³', '½', '→', '←', '↔', '⇒', '√', '∑', '∫', '∂', '∇', 'α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'π', 'ρ', 'σ', 'τ', 'φ', 'ω', 'Δ', 'Σ', 'Φ', 'Ψ', '©', '®', '™', '§', '¶', '€', '£', '¥'];

export function Ribbon({ layout, leading, trailing, minimal }: { layout: RibbonLayout; leading?: ReactNode; trailing?: ReactNode; minimal?: boolean }) {
  const activeKey = usePreviewSurface((s) => s.activeKey);
  const section = useStore((s) => s.section);
  const settings = useStore((s) => s.doc.settings);
  const levels = levelLabels(settings);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [autoTable, setAutoTable] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  /** 收起状态下临时弹出来 */
  const [peek, setPeek] = useState(false);
  const [pop, setPop] = useState<'table' | 'symbol' | null>(null);
  const [painter, setPainter] = useState<Mark[] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pick = () => setEditor(activeKey ? getEditor(activeKey) ?? null : null);
    pick();
    return onRegistryChange(pick);
  }, [activeKey]);
  useEditorTick(editor);
  const meta = activeKey ? getEditorMeta(activeKey) : undefined;
  const ins = useInsertActions(editor);
  const ed = editor && !editor.isDestroyed ? editor : null;
  const inTable = !!ed?.isActive('table');
  useEffect(() => {
    if (inTable && tab !== 'table') { setTab('table'); setAutoTable(true); }
    else if (!inTable && tab === 'table' && autoTable) { setTab('home'); setAutoTable(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inTable]);
  const headings = !!ed?.schema.nodes.heading;
  const blocks = meta?.blocks !== false;
  const none = !ed;
  const zoom = usePreviewZoom();
  const chain = () => ed!.chain().focus();
  const findOpen = useFindBar((s) => s.open);

  // 收起 / 展开
  const toggleCollapsed = (v: boolean) => { setCollapsed(v); setPeek(false); try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* */ } };
  const onTab = (k: Tab) => {
    if (collapsed) { if (peek && tab === k) setPeek(false); else { setTab(k); setPeek(true); } }
    else if (tab === k) toggleCollapsed(true);
    else setTab(k);
    setAutoTable(false);
  };
  // 收起态弹出的那一片：点外面、按了命令就收
  useEffect(() => {
    if (!peek) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setPeek(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [peek]);
  const afterCommand = useCallback(() => { if (collapsed) setPeek(false); setPop(null); }, [collapsed]);
  // 格式刷：记下选区的格式，下一次选中一段就刷上去
  useEffect(() => {
    if (!painter || !ed) return;
    const onSel = () => {
      const { from, to } = ed.state.selection;
      if (from === to) return;
      const tr = ed.state.tr;
      ed.state.doc.nodesBetween(from, to, (node, pos) => { if (node.isText) { for (const m of node.marks) tr.removeMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), m.type); } });
      for (const m of painter) tr.addMark(from, to, m);
      ed.view.dispatch(tr);
      setPainter(null);
    };
    ed.on('selectionUpdate', onSel);
    return () => { ed.off('selectionUpdate', onSel); };
  }, [painter, ed]);

  const clipboard = {
    copy: async () => { if (!ed) return; const { from, to } = ed.state.selection; const text = ed.state.doc.textBetween(from, to, '\n'); try { await navigator.clipboard.writeText(text); } catch { document.execCommand('copy'); } },
    cut: async () => { if (!ed) return; await clipboard.copy(); ed.chain().focus().deleteSelection().run(); },
    paste: async () => { if (!ed) return; try { const text = await navigator.clipboard.readText(); if (text) ed.chain().focus().insertContent(text.split(/\r?\n/).map((l) => `<p>${l.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))}</p>`).join('')).run(); } catch { document.execCommand('paste'); } },
  };

  const bodyVisible = !minimal && (!collapsed || peek);
  const where = none
    ? (section === 'info' || section === 'settings' || section === 'pages' ? '这一页是表单，功能区管不着' : '点一下正文或预览里的字，功能区就活了')
    : `编辑：${KEY_NAME[activeKey!] ?? ''}${usePreviewSurface.getState().focused ? '（在预览里）' : ''}`;

  return (
    <div ref={root} className={`ribbon ${none ? 'is-idle' : ''} ${collapsed ? 'is-collapsed' : ''} ${peek ? 'is-peek' : ''}`} onClick={(e) => { const t = e.target as HTMLElement; if (t.closest('.tb') && !t.closest('.rb-keep')) afterCommand(); }}>
      <div className="rb-tabs">
        {leading}
        {!minimal && TABS.filter((t) => t.key !== 'table' || inTable).map((t) => (
          <button key={t.key} type="button" className={`rb-tab ${tab === t.key && bodyVisible ? 'on' : ''} ${t.key === 'table' ? 'is-ctx' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onTab(t.key)} onDoubleClick={() => toggleCollapsed(!collapsed)}>{t.label}</button>
        ))}
        <span className="rb-where">{minimal ? '' : where}</span>
        {trailing}
        {!minimal && <button type="button" className="rb-collapse" title={collapsed ? '固定功能区（双击选项卡也行）' : '收起功能区（再点一下当前选项卡也行）'} onMouseDown={(e) => e.preventDefault()} onClick={() => toggleCollapsed(!collapsed)}>{collapsed ? <ChevronDown /> : <ChevronUp />}</button>}
      </div>
      {bodyVisible && (
        <div className="rb-body">
          {tab === 'home' && (
            <>
              <Group label="剪贴板">
                <B title="粘贴（⌘V）" big disabled={none} run={clipboard.paste}><ClipboardPaste />粘贴</B>
                <Stack>
                  <S title="剪切（⌘X）" icon={<Scissors />} disabled={none || ed.state.selection.empty} run={clipboard.cut}>剪切</S>
                  <S title="复制（⌘C）" icon={<Copy />} disabled={none || ed.state.selection.empty} run={clipboard.copy}>复制</S>
                  <S title="格式刷：先选中有格式的字，点它，再选中要刷的字" icon={<PaintRoller />} on={!!painter} disabled={none} run={() => { if (painter) setPainter(null); else if (ed) { const { from, to } = ed.state.selection; const marks = from === to ? ed.state.storedMarks ?? ed.state.selection.$from.marks() : ed.state.doc.resolve(from + 1).marks(); setPainter([...marks]); } }}>格式刷</S>
                </Stack>
              </Group>
              <Group label="撤销">
                <Stack>
                  <S title="撤销 (⌘Z)" icon={<Undo2 />} run={() => chain().undo().run()} disabled={none || !ed.can().undo()}>撤销</S>
                  <S title="重做 (⌘⇧Z)" icon={<Redo2 />} run={() => chain().redo().run()} disabled={none || !ed.can().redo()}>重做</S>
                </Stack>
              </Group>
              <Group label="字体">
                <div className="rb-rows">
                  <div className="rb-row">
                    <B title="加粗 (⌘B)" on={!!ed?.isActive('bold')} disabled={none} run={() => chain().toggleBold().run()}><Bold /></B>
                    <B title="强调（排楷体）(⌘I)" on={!!ed?.isActive('italic')} disabled={none} run={() => chain().toggleItalic().run()}><Italic /></B>
                    <B title="下划线 (⌘U)" on={!!ed?.isActive('underline')} disabled={none} run={() => chain().toggleUnderline().run()}><Underline /></B>
                    <B title="删除线" on={!!ed?.isActive('strike')} disabled={none} run={() => chain().toggleStrike().run()}><Strikethrough /></B>
                    <B title="下标 (⌘,)" on={!!ed?.isActive('subscript')} disabled={none} run={() => chain().toggleSubscript().run()}><Subscript /></B>
                    <B title="上标 (⌘.)" on={!!ed?.isActive('superscript')} disabled={none} run={() => chain().toggleSuperscript().run()}><Superscript /></B>
                  </div>
                  <div className="rb-row">
                    <B title="等宽代码" on={!!ed?.isActive('code')} disabled={none} run={() => chain().toggleCode().run()}><Code /></B>
                    <B title="清除格式" disabled={none} run={() => chain().unsetAllMarks().run()}><RemoveFormatting /></B>
                    <Sep />
                    <B title="行内公式" disabled={none} run={() => ins.insertInline('mathInline')}><Sigma /></B>
                    <span className="menu rb-keep">
                      <B title="插入符号" on={pop === 'symbol'} disabled={none} run={() => setPop(pop === 'symbol' ? null : 'symbol')}><Omega /><ChevronDown className="rb-dd" /></B>
                      {pop === 'symbol' && <SymbolGrid onPick={(ch) => { chain().insertContent(ch).run(); setPop(null); afterCommand(); }} />}
                    </span>
                  </div>
                </div>
              </Group>
              <Group label="段落">
                <div className="rb-rows">
                  <div className="rb-row">
                    <B title="无序列表" on={!!ed?.isActive('bulletList')} disabled={none} run={() => chain().toggleBulletList().run()}><List /></B>
                    <B title="编号列表" on={!!ed?.isActive('orderedList')} disabled={none} run={() => chain().toggleOrderedList().run()}><ListOrdered /></B>
                    <B title="这一段不首行缩进（接在公式、列表后面的续段）" on={!!ed?.isActive('paragraph', { noIndent: true })} disabled={none} run={() => chain().updateAttributes('paragraph', { noIndent: !ed!.getAttributes('paragraph').noIndent }).run()}><IndentDecrease /></B>
                  </div>
                  <div className="rb-row">
                    <B title="空一个汉字宽（#ccwd）" disabled={none} run={() => ins.insertInline('ccwd', { n: 1 })}><Space /></B>
                    <B title="空回车段：连续空段落会排成 #enter(n)，真占一行" disabled={none} run={() => chain().splitBlock().run()}><CornerDownLeft /></B>
                    <B title="分页" disabled={none || !blocks} run={ins.insertPageBreak}><SeparatorHorizontal /></B>
                  </div>
                </div>
              </Group>
              <Group label="样式">
                <div className="rb-styles">
                  <button type="button" className={`rb-style rb-style-p ${ed?.isActive('paragraph') ? 'on' : ''}`} disabled={none} title="正文段落" onMouseDown={(e) => e.preventDefault()} onClick={() => refocusPreviewAfter(() => chain().setParagraph().run())}><span>正文</span></button>
                  {levels.map(({ level: l, name, sample }) => (
                    <button key={l} type="button" className={`rb-style rb-style-h${l} ${ed?.isActive('heading', { level: l }) ? 'on' : ''}`} disabled={none || !headings} title={`${name || `${l} 级`}标题（${l} 级）`} onMouseDown={(e) => e.preventDefault()} onClick={() => refocusPreviewAfter(() => chain().toggleHeading({ level: l as 1 | 2 | 3 | 4 }).run())}><span>{sample}</span><small>{name || `${l} 级`}</small></button>
                  ))}
                  <button type="button" className={`rb-style rb-style-item ${ed?.isActive('orderedList') ? 'on' : ''}`} disabled={none} title="项：款底下那一级——指南说是「（1）」题序、内容接排的段落写法，不是标题；用编号列表" onMouseDown={(e) => e.preventDefault()} onClick={() => refocusPreviewAfter(() => chain().toggleOrderedList().run())}><span>（1）</span><small>项</small></button>
                </div>
              </Group>
              <Group label="编辑">
                <Stack>
                  <S title="查找 (⌘F)" icon={<SearchIcon />} on={findOpen} run={() => useFindBar.getState().set(!findOpen)}>查找</S>
                  <S title="替换 (⌘H)" icon={<Replace />} on={findOpen} run={() => useFindBar.getState().set(true)}>替换</S>
                  <S title="全选 (⌘A)" icon={<TextSelect />} disabled={none} run={() => chain().selectAll().run()}>全选</S>
                </Stack>
              </Group>
            </>
          )}
          {tab === 'insert' && (
            <>
              <Group label="页面">
                <B title="分页" big disabled={none || !blocks} run={ins.insertPageBreak}><SeparatorHorizontal />分页</B>
              </Group>
              <Group label="表格">
                <span className="menu rb-keep">
                  <B title="插入表格：拖着选行列数" big disabled={none || !blocks} run={() => setPop(pop === 'table' ? null : 'table')}><Table />表格<ChevronDown className="rb-dd" /></B>
                  {pop === 'table' && ed && <TableGrid onPick={(rows, cols) => { const table = createTable(ed.schema, rows, cols, true); chain().insertContent({ type: 'tableFigure', attrs: {}, content: [table.toJSON()] }).run(); setPop(null); afterCommand(); }} />}
                </span>
              </Group>
              <Group label="插图">
                <B title="插图…（也可以直接把图片粘贴进正文）" big disabled={none || !blocks} run={ins.insertFigure}><Image />图片</B>
              </Group>
              <Group label="公式">
                <B title="行间公式（编号）" big disabled={none || !blocks} run={ins.insertEquation}><SquareFunction />公式</B>
                <Stack>
                  <S title="行内公式" icon={<Sigma />} disabled={none} run={() => ins.insertInline('mathInline')}>行内公式</S>
                  <S title="公式底下的「式中 x——…」" icon={<ListTree />} disabled={none || !blocks} run={ins.insertDenote}>式中</S>
                  <S title="代码块" icon={<CodeXml />} disabled={none || !blocks} run={() => chain().toggleCodeBlock().run()}>代码块</S>
                </Stack>
              </Group>
              <Group label="符号">
                <span className="menu rb-keep">
                  <B title="插入符号" big disabled={none} run={() => setPop(pop === 'symbol' ? null : 'symbol')}><Omega />符号<ChevronDown className="rb-dd" /></B>
                  {pop === 'symbol' && <SymbolGrid onPick={(ch) => { chain().insertContent(ch).run(); setPop(null); afterCommand(); }} />}
                </span>
              </Group>
              <Group label="文本">
                <Stack>
                  <S title="脚注" icon={<MessageSquareQuote />} disabled={none} run={() => ins.insertInline('footnote')}>脚注</S>
                  <S title="索引词（登记进索引页）" icon={<BookmarkPlus />} disabled={none} run={() => ins.insertInline('idx')}>索引词</S>
                  <S title="空一个汉字宽" icon={<Space />} disabled={none} run={() => ins.insertInline('ccwd', { n: 1 })}>空格</S>
                </Stack>
              </Group>
            </>
          )}
          {tab === 'cite' && (
            <>
              <Group label="目录">
                <B title="目录由模板自动生成；排不排在「页面开关」里设" big run={() => useStore.getState().setSection('pages')}><TableOfContents />目录</B>
              </Group>
              <Group label="引文与书目">
                <B title="引用参考文献" big disabled={none} run={() => ins.insertInline('cite')}><BookMarked />插入引文</B>
                <Stack>
                  <S title="到「参考文献」页登记条目（像 Zotero 那样逐字段填，或导入 .bib）" icon={<Library />} run={() => useStore.getState().setSection('bibliography')}>管理文献</S>
                  <S title="到「成果」页登记攻读期间的成果" icon={<ListChecks />} run={() => useStore.getState().setSection('achievements')}>成果</S>
                </Stack>
              </Group>
              <Group label="题注">
                <B title="交叉引用图 / 表 / 式 / 节" big disabled={none} run={() => ins.insertInline('ref')}><Link2 />交叉引用</B>
                <span className="rb-note">题注在图、表底下直接写；编号由模板算</span>
              </Group>
              <Group label="缩略语与符号">
                <B title="缩略语（首次出现自动展开）" big disabled={none} run={() => ins.insertInline('abbr')}><span className="rb-glyph">Ab</span>缩略语</B>
                <Stack>
                  <S title="到「符号与缩略语」页登记" icon={<Sigma />} run={() => useStore.getState().setSection('nomenclature')}>登记</S>
                  <S title="脚注" icon={<MessageSquareQuote />} disabled={none} run={() => ins.insertInline('footnote')}>脚注</S>
                </Stack>
              </Group>
              <Group label="索引">
                <B title="标记索引词（登记进索引页）" big disabled={none} run={() => ins.insertInline('idx')}><BookmarkPlus />标记条目</B>
                <Stack>
                  <S title="索引页排不排在「页面开关」里设" icon={<LayoutGrid />} run={() => useStore.getState().setSection('pages')}>插入索引</S>
                </Stack>
              </Group>
            </>
          )}
          {tab === 'table' && ed && (
            <>
              <Group label="行与列">
                <div className="rb-rows">
                  <div className="rb-row">
                    <B title="上方插行" disabled={!inTable} run={() => chain().addRowBefore().run()}><BetweenHorizontalStart /></B>
                    <B title="下方插行" disabled={!inTable} run={() => chain().addRowAfter().run()}><BetweenHorizontalEnd /></B>
                    <B title="删行" disabled={!inTable} run={() => chain().deleteRow().run()}><Rows3 /><Minus /></B>
                  </div>
                  <div className="rb-row">
                    <B title="左侧插列" disabled={!inTable} run={() => chain().addColumnBefore().run()}><BetweenVerticalStart /></B>
                    <B title="右侧插列" disabled={!inTable} run={() => chain().addColumnAfter().run()}><BetweenVerticalEnd /></B>
                    <B title="删列" disabled={!inTable} run={() => chain().deleteColumn().run()}><Columns3 /><Minus /></B>
                  </div>
                </div>
              </Group>
              <Group label="合并">
                <Stack>
                  <S title="合并 / 拆分单元格" icon={<TableCellsMerge />} disabled={!inTable} run={() => chain().mergeOrSplit().run()}>合并 / 拆分</S>
                  <S title="表头行切换" icon={<PanelTop />} disabled={!inTable} run={() => chain().toggleHeaderRow().run()}>表头行</S>
                  <S title="删除整张表" icon={<Trash2 />} disabled={!inTable} run={() => chain().deleteTable().run()}>删除表格</S>
                </Stack>
              </Group>
              <Group label="对齐与尺寸">
                <span className="rb-keep">{inTable && <TableAlignTools editor={ed} />}</span>
              </Group>
            </>
          )}
          {tab === 'view' && (
            <>
              <Group label="视图">
                <B title="只看编辑" big on={layout.mode === 'editor'} run={() => layout.setMode('editor')}><PanelLeft />编辑</B>
                <B title="编辑 + 预览" big on={layout.mode === 'split'} run={() => layout.setMode('split')}><Columns2 />分栏</B>
                <B title="只看预览" big on={layout.mode === 'preview'} run={() => layout.setMode('preview')}><PanelRight />预览</B>
              </Group>
              <Group label="显示">
                <Stack>
                  <S title={layout.navOpen ? '收起左栏' : '展开左栏'} icon={layout.navOpen ? <PanelLeftClose /> : <PanelLeftOpen />} on={layout.navOpen} run={() => layout.setNavOpen(!layout.navOpen)}>导航栏</S>
                  <S title="论文设置（校区、学位、阶段……）" icon={<SlidersHorizontal />} run={() => useStore.getState().setSection('settings')}>论文设置</S>
                  <S title="元信息（题目、作者、导师……）" icon={<Info />} run={() => useStore.getState().setSection('info')}>元信息</S>
                </Stack>
              </Group>
              <Group label="编辑区字号">
                <span className="rb-keep"><FontSizeTool /></span>
              </Group>
              <Group label="预览缩放">
                <span className="rb-keep">
                  <B title="缩小（触控板捏合、⌘/Ctrl + 滚轮也行）" run={() => zoom.zoomBy(1 / 1.1)}><ZoomOut /></B>
                  <B title="回到 100%" run={() => zoom.zoomTo(1)}><span className="tb-text" style={{ minWidth: 38 }}>{Math.round(zoom.zoom * 100)}%</span></B>
                  <B title="放大" run={() => zoom.zoomBy(1.1)}><ZoomIn /></B>
                  <B title="适宽" run={() => zoom.zoomTo(1)}><Maximize2 /></B>
                </span>
              </Group>
              <Group label="提示">
                <span className="rb-hint"><MousePointerClick />预览里点哪儿光标落哪儿，直接打字；功能区的按钮对预览里的选区同样生效</span>
              </Group>
            </>
          )}
        </div>
      )}
      {findOpen && <FindBar editor={ed} />}
    </div>
  );
}

/** 插表格：拖一个格子选大小（Word 的 10 × 8 网格） */
function TableGrid({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  const COLS = 10, ROWS = 8;
  return (
    <div className="menu-pop rb-table-grid" onMouseDown={(e) => e.preventDefault()}>
      <div className="rb-grid-label">{hover[0] && hover[1] ? `${hover[0]} 行 × ${hover[1]} 列的表格` : '插入表格'}</div>
      <div className="rb-grid" onMouseLeave={() => setHover([0, 0])}>
        {Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => (
          <button key={`${r}-${c}`} type="button" className={`rb-cell ${r < hover[0] && c < hover[1] ? 'on' : ''}`} onMouseEnter={() => setHover([r + 1, c + 1])} onClick={() => onPick(r + 1, c + 1)} title={`${r + 1} × ${c + 1}`} />
        )))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>第一行是表头；题注在表上方直接写</div>
    </div>
  );
}

/** 插符号 */
function SymbolGrid({ onPick }: { onPick: (ch: string) => void }) {
  return (
    <div className="menu-pop rb-symbols" onMouseDown={(e) => e.preventDefault()}>
      {SYMBOLS.map((ch) => <button key={ch} type="button" className="rb-sym" title={ch} onClick={() => onPick(ch)}>{ch}</button>)}
    </div>
  );
}

/** 查找 / 替换栏 */
function FindBar({ editor }: { editor: Editor | null }) {
  const [q, setQ] = useState('');
  const [rep, setRep] = useState('');
  const [cs, setCs] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const close = () => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query: '' })); useFindBar.getState().set(false); };
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query: q, caseSensitive: cs, current: 0 }));
    return () => { if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query: '' })); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, cs, editor]);
  useEditorTick(editor);
  const st = editor && !editor.isDestroyed ? searchKey.getState(editor.state) : undefined;
  const n = st?.matches.length ?? 0;
  const step = (d: 1 | -1) => { if (!editor || !n) return; editor.view.dispatch(editor.state.tr.setMeta(searchKey, { current: ((st!.current + d) % n + n) % n })); selectCurrentMatch(editor.view); };
  const replaceOne = () => {
    if (!editor || !n) return;
    const m = st!.matches[st!.current];
    editor.view.dispatch(editor.state.tr.insertText(rep, m.from, m.to).setMeta(searchKey, { current: st!.current }));
    selectCurrentMatch(editor.view);
  };
  const replaceAll = () => {
    if (!editor || !n) return;
    const tr = editor.state.tr;
    for (const m of [...st!.matches].reverse()) tr.insertText(rep, m.from, m.to);
    editor.view.dispatch(tr);
  };
  return (
    <div className="findbar" onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <SearchIcon />
      <input ref={input} value={q} placeholder="查找" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} />
      <span className="findbar-count">{q ? (n ? `${(st!.current % n) + 1} / ${n}` : '无结果') : ''}</span>
      <button type="button" className="btn btn-xs btn-icon" title="上一个 (⇧Enter)" disabled={!n} onClick={() => step(-1)}><ChevronLeft /></button>
      <button type="button" className="btn btn-xs btn-icon" title="下一个 (Enter)" disabled={!n} onClick={() => step(1)}><ChevronRight /></button>
      <label className="findbar-opt"><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> 区分大小写</label>
      <Sep />
      <Replace />
      <input value={rep} placeholder="替换为" onChange={(e) => setRep(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } }} />
      <button type="button" className="btn btn-xs" disabled={!n} onClick={replaceOne}>替换</button>
      <button type="button" className="btn btn-xs" disabled={!n} onClick={replaceAll}>全部替换</button>
      <span className="spacer" />
      {!editor && <span className="muted" style={{ fontSize: 12 }}>先点一下正文</span>}
      <button type="button" className="btn btn-xs btn-icon" title="关闭 (Esc)" onClick={close}><X /></button>
    </div>
  );
}

const KEY_NAME: Record<RichKey, string> = { body: '正文', appendix: '附录', conclusion: '结论', abstractZh: '中文摘要', abstractEn: '英文摘要', acknowledgement: '致谢', resume: '个人简历' };
