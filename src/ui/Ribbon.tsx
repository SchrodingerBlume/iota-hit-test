// Word 风格的 Fluent UI 功能区。命令始终作用于当前富文本编辑器；页面视图与编辑区共用选区。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import { create } from 'zustand';
import { TabList, Tab, Button, SplitButton, Popover, PopoverTrigger, PopoverSurface, Tooltip, Input, Checkbox, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, MenuItemCheckbox, MenuDivider, Overflow, OverflowItem, useOverflowMenu, useIsOverflowItemVisible, type MenuButtonProps } from '@fluentui/react-components';
import {
  ArrowUndo20Regular, ArrowRedo20Regular, TextBold20Regular, TextItalic20Regular, TextUnderline20Regular, TextStrikethrough20Regular, TextSubscript20Regular, TextSuperscript20Regular,
  Code20Regular, ClearFormatting20Regular, PaintBrush20Regular, Cut20Regular, Copy20Regular, ClipboardPaste20Regular, TextBulletListLtr20Regular, TextNumberListLtr20Regular, TextIndentDecreaseLtr20Regular,
  Search20Regular, ArrowSwap20Regular, SelectAllOn20Regular, MathFormula20Regular, MathSymbols20Regular, TextDescription20Regular, Image20Regular, Table20Regular, Braces20Regular, TextFootnote20Regular,
  BookmarkAdd20Regular, Spacebar20Regular, DocumentPageBreak20Regular, Omega20Regular, ArrowEnter20Regular, Book20Regular, Link20Regular, Library20Regular, DocumentTableSearch20Regular,
  TextGrammarSettings20Regular, TableStackAbove20Regular, TableStackBelow20Regular, TableDeleteRow20Regular, TableStackLeft20Regular, TableStackRight20Regular, TableDeleteColumn20Regular,
  TableCellsMerge20Regular, TableFreezeRow20Regular, TableDismiss20Regular, PanelLeft20Regular, LayoutColumnTwo20Regular, PanelRight20Regular,
  ChevronUp20Regular, ChevronDown20Regular, ChevronLeft20Regular, ChevronRight20Regular, Dismiss20Regular, Pin20Regular, Grid20Regular, TextParagraph20Regular,
  Translate20Regular, ImageEdit20Regular, Delete20Regular, TableSimple20Regular, ClipboardTextLtr20Regular,
  CommentAdd20Regular, CommentDismiss20Regular, Comment20Regular, TextBulletListSquare20Regular, TextEditStyle20Regular,
  Lightbulb20Regular, History20Regular, BranchFork20Regular, ZoomIn20Regular, AutoFitWidth20Regular, DocumentOnePage20Regular, DocumentMultiple20Regular, TextChangeCase20Regular, TextWordCount20Regular, PanelLeftText20Regular, ChevronDoubleRight16Regular, DocumentHeader20Regular, DocumentFooter20Regular,
} from '@fluentui/react-icons';
import { useStore } from '../model/store';
import { getEditor, getEditorMeta, onRegistryChange } from '../editor/registry';
import { historyLog, entryText } from '../editor/historyLog';
import { usePreviewSurface, usePreviewMarks } from './PreviewEditLayer';
import { useBlockMenu } from '../editor/BlockMenu';
import { THEOREM_KINDS, THEOREM_NAMES } from '../typst/theorem';
import { HistoryDialog, useHistoryDialog } from './HistoryDialog';
import { GitDialog, useGitDialog } from './GitDialog';
import { startAutoHistory } from '../history/history';
import { B, Sep, useEditorTick, useInsertActions, TableAlignTools, FontSizeTool, refocusPreviewAfter } from '../editor/tools';
import { searchKey, selectCurrentMatch } from '../editor/extensions/Search';
import { levelLabels } from '../typst/numbering';
import { ChoiceMenu } from './RibbonSettings';
import { useEditorEnv } from '../editor/env';
import { useOpenRequest } from '../editor/openRequest';
import { usePreviewZoom } from './previewZoom';
import { ZoomMenu, WordCountBadge } from './previewTools';
import { changeCase, type CaseKind } from '../editor/changeCase';
import { convertChinese } from '../editor/zhconvert';
import { FontFamilyPicker, FontSizePicker, FontColorButton, HighlightButton } from './FontTools';
import { useCompileState } from '../compiler/client';
import { useMedia, SHORT } from './useMedia';
import { TableSizeDialog, TableTextDialog, readTableDefaults, type TableDialogKind } from './TableInsert';
import { LengthInput } from './LengthInput';
import { useLinkDialog } from './LinkDialog';
import { HeaderFooterDialog, useHFDialog } from './HeaderFooterDialog';
import { useComments, newCommentId } from '../editor/comments';
import { commentRange } from './CommentsPane';
import { wordAt } from '../editor/wordAt';
import { SymbolPicker, SymbolPanel } from './SymbolPicker';
import { t as tx } from '../i18n';
const FITS = [{ value: 'content', label: tx("根据内容自动调整表格"), hint: tx("根据单元格内容调整列宽") }, { value: 'window', label: tx("根据窗口自动调整表格"), hint: tx("适应版心宽度并平均分配各列") }, { value: 'fixed', label: tx("固定列宽"), hint: tx("各列等宽；可在“插入表格”对话框中设置宽度。") }];

/** 图 / 表的浮动与跨页选项（模板：placement 交给 Typst；跨页走 show figure.where(kind:): set block(breakable:)） */
const PLACEMENTS = [{ value: 'none', label: tx("不浮动"), hint: tx("随文字移动") }, { value: 'auto', label: tx("自动"), hint: tx("就近放置在页顶或页底") }, { value: 'top', label: tx("页顶") }, { value: 'bottom', label: tx("页底") }];
const BREAK_IMAGE = [{ value: 'auto', label: tx("自动（不跨页）"), hint: tx("模板默认将图片和题注保持在同一页。") }, { value: 'true', label: tx("允许"), hint: tx("按指南排「续图」") }, { value: 'false', label: tx("不允许") }];
const BREAK_TABLE = [{ value: 'auto', label: tx("自动（允许跨页）"), hint: tx("模板默认，续页注「续表」") }, { value: 'true', label: tx("允许") }, { value: 'false', label: tx("不允许"), hint: tx("保持整张表格同页；空间不足时移至下一页") }];

