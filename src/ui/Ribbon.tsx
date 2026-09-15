// 功能区：横贯左右、哪里都能用的工具栏，分组照 Word（开始 / 插入 / 引用 / 表格 / 视图）。
// 命令作用于「当前编辑器」——最近聚焦的那份富文本，或预览区里正在编辑的那份；
// 预览的光标就是编辑器的选区，所以在预览里选中一段再按加粗照样生效。
import { useEffect, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useStore, type RichKey } from '../model/store';
import { getEditor, getEditorMeta, onRegistryChange } from '../editor/registry';
import { usePreviewSurface } from './PreviewEditLayer';
import { usePreviewZoom } from './previewZoom';
import { B, Sep, useEditorTick, useInsertActions, TableAlignTools, FontSizeTool } from '../editor/tools';
type LayoutMode = 'editor' | 'split' | 'preview';
import {
  Undo2, Redo2, Pilcrow, Heading1, Heading2, Heading3, Heading4, Bold, Italic, Underline, Superscript, Subscript, Code, IndentDecrease,
  List, ListOrdered, Sigma, SquareFunction, ListTree, Image, Table, CodeXml, MessageSquareQuote, BookmarkPlus, Space, SeparatorHorizontal,
  BookMarked, Link2, Library, BetweenHorizontalStart, BetweenHorizontalEnd, Rows3, Columns3, Minus, BetweenVerticalStart, BetweenVerticalEnd, TableCellsMerge, PanelTop,
  PanelLeftClose, PanelLeftOpen, PanelLeft, Columns2, PanelRight, ZoomIn, ZoomOut, Maximize2, MousePointerClick,
} from 'lucide-react';

type Tab = 'home' | 'insert' | 'cite' | 'table' | 'view';
const TABS: { key: Tab; label: string }[] = [
  { key: 'home', label: '开始' },
  { key: 'insert', label: '插入' },
  { key: 'cite', label: '引用' },
  { key: 'table', label: '表格' },
  { key: 'view', label: '视图' },
];

/** 一个分组：一排按钮，底下一行小字标题（Word 的样子） */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rb-group">
      <div className="rb-items">{children}</div>
      <div className="rb-label">{label}</div>
    </div>
  );
}

export interface RibbonLayout {
  navOpen: boolean;
  setNavOpen: (v: boolean) => void;
  mode: LayoutMode;
  setMode: (m: LayoutMode) => void;
}

