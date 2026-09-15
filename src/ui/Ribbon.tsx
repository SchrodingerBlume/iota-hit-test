// 功能区：横贯左右、哪里都能用的工具栏，用微软自家的 Fluent UI（Word 网页版同一套设计语言）搭——
//   选项卡 TabList，按钮、切换按钮、下拉菜单、弹出面板、提示全是 Fluent 的；分组照 Word：
//   大按钮图标在上字在下，小按钮三个一摞，组名印在组底下；双击选项卡或右端的 ^ 收起，只剩一行
//   选项卡，收起后点选项卡临时展开（同样把内容推下去）、按完命令自动收；光标进表格自动切
//   「表格工具」上下文页；插表格是拖一个格子选大小。
// 命令作用于「当前编辑器」——最近聚焦的那份富文本，或预览区里正在编辑的那份；
// 预览的光标就是编辑器的选区，所以在预览里选中一段再按加粗照样生效。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import { create } from 'zustand';
import { TabList, Tab, Button, Popover, PopoverTrigger, PopoverSurface, Tooltip, Input, Checkbox } from '@fluentui/react-components';
import {
  ArrowUndo20Regular, ArrowRedo20Regular, TextBold20Regular, TextItalic20Regular, TextUnderline20Regular, TextStrikethrough20Regular, TextSubscript20Regular, TextSuperscript20Regular,
  Code20Regular, ClearFormatting20Regular, PaintBrush20Regular, Cut20Regular, Copy20Regular, ClipboardPaste20Regular, TextBulletListLtr20Regular, TextNumberListLtr20Regular, TextIndentDecreaseLtr20Regular,
  Search20Regular, ArrowSwap20Regular, SelectAllOn20Regular, MathFormula20Regular, MathSymbols20Regular, TextDescription20Regular, Image20Regular, Table20Regular, Braces20Regular, TextFootnote20Regular,
  BookmarkAdd20Regular, Spacebar20Regular, DocumentPageBreak20Regular, Omega20Regular, ArrowEnter20Regular, Book20Regular, Link20Regular, Library20Regular, DocumentTableSearch20Regular,
  TextGrammarSettings20Regular, TableStackAbove20Regular, TableStackBelow20Regular, TableDeleteRow20Regular, TableStackLeft20Regular, TableStackRight20Regular, TableDeleteColumn20Regular,
  TableCellsMerge20Regular, TableFreezeRow20Regular, TableDismiss20Regular, PanelLeftContract20Regular, PanelLeftExpand20Regular, PanelLeft20Regular, LayoutColumnTwo20Regular, PanelRight20Regular,
  ZoomIn20Regular, ZoomOut20Regular, AutoFitWidth20Regular, Settings20Regular, Info20Regular, ChevronUp20Regular, ChevronDown20Regular, ChevronLeft20Regular, ChevronRight20Regular, Dismiss20Regular, Pin20Regular, Grid20Regular, Navigation20Regular,
} from '@fluentui/react-icons';
import { useStore, type RichKey } from '../model/store';
import { getEditor, getEditorMeta, onRegistryChange } from '../editor/registry';
import { usePreviewSurface } from './PreviewEditLayer';
import { usePreviewZoom } from './previewZoom';
import { B, Sep, useEditorTick, useInsertActions, TableAlignTools, FontSizeTool, refocusPreviewAfter } from '../editor/tools';
import { searchKey, selectCurrentMatch } from '../editor/extensions/Search';
import { levelLabels } from '../typst/numbering';

