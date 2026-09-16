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
import { TabList, Tab, Button, Popover, PopoverTrigger, PopoverSurface, Tooltip, Input, Checkbox, Menu, MenuTrigger, MenuPopover, MenuList, MenuItemCheckbox } from '@fluentui/react-components';
import {
  ArrowUndo20Regular, ArrowRedo20Regular, TextBold20Regular, TextItalic20Regular, TextUnderline20Regular, TextStrikethrough20Regular, TextSubscript20Regular, TextSuperscript20Regular,
  Code20Regular, ClearFormatting20Regular, PaintBrush20Regular, Cut20Regular, Copy20Regular, ClipboardPaste20Regular, TextBulletListLtr20Regular, TextNumberListLtr20Regular, TextIndentDecreaseLtr20Regular,
  Search20Regular, ArrowSwap20Regular, SelectAllOn20Regular, MathFormula20Regular, MathSymbols20Regular, TextDescription20Regular, Image20Regular, Table20Regular, Braces20Regular, TextFootnote20Regular,
  BookmarkAdd20Regular, Spacebar20Regular, DocumentPageBreak20Regular, Omega20Regular, ArrowEnter20Regular, Book20Regular, Link20Regular, Library20Regular, DocumentTableSearch20Regular,
  TextGrammarSettings20Regular, TableStackAbove20Regular, TableStackBelow20Regular, TableDeleteRow20Regular, TableStackLeft20Regular, TableStackRight20Regular, TableDeleteColumn20Regular,
  TableCellsMerge20Regular, TableFreezeRow20Regular, TableDismiss20Regular, PanelLeftContract20Regular, PanelLeftExpand20Regular, PanelLeft20Regular, LayoutColumnTwo20Regular, PanelRight20Regular,
  ChevronUp20Regular, ChevronDown20Regular, ChevronLeft20Regular, ChevronRight20Regular, Dismiss20Regular, Pin20Regular, Grid20Regular, TextParagraph20Regular,
  Translate20Regular, ImageEdit20Regular, Delete20Regular, TableSimple20Regular, ClipboardTextLtr20Regular,
  CommentAdd20Regular, CommentDismiss20Regular, Comment20Regular, TextBulletListSquare20Regular, TextEditStyle20Regular,
} from '@fluentui/react-icons';
import { useStore } from '../model/store';
import { getEditor, getEditorMeta, onRegistryChange } from '../editor/registry';
import { usePreviewSurface, usePreviewMarks } from './PreviewEditLayer';
import { useBlockMenu } from '../editor/BlockMenu';
import { B, Sep, useEditorTick, useInsertActions, TableAlignTools, FontSizeTool, refocusPreviewAfter } from '../editor/tools';
import { searchKey, selectCurrentMatch } from '../editor/extensions/Search';
import { levelLabels } from '../typst/numbering';
import { ChoiceMenu } from './RibbonSettings';
import { useEditorEnv } from '../editor/env';
import { useOpenRequest } from '../editor/openRequest';
import { useMedia, SHORT } from './useMedia';
import { TableSizeDialog, TableTextDialog, readTableDefaults, type TableDialogKind } from './TableInsert';
import { LengthInput } from './LengthInput';
import { useLinkDialog } from './LinkDialog';
import { useComments, newCommentId } from '../editor/comments';
import { commentRange } from './CommentsPane';
import { wordAt } from '../editor/wordAt';
import { SymbolPicker, SymbolPanel } from './SymbolPicker';
import { useOutline } from './OutlinePane';
const FITS = [{ value: 'content', label: '根据内容', hint: '列宽按内容定' }, { value: 'window', label: '根据窗口', hint: '撑满版心，各列均分' }, { value: 'fixed', label: '固定列宽', hint: '每列同宽（厘米在插入表格对话框里定）' }];

/** 图 / 表的浮动与跨页选项（模板：placement 交给 Typst；跨页走 show figure.where(kind:): set block(breakable:)） */
const PLACEMENTS = [{ value: 'none', label: '不浮动', hint: '跟着文字排' }, { value: 'auto', label: '自动', hint: '本页顶或底，就近' }, { value: 'top', label: '页顶' }, { value: 'bottom', label: '页底' }];
const BREAK_IMAGE = [{ value: 'auto', label: '自动：不拆', hint: '模板默认，图与题注一整块' }, { value: 'true', label: '允许', hint: '按指南排「续图」' }, { value: 'false', label: '不允许' }];
const BREAK_TABLE = [{ value: 'auto', label: '自动：允许', hint: '模板默认，续页注「续表」' }, { value: 'true', label: '允许' }, { value: 'false', label: '不允许', hint: '整张不拆，放不下就整张挪到下页' }];