type LayoutMode = 'editor' | 'split' | 'preview';
type TabKey = 'home' | 'insert' | 'cite' | 'review' | 'table' | 'figure' | 'view';
const CTX_TABS: TabKey[] = ['table', 'figure'];
const TABS: { key: TabKey; label: string }[] = [
  { key: 'home', label: tx("开始") },
  { key: 'insert', label: tx("插入") },
  { key: 'cite', label: tx("引用") },
  { key: 'review', label: tx("审阅") },
  { key: 'table', label: tx("表格工具") },
  { key: 'figure', label: tx("图片工具") },
  { key: 'view', label: tx("视图") },
];
const COLLAPSE_KEY = 'iota4web-ribbon-collapsed-v2';

/** 查找栏状态，⌘F 共用此入口。 */
export const useFindBar = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

/** 将窄屏中不可见的选项卡移入溢出菜单。 */
function TabOverflowMenu({ tabs, onPick }: { tabs: { key: TabKey; label: string }[]; onPick: (k: TabKey) => void }) {
  const { ref, isOverflowing } = useOverflowMenu<HTMLButtonElement>();
  if (!isOverflowing) return null;
  return (
    <Menu positioning="below-end">
      <MenuTrigger disableButtonEnhancement>
        <Button ref={ref} appearance="subtle" size="small" className="rb-btn rb-tab-more" icon={<ChevronDoubleRight16Regular />} aria-label={tx("更多选项卡")} onMouseDown={(e) => e.preventDefault()} />
      </MenuTrigger>
      <MenuPopover><MenuList>{tabs.map((t) => <HiddenTabItem key={t.key} tab={t} onPick={onPick} />)}</MenuList></MenuPopover>
    </Menu>
  );
}
function HiddenTabItem({ tab, onPick }: { tab: { key: TabKey; label: string }; onPick: (k: TabKey) => void }) {
  const visible = useIsOverflowItemVisible(tab.key);
  if (visible) return null;
  return <MenuItem onClick={() => onPick(tab.key)}>{tab.label}</MenuItem>;
}

/** 功能区分组。 */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rb-group">
      <div className="rb-items">{children}</div>
      <div className="rb-label">{label}</div>
    </div>
  );
}
/** 纵向排列的小按钮。 */
const Stack = ({ children }: { children: ReactNode }) => <div className="rb-stack">{children}</div>;
const Rows = ({ children }: { children: ReactNode }) => <div className="rb-rows">{children}</div>;
const Row = ({ children }: { children: ReactNode }) => <div className="rb-row">{children}</div>;

export interface RibbonLayout {
  navOpen: boolean;
  setNavOpen: (v: boolean) => void;
  mode: LayoutMode;
  setMode: (m: LayoutMode) => void;
}

/** 返回当前活动的富文本编辑器。 */
function useActiveEditor() {
  const activeKey = usePreviewSurface((s) => s.activeKey);
  const [editor, setEditor] = useState<Editor | null>(null);
  useEffect(() => {
    const pick = () => setEditor(activeKey ? getEditor(activeKey) ?? null : null);
    pick();
    return onRegistryChange(pick);
  }, [activeKey]);
  useEditorTick(editor);
  return editor && !editor.isDestroyed ? editor : null;
}