export function Ribbon({ layout }: { layout: RibbonLayout }) {
  const activeKey = usePreviewSurface((s) => s.activeKey);
  const section = useStore((s) => s.section);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [autoTable, setAutoTable] = useState(false);
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
  // 光标进表格自动切到「表格」页，出来再切回去（Word 的上下文选项卡）
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

  return (
    <div className={`ribbon ${none ? 'is-idle' : ''}`}>
      <div className="rb-tabs">
        {TABS.filter((t) => t.key !== 'table' || inTable).map((t) => (
          <button key={t.key} type="button" className={`rb-tab ${tab === t.key ? 'on' : ''} ${t.key === 'table' ? 'is-ctx' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { setTab(t.key); setAutoTable(false); }}>{t.label}</button>
        ))}
        <span className="rb-where">{none ? (section === 'info' || section === 'settings' || section === 'pages' ? '这一页是表单，工具栏管不着' : '点一下正文或预览里的字，工具栏就活了') : `编辑：${KEY_NAME[activeKey!] ?? ''}${usePreviewSurface.getState().focused ? '（在预览里）' : ''}`}</span>
      </div>
      <div className="rb-body">
        {tab === 'home' && (
          <>
            <Group label="撤销">
              <B title="撤销 (⌘Z)" run={() => chain().undo().run()} disabled={none || !ed.can().undo()}><Undo2 /></B>
              <B title="重做 (⌘⇧Z)" run={() => chain().redo().run()} disabled={none || !ed.can().redo()}><Redo2 /></B>
            </Group>
            <Group label="样式">
              <B title="正文段落" on={!!ed?.isActive('paragraph')} disabled={none} run={() => chain().setParagraph().run()}><Pilcrow /></B>
              {([1, 2, 3, 4] as const).map((l) => {
                const Icon = [Heading1, Heading2, Heading3, Heading4][l - 1];
                return <B key={l} title={['章', '节', '条', '款'][l - 1] + `（${l} 级标题）`} on={!!ed?.isActive('heading', { level: l })} disabled={none || !headings} run={() => chain().toggleHeading({ level: l }).run()}><Icon /></B>;
              })}
            </Group>
            <Group label="字体">
              <B title="加粗 (⌘B)" on={!!ed?.isActive('bold')} disabled={none} run={() => chain().toggleBold().run()}><Bold /></B>
              <B title="强调（排楷体）(⌘I)" on={!!ed?.isActive('italic')} disabled={none} run={() => chain().toggleItalic().run()}><Italic /></B>
              <B title="下划线 (⌘U)" on={!!ed?.isActive('underline')} disabled={none} run={() => chain().toggleUnderline().run()}><Underline /></B>
              <B title="上标" on={!!ed?.isActive('superscript')} disabled={none} run={() => chain().toggleSuperscript().run()}><Superscript /></B>
              <B title="下标" on={!!ed?.isActive('subscript')} disabled={none} run={() => chain().toggleSubscript().run()}><Subscript /></B>
              <B title="等宽代码" on={!!ed?.isActive('code')} disabled={none} run={() => chain().toggleCode().run()}><Code /></B>
            </Group>
            <Group label="段落">
              <B title="无序列表" on={!!ed?.isActive('bulletList')} disabled={none} run={() => chain().toggleBulletList().run()}><List /></B>
              <B title="编号列表" on={!!ed?.isActive('orderedList')} disabled={none} run={() => chain().toggleOrderedList().run()}><ListOrdered /></B>
              <B title="这一段不首行缩进（接在公式、列表后面的续段）" on={!!ed?.isActive('paragraph', { noIndent: true })} disabled={none} run={() => chain().updateAttributes('paragraph', { noIndent: !ed!.getAttributes('paragraph').noIndent }).run()}><IndentDecrease /></B>
            </Group>
            <Group label="公式">
              <B title="行内公式" disabled={none} run={() => ins.insertInline('mathInline')}><Sigma /></B>
              <B title="行间公式（编号）" disabled={none || !blocks} run={ins.insertEquation}><SquareFunction /></B>
              <B title="式中符号注释（式中 x——…）" disabled={none || !blocks} run={ins.insertDenote}><ListTree /></B>
            </Group>
          </>
        )}
        {tab === 'insert' && (
          <>
            <Group label="图表">
              <B title="插图…" big disabled={none || !blocks} run={ins.insertFigure}><Image />插图</B>
              <B title="表格（3 × 3，带题注）" big disabled={none || !blocks} run={ins.insertTable}><Table />表格</B>
            </Group>
            <Group label="公式">
              <B title="行间公式（编号）" big disabled={none || !blocks} run={ins.insertEquation}><SquareFunction />行间公式</B>
              <B title="行内公式" big disabled={none} run={() => ins.insertInline('mathInline')}><Sigma />行内公式</B>
              <B title="公式底下的「式中 x——…」" big disabled={none || !blocks} run={ins.insertDenote}><ListTree />式中</B>
            </Group>
            <Group label="文本">
              <B title="代码块" big disabled={none || !blocks} run={() => chain().toggleCodeBlock().run()}><CodeXml />代码块</B>
              <B title="脚注" big disabled={none} run={() => ins.insertInline('footnote')}><MessageSquareQuote />脚注</B>
              <B title="索引词（登记进索引页）" big disabled={none} run={() => ins.insertInline('idx')}><BookmarkPlus />索引词</B>
              <B title="空一个汉字宽" big disabled={none} run={() => ins.insertInline('ccwd', { n: 1 })}><Space />空格</B>
            </Group>
            <Group label="页">
              <B title="分页" big disabled={none || !blocks} run={ins.insertPageBreak}><SeparatorHorizontal />分页</B>
            </Group>
          </>
        )}
        {tab === 'cite' && (
          <>
            <Group label="引用">
              <B title="引用参考文献" big disabled={none} run={() => ins.insertInline('cite')}><BookMarked />文献</B>
              <B title="交叉引用图 / 表 / 式 / 节" big disabled={none} run={() => ins.insertInline('ref')}><Link2 />交叉引用</B>
              <B title="缩略语（首次出现自动展开）" big disabled={none} run={() => ins.insertInline('abbr')}><span className="tb-text" style={{ fontSize: 15 }}>Ab</span>缩略语</B>
            </Group>
            <Group label="管理">
              <B title="到「参考文献」页登记条目" big run={() => useStore.getState().setSection('bibliography')}><Library />参考文献</B>
              <B title="到「符号与缩略语」页登记缩略语" big run={() => useStore.getState().setSection('nomenclature')}><span className="tb-text" style={{ fontSize: 15 }}>Σ</span>符号表</B>
            </Group>
          </>
        )}
        {tab === 'table' && ed && (
          <>
            <Group label="行">
              <B title="上方插行" disabled={!inTable} run={() => chain().addRowBefore().run()}><BetweenHorizontalStart /></B>
              <B title="下方插行" disabled={!inTable} run={() => chain().addRowAfter().run()}><BetweenHorizontalEnd /></B>
              <B title="删行" disabled={!inTable} run={() => chain().deleteRow().run()}><Rows3 /><Minus /></B>
            </Group>
            <Group label="列">
              <B title="左侧插列" disabled={!inTable} run={() => chain().addColumnBefore().run()}><BetweenVerticalStart /></B>
              <B title="右侧插列" disabled={!inTable} run={() => chain().addColumnAfter().run()}><BetweenVerticalEnd /></B>
              <B title="删列" disabled={!inTable} run={() => chain().deleteColumn().run()}><Columns3 /><Minus /></B>
            </Group>
            <Group label="单元格">
              <B title="合并 / 拆分单元格" disabled={!inTable} run={() => chain().mergeOrSplit().run()}><TableCellsMerge /></B>
              <B title="表头行切换" disabled={!inTable} run={() => chain().toggleHeaderRow().run()}><PanelTop /></B>
            </Group>
            <Group label="对齐与尺寸">
              {inTable && <TableAlignTools editor={ed} />}
            </Group>
          </>
        )}
        {tab === 'view' && (
          <>
            <Group label="布局">
              <B title={layout.navOpen ? '收起左栏' : '展开左栏'} run={() => layout.setNavOpen(!layout.navOpen)}>{layout.navOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</B>
              <Sep />
              <B title="只看编辑" on={layout.mode === 'editor'} run={() => layout.setMode('editor')}><PanelLeft /></B>
              <B title="编辑 + 预览" on={layout.mode === 'split'} run={() => layout.setMode('split')}><Columns2 /></B>
              <B title="只看预览" on={layout.mode === 'preview'} run={() => layout.setMode('preview')}><PanelRight /></B>
            </Group>
            <Group label="编辑区字号">
              <FontSizeTool />
            </Group>
            <Group label="预览缩放">
              <B title="缩小（触控板捏合、⌘/Ctrl + 滚轮也行）" run={() => zoom.zoomBy(1 / 1.1)}><ZoomOut /></B>
              <B title="回到 100%" run={() => zoom.zoomTo(1)}><span className="tb-text" style={{ minWidth: 38 }}>{Math.round(zoom.zoom * 100)}%</span></B>
              <B title="放大" run={() => zoom.zoomBy(1.1)}><ZoomIn /></B>
              <B title="适宽" run={() => zoom.zoomTo(1)}><Maximize2 /></B>
            </Group>
            <Group label="提示">
              <span className="rb-hint"><MousePointerClick />预览里点哪儿光标落哪儿，直接打字；这里的按钮对预览里的选区同样生效</span>
            </Group>
          </>
        )}
      </div>
    </div>
  );
}

const KEY_NAME: Record<RichKey, string> = { body: '正文', appendix: '附录', conclusion: '结论', abstractZh: '中文摘要', abstractEn: '英文摘要', acknowledgement: '致谢', resume: '个人简历' };