type LayoutMode = 'editor' | 'split' | 'preview';
type TabKey = 'home' | 'insert' | 'cite' | 'review' | 'table' | 'figure' | 'view';
const CTX_TABS: TabKey[] = ['table', 'figure'];
const TABS: { key: TabKey; label: string }[] = [
  { key: 'home', label: '开始' },
  { key: 'insert', label: '插入' },
  { key: 'cite', label: '引用' },
  { key: 'review', label: '审阅' },
  { key: 'table', label: '表格工具' },
  { key: 'figure', label: '图片工具' },
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

export function Ribbon({ layout, leading, trailing, minimal }: { layout: RibbonLayout; leading?: ReactNode; trailing?: ReactNode; minimal?: boolean }) {
  const activeKey = usePreviewSurface((s) => s.activeKey);
  const settings = useStore((s) => s.doc.settings);
  const levels = levelLabels(settings);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tab, setTab] = useState<TabKey>('home');
  const [autoTable, setAutoTable] = useState(false);
  const [userCollapsed, setCollapsed] = useState<boolean>(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  // 矮屏（手机横屏）功能区默认收起，点选项卡临时弹出；宽高够了再照用户的偏好
  const shortScreen = useMedia(SHORT);
  const collapsed = userCollapsed || shortScreen;
  /** 收起状态下临时展开 */
  const [peek, setPeek] = useState(false);
  const [pop, setPop] = useState<'table' | 'symbol' | 'symbol2' | null>(null);
  const [tableDlg, setTableDlg] = useState<TableDialogKind | null>(null);
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
  const inFigure = !!ed?.isActive('figure');
  // 上下文页：光标进表格 / 选中插图时自动切过去，离开时切回（用户自己点过别的页就不再管）
  const ctx: TabKey | null = inTable ? 'table' : inFigure ? 'figure' : null;
  useEffect(() => {
    if (ctx && tab !== ctx) { setTab(ctx); setAutoTable(true); }
    else if (!ctx && CTX_TABS.includes(tab) && autoTable) { setTab('home'); setAutoTable(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  const env = useEditorEnv();
  // 批注
  const comments = useStore((s) => s.doc.comments ?? []);
  const commentsOpen = useComments((s) => s.open);
  const reviewer = useComments((s) => s.author);
  const activeCommentId = useComments((s) => s.active);
  const activeComment = comments.find((c) => c.id === activeCommentId) ?? null;
  const newComment = () => {
    if (!ed || !activeKey) return;
    const sel = ed.state.selection;
    const id = newCommentId();
    const c = ed.chain().focus();
    if (sel.empty) { const r = wordAt(ed, sel.from); if (!r) return; c.setTextSelection(r); }
    c.setComment(id).run();
    useStore.getState().setComments([...comments, { id, key: activeKey, author: reviewer, text: '', createdAt: new Date().toISOString() }]);
    useComments.getState().setOpen(true);
    useComments.getState().setActive(id);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(`.comment-card.is-active textarea`)?.focus(), 80);
  };
  const stepComment = (dir: 1 | -1) => {
    const list = comments.filter((c) => c.key === activeKey);
    if (!list.length) return;
    const i = list.findIndex((c) => c.id === activeCommentId);
    const next = list[i < 0 ? (dir === 1 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
    const r = commentRange(next.key, next.id);
    if (r && ed) { ed.chain().focus().setTextSelection(r).run(); useComments.getState().setActive(next.id); }
  };
  const stepNode = (type: string, dir: 1 | -1) => {
    if (!ed || !activeKey) return;
    const list: number[] = [];
    ed.state.doc.descendants((n, pos) => { if (n.type.name === type) list.push(pos); });
    if (!list.length) return;
    const cur = ed.state.selection.from;
    const next = dir > 0 ? list.find((p) => p > cur) ?? list[0] : [...list].reverse().find((p) => p < cur) ?? list[list.length - 1];
    ed.chain().focus().setNodeSelection(next).scrollIntoView().run();
    useOpenRequest.getState().request({ key: activeKey, pos: next });
  };
  /** 更改图片（图片工具页） */
  const replaceImage = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/svg+xml,image/gif';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f || !ed) return;
      const r = await env.addImage(f);
      const patch: Record<string, unknown> = { image: r.name };
      if (r.width && r.height) patch.width = Math.min(14, Math.max(4, Math.round((r.width / 96) * 2.54 * 10) / 10));
      ed.chain().focus().updateAttributes('figure', patch).run();
    };
    input.click();
  };
  const headings = !!ed?.schema.nodes.heading;
  const blocks = meta?.blocks !== false;
  const none = !ed;
  const marksOn = usePreviewMarks((s) => s.on);
  const mkP = usePreviewMarks((s) => s.paragraph), mkS = usePreviewMarks((s) => s.space), mkG = usePreviewMarks((s) => s.gutter);
  const markKinds = { paragraph: mkP, space: mkS, gutter: mkG };
  const outlineOn = useOutline((s) => s.on);
  const toggleMarks = usePreviewMarks((s) => s.toggle);
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
  /** 正在跑的动画：快速连点时从它们当下的位置接着动，不跳、不叠加 */
  const anim = useRef<{ main: Animation; ghost: Animation; clip: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    const open = bodyVisible;
    if (firstRender.current) { firstRender.current = false; wasOpen.current = open; return; }
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    const drawer = drawerRef.current;
    const main = document.querySelector<HTMLElement>('.main');
    const H = openHeight.current;
    if (!drawer || !main || !H) return;
    const tyOf = (el: Element) => { const m = getComputedStyle(el).transform; if (!m || m === 'none') return 0; const p = m.match(/matrix\(([^)]+)\)/); return p ? parseFloat(p[1].split(',')[5]) || 0 : 0; };
    // 上一轮还没走完：记下内容区与抽屉眼下画在哪儿，取消旧动画，新动画从那儿起步。
    // 版面已经翻到新状态（内容区的版面位置差了 H），所以起点要把这个差补回去
    let mainFrom = open ? -H : H;
    let ghostFrom = open ? -H : 0;
    let opacityFrom = open ? 0.4 : 1;
    const prev = anim.current;
    if (prev) {
      const curMain = tyOf(main);
      const ghostEl = prev.clip.firstElementChild as HTMLElement | null;
      if (ghostEl) { ghostFrom = tyOf(ghostEl); opacityFrom = parseFloat(getComputedStyle(ghostEl).opacity) || 1; }
      mainFrom = curMain + (open ? -H : H);
      prev.main.cancel(); prev.ghost.cancel(); prev.clip.remove();
      anim.current = null;
    }
    const ease = open ? 'cubic-bezier(0, 0, 0, 1)' : 'cubic-bezier(0.7, 0, 1, 0.5)';
    const dur = open ? 240 : 170;
    main.style.height = open ? `${main.getBoundingClientRect().height + H}px` : '';
    const a2 = main.animate([{ transform: `translateY(${mainFrom}px)` }, { transform: 'none' }], { duration: dur, easing: ease });
    const clip = document.createElement('div');
    clip.className = 'rb-ghost-clip';
    clip.style.height = `${H}px`;
    clip.style.top = `${drawer.offsetTop}px`;
    const ghost = drawer.cloneNode(true) as HTMLElement;
    ghost.className = 'rb-drawer rb-ghost';
    ghost.style.height = `${H}px`;
    clip.appendChild(ghost);
    drawer.parentElement!.appendChild(clip);
    drawer.style.visibility = 'hidden';
    const a1 = ghost.animate(
      [{ transform: `translateY(${ghostFrom}px)`, opacity: opacityFrom }, { transform: open ? 'none' : `translateY(${-H}px)`, opacity: open ? 1 : 0.4 }],
      { duration: dur, easing: ease, fill: 'forwards' },
    );
    anim.current = { main: a2, ghost: a1, clip };
    let done = false;
    const finish = () => { if (done) return; done = true; if (anim.current?.clip === clip) anim.current = null; clip.remove(); drawer.style.visibility = ''; main.style.height = ''; };
    Promise.all([a1.finished, a2.finished]).then(finish, () => { /* 被新一轮取消：新一轮接手收尾 */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyVisible]);

  const symbolPop = (id: 'symbol' | 'symbol2', big: boolean) => (
    <Popover open={pop === id} onOpenChange={(_, d) => setPop(d.open ? id : null)} positioning="below-start" trapFocus={false}>
      <PopoverTrigger disableButtonEnhancement>
        <span className="rb-keep"><B title="插入符号" big={big} menu icon={<Omega20Regular />} disabled={none} run={() => setPop(pop === id ? null : id)}>{big ? '符号' : undefined}</B></span>
      </PopoverTrigger>
      <PopoverSurface className="rb-symbols">
        <SymbolPanel autoFocus onPick={(ch) => { chain().insertContent(ch).run(); }} />
      </PopoverSurface>
    </Popover>
  );

  return (
    <div ref={root} className={`ribbon ${none ? 'is-idle' : ''} ${collapsed ? 'is-collapsed' : ''} ${peek ? 'is-peek' : ''}`} onClick={(e) => { const t = e.target as HTMLElement; if (t.closest('.rb-btn') && !t.closest('.rb-keep')) afterCommand(); }}>
      <SymbolPicker onPick={(ch) => { chain().insertContent(ch).run(); }} />
      <div className="rb-tabs">
        {leading}
        {!minimal && (
          <TabList selectedValue={bodyVisible ? tab : ''} onTabSelect={(_, d) => onTab(d.value as TabKey)} size="small" appearance="subtle" className="rb-tablist">
            {TABS.filter((t) => (t.key !== 'table' || inTable) && (t.key !== 'figure' || inFigure)).map((t) => (
              <Tab key={t.key} value={t.key} className={CTX_TABS.includes(t.key) ? 'rb-tab-ctx' : ''} onMouseDown={(e) => e.preventDefault()} onDoubleClick={() => toggleCollapsed(!collapsed)}>{t.label}</Tab>
            ))}
          </TabList>
        )}
        {collapsed && peek && !shortScreen && <Button size="small" appearance="primary" icon={<Pin20Regular />} className="rb-pin" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleCollapsed(false)}>固定</Button>}
        {!minimal && !shortScreen && (
          <Tooltip content={collapsed ? '固定功能区（双击选项卡也行）' : '收起功能区（双击选项卡也行）'} relationship="label" positioning="below">
            <Button appearance="subtle" size="small" icon={collapsed ? <ChevronDown20Regular /> : <ChevronUp20Regular />} className="rb-collapse" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleCollapsed(!collapsed)} />
          </Tooltip>
        )}
        {trailing}
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
                    <B title="显示 / 隐藏编辑标记（¶、空格、顶格符；只在编辑区与预览里画，PDF 不受影响）" icon={<TextParagraph20Regular />} on={marksOn} run={toggleMarks} />
                    <Menu checkedValues={{ k: (['paragraph', 'space', 'gutter'] as const).filter((k) => markKinds[k]) }} onCheckedValueChange={(_, d) => { for (const k of ['paragraph', 'space', 'gutter'] as const) usePreviewMarks.getState().setKind(k, d.checkedItems.includes(k)); }} positioning="below-start">
                      <MenuTrigger disableButtonEnhancement>
                        <span className="rb-keep"><B title="选择显示哪些标记" menu run={() => {}} /></span>
                      </MenuTrigger>
                      <MenuPopover><MenuList>
                        <MenuItemCheckbox name="k" value="paragraph">段落标记 ¶</MenuItemCheckbox>
                        <MenuItemCheckbox name="k" value="space">空格 ·</MenuItemCheckbox>
                        <MenuItemCheckbox name="k" value="gutter">顶格符 ⇤</MenuItemCheckbox>
                      </MenuList></MenuPopover>
                    </Menu>
                  </Row>
                </Rows>
              </Group>
              <Group label="样式">
                <div className="rb-styles">
                  <button type="button" className={`rb-style rb-style-p ${ed?.isActive('paragraph') ? 'on' : ''}`} disabled={none} title="正文段落" onMouseDown={(e) => e.preventDefault()} onClick={() => refocusPreviewAfter(() => chain().setParagraph().run())} onContextMenu={(e) => { e.preventDefault(); useBlockMenu.getState().openStyle(0); }}><span>正文</span></button>
                  {levels.map(({ level: l, name, sample }) => (
                    <button key={l} type="button" className={`rb-style rb-style-h${l} ${ed?.isActive('heading', { level: l }) ? 'on' : ''}`} disabled={none || !headings} title={`${name || `${l} 级`}标题（${l} 级）`} onMouseDown={(e) => e.preventDefault()} onClick={() => refocusPreviewAfter(() => chain().toggleHeading({ level: l as 1 | 2 | 3 | 4 }).run())} onContextMenu={(e) => { e.preventDefault(); useBlockMenu.getState().openStyle(l); }}><span>{sample}</span><small>{name || `${l} 级`}</small></button>
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
                    <TableGrid onPick={(rows, cols) => { const d = readTableDefaults(); ins.insertTable(rows, cols, d.header, d.fit === 'fixed' && d.colWidth === 'auto' ? 'content' : d.fit, d.colWidth === 'auto' ? 2.5 : d.colWidth); setPop(null); afterCommand(); }} />
                    <div className="rb-pop-menu">
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setPop(null); setTableDlg('size'); }}><TableSimple20Regular />插入表格…</button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setPop(null); setTableDlg('text'); }}><ClipboardTextLtr20Regular />从文本 / Markdown 插入…</button>
                    </div>
                  </PopoverSurface>
                </Popover>
                {tableDlg === 'size' && <TableSizeDialog onClose={() => setTableDlg(null)} onInsert={(r, c, h, fit, cw) => { setTableDlg(null); ins.insertTable(r, c, h, fit, cw); afterCommand(); }} />}
                {tableDlg === 'text' && <TableTextDialog onClose={() => setTableDlg(null)} onInsert={(t, h) => { setTableDlg(null); ins.insertTableFromText(t, h); afterCommand(); }} />}
              </Group>
              <Group label="插图">
                <B title="插图…（也可以直接把图片粘贴进正文）" big icon={<Image20Regular />} disabled={none || !blocks} run={ins.insertFigure}>图片</B>
              </Group>
              <Group label="链接">
                <B title="插入链接（⌘K）" big icon={<Link20Regular />} disabled={none} run={() => useLinkDialog.getState().open()}>链接</B>
              </Group>
              <Group label="公式">
                <B title="行间公式（编号）" big icon={<MathFormula20Regular />} disabled={none || !blocks} run={ins.insertEquation}>公式</B>
                <Stack>
                  <B title="行内公式" icon={<MathSymbols20Regular />} disabled={none} run={() => ins.insertInline('mathInline')}>行内公式</B>
                  <B title="公式底下的「式中 x——…」" icon={<TextDescription20Regular />} disabled={none || !blocks} run={ins.insertDenote}>式中</B>
                </Stack>
              </Group>
              <Group label="算法与代码">
                <B title="伪代码（模板的 lovelace 排法：一行一条，Tab 缩进；题注「算法 1-1」，可引用）" big icon={<TextBulletListSquare20Regular />} disabled={none || !blocks} run={ins.insertAlgorithm}>算法</B>
                <Stack>
                  <B title="代码块（不带题注，按模板的代码样式排）" icon={<Braces20Regular />} disabled={none || !blocks} run={() => chain().toggleCodeBlock().run()}>代码块</B>
                  <B title="代码清单：带题注「代码 1-1」、可引用的代码块（光标在代码块里就给它加题注）" icon={<Code20Regular />} disabled={none || !blocks} run={ins.insertCodeFigure}>代码清单</B>
                </Stack>
              </Group>
              <Group label="符号">
                {symbolPop('symbol2', true)}
              </Group>
              <Group label="文本">
                <Stack>
                  <B title="空一个汉字宽" icon={<Spacebar20Regular />} disabled={none} run={() => ins.insertInline('ccwd', { n: 1 })}>空格</B>
                </Stack>
              </Group>
            </>
          )}
          {tab === 'cite' && (
            <>
              <Group label="目录">
                <B title="目录设置" big icon={<DocumentTableSearch20Regular />} run={() => useStore.getState().setSection('pages')}>目录</B>
                <Stack>
                  <B title="目录条目的行距、字体、字号（模板的 toc-1～toc-4）" icon={<TextEditStyle20Regular />} run={() => useBlockMenu.getState().openStyle(-1)}>目录样式…</B>
                </Stack>
              </Group>
              <Group label="引文与书目">
                <B title="引用参考文献" big icon={<Book20Regular />} disabled={none} run={() => ins.insertInline('cite')}>插入引文</B>
                <Stack>
                  <B title="管理参考文献" icon={<Library20Regular />} run={() => useStore.getState().setSection('bibliography')}>管理源</B>
                  <B title="到「成果」页登记攻读期间的成果" icon={<TextGrammarSettings20Regular />} run={() => useStore.getState().setSection('achievements')}>成果</B>
                </Stack>
              </Group>
              <Group label="题注">
                <B title="交叉引用图 / 表 / 式 / 节" big icon={<Link20Regular />} disabled={none} run={() => ins.insertInline('ref')}>交叉引用</B>
              </Group>
              <Group label="脚注">
                <B title="插入脚注" big icon={<TextFootnote20Regular />} disabled={none} run={() => ins.insertInline('footnote')}>插入脚注</B>
                <Stack>
                  <B title="上一条脚注" icon={<ChevronUp20Regular />} disabled={none} run={() => stepNode('footnote', -1)}>上一条</B>
                  <B title="下一条脚注" icon={<ChevronDown20Regular />} disabled={none} run={() => stepNode('footnote', 1)}>下一条</B>
                </Stack>
              </Group>
              <Group label="缩略语">
                <B title="缩略语（首次出现自动展开）" big icon={<span className="rb-glyph">Ab</span>} disabled={none} run={() => ins.insertInline('abbr')}>缩略语</B>
                <Stack>
                  <B title="到「符号与缩略语」页登记" icon={<MathSymbols20Regular />} run={() => useStore.getState().setSection('nomenclature')}>管理缩略语</B>
                </Stack>
              </Group>
              <Group label="索引">
                <B title="标记索引词（登记进索引页）" big icon={<BookmarkAdd20Regular />} disabled={none} run={() => ins.insertInline('idx')}>标记条目</B>
                <Stack>
                  <B title="索引设置" icon={<Grid20Regular />} run={() => useStore.getState().setSection('index')}>索引设置</B>
                </Stack>
              </Group>
            </>
          )}
          {tab === 'review' && (
            <>
              <Group label="批注">
                <B title="新建批注" big icon={<CommentAdd20Regular />} disabled={none} run={newComment}>新建批注</B>
                <Stack>
                  <B title="删除光标所在的批注" icon={<CommentDismiss20Regular />} disabled={!activeComment} run={() => { const c = activeComment; if (c) { chain().unsetComment(c.id).run(); useStore.getState().setComments(comments.filter((x) => x.id !== c.id)); } }}>删除</B>
                  <B title="上一条批注" icon={<ChevronUp20Regular />} disabled={!comments.some((c) => c.key === activeKey)} run={() => stepComment(-1)}>上一条</B>
                  <B title="下一条批注" icon={<ChevronDown20Regular />} disabled={!comments.some((c) => c.key === activeKey)} run={() => stepComment(1)}>下一条</B>
                </Stack>
              </Group>
              <Group label="面板">
                <B title="显示或隐藏批注窗格" big icon={<Comment20Regular />} on={commentsOpen} run={() => useComments.getState().setOpen(!commentsOpen)}>批注窗格</B>
              </Group>
              <Group label="审阅者">
                <span className="rb-keep rb-inline">
                  <Input size="small" value={reviewer} placeholder="审阅者姓名" onChange={(_, d) => useComments.getState().setAuthor(d.value)} style={{ width: 140 }} />
                </span>
              </Group>
            </>
          )}
          {tab === 'table' && ed && (
            <>
              <Group label="行与列">
                <Rows>
                  <Row>
                    <B title="在上方插入行" icon={<TableStackAbove20Regular />} disabled={!inTable} run={() => chain().addRowBefore().run()} />
                    <B title="在下方插入行" icon={<TableStackBelow20Regular />} disabled={!inTable} run={() => chain().addRowAfter().run()} />
                    <B title="删除行" icon={<TableDeleteRow20Regular />} disabled={!inTable} run={() => chain().deleteRow().run()} />
                  </Row>
                  <Row>
                    <B title="在左侧插入列" icon={<TableStackLeft20Regular />} disabled={!inTable} run={() => chain().addColumnBefore().run()} />
                    <B title="在右侧插入列" icon={<TableStackRight20Regular />} disabled={!inTable} run={() => chain().addColumnAfter().run()} />
                    <B title="删除列" icon={<TableDeleteColumn20Regular />} disabled={!inTable} run={() => chain().deleteColumn().run()} />
                  </Row>
                </Rows>
              </Group>
              <Group label="合并">
                <Stack>
                  <B title="合并 / 拆分单元格" icon={<TableCellsMerge20Regular />} disabled={!inTable} run={() => chain().mergeOrSplit().run()}>合并 / 拆分</B>
                  <B title="标题行" icon={<TableFreezeRow20Regular />} disabled={!inTable} run={() => chain().toggleHeaderRow().run()}>标题行</B>
                  <B title="删除整张表" icon={<TableDismiss20Regular />} disabled={!inTable} run={() => chain().deleteTable().run()}>删除表格</B>
                </Stack>
              </Group>
              <Group label="对齐与尺寸">
                <span className="rb-keep rb-inline">{inTable && <TableAlignTools editor={ed} />}</span>
              </Group>
              <Group label="版式">
                <span className="rb-keep rb-inline">
                  <Rows>
                    <Row><ChoiceMenu label="浮动" hint="浮动：表不跟着文字走，Typst 把它放到本页或下页的顶 / 底（figure(placement:)）；浮动的表不跨页" choices={PLACEMENTS} value={(ed.getAttributes('tableFigure').placement as string) || 'none'} onChange={(v) => chain().updateAttributes('tableFigure', { placement: v }).run()} /></Row>
                    <Row><ChoiceMenu label="跨页" hint="表能不能拆到下一页（指南 2.12：一页放不下才可转页，续页表右上角注「续表」）；模板默认允许" choices={BREAK_TABLE} value={(ed.getAttributes('tableFigure').breakable as string) || 'auto'} disabled={((ed.getAttributes('tableFigure').placement as string) || 'none') !== 'none'} onChange={(v) => chain().updateAttributes('tableFigure', { breakable: v }).run()} /></Row>
                    <Row><ChoiceMenu label="自动调整" hint="Word 的「自动调整」：根据内容 / 根据窗口 / 固定列宽；拖过列线的列按拖的来" choices={FITS} value={(ed.getAttributes('tableFigure').fit as string) || 'content'} onChange={(v) => chain().updateAttributes('tableFigure', { fit: v }).run()} /></Row>
                  </Rows>
                </span>
              </Group>
            </>
          )}
          {tab === 'figure' && ed && inFigure && (() => { const a = ed.getAttributes('figure'); const placement = (a.placement as string) || 'none'; return (
            <>
              <Group label="大小">
                <span className="rb-keep rb-inline">
                  <label className="tb-field" title="图的宽度：cm / mm / pt / em / %（相对版心宽）；版心宽约 14.6 cm">
                    宽度 <LengthInput value={a.width ?? 8} defaultUnit="cm" onChange={(v) => chain().updateAttributes('figure', { width: v ?? 8 }).run()} width={96} />
                  </label>
                  <Stack>
                    {['6cm', '10cm', '100%'].map((w) => <B key={w} title={`宽 ${w}`} on={String(a.width) === w} run={() => chain().updateAttributes('figure', { width: w }).run()}>{w}</B>)}
                  </Stack>
                </span>
              </Group>
              <Group label="位置">
                <span className="rb-keep rb-inline">
                  <Rows>
                    <Row><ChoiceMenu label="浮动" hint="浮动：图不跟着文字走，Typst 把它放到本页或下页的顶 / 底（figure(placement:)）；浮动的图不跨页" choices={PLACEMENTS} value={placement} onChange={(v) => chain().updateAttributes('figure', { placement: v }).run()} /></Row>
                    <Row><ChoiceMenu label="跨页" hint="图默认整块不拆（指南 2.13.2）；允许后分图多的图按指南排成「续图」" choices={BREAK_IMAGE} value={(a.breakable as string) || 'auto'} disabled={placement !== 'none'} onChange={(v) => chain().updateAttributes('figure', { breakable: v }).run()} /></Row>
                  </Rows>
                </span>
              </Group>
              <Group label="分图">
                <span className="rb-keep rb-inline">
                  <Rows>
                    <Row><ChoiceMenu label="每行" choices={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} 张` }))} value={String(Math.max(1, Math.min(4, Number(a.columns) || 2)))} onChange={(v) => chain().updateAttributes('figure', { columns: Number(v) }).run()} /></Row>
                    <Row><ChoiceMenu label="分图题" hint="分图题排在分图之下（#subfigure），或跟在图题之下连排（#subs）——指南 2.13.1 的两种" choices={[{ value: 'under', label: '分图之下' }, { value: 'caption', label: '图题之下连排' }]} value={(a.subMode as string) || 'under'} onChange={(v) => chain().updateAttributes('figure', { subMode: v }).run()} /></Row>
                  </Rows>
                </span>
              </Group>
              <Group label="题注">
                <Stack>
                  <B title="编辑题注" icon={<TextDescription20Regular />} run={() => { const pos = ed.state.selection.from; useOpenRequest.getState().request({ key: activeKey!, pos, attr: 'caption' }); }}>题注</B>
                  <B title="编辑英文题注" icon={<Translate20Regular />} run={() => { const pos = ed.state.selection.from; useOpenRequest.getState().request({ key: activeKey!, pos, attr: 'captionEn' }); }}>英文题注</B>
                </Stack>
              </Group>
              <Group label="图片">
                <Stack>
                  <B title="更改图片" icon={<ImageEdit20Regular />} run={replaceImage}>更改图片</B>
                  <B title="删除插图" icon={<Delete20Regular />} run={() => chain().deleteSelection().run()}>删除</B>
                </Stack>
              </Group>
            </>
          ); })()}
          {tab === 'view' && (
            <>
              <Group label="视图">
                <B title="只看编辑" big icon={<PanelLeft20Regular />} on={layout.mode === 'editor'} run={() => layout.setMode('editor')}>编辑</B>
                <B title="编辑 + 预览" big icon={<LayoutColumnTwo20Regular />} on={layout.mode === 'split'} run={() => layout.setMode('split')}>并排查看</B>
                <B title="只看预览" big icon={<PanelRight20Regular />} on={layout.mode === 'preview'} run={() => layout.setMode('preview')}>预览</B>
              </Group>
              <Group label="显示">
                <Stack>
                  <B title={layout.navOpen ? '收起左栏' : '展开左栏'} icon={layout.navOpen ? <PanelLeftContract20Regular /> : <PanelLeftExpand20Regular />} on={layout.navOpen} run={() => layout.setNavOpen(!layout.navOpen)}>导航窗格</B>
                  <B title="大纲：左栏里列出本节的标题，点一下跳过去" icon={<TextBulletListSquare20Regular />} on={outlineOn} run={() => { useOutline.getState().toggle(); if (!layout.navOpen) layout.setNavOpen(true); }}>大纲</B>
                </Stack>
                <B title="显示或隐藏段落标记" big icon={<TextParagraph20Regular />} on={marksOn} run={toggleMarks}>显示/隐藏 ¶</B>
              </Group>
              <Group label="编辑区字号">
                <span className="rb-keep rb-inline"><FontSizeTool /></span>
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
    <div className="findbar" onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Escape') close(); }}>
      <Input ref={input} size="small" contentBefore={<Search20Regular />} value={q} placeholder="查找" onChange={(_, d) => setQ(d.value)} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} className="findbar-input" />
      <span className="findbar-count">{q ? (n ? `${(st!.current % n) + 1} / ${n}` : '无结果') : ''}</span>
      <Button size="small" appearance="subtle" icon={<ChevronLeft20Regular />} title="上一个 (⇧Enter)" disabled={!n} onClick={() => step(-1)} />
      <Button size="small" appearance="subtle" icon={<ChevronRight20Regular />} title="下一个 (Enter)" disabled={!n} onClick={() => step(1)} />
      <Checkbox size="medium" label="区分大小写" checked={cs} onChange={(_, d) => setCs(!!d.checked)} />
      <Sep />
      <Input size="small" contentBefore={<ArrowSwap20Regular />} value={rep} placeholder="替换为" onChange={(_, d) => setRep(d.value)} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } }} className="findbar-input" />
      <Button size="small" disabled={!n} onClick={replaceOne}>替换</Button>
      <Button size="small" disabled={!n} onClick={replaceAll}>全部替换</Button>
      <span className="spacer" />
      {!editor && <span className="muted" style={{ fontSize: 12 }}>请先选择要查找的文本区域</span>}
      <Button size="small" appearance="subtle" icon={<Dismiss20Regular />} title="关闭 (Esc)" onClick={close} />
    </div>
  );
}