/** 撤消与恢复；撤消菜单支持一次回退多个操作。 */
export function HistoryButtons() {
  const ed = useActiveEditor();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);
  const [, bump] = useState(0);
  const log = ed ? historyLog(ed) : null;
  const undoTop = log?.undo[log.undo.length - 1], redoTop = log?.redo[log.redo.length - 1];
  const items = log ? [...log.undo].reverse() : [];
  const undoN = (n: number) => { setOpen(false); refocusPreviewAfter(() => { for (let i = 0; i < n; i++) ed!.commands.undo(); ed!.commands.focus(); }); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHover(Math.min(items.length, hover + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHover(Math.max(1, hover - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); undoN(hover || 1); }
  };
  return (
    <span className="rb-history">
      <Popover open={open} onOpenChange={(_, d) => { setOpen(d.open); setHover(0); }} positioning="below-start" trapFocus={false}>
        <PopoverTrigger disableButtonEnhancement>
          {(trigger) => (
            <Tooltip content={undoTop ? tx("撤消 {{s}} (⌘Z)", { s: entryText(undoTop) }) : tx("无法撤消 (⌘Z)")} relationship="description" withArrow positioning="below" onVisibleChange={(_, d) => { if (d.visible) bump((n) => n + 1); }}>
              <SplitButton appearance="subtle" size="small" className="rb-split" icon={<ArrowUndo20Regular />} menuIcon={null} disabled={!undoTop}
                primaryActionButton={{ className: 'rb-btn', 'aria-label': tx("撤消"), onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onClick: () => refocusPreviewAfter(() => ed!.chain().focus().undo().run()) }}
                menuButton={{ ...(trigger as MenuButtonProps), className: 'rb-btn rb-menu', 'aria-label': tx("撤消列表"), onMouseDown: (e: React.MouseEvent) => e.preventDefault() }} />
            </Tooltip>
          )}
        </PopoverTrigger>
        <PopoverSurface className="undo-pop" onKeyDown={onKey}>
          <div className="undo-list" onMouseLeave={() => setHover(0)}>
            {items.map((e, i) => <div key={i} className={`undo-item ${i < hover ? 'on' : ''}`} onMouseEnter={() => setHover(i + 1)} onClick={() => undoN(i + 1)}>{entryText(e)}</div>)}
          </div>
          <div className="undo-foot">{hover ? tx("撤消 {{n}} 次操作", { n: hover }) : tx("取消")}</div>
        </PopoverSurface>
      </Popover>
      <B title={redoTop ? tx("恢复 {{s}} (⌘Y)", { s: entryText(redoTop) }) : tx("无法恢复 (⌘Y)")} icon={<ArrowRedo20Regular />} disabled={!redoTop} run={() => ed!.chain().focus().redo().run()} />
    </span>
  );
}

export function Ribbon({ layout, leading, trailing, minimal }: { layout: RibbonLayout; leading?: ReactNode; trailing?: ReactNode; minimal?: boolean }) {
  const activeKey = usePreviewSurface((s) => s.activeKey);
  useEffect(() => startAutoHistory(() => (useStore.getState().view === 'editor' ? useStore.getState().doc : null)), []);
  const settings = useStore((s) => s.doc.settings);
  const docName = useStore((s) => s.doc.name);
  const section = useStore((s) => s.section);
  // 样式格子跟着当前编辑的那一节：附录里是「附录 A / A.1」
  const levels = levelLabels(settings, section === 'appendix' ? 'appendix' : 'body');
  const [tab, setTab] = useState<TabKey>('home');
  const [autoTable, setAutoTable] = useState(false);
  const [userCollapsed, setCollapsed] = useState<boolean>(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  // 矮屏（手机横屏）功能区默认收起，点选项卡临时弹出；宽高够了再照用户的偏好
  const shortScreen = useMedia(SHORT);
  const collapsed = userCollapsed || shortScreen;
  /** 收起状态下临时展开 */
  const [peek, setPeek] = useState(false);
  const [pop, setPop] = useState<'table' | 'symbol' | 'symbol2' | 'theorem' | null>(null);
  const [tableDlg, setTableDlg] = useState<TableDialogKind | null>(null);
  const [painter, setPainter] = useState<Mark[] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const ed = useActiveEditor();
  const meta = activeKey ? getEditorMeta(activeKey) : undefined;
  const ins = useInsertActions(ed);
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
    if (r && ed) { ed.chain().focus().setTextSelection(r).scrollIntoView().run(); useComments.getState().setActive(next.id); }
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
  const toggleMarks = usePreviewMarks((s) => s.toggle);
  const chain = () => ed!.chain().focus();
  const findOpen = useFindBar((s) => s.open);
  const pz = usePreviewZoom();
  const pageCount = useCompileState((s) => s.pageCount);

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
  const shownTabs = TABS.filter((t) => (t.key !== 'table' || inTable) && (t.key !== 'figure' || inFigure));
  // 选项卡那一栏能有多宽：整行减去左边那几个钮、收起钮、右端状态那一串；放不下的选项卡收进 ▾
  const [tabsMax, setTabsMax] = useState<number | undefined>(undefined);
  useEffect(() => {
    const row = root.current?.querySelector<HTMLElement>('.rb-tabs');
    if (!row) return;
    const w = (sel: string) => row.querySelector<HTMLElement>(sel)?.getBoundingClientRect().width ?? 0;
    const measure = () => { const max = Math.floor(row.clientWidth - w('.rb-leading') - w('.rb-trailing') - 44); setTabsMax((prev) => (Math.abs((prev ?? -1) - max) < 1 ? prev : max)); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    for (const sel of ['.rb-leading', '.rb-trailing']) { const el = row.querySelector(sel); if (el) ro.observe(el); }
    return () => ro.disconnect();
  }, [minimal]);
  // Fluent 关闭菜单后会聚焦菜单按钮，因此命令完成后需恢复编辑器焦点。
  const pickCase = (k: CaseKind) => refocusPreviewAfter(() => { if (!ed) return; changeCase(ed, k); setTimeout(() => ed.view.focus(), 0); });
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  const syncRibbonScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setScrollEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !bodyVisible) return;
    const frame = requestAnimationFrame(syncRibbonScroll);
    const resize = new ResizeObserver(syncRibbonScroll);
    resize.observe(el);
    if (el.firstElementChild) resize.observe(el.firstElementChild);
    el.addEventListener('scroll', syncRibbonScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); resize.disconnect(); el.removeEventListener('scroll', syncRibbonScroll); };
  }, [bodyVisible, tab, inTable, inFigure, syncRibbonScroll]);
  // 收起 / 展开的动画不动版面：版面一步到位，抽屉克隆一份盖在原位按高度裁，底下的内容区
  // 整块平移过去。逐帧改高度会让编辑区和十几页的预览每帧重排，跟不上；合成层动画怎么都稳。
  const drawerRef = useRef<HTMLDivElement>(null);
  const openHeight = useRef(0);
  const firstRender = useRef(true);
  // 仅在功能区展开且切换选项卡时测量高度，避免预览更新触发完整 SVG 重排。
  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    if (drawer && bodyVisible) openHeight.current = drawer.getBoundingClientRect().height || openHeight.current;
  }, [bodyVisible, tab]);
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
        <span className="rb-keep"><B title={tx("插入符号")} big={big} menu icon={<Omega20Regular />} disabled={none} run={() => setPop(pop === id ? null : id)}>{big ? tx("符号") : undefined}</B></span>
      </PopoverTrigger>
      <PopoverSurface className="rb-symbols">
        <SymbolPanel autoFocus onPick={(ch) => { chain().insertContent(ch).run(); }} />
      </PopoverSurface>
    </Popover>
  );

  return (
    <div ref={root} className={`ribbon ${none ? 'is-idle' : ''} ${collapsed ? 'is-collapsed' : ''} ${peek ? 'is-peek' : ''}`} onClick={(e) => { const t = e.target as HTMLElement; if (t.closest('.rb-btn') && !t.closest('.rb-keep')) afterCommand(); }}>
      <SymbolPicker onPick={(ch) => { chain().insertContent(ch).run(); }} />
      <HeaderFooterDialog />
      <HistoryDialog />
      <GitDialog />
      <div className="rb-tabs">
        <div className="rb-tabs-left">
          {leading}
          {!minimal && (
            <Overflow minimumVisible={1} padding={0}>
              {/* 选项卡栏撑满左栏剩下的宽（Fluent 的溢出量的是容器宽，内容定宽的话宽回去也不会把选项卡放回来）；
                  固定 / 收起钮放在栏里、跟在最后一个选项卡后面，登记成永不隐藏的项让它们占的宽也算进去 */}
              <TabList selectedValue={bodyVisible ? tab : ''} onTabSelect={(_, d) => onTab(d.value as TabKey)} size="small" appearance="subtle" className="rb-tablist" style={{ maxWidth: tabsMax }}>
                {shownTabs.map((t) => (
                  <OverflowItem key={t.key} id={t.key} priority={t.key === tab ? 2 : 1}>
                    <Tab value={t.key} className={CTX_TABS.includes(t.key) ? 'rb-tab-ctx' : ''} onMouseDown={(e) => e.preventDefault()} onDoubleClick={() => toggleCollapsed(!collapsed)}>{t.label}</Tab>
                  </OverflowItem>
                ))}
                <TabOverflowMenu tabs={shownTabs} onPick={onTab} />
                {collapsed && peek && !shortScreen && <OverflowItem id="pin" priority={99}><Button size="small" appearance="primary" icon={<Pin20Regular />} className="rb-pin" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleCollapsed(false)}>{tx("固定")}</Button></OverflowItem>}
                {!shortScreen && (
                  <OverflowItem id="collapse" priority={99}>
                    <Tooltip content={collapsed ? tx("固定功能区（也可双击选项卡）") : tx("收起功能区（也可双击选项卡）")} relationship="label" positioning="below">
                      <button type="button" className={`fold-btn is-vert rb-collapse ${collapsed ? '' : 'is-open'}`} aria-expanded={!collapsed} aria-label={collapsed ? tx("固定功能区") : tx("收起功能区")} onMouseDown={(e) => e.preventDefault()} onClick={() => toggleCollapsed(!collapsed)}><i className="rb-caret" /></button>
                    </Tooltip>
                  </OverflowItem>
                )}
              </TabList>
            </Overflow>
          )}
        </div>
        {!minimal && <span className="rb-proj" title={docName}>{docName}</span>}
        {trailing}
      </div>
      {!minimal && (
        <div ref={drawerRef} className={`rb-drawer ${bodyVisible ? '' : 'is-closed'}`} aria-hidden={!bodyVisible}>
          <div className="rb-drawer-inner">
            <div className="rb-scroll-shell">
              {scrollEdges.left && <button type="button" className="rb-scroll-arrow is-left" aria-label={tx("向左滚动功能区")} onClick={() => scrollerRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}><ChevronLeft20Regular /></button>}
              <div ref={scrollerRef} className="rb-scroller" onWheel={(event) => { const el = scrollerRef.current; if (!el || el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return; event.preventDefault(); el.scrollLeft += event.deltaY; }}>
                <div className="rb-body" key={tab}>
          {tab === 'home' && (
            <>
              <Group label={tx("剪贴板")}>
                <B title={tx("粘贴（⌘V）")} big icon={<ClipboardPaste20Regular />} disabled={none} run={clipboard.paste}>{tx("粘贴")}</B>
                <Stack>
                  <B title={tx("剪切（⌘X）")} icon={<Cut20Regular />} disabled={none || ed.state.selection.empty} run={clipboard.cut}>{tx("剪切")}</B>
                  <B title={tx("复制（⌘C）")} icon={<Copy20Regular />} disabled={none || ed.state.selection.empty} run={clipboard.copy}>{tx("复制")}</B>
                  <B title={tx("格式刷")} icon={<PaintBrush20Regular />} on={!!painter} disabled={none} run={() => { if (painter) setPainter(null); else if (ed) { const { from, to } = ed.state.selection; const marks = from === to ? ed.state.storedMarks ?? ed.state.selection.$from.marks() : ed.state.doc.resolve(from + 1).marks(); setPainter([...marks]); } }}>{tx("格式刷")}</B>
                </Stack>
              </Group>
              <Group label={tx("字体")}>
                <Rows>
                  <Row>
                    <span className="rb-keep rb-inline"><FontFamilyPicker ed={ed} /><FontSizePicker ed={ed} /></span>
                    <Menu positioning="below-start">
                      <MenuTrigger disableButtonEnhancement>
                        <span className="rb-keep"><B title={tx("更改大小写")} menu icon={<TextChangeCase20Regular />} disabled={none} run={() => {}} /></span>
                      </MenuTrigger>
                      <MenuPopover><MenuList>
                        {([['sentence', tx("句首字母大写")], ['lower', tx("小写")], ['upper', tx("大写")], ['title', tx("每个单词首字母大写")], ['toggle', tx("切换大小写")]] as [CaseKind, string][]).map(([k, label]) => (
                          <MenuItem key={k} onClick={() => pickCase(k)}>{label}</MenuItem>
                        ))}
                        <MenuDivider />
                        <MenuItem onClick={() => pickCase('half')}>{tx("半角")}</MenuItem>
                        <MenuItem onClick={() => pickCase('full')}>{tx("全角")}</MenuItem>
                      </MenuList></MenuPopover>
                    </Menu>
                    <B title={tx("清除格式")} icon={<ClearFormatting20Regular />} disabled={none} run={() => chain().unsetAllMarks().run()} />
                  </Row>
                  <Row>
                    <B title={tx("加粗 (⌘B)")} icon={<TextBold20Regular />} on={!!ed?.isActive('bold')} disabled={none} run={() => chain().toggleBold().run()} />
                    <B title={tx("倾斜 (⌘I)")} icon={<TextItalic20Regular />} on={!!ed?.isActive('italic')} disabled={none} run={() => chain().toggleItalic().run()} />
                    <B title={tx("下划线 (⌘U)")} icon={<TextUnderline20Regular />} on={!!ed?.isActive('underline')} disabled={none} run={() => chain().toggleUnderline().run()} />
                    <B title={tx("删除线")} icon={<TextStrikethrough20Regular />} on={!!ed?.isActive('strike')} disabled={none} run={() => chain().toggleStrike().run()} />
                    <B title={tx("下标 (⌘,)")} icon={<TextSubscript20Regular />} on={!!ed?.isActive('subscript')} disabled={none} run={() => chain().toggleSubscript().run()} />
                    <B title={tx("上标 (⌘.)")} icon={<TextSuperscript20Regular />} on={!!ed?.isActive('superscript')} disabled={none} run={() => chain().toggleSuperscript().run()} />
                    <B title={tx("等宽字体")} icon={<Code20Regular />} on={!!ed?.isActive('code')} disabled={none} run={() => chain().toggleCode().run()} />
                    <span className="rb-keep rb-inline"><HighlightButton ed={ed} /><FontColorButton ed={ed} /></span>
                  </Row>
                </Rows>
              </Group>
              <Group label={tx("段落")}>
                <Rows>
                  <Row>
                    <B title={tx("项目符号")} icon={<TextBulletListLtr20Regular />} on={!!ed?.isActive('bulletList')} disabled={none} run={() => chain().toggleBulletList().run()} />
                    <B title={tx("编号列表（指南里的「项」：（1）接排）")} icon={<TextNumberListLtr20Regular />} on={!!ed?.isActive('orderedList')} disabled={none} run={() => chain().toggleOrderedList().run()} />
                    <B title={tx("取消本段首行缩进；适用于公式或列表后的续段。")} icon={<TextIndentDecreaseLtr20Regular />} on={!!ed?.isActive('paragraph', { noIndent: true })} disabled={none} run={() => chain().updateAttributes('paragraph', { noIndent: !ed!.getAttributes('paragraph').noIndent }).run()} />
                  </Row>
                  <Row>
                    <B title={tx("连续空段落将保留为空行。")} icon={<ArrowEnter20Regular />} disabled={none} run={() => chain().splitBlock().run()} />
                    <B title={tx("插入一个汉字宽的空格")} icon={<Spacebar20Regular />} disabled={none} run={() => ins.insertInline('ccwd', { n: 1 })} />
                    <span className="rb-split">
                      <B title={tx("显示/隐藏编辑标记")} icon={<TextParagraph20Regular />} on={marksOn} run={toggleMarks} />
                      <Menu checkedValues={{ k: (['paragraph', 'space', 'gutter'] as const).filter((k) => markKinds[k]) }} onCheckedValueChange={(_, d) => { for (const k of ['paragraph', 'space', 'gutter'] as const) usePreviewMarks.getState().setKind(k, d.checkedItems.includes(k)); }} positioning="below-start">
                        <MenuTrigger disableButtonEnhancement>
                          <span className="rb-keep"><B title={tx("选择显示哪些标记")} menu run={() => {}} /></span>
                        </MenuTrigger>
                        <MenuPopover><MenuList>
                          <MenuItemCheckbox name="k" value="paragraph">{tx("段落标记 ¶")}</MenuItemCheckbox>
                          <MenuItemCheckbox name="k" value="space">{tx("空格 ·")}</MenuItemCheckbox>
                          <MenuItemCheckbox name="k" value="gutter">{tx("顶格符 ⇤")}</MenuItemCheckbox>
                        </MenuList></MenuPopover>
                      </Menu>
                    </span>
                  </Row>
                </Rows>
              </Group>
              <Group label={tx("样式")}>
                <div className="rb-styles">
                  <button type="button" className={`rb-style rb-style-p ${ed?.isActive('paragraph') ? 'on' : ''}`} disabled={none} title={tx("正文段落")} onMouseDown={(e) => e.preventDefault()} onClick={() => refocusPreviewAfter(() => chain().setParagraph().run())} onContextMenu={(e) => { e.preventDefault(); useBlockMenu.getState().openStyle(0); }}><span>{tx("正文")}</span></button>
                  {levels.map(({ level: l, name, sample }) => (
                    <button key={l} type="button" className={`rb-style rb-style-h${l} ${ed?.isActive('heading', { level: l }) ? 'on' : ''}`} disabled={none || !headings} title={tx("{{v0}}标题（{{l}} 级）", { v0: name || tx("{{l}} 级", { l: l }), l: l })} onMouseDown={(e) => e.preventDefault()} onClick={() => refocusPreviewAfter(() => chain().toggleHeading({ level: l as 1 | 2 | 3 | 4 }).run())} onContextMenu={(e) => { e.preventDefault(); useBlockMenu.getState().openStyle(l); }}><span>{sample}</span><small>{name || tx("{{l}} 级", { l: l })}</small><b className="rb-style-short">H{l}</b></button>
                  ))}
                  <button type="button" className={`rb-style rb-style-item ${ed?.isActive('orderedList') ? 'on' : ''}`} disabled={none} title={tx("编号列表")} onMouseDown={(e) => e.preventDefault()} onClick={() => refocusPreviewAfter(() => chain().toggleOrderedList().run())}><span>（1）</span><small>{tx("项")}</small></button>
                </div>
              </Group>
              <Group label={tx("编辑")}>
                <Stack>
                  <B title={tx("查找 (⌘F)")} icon={<Search20Regular />} on={findOpen} run={() => useFindBar.getState().set(!findOpen)}>{tx("查找")}</B>
                  <B title={tx("替换 (⌘H)")} icon={<ArrowSwap20Regular />} run={() => useFindBar.getState().set(true)}>{tx("替换")}</B>
                  <B title={tx("全选 (⌘A)")} icon={<SelectAllOn20Regular />} disabled={none} run={() => chain().selectAll().run()}>{tx("全选")}</B>
                </Stack>
              </Group>
            </>
          )}
          {tab === 'insert' && (
            <>
              <Group label={tx("页面")}>
                <B title={tx("分页符")} big icon={<DocumentPageBreak20Regular />} disabled={none || !blocks} run={ins.insertPageBreak}>{tx("分页符")}</B>
              </Group>
              <Group label={tx("页眉和页脚")}>
                <B title={tx("页眉：排不排、距边界、字体字号行距、横线；页眉印什么按规范由模板定，这里能改字")} big icon={<DocumentHeader20Regular />} run={() => useHFDialog.getState().show('header')}>{tx("页眉")}</B>
                <B title={tx("页脚：排不排、距边界、字号行距、横线；页码格式按规范由模板定")} big icon={<DocumentFooter20Regular />} run={() => useHFDialog.getState().show('footer')}>{tx("页脚")}</B>
              </Group>
              <Group label={tx("表格和图片")}>
                <Popover open={pop === 'table'} onOpenChange={(_, d) => setPop(d.open ? 'table' : null)} positioning="below-start" trapFocus={false}>
                  <PopoverTrigger disableButtonEnhancement>
                    <span className="rb-keep"><B title={tx("插入表格；拖动选择行数和列数")} big menu icon={<Table20Regular />} disabled={none || !blocks} run={() => setPop(pop === 'table' ? null : 'table')}>{tx("表格")}</B></span>
                  </PopoverTrigger>
                  <PopoverSurface className="rb-table-grid">
                    <TableGrid onPick={(rows, cols) => { const d = readTableDefaults(); ins.insertTable(rows, cols, d.header, d.fit === 'fixed' && d.colWidth === 'auto' ? 'content' : d.fit, d.colWidth === 'auto' ? 2.5 : d.colWidth); setPop(null); afterCommand(); }} />
                    <div className="rb-pop-menu">
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setPop(null); setTableDlg('size'); }}><TableSimple20Regular />{tx("插入表格…")}</button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setPop(null); setTableDlg('text'); }}><ClipboardTextLtr20Regular />{tx("从文本 / Markdown 插入…")}</button>
                    </div>
                  </PopoverSurface>
                </Popover>
                {tableDlg === 'size' && <TableSizeDialog onClose={() => setTableDlg(null)} onInsert={(r, c, h, fit, cw) => { setTableDlg(null); ins.insertTable(r, c, h, fit, cw); afterCommand(); }} />}
                {tableDlg === 'text' && <TableTextDialog onClose={() => setTableDlg(null)} onInsert={(t, h) => { setTableDlg(null); ins.insertTableFromText(t, h); afterCommand(); }} />}
                <B title={tx("插入图片；也可将图片直接粘贴到正文中")} big icon={<Image20Regular />} disabled={none || !blocks} run={ins.insertFigure}>{tx("图片")}</B>
              </Group>
              <Group label={tx("链接与符号")}>
                <B title={tx("插入链接（⌘K）")} big icon={<Link20Regular />} disabled={none} run={() => useLinkDialog.getState().open()}>{tx("链接")}</B>
                {symbolPop('symbol2', true)}
              </Group>
              <Group label={tx("公式")}>
                <B title={tx("插入带编号的行间公式")} big icon={<MathFormula20Regular />} disabled={none || !blocks} run={ins.insertEquation}>{tx("公式")}</B>
                <Stack>
                  <B title={tx("行内公式")} icon={<MathSymbols20Regular />} disabled={none} run={() => ins.insertInline('mathInline')}>{tx("行内公式")}</B>
                  <B title={tx("在公式下方插入“式中”符号说明")} icon={<TextDescription20Regular />} disabled={none || !blocks} run={ins.insertDenote}>{tx("式中")}</B>
                </Stack>
              </Group>
              <Group label={tx("算法与代码")}>
                <B title={tx("插入算法")} big icon={<TextBulletListSquare20Regular />} disabled={none || !blocks} run={ins.insertAlgorithm}>{tx("算法")}</B>
                <Stack>
                  <B title={tx("插入不带题注的代码块，并应用模板代码样式。")} icon={<Braces20Regular />} disabled={none || !blocks} run={() => chain().toggleCodeBlock().run()}>{tx("代码块")}</B>
                  <B title={tx("插入代码清单")} icon={<Code20Regular />} disabled={none || !blocks} run={ins.insertCodeFigure}>{tx("代码清单")}</B>
                </Stack>
              </Group>
              <Group label={tx("定理")}>
                <Popover open={pop === 'theorem'} onOpenChange={(_, d) => setPop(d.open ? 'theorem' : null)} positioning="below-start" trapFocus={false}>
                  <PopoverTrigger disableButtonEnhancement>
                    <span className="rb-keep"><B title={tx("插入定理、引理、定义等环境；头用黑体，编号与公式一样按章")} big menu icon={<Lightbulb20Regular />} disabled={none || !blocks} run={() => setPop(pop === 'theorem' ? null : 'theorem')}>{tx("定理")}</B></span>
                  </PopoverTrigger>
                  <PopoverSurface className="rb-theorem-menu">
                    <div className="rb-pop-menu">
                      {THEOREM_KINDS.map((k) => <button key={k} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setPop(null); ins.insertTheorem(k); afterCommand(); }}><span className="rb-thm-zh">{THEOREM_NAMES[k].zh}</span><span className="muted">{THEOREM_NAMES[k].en}</span></button>)}
                    </div>
                  </PopoverSurface>
                </Popover>
              </Group>
            </>
          )}
          {tab === 'cite' && (
            <>
              <Group label={tx("目录")}>
                <B title={tx("目录设置")} big icon={<DocumentTableSearch20Regular />} run={() => useStore.getState().setSection('toc')}>{tx("目录")}</B>
                <Stack>
                  <B title={tx("设置各级目录条目的行距、字体和字号。")} icon={<TextEditStyle20Regular />} run={() => useBlockMenu.getState().openStyle(-1)}>{tx("目录样式…")}</B>
                </Stack>
              </Group>
              <Group label={tx("引文与书目")}>
                <B title={tx("引用参考文献")} big icon={<Book20Regular />} disabled={none} run={() => ins.insertInline('cite')}>{tx("插入引文")}</B>
                <Stack>
                  <B title={tx("管理源")} icon={<Library20Regular />} run={() => useStore.getState().setSection('bibliography')}>{tx("管理源")}</B>
                  <B title={tx("打开“成果”页，登记攻读学位期间取得的成果。")} icon={<TextGrammarSettings20Regular />} run={() => useStore.getState().setSection('achievements')}>{tx("成果")}</B>
                </Stack>
              </Group>
              <Group label={tx("题注")}>
                <B title={tx("插入图、表、公式或标题的交叉引用")} big icon={<Link20Regular />} disabled={none} run={() => ins.insertInline('ref')}>{tx("交叉引用")}</B>
              </Group>
              <Group label={tx("脚注")}>
                <B title={tx("插入脚注")} big icon={<TextFootnote20Regular />} disabled={none} run={() => ins.insertInline('footnote')}>{tx("插入脚注")}</B>
                <Stack>
                  <B title={tx("上一条脚注")} icon={<ChevronUp20Regular />} disabled={none} run={() => stepNode('footnote', -1)}>{tx("上一条")}</B>
                  <B title={tx("下一条脚注")} icon={<ChevronDown20Regular />} disabled={none} run={() => stepNode('footnote', 1)}>{tx("下一条")}</B>
                </Stack>
              </Group>
              <Group label={tx("缩略语")}>
                <B title={tx("缩略语（首次出现自动展开）")} big icon={<span className="rb-glyph">Ab</span>} disabled={none} run={() => ins.insertInline('abbr')}>{tx("缩略语")}</B>
                <Stack>
                  <B title={tx("到「符号与缩略语」页登记")} icon={<MathSymbols20Regular />} run={() => useStore.getState().setSection('nomenclature')}>{tx("管理缩略语")}</B>
                </Stack>
              </Group>
              <Group label={tx("索引")}>
                <B title={tx("将所选文字标记为索引项")} big icon={<BookmarkAdd20Regular />} disabled={none} run={() => ins.insertInline('idx')}>{tx("标记条目")}</B>
                <Stack>
                  <B title={tx("索引设置")} icon={<Grid20Regular />} run={() => useStore.getState().setSection('index')}>{tx("索引设置")}</B>
                </Stack>
              </Group>
            </>
          )}
          {tab === 'review' && (
            <>
              <Group label={tx("批注")}>
                <B title={tx("新建批注")} big icon={<CommentAdd20Regular />} disabled={none} run={newComment}>{tx("新建批注")}</B>
                <Stack>
                  <B title={tx("删除光标所在的批注")} icon={<CommentDismiss20Regular />} disabled={!activeComment} run={() => { const c = activeComment; if (c) { chain().unsetComment(c.id).run(); useStore.getState().setComments(comments.filter((x) => x.id !== c.id)); } }}>{tx("删除")}</B>
                  <B title={tx("上一条批注")} icon={<ChevronUp20Regular />} disabled={!comments.some((c) => c.key === activeKey)} run={() => stepComment(-1)}>{tx("上一条")}</B>
                  <B title={tx("下一条批注")} icon={<ChevronDown20Regular />} disabled={!comments.some((c) => c.key === activeKey)} run={() => stepComment(1)}>{tx("下一条")}</B>
                </Stack>
              </Group>
              <Group label={tx("窗格")}>
                <B title={tx("显示或隐藏批注窗格")} big icon={<Comment20Regular />} on={commentsOpen} run={() => useComments.getState().setOpen(!commentsOpen)}>{tx("批注窗格")}</B>
              </Group>
              <Group label={tx("校对")}>
                <WordCountBadge pages={pageCount}><span className="rb-keep"><B title={tx("字数统计")} big icon={<TextWordCount20Regular />} run={() => {}}>{tx("字数统计")}</B></span></WordCountBadge>
              </Group>
              <Group label={tx("中文简繁转换")}>
                <B title={tx("简体中文转换为繁体中文")} big icon={<Translate20Regular />} disabled={none} run={() => void convertChinese(ed!, 'zh-Hant')}>{tx("简转繁")}</B>
                <B title={tx("繁体中文转换为简体中文")} big icon={<Translate20Regular />} disabled={none} run={() => void convertChinese(ed!, 'zh-Hans')}>{tx("繁转简")}</B>
              </Group>
              <Group label={tx("审阅者")}>
                <span className="rb-keep rb-inline">
                  <Input size="small" value={reviewer} placeholder={tx("审阅者姓名")} onChange={(_, d) => useComments.getState().setAuthor(d.value)} style={{ width: 140 }} />
                </span>
              </Group>
              <Group label={tx("版本")}>
                <B title={tx("本地历史：每 5 分钟自动存一份快照，能看差异、整份恢复")} big icon={<History20Regular />} run={() => useHistoryDialog.getState().set(true)}>{tx("本地历史")}</B>
                <B title={tx("Git：有名称的提交、差异、恢复，连上 GitHub 能推能拉")} big icon={<BranchFork20Regular />} run={() => useGitDialog.getState().set(true)}>Git</B>
              </Group>
            </>
          )}
          {tab === 'table' && ed && (
            <>
              <Group label={tx("行与列")}>
                <Rows>
                  <Row>
                    <B title={tx("在上方插入行")} icon={<TableStackAbove20Regular />} disabled={!inTable} run={() => chain().addRowBefore().run()} />
                    <B title={tx("在下方插入行")} icon={<TableStackBelow20Regular />} disabled={!inTable} run={() => chain().addRowAfter().run()} />
                    <B title={tx("删除行")} icon={<TableDeleteRow20Regular />} disabled={!inTable} run={() => chain().deleteRow().run()} />
                  </Row>
                  <Row>
                    <B title={tx("在左侧插入列")} icon={<TableStackLeft20Regular />} disabled={!inTable} run={() => chain().addColumnBefore().run()} />
                    <B title={tx("在右侧插入列")} icon={<TableStackRight20Regular />} disabled={!inTable} run={() => chain().addColumnAfter().run()} />
                    <B title={tx("删除列")} icon={<TableDeleteColumn20Regular />} disabled={!inTable} run={() => chain().deleteColumn().run()} />
                  </Row>
                </Rows>
              </Group>
              <Group label={tx("合并")}>
                <Stack>
                  <B title={tx("合并或拆分单元格")} icon={<TableCellsMerge20Regular />} disabled={!inTable} run={() => chain().mergeOrSplit().run()}>{tx("合并或拆分")}</B>
                  <B title={tx("标题行")} icon={<TableFreezeRow20Regular />} disabled={!inTable} run={() => chain().toggleHeaderRow().run()}>{tx("标题行")}</B>
                  <B title={tx("删除整张表")} icon={<TableDismiss20Regular />} disabled={!inTable} run={() => chain().deleteTable().run()}>{tx("删除表格")}</B>
                </Stack>
              </Group>
              <Group label={tx("对齐与尺寸")}>
                <span className="rb-keep rb-inline">{inTable && <TableAlignTools editor={ed} />}</span>
              </Group>
              <Group label={tx("版式")}>
                <span className="rb-keep rb-inline">
                  <Rows>
                    <Row><ChoiceMenu label={tx("浮动")} hint={tx("文字环绕")} choices={PLACEMENTS} value={(ed.getAttributes('tableFigure').placement as string) || 'none'} onChange={(v) => chain().updateAttributes('tableFigure', { placement: v }).run()} /></Row>
                    <Row><ChoiceMenu label={tx("跨页")} hint={tx("允许跨页断行")} choices={BREAK_TABLE} value={(ed.getAttributes('tableFigure').breakable as string) || 'auto'} disabled={((ed.getAttributes('tableFigure').placement as string) || 'none') !== 'none'} onChange={(v) => chain().updateAttributes('tableFigure', { breakable: v }).run()} /></Row>
                    <Row><ChoiceMenu label={tx("自动调整")} hint={tx("自动调整")} choices={FITS} value={(ed.getAttributes('tableFigure').fit as string) || 'content'} onChange={(v) => chain().updateAttributes('tableFigure', { fit: v }).run()} /></Row>
                  </Rows>
                </span>
              </Group>
            </>
          )}
          {tab === 'figure' && ed && inFigure && (() => { const a = ed.getAttributes('figure'); const placement = (a.placement as string) || 'none'; return (
            <>
              <Group label={tx("大小")}>
                <span className="rb-keep rb-inline">
                  <label className="tb-field" title={tx("宽度")}>
                    {tx("宽度")}{' '}<LengthInput value={a.width ?? 8} defaultUnit="cm" onChange={(v) => chain().updateAttributes('figure', { width: v ?? 8 }).run()} width={96} />
                  </label>
                  <Stack>
                    {['6cm', '10cm', '100%'].map((w) => <B key={w} title={tx("宽 {{w}}", { w: w })} on={String(a.width) === w} run={() => chain().updateAttributes('figure', { width: w }).run()}>{w}</B>)}
                  </Stack>
                </span>
              </Group>
              <Group label={tx("位置")}>
                <span className="rb-keep rb-inline">
                  <Rows>
                    <Row><ChoiceMenu label={tx("浮动")} hint={tx("位置")} choices={PLACEMENTS} value={placement} onChange={(v) => chain().updateAttributes('figure', { placement: v }).run()} /></Row>
                    <Row><ChoiceMenu label={tx("跨页")} hint={tx("允许跨页")} choices={BREAK_IMAGE} value={(a.breakable as string) || 'auto'} disabled={placement !== 'none'} onChange={(v) => chain().updateAttributes('figure', { breakable: v }).run()} /></Row>
                  </Rows>
                </span>
              </Group>
              <Group label={tx("分图")}>
                <span className="rb-keep rb-inline">
                  <Rows>
                    <Row><ChoiceMenu label={tx("每行")} choices={[{ value: '0', label: tx("一行排完") }, ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: tx("{{n}} 张", { n: n }) }))]} value={String(Math.max(0, Math.min(4, Number(a.columns) ?? 2)))} onChange={(v) => chain().updateAttributes('figure', { columns: Number(v) }).run()} /></Row>
                    <Row><ChoiceMenu label={tx("分图题注")} hint={tx("分图题注位置")} choices={[{ value: 'under', label: tx("分图之下") }, { value: 'caption', label: tx("图题之下连排") }]} value={(a.subMode as string) || 'under'} onChange={(v) => chain().updateAttributes('figure', { subMode: v }).run()} /></Row>
                    <Row><ChoiceMenu label={tx("图上标签")} hint={tx("(a)(b) 直接印在图角上")} choices={[{ value: 'none', label: tx("不印") }, { value: 'tl', label: tx("左上") }, { value: 'tr', label: tx("右上") }, { value: 'bl', label: tx("左下") }, { value: 'br', label: tx("右下") }]} value={(a.subLabel as string) || 'none'} onChange={(v) => chain().updateAttributes('figure', { subLabel: v }).run()} /><ChoiceMenu label={tx("标签色")} choices={[{ value: 'black', label: tx("黑") }, { value: 'white', label: tx("白（深色图）") }]} value={(a.subLabelFill as string) || 'black'} onChange={(v) => chain().updateAttributes('figure', { subLabelFill: v }).run()} /></Row>
                  </Rows>
                </span>
              </Group>
              <Group label={tx("题注")}>
                <Stack>
                  <B title={tx("编辑题注")} icon={<TextDescription20Regular />} run={() => { const pos = ed.state.selection.from; useOpenRequest.getState().request({ key: activeKey!, pos, attr: 'caption' }); }}>{tx("题注")}</B>
                  <B title={tx("编辑英文题注")} icon={<Translate20Regular />} run={() => { const pos = ed.state.selection.from; useOpenRequest.getState().request({ key: activeKey!, pos, attr: 'captionEn' }); }}>{tx("英文题注")}</B>
                </Stack>
              </Group>
              <Group label={tx("图片")}>
                <Stack>
                  <B title={tx("更改图片")} icon={<ImageEdit20Regular />} run={replaceImage}>{tx("更改图片")}</B>
                  <B title={tx("删除插图")} icon={<Delete20Regular />} run={() => chain().deleteSelection().run()}>{tx("删除")}</B>
                </Stack>
              </Group>
            </>
          ); })()}
          {tab === 'view' && (
            <>
              <Group label={tx("视图")}>
                <B title={tx("仅显示编辑器")} big icon={<PanelLeft20Regular />} on={layout.mode === 'editor'} run={() => layout.setMode('editor')}>{tx("编辑")}</B>
                <B title={tx("并排显示编辑器和预览")} big icon={<LayoutColumnTwo20Regular />} on={layout.mode === 'split'} run={() => layout.setMode('split')}>{tx("并排查看")}</B>
                <B title={tx("仅显示页面视图")} big icon={<PanelRight20Regular />} on={layout.mode === 'preview'} run={() => layout.setMode('preview')}>{tx("预览")}</B>
              </Group>
              <Group label={tx("显示")}>
                <B title={tx("显示或隐藏左侧导航窗格")} big icon={<PanelLeftText20Regular />} on={layout.navOpen} run={() => layout.setNavOpen(!layout.navOpen)}>{tx("导航窗格")}</B>
              </Group>
              <Group label={tx("缩放")}>
                <ZoomMenu zoom={pz.zoom} zoomTo={pz.zoomTo} fitPage={pz.fitPage}><span className="rb-keep"><B title={tx("打开“缩放”菜单")} big menu icon={<ZoomIn20Regular />} run={() => {}}>{tx("缩放")}</B></span></ZoomMenu>
                <B title={tx("按窗口宽度显示页面")} big icon={<AutoFitWidth20Regular />} run={() => pz.zoomTo(1)}>{tx("页宽")}</B>
                <B title={tx("在窗口中显示一整页")} big icon={<DocumentOnePage20Regular />} on={pz.perRow === 1} run={() => { pz.setPerRow(1); pz.fitPage(); }}>{tx("单页")}</B>
                <B title={tx("并排显示多页")} big icon={<DocumentMultiple20Regular />} on={pz.perRow > 1} run={() => pz.setPerRow(pz.perRow > 1 ? 1 : 2)}>{tx("多页")}</B>
              </Group>
              <Group label={tx("编辑区字号")}>
                <span className="rb-keep rb-inline"><FontSizeTool /></span>
              </Group>
            </>
          )}
                </div>
              </div>
              {scrollEdges.right && <button type="button" className="rb-scroll-arrow is-right" aria-label={tx("向右滚动功能区")} onClick={() => scrollerRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}><ChevronRight20Regular /></button>}
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
      <div className="rb-grid-label">{hover[0] && hover[1] ? tx("{{v0}} 行 × {{v1}} 列的表格", { v0: hover[0], v1: hover[1] }) : tx("插入表格")}</div>
      <div className="rb-grid" onMouseLeave={() => setHover([0, 0])}>
        {Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => (
          <button key={`${r}-${c}`} type="button" className={`rb-cell ${r < hover[0] && c < hover[1] ? 'on' : ''}`} onMouseEnter={() => setHover([r + 1, c + 1])} onClick={() => onPick(r + 1, c + 1)} title={`${r + 1} × ${c + 1}`} />
        )))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{tx("第一行作为表头；在表格上方输入题注。")}</div>
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
      <Input ref={input} size="small" contentBefore={<Search20Regular />} value={q} placeholder={tx("查找")} onChange={(_, d) => setQ(d.value)} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} className="findbar-input" />
      <span className="findbar-count">{q ? (n ? `${(st!.current % n) + 1} / ${n}` : tx("无结果")) : ''}</span>
      <Button size="small" appearance="subtle" icon={<ChevronLeft20Regular />} title={tx("上一个 (⇧Enter)")} disabled={!n} onClick={() => step(-1)} />
      <Button size="small" appearance="subtle" icon={<ChevronRight20Regular />} title={tx("下一个 (Enter)")} disabled={!n} onClick={() => step(1)} />
      <Checkbox size="medium" label={tx("区分大小写")} checked={cs} onChange={(_, d) => setCs(!!d.checked)} />
      <Sep />
      <Input size="small" contentBefore={<ArrowSwap20Regular />} value={rep} placeholder={tx("替换为")} onChange={(_, d) => setRep(d.value)} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } }} className="findbar-input" />
      <Button size="small" disabled={!n} onClick={replaceOne}>{tx("替换")}</Button>
      <Button size="small" disabled={!n} onClick={replaceAll}>{tx("全部替换")}</Button>
      <span className="spacer" />
      {!editor && <span className="muted" style={{ fontSize: 12 }}>{tx("请先选择要查找的文本区域")}</span>}
      <Button size="small" appearance="subtle" icon={<Dismiss20Regular />} title={tx("关闭 (Esc)")} onClick={close} />
    </div>
  );
}
