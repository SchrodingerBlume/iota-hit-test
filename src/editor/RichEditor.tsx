// 富文本编辑器：TipTap + 我们的节点。value 是 ProseMirror JSON，onChange 回同样的 JSON。
// 工具栏一行：常用的摆在外面，插入类的收进「插入」菜单；选中文字时浮出气泡菜单。
import { useEffect, useMemo, useRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import { AlignedTableCell, AlignedTableHeader, SizedTableRow, TableExtras } from './extensions/table';
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
import { B, Sep, useEditorTick, useInsertActions, useRichSize } from './tools';
import { MirrorCaret, mirrorCaretKey } from './extensions/MirrorCaret';
import { Search } from './extensions/Search';
import { useFindBar } from '../ui/Ribbon';
import { recordTransaction, invalidatePositions } from './versions';
import { usePreviewSurface } from '../ui/PreviewEditLayer';
import { TextBold20Regular, TextItalic20Regular, TextUnderline20Regular, TextSuperscript20Regular, TextSubscript20Regular, Code20Regular, MathFormula20Regular, Book20Regular, BookmarkAdd20Regular } from '@fluentui/react-icons';

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
      UniqueId, MirrorCaret, Search,
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
      // ⌘F / ⌘H 开查找替换栏（Word 的习惯）
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && (event.key === 'f' || event.key === 'h')) { event.preventDefault(); useFindBar.getState().set(true); return true; }
        return false;
      },
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
    registerEditor(richKey, editor, { blocks, headings });
    // 没有当前编辑器（或它已经没了）就把这份当作当前的，功能区才有东西可作用
    const cur = usePreviewSurface.getState().activeKey;
    if (!cur || cur === richKey) usePreviewSurface.getState().set({ activeKey: richKey });
    const onFocus = () => usePreviewSurface.getState().set({ activeKey: richKey });
    editor.on('focus', onFocus);
    return () => { editor.off('focus', onFocus); unregisterEditor(richKey, editor); };
  }, [editor, richKey, blocks, headings]);

  // 预览区里在编辑这份文档时，左边画影子光标；预览失焦就收
  useEffect(() => {
    if (!editor || !richKey) return;
    const apply = () => {
      const s = usePreviewSurface.getState();
      const on = s.focused && s.activeKey === richKey;
      if (mirrorCaretKey.getState(editor.state) !== on && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(mirrorCaretKey, on));
    };
    apply();
    return usePreviewSurface.subscribe(apply);
  }, [editor, richKey]);

  return (
    <NumberingContext.Provider value={numbering}>
      <RichKeyContext.Provider value={richKey}>
        <div className={`editor ${className ?? ''}`} style={{ '--rich-size': `${richSize}px` } as React.CSSProperties}>
          {editor && <Bubble editor={editor} />}
          <EditorContent editor={editor} className="editor-body" />
        </div>
      </RichKeyContext.Provider>
    </NumberingContext.Provider>
  );
}

/** 选中文字时浮出来的小菜单 */
// BubbleMenu 每次拿到新的 shouldShow / options 就重新注册插件（会发一次事务），
// 而我们又靠事务触发重绘——两个对象必须是稳定的，否则互相触发无限循环
const bubbleOptions = { placement: 'top' as const, offset: 8 };
const bubbleShouldShow = ({ editor, state }: { editor: Editor; state: Editor['state'] }) => {
  const { from, to } = state.selection;
  if (from === to || state.selection instanceof NodeSelection) return false;
  // 预览区里选的字，选区是镜像过来的，气泡不该在左边冒出来——功能区就在头顶
  if (!editor.isFocused) return false;
  return editor.isEditable && !editor.isActive('codeBlock');
};
function Bubble({ editor }: { editor: Editor }) {
  useEditorTick(editor);
  const { insertInline } = useInsertActions(editor);
  return (
    <BubbleMenu editor={editor} className="bubble" options={bubbleOptions} shouldShow={bubbleShouldShow}>
      <B title="加粗" icon={<TextBold20Regular />} on={editor.isActive('bold')} run={() => editor.chain().focus().toggleBold().run()} />
      <B title="强调" icon={<TextItalic20Regular />} on={editor.isActive('italic')} run={() => editor.chain().focus().toggleItalic().run()} />
      <B title="下划线" icon={<TextUnderline20Regular />} on={editor.isActive('underline')} run={() => editor.chain().focus().toggleUnderline().run()} />
      <B title="下标" icon={<TextSubscript20Regular />} on={editor.isActive('subscript')} run={() => editor.chain().focus().toggleSubscript().run()} />
      <B title="上标" icon={<TextSuperscript20Regular />} on={editor.isActive('superscript')} run={() => editor.chain().focus().toggleSuperscript().run()} />
      <B title="等宽代码" icon={<Code20Regular />} on={editor.isActive('code')} run={() => editor.chain().focus().toggleCode().run()} />
      <Sep />
      <B title="变成行内公式（LaTeX）" icon={<MathFormula20Regular />} run={() => { const { from, to } = editor.state.selection; const text = editor.state.doc.textBetween(from, to, ' '); editor.chain().focus().insertContent({ type: 'mathInline', attrs: { src: text, mode: 'latex' } }).run(); }} />
      <B title="在此引用文献" icon={<Book20Regular />} run={() => { editor.chain().focus().setTextSelection(editor.state.selection.to).run(); insertInline('cite'); }} />
      <B title="登记为索引词" icon={<BookmarkAdd20Regular />} run={() => { const { from, to } = editor.state.selection; const text = editor.state.doc.textBetween(from, to, ' '); editor.chain().focus().insertContent({ type: 'idx', attrs: { text } }).run(); }} />
    </BubbleMenu>
  );
}