type LayoutMode = 'editor' | 'split' | 'preview';
type TabKey = 'home' | 'insert' | 'cite' | 'table' | 'view';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'home', label: '开始' },
  { key: 'insert', label: '插入' },
  { key: 'cite', label: '引用' },
  { key: 'table', label: '表格工具' },
  { key: 'view', label: '视图' },
];
const COLLAPSE_KEY = 'iota4web-ribbon-collapsed-v2';

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
const Rows = ({ children }: { children: ReactNode }) => <div className="rb-rows">{children}</div>;
const Row = ({ children }: { children: ReactNode }) => <div className="rb-row">{children}</div>;

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
  const [tab, setTab] = useState<TabKey>('home');
  const [autoTable, setAutoTable] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  /** 收起状态下临时展开 */
  const [peek, setPeek] = useState(false);
  const [pop, setPop] = useState<'table' | 'symbol' | 'symbol2' | null>(null);
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

  // 收起 / 展开：单击选项卡只切页（Word 也是），收起靠双击或右端的箭头
  const toggleCollapsed = (v: boolean) => { setCollapsed(v); setPeek(false); try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* */ } };
  const onTab = (k: TabKey) => {
    if (collapsed) { if (peek && tab === k) setPeek(false); else { setTab(k); setPeek(true); } }
    else setTab(k);
    setAutoTable(false);
  };
  useEffect(() => {
    if (!peek) return;
    const onDown = (e: MouseEvent) => { const t = e.target as HTMLElement; if (root.current && !root.current.contains(t) && !t.closest?.('.fui-PopoverSurface, .fui-MenuPopover')) setPeek(false); };
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
  // 收起 / 展开的动画不动版面：版面一步到位，抽屉克隆一份盖在原位按高度裁，底下的内容区
  // 整块平移过去。逐帧改高度会让编辑区和十几页的预览每帧重排，跟不上；合成层动画怎么都稳。
  const drawerRef = useRef<HTMLDivElement>(null);
  const openHeight = useRef(0);
  const firstRender = useRef(true);
  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    if (drawer && bodyVisible) openHeight.current = drawer.getBoundingClientRect().height || openHeight.current;
  });
  const wasOpen = useRef(bodyVisible);
  useLayoutEffect(() => {
    const open = bodyVisible;
    if (firstRender.current) { firstRender.current = false; wasOpen.current = open; return; }
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    const drawer = drawerRef.current;
    const main = document.querySelector<HTMLElement>('.main');
    const H = openHeight.current;
    if (!drawer || !main || !H) return;
    const ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
    const dur = 220;
    if (open) main.style.height = `${main.getBoundingClientRect().height + H}px`;
    const a2 = main.animate([{ transform: `translateY(${open ? -H : H}px)` }, { transform: 'none' }], { duration: dur, easing: ease });
    const ghost = drawer.cloneNode(true) as HTMLElement;
    ghost.className = 'rb-drawer rb-ghost';
    ghost.style.height = `${H}px`;
    drawer.parentElement!.appendChild(ghost);
    drawer.style.visibility = 'hidden';
    const from = open ? 'inset(0 0 100% 0)' : 'inset(0 0 0 0)';
    const to = open ? 'inset(0 0 0 0)' : 'inset(0 0 100% 0)';
    const a1 = ghost.animate([{ clipPath: from }, { clipPath: to }], { duration: dur, easing: ease, fill: 'forwards' });
    let done = false;
    const finish = () => { if (done) return; done = true; ghost.remove(); drawer.style.visibility = ''; main.style.height = ''; };
    Promise.all([a1.finished, a2.finished]).then(finish, finish);
    return finish;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyVisible]);

  const where = none
    ? (section === 'info' || section === 'settings' || section === 'pages' ? '这一页是表单，功能区管不着' : '点一下正文或预览里的字，功能区就活了')
    : `编辑：${KEY_NAME[activeKey!] ?? ''}${usePreviewSurface.getState().focused ? '（在预览里）' : ''}`;

  const symbolPop = (id: 'symbol' | 'symbol2', big: boolean) => (
    <Popover open={pop === id} onOpenChange={(_, d) => setPop(d.open ? id : null)} positioning="below-start" trapFocus={false}>
      <PopoverTrigger disableButtonEnhancement>
        <span className="rb-keep"><B title="插入符号" big={big} menu icon={<Omega20Regular />} disabled={none} run={() => setPop(pop === id ? null : id)}>{big ? '符号' : undefined}</B></span>
      </PopoverTrigger>
      <PopoverSurface className="rb-symbols">
        {SYMBOLS.map((ch) => <button key={ch} type="button" className="rb-sym" title={ch} onMouseDown={(e) => e.preventDefault()} onClick={() => { chain().insertContent(ch).run(); setPop(null); afterCommand(); }}>{ch}</button>)}
      </PopoverSurface>
    </Popover>
  );

  return (
    <div ref={root} className={`ribbon ${none ? 'is-idle' : ''} ${collapsed ? 'is-collapsed' : ''} ${peek ? 'is-peek' : ''}`} onClick={(e) => { const t = e.target as HTMLElement; if (t.closest('.rb-btn') && !t.closest('.rb-keep')) afterCommand(); }}>
      <div className="rb-tabs">
        {leading}
        {!minimal && (
          <TabList selectedValue={bodyVisible ? tab : ''} onTabSelect={(_, d) => onTab(d.value as TabKey)} size="medium" appearance="subtle" className="rb-tablist">
            {TABS.filter((t) => t.key !== 'table' || inTable).map((t) => (
              <Tab key={t.key} value={t.key} className={t.key === 'table' ? 'rb-tab-ctx' : ''} onMouseDown={(e) => e.preventDefault()} onDoubleClick={() => toggleCollapsed(!collapsed)}>{t.label}</Tab>
            ))}
          </TabList>
        )}
        <span className="rb-where">{minimal ? '' : where}</span>
        {trailing}
        {collapsed && peek && <Button size="small" appearance="primary" icon={<Pin20Regular />} className="rb-pin" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleCollapsed(false)}>固定</Button>}
        {!minimal && (
          <Tooltip content={collapsed ? '固定功能区（双击选项卡也行）' : '收起功能区（双击选项卡也行）'} relationship="label" positioning="below">
            <Button appearance="subtle" size="small" icon={collapsed ? <ChevronDown20Regular /> : <ChevronUp20Regular />} className="rb-collapse" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleCollapsed(!collapsed)} />
          </Tooltip>
        )}
      </div>
      {!minimal && (
        <div ref={drawerRef} className={`rb-drawer ${bodyVisible ? '' : 'is-closed'}`} aria-hidden={!bodyVisible}>
        <div className="rb-drawer-inner">
        <div className="rb-body">
          {tab === 'home' && (
            <>
              <Group label="剪贴板">
                <B title="粘贴（⌘V）" big icon={<ClipboardPaste20Regular />} disabled={none} run={clipboard.paste}>粘贴</B>
                <Stack>
                  <B title="剪切（⌘X）" icon={<Cut20Regular />} disabled={none || ed.state.selection.empty} run={clipboard.cut}>剪切</B>
                  <B title="复制（⌘C）" icon={<Copy20Regular />} disabled={none || ed.state.selection.empty} run={clipboard.copy}>复制</B>
                  <B title="格式刷：先选中有格式的字，点它，再选中要刷的字" icon={<PaintBrush20Regular />} on={!!painter} disabled={none} run={() => { if (painter) setPainter(null); else if (ed) { const { from, to } = ed.state.selection; const marks = from === to ? ed.state.storedMarks ?? ed.state.selection.$from.marks() : ed.state.doc.resolve(from + 1).marks(); setPainter([...marks]); } }}>格式刷</B>
                </Stack>
              </Group>
              <Group label="撤销">
                <Stack>
                  <B title="撤销 (⌘Z)" icon={<ArrowUndo20Regular />} run={() => chain().undo().run()} disabled={none || !ed.can().undo()}>撤销</B>
                  <B title="重做 (⌘⇧Z)" icon={<ArrowRedo20Regular />} run={() => chain().redo().run()} disabled={none || !ed.can().redo()}>重做</B>
                </Stack>
              </Group>
              <Group label="字体">
                <Rows>
                  <Row>
                    <B title="加粗 (⌘B)" icon={<TextBold20Regular />} on={!!ed?.isActive('bold')} disabled={none} run={() => chain().toggleBold().run()} />
                    <B title="强调（排楷体）(⌘I)" icon={<TextItalic20Regular />} on={!!ed?.isActive('italic')} disabled={none} run={() => chain().toggleItalic().run()} />
                    <B title="下划线 (⌘U)" icon={<TextUnderline20Regular />} on={!!ed?.isActive('underline')} disabled={none} run={() => chain().toggleUnderline().run()} />
                    <B title="删除线" icon={<TextStrikethrough20Regular />} on={!!ed?.isActive('strike')} disabled={none} run={() => chain().toggleStrike().run()} />
                    <B title="下标 (⌘,)" icon={<TextSubscript20Regular />} on={!!ed?.isActive('subscript')} disabled={none} run={() => chain().toggleSubscript().run()} />
                    <B title="上标 (⌘.)" icon={<TextSuperscript20Regular />} on={!!ed?.isActive('superscript')} disabled={none} run={() => chain().toggleSuperscript().run()} />
                  </Row>
                  <Row>
                    <B title="等宽代码" icon={<Code20Regular />} on={!!ed?.isActive('code')} disabled={none} run={() => chain().toggleCode().run()} />
                    <B title="清除格式" icon={<ClearFormatting20Regular />} disabled={none} run={() => chain().unsetAllMarks().run()} />
                    <Sep />
                    <B title="行内公式" icon={<MathFormula20Regular />} disabled={none} run={() => ins.insertInline('mathInline')} />
                    {symbolPop('symbol', false)}
                  </Row>
                </Rows>
              </Group>
              <Group label="段落">
                <Rows>
                  <Row>
                    <B title="无序列表" icon={<TextBulletListLtr20Regular />} on={!!ed?.isActive('bulletList')} disabled={none} run={() => chain().toggleBulletList().run()} />
                    <B title="编号列表（指南里的「项」：（1）接排）" icon={<TextNumberListLtr20Regular />} on={!!ed?.isActive('orderedList')} disabled={none} run={() => chain().toggleOrderedList().run()} />
                    <B title="这一段不首行缩进（接在公式、列表后面的续段）" icon={<TextIndentDecreaseLtr20Regular />} on={!!ed?.isActive('paragraph', { noIndent: true })} disabled={none} run={() => chain().updateAttributes('paragraph', { noIndent: !ed!.getAttributes('paragraph').noIndent }).run()} />
                  </Row>
                  <Row>
                    <B title="空一个汉字宽（#ccwd）" icon={<Spacebar20Regular />} disabled={none} run={() => ins.insertInline('ccwd', { n: 1 })} />
                    <B title="空回车段：连续空段落会排成 #enter(n)，真占一行" icon={<ArrowEnter20Regular />} disabled={none} run={() => chain().splitBlock().run()} />
                    <B title="分页" icon={<DocumentPageBreak20Regular />} disabled={none || !blocks} run={ins.insertPageBreak} />
                  </Row>
                </Rows>
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
                  <B title="查找 (⌘F)" icon={<Search20Regular />} on={findOpen} run={() => useFindBar.getState().set(!findOpen)}>查找</B>
                  <B title="替换 (⌘H)" icon={<ArrowSwap20Regular />} run={() => useFindBar.getState().set(true)}>替换</B>
                  <B title="全选 (⌘A)" icon={<SelectAllOn20Regular />} disabled={none} run={() => chain().selectAll().run()}>全选</B>
                </Stack>
              </Group>
            </>
          )}
          {tab === 'insert' && (
            <>
              <Group label="页面">
                <B title="分页" big icon={<DocumentPageBreak20Regular />} disabled={none || !blocks} run={ins.insertPageBreak}>分页</B>
              </Group>
              <Group label="表格">
                <Popover open={pop === 'table'} onOpenChange={(_, d) => setPop(d.open ? 'table' : null)} positioning="below-start" trapFocus={false}>
                  <PopoverTrigger disableButtonEnhancement>
                    <span className="rb-keep"><B title="插入表格：拖着选行列数" big menu icon={<Table20Regular />} disabled={none || !blocks} run={() => setPop(pop === 'table' ? null : 'table')}>表格</B></span>
                  </PopoverTrigger>
                  <PopoverSurface className="rb-table-grid">
                    <TableGrid onPick={(rows, cols) => { ins.insertTable(rows, cols); setPop(null); afterCommand(); }} />
                  </PopoverSurface>
                </Popover>
              </Group>
              <Group label="插图">
                <B title="插图…（也可以直接把图片粘贴进正文）" big icon={<Image20Regular />} disabled={none || !blocks} run={ins.insertFigure}>图片</B>
              </Group>
              <Group label="公式">
                <B title="行间公式（编号）" big icon={<MathFormula20Regular />} disabled={none || !blocks} run={ins.insertEquation}>公式</B>
                <Stack>
                  <B title="行内公式" icon={<MathSymbols20Regular />} disabled={none} run={() => ins.insertInline('mathInline')}>行内公式</B>
                  <B title="公式底下的「式中 x——…」" icon={<TextDescription20Regular />} disabled={none || !blocks} run={ins.insertDenote}>式中</B>
                  <B title="代码块" icon={<Braces20Regular />} disabled={none || !blocks} run={() => chain().toggleCodeBlock().run()}>代码块</B>
                </Stack>
              </Group>
              <Group label="符号">
                {symbolPop('symbol2', true)}
              </Group>
              <Group label="文本">
                <Stack>
                  <B title="脚注" icon={<TextFootnote20Regular />} disabled={none} run={() => ins.insertInline('footnote')}>脚注</B>
                  <B title="索引词（登记进索引页）" icon={<BookmarkAdd20Regular />} disabled={none} run={() => ins.insertInline('idx')}>索引词</B>
                  <B title="空一个汉字宽" icon={<Spacebar20Regular />} disabled={none} run={() => ins.insertInline('ccwd', { n: 1 })}>空格</B>
                </Stack>
              </Group>
            </>
          )}
          {tab === 'cite' && (
            <>
              <Group label="目录">
                <B title="目录由模板自动生成；排不排在「页面开关」里设" big icon={<DocumentTableSearch20Regular />} run={() => useStore.getState().setSection('pages')}>目录</B>
              </Group>
              <Group label="引文与书目">
                <B title="引用参考文献" big icon={<Book20Regular />} disabled={none} run={() => ins.insertInline('cite')}>插入引文</B>
                <Stack>
                  <B title="到「参考文献」页登记条目（像 Zotero 那样逐字段填，或导入 .bib）" icon={<Library20Regular />} run={() => useStore.getState().setSection('bibliography')}>管理文献</B>
                  <B title="到「成果」页登记攻读期间的成果" icon={<TextGrammarSettings20Regular />} run={() => useStore.getState().setSection('achievements')}>成果</B>
                </Stack>
              </Group>
              <Group label="题注">
                <B title="交叉引用图 / 表 / 式 / 节" big icon={<Link20Regular />} disabled={none} run={() => ins.insertInline('ref')}>交叉引用</B>
                <span className="rb-note">题注在图、表底下直接写；编号由模板算</span>
              </Group>
              <Group label="缩略语与符号">
                <B title="缩略语（首次出现自动展开）" big icon={<span className="rb-glyph">Ab</span>} disabled={none} run={() => ins.insertInline('abbr')}>缩略语</B>
                <Stack>
                  <B title="到「符号与缩略语」页登记" icon={<MathSymbols20Regular />} run={() => useStore.getState().setSection('nomenclature')}>登记</B>
                  <B title="脚注" icon={<TextFootnote20Regular />} disabled={none} run={() => ins.insertInline('footnote')}>脚注</B>
                </Stack>
              </Group>
              <Group label="索引">
                <B title="标记索引词（登记进索引页）" big icon={<BookmarkAdd20Regular />} disabled={none} run={() => ins.insertInline('idx')}>标记条目</B>
                <Stack>
                  <B title="索引页排不排在「页面开关」里设" icon={<Grid20Regular />} run={() => useStore.getState().setSection('pages')}>插入索引</B>
                </Stack>
              </Group>
            </>
          )}
          {tab === 'table' && ed && (
            <>
              <Group label="行与列">
                <Rows>
                  <Row>
                    <B title="上方插行" icon={<TableStackAbove20Regular />} disabled={!inTable} run={() => chain().addRowBefore().run()} />
                    <B title="下方插行" icon={<TableStackBelow20Regular />} disabled={!inTable} run={() => chain().addRowAfter().run()} />
                    <B title="删行" icon={<TableDeleteRow20Regular />} disabled={!inTable} run={() => chain().deleteRow().run()} />
                  </Row>
                  <Row>
                    <B title="左侧插列" icon={<TableStackLeft20Regular />} disabled={!inTable} run={() => chain().addColumnBefore().run()} />
                    <B title="右侧插列" icon={<TableStackRight20Regular />} disabled={!inTable} run={() => chain().addColumnAfter().run()} />
                    <B title="删列" icon={<TableDeleteColumn20Regular />} disabled={!inTable} run={() => chain().deleteColumn().run()} />
                  </Row>
                </Rows>
              </Group>
              <Group label="合并">
                <Stack>
                  <B title="合并 / 拆分单元格" icon={<TableCellsMerge20Regular />} disabled={!inTable} run={() => chain().mergeOrSplit().run()}>合并 / 拆分</B>
                  <B title="表头行切换" icon={<TableFreezeRow20Regular />} disabled={!inTable} run={() => chain().toggleHeaderRow().run()}>表头行</B>
                  <B title="删除整张表" icon={<TableDismiss20Regular />} disabled={!inTable} run={() => chain().deleteTable().run()}>删除表格</B>
                </Stack>
              </Group>
              <Group label="对齐与尺寸">
                <span className="rb-keep rb-inline">{inTable && <TableAlignTools editor={ed} />}</span>
              </Group>
            </>
          )}
          {tab === 'view' && (
            <>
              <Group label="视图">
                <B title="只看编辑" big icon={<PanelLeft20Regular />} on={layout.mode === 'editor'} run={() => layout.setMode('editor')}>编辑</B>
                <B title="编辑 + 预览" big icon={<LayoutColumnTwo20Regular />} on={layout.mode === 'split'} run={() => layout.setMode('split')}>分栏</B>
                <B title="只看预览" big icon={<PanelRight20Regular />} on={layout.mode === 'preview'} run={() => layout.setMode('preview')}>预览</B>
              </Group>
              <Group label="显示">
                <Stack>
                  <B title={layout.navOpen ? '收起左栏' : '展开左栏'} icon={layout.navOpen ? <PanelLeftContract20Regular /> : <PanelLeftExpand20Regular />} on={layout.navOpen} run={() => layout.setNavOpen(!layout.navOpen)}>导航栏</B>
                  <B title="论文设置（校区、学位、阶段……）" icon={<Settings20Regular />} run={() => useStore.getState().setSection('settings')}>论文设置</B>
                  <B title="元信息（题目、作者、导师……）" icon={<Info20Regular />} run={() => useStore.getState().setSection('info')}>元信息</B>
                </Stack>
              </Group>
              <Group label="编辑区字号">
                <span className="rb-keep rb-inline"><FontSizeTool /></span>
              </Group>
              <Group label="预览缩放">
                <span className="rb-keep rb-inline">
                  <B title="缩小（触控板捏合、⌘/Ctrl + 滚轮也行）" icon={<ZoomOut20Regular />} run={() => zoom.zoomBy(1 / 1.1)} />
                  <B title="回到 100%" run={() => zoom.zoomTo(1)}><span style={{ minWidth: 40, display: 'inline-block', textAlign: 'center' }}>{Math.round(zoom.zoom * 100)}%</span></B>
                  <B title="放大" icon={<ZoomIn20Regular />} run={() => zoom.zoomBy(1.1)} />
                  <B title="适宽" icon={<AutoFitWidth20Regular />} run={() => zoom.zoomTo(1)} />
                </span>
              </Group>
              <Group label="提示">
                <span className="rb-hint"><Navigation20Regular />预览里点哪儿光标落哪儿，直接打字；功能区的按钮对预览里的选区同样生效</span>
              </Group>
            </>
          )}
        </div>
        </div>
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
    <div onMouseDown={(e) => e.preventDefault()}>
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
      <Input ref={input} size="small" contentBefore={<Search20Regular />} value={q} placeholder="查找" onChange={(_, d) => setQ(d.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} className="findbar-input" />
      <span className="findbar-count">{q ? (n ? `${(st!.current % n) + 1} / ${n}` : '无结果') : ''}</span>
      <Button size="small" appearance="subtle" icon={<ChevronLeft20Regular />} title="上一个 (⇧Enter)" disabled={!n} onClick={() => step(-1)} />
      <Button size="small" appearance="subtle" icon={<ChevronRight20Regular />} title="下一个 (Enter)" disabled={!n} onClick={() => step(1)} />
      <Checkbox size="medium" label="区分大小写" checked={cs} onChange={(_, d) => setCs(!!d.checked)} />
      <Sep />
      <Input size="small" contentBefore={<ArrowSwap20Regular />} value={rep} placeholder="替换为" onChange={(_, d) => setRep(d.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } }} className="findbar-input" />
      <Button size="small" disabled={!n} onClick={replaceOne}>替换</Button>
      <Button size="small" disabled={!n} onClick={replaceAll}>全部替换</Button>
      <span className="spacer" />
      {!editor && <span className="muted" style={{ fontSize: 12 }}>先点一下正文</span>}
      <Button size="small" appearance="subtle" icon={<Dismiss20Regular />} title="关闭 (Esc)" onClick={close} />
    </div>
  );
}

const KEY_NAME: Record<RichKey, string> = { body: '正文', appendix: '附录', conclusion: '结论', abstractZh: '中文摘要', abstractEn: '英文摘要', acknowledgement: '致谢', resume: '个人简历' };
