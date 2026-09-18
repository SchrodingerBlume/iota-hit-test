// 富文本编辑器：TipTap + 我们的节点。value 是 ProseMirror JSON，onChange 回同样的 JSON。
// 工具栏一行：常用的摆在外面，插入类的收进「插入」菜单；选中文字时浮出气泡菜单。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useBlockMenu } from './BlockMenu';
import { CommentExtension } from '@sereneinserenade/tiptap-comment-extension';
import { useComments } from './comments';
import { SpaceMarks, spaceMarksKey } from './extensions/SpaceMarks';
import { useLinkDialog } from '../ui/LinkDialog';
import StarterKit from '@tiptap/starter-kit';
import { TypstBulletList, TypstOrderedList } from './extensions/lists';
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
import { Figure, TableFigure, CodeFigure, Equation, PageBreak } from './extensions/blocks';
import { Algorithm } from './extensions/algorithm';
import { EqDenote } from './extensions/eqdenote';
import { useEditorEnv, NumberingContext, RichKeyContext } from './env';
import { computeNumbering, type Part } from '../typst/numbering';
import { useStore, type RichKey } from '../model/store';
import { registerEditor, unregisterEditor, getEditor } from './registry';
import { B, useEditorTick, useInsertActions, useRichSize } from './tools';
import { MirrorCaret, mirrorCaretKey } from './extensions/MirrorCaret';
import { Search } from './extensions/Search';
import { fromMarkdown, toMarkdown } from './markdown';
import { useFindBar } from '../ui/Ribbon';
import { recordTransaction, invalidatePositions } from './versions';
import { useInputState } from './inputState';
import { usePreviewSurface, usePreviewMarks } from '../ui/PreviewEditLayer';
import { MathFormula20Regular, Book20Regular, BookmarkAdd20Regular } from '@fluentui/react-icons';
import { t } from '../i18n';

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
  const savedSource = useStore.getState().doc.sourceDrafts?.[instanceKey];
  const [sourceMode, setSourceMode] = useState(savedSource !== undefined);
  const [source, setSource] = useState(() => savedSource ?? '');
  const [sourceError, setSourceError] = useState('');
  const sourceRef = useRef(source);
  const parseTimer = useRef(0);
  const saveTimer = useRef(0);
  const changeTimer = useRef(0);
  const pendingChange = useRef<Editor | null>(null);
  const compositionActive = useRef(false);
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

  const commitChange = (target?: Editor | null) => {
    const ed = target ?? pendingChange.current;
    if (!ed || ed.isDestroyed || pendingChange.current !== ed) return;
    window.clearTimeout(changeTimer.current);
    pendingChange.current = null;
    const json = ed.getJSON() as RichDoc;
    lastEmitted.current = json;
    onChange(json);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, bulletList: false, orderedList: false, link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener', class: 'lnk' } }, paragraph: false, codeBlock: { defaultLanguage: 'python' } }),
      TypstBulletList, TypstOrderedList,
      // 批注：@sereneinserenade/tiptap-comment-extension（MIT），正文里只是一个带 id 的标记
      CommentExtension.configure({ HTMLAttributes: { class: 'cmt' }, onCommentActivated: (id) => useComments.getState().setActive(id) }),
      NoIndentParagraph,
      ...(headings ? [HeadingEn] : []),
      Superscript, Subscript,
      Placeholder.configure({ placeholder: placeholder ?? t("输入文本…") }),
      TableKit.configure({ table: { resizable: true, cellMinWidth: 40 }, tableCell: false, tableHeader: false, tableRow: false }),
      AlignedTableCell, AlignedTableHeader, SizedTableRow, TableExtras,
      Figure, TableFigure, CodeFigure, Algorithm, Equation, PageBreak, EqDenote,
      MathInline, Cite, Ref, Abbr, Footnote, Ccwd, Idx,
      UniqueId, MirrorCaret, Search, SpaceMarks,
    ],
    content: value,
    onUpdate: ({ editor }) => {
      // getJSON 会遍历整节文档。长论文连续输入时只在短暂停顿后做一次，
      // 否则每个按键都会同步扫描上百页，直接阻塞输入事件；也别撞上打字即时回显那一趟（发出去 ~120 ms 回来）
      pendingChange.current = editor;
      window.clearTimeout(changeTimer.current);
      changeTimer.current = window.setTimeout(() => commitChange(editor), 250);
    },
    onBlur: ({ editor }) => commitChange(editor),
    // 每一笔改动的 mapping 记下来：预览区的字形表要靠它把老位置换算成新位置
    onTransaction: ({ transaction }) => { if (richKey) recordTransaction(richKey, transaction); },
    editorProps: {
      attributes: { class: 'rich', spellcheck: 'false' },
      // ⌘F / ⌘H 开查找替换栏（Word 的习惯）
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && (event.key === 'f' || event.key === 'h')) { event.preventDefault(); useFindBar.getState().set(true); return true; }
        // ⌘K：插入 / 编辑链接（Word 与浏览器的习惯）
        if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); useLinkDialog.getState().open(); return true; }
        return false;
      },
      // 右键一段 / 一条标题：块级样式菜单（Word 右键的「段落」「样式」那一组）
      handleDOMEvents: {
        compositionstart: () => {
          if (!compositionActive.current) {
            compositionActive.current = true;
            useInputState.getState().begin();
          }
          return false;
        },
        compositionend: () => {
          if (compositionActive.current) {
            compositionActive.current = false;
            useInputState.getState().end();
          }
          return false;
        },
        contextmenu: (view, event) => {
          if (!richKey || !view.editable) return false;
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!at) return false;
          const $p = view.state.doc.resolve(at.pos);
          // 找最近的段落 / 标题块
          for (let d = $p.depth; d >= 0; d--) {
            const n = $p.node(d);
            if (n.type.name === 'paragraph' || n.type.name === 'heading') {
              event.preventDefault();
              useBlockMenu.getState().open({ key: richKey, pos: d === 0 ? 0 : $p.before(d), x: event.clientX, y: event.clientY });
              return true;
            }
          }
          return false;
        },
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

  // 切换章节或工程时浏览器不一定补发 compositionend，避免排版永久停在“输入中”。
  useEffect(() => () => {
    if (compositionActive.current) {
      compositionActive.current = false;
      useInputState.getState().end();
    }
  }, [instanceKey]);

  // 外面换了文档（打开工程、换节）才 setContent；自己发出去的不回灌
  useEffect(() => {
    if (!editor) return;
    // 第一次：编辑器就是拿 value 建的，不用灌，也别把预览的位置表作废
    if (lastEmitted.current === null) { lastEmitted.current = value; return; }
    if (value === lastEmitted.current) return;
    invalidatePositions();
    lastEmitted.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  // 登记到编辑器表里：预览区直接编辑要找到它（挂上来时内容就是工程里那份，位置不必作废）
  useEffect(() => {
    if (!editor || !richKey || sourceMode) return;
    registerEditor(richKey, editor, { blocks, headings });
    // 没有当前编辑器（或它已经没了）就把这份当作当前的，功能区才有东西可作用
    const cur = usePreviewSurface.getState().activeKey;
    if (!cur || cur === richKey || !getEditor(cur)) usePreviewSurface.getState().set({ activeKey: richKey });
    const onFocus = () => usePreviewSurface.getState().set({ activeKey: richKey });
    editor.on('focus', onFocus);
    return () => { editor.off('focus', onFocus); unregisterEditor(richKey, editor); };
  }, [editor, richKey, blocks, headings, sourceMode]);

  // 当前批注：正文里那一段加亮
  useEffect(() => {
    if (!editor) return;
    const apply = () => {
      if (editor.isDestroyed) return;
      const id = useComments.getState().active;
      editor.view.dom.querySelectorAll<HTMLElement>('span.cmt').forEach((el) => el.classList.toggle('is-active', !!id && el.dataset.commentId === id));
    };
    apply();
    const off = editor.on('transaction', apply);
    const unsub = useComments.subscribe(apply);
    return () => { unsub(); void off; editor.off('transaction', apply); };
  }, [editor]);

  // 编辑标记（¶）与预览同一个开关：开着就给编辑区挂 show-marks，样式表画段末的 ¶
  useEffect(() => {
    if (!editor) return;
    const apply = () => {
      if (editor.isDestroyed) return;
      const m = usePreviewMarks.getState();
      editor.view.dom.classList.toggle('show-marks', m.on && m.paragraph);
      editor.view.dom.classList.toggle('show-gutter', m.on && m.gutter);
      const on = m.on && m.space;
      if (spaceMarksKey.getState(editor.state)?.on !== on) editor.view.dispatch(editor.state.tr.setMeta(spaceMarksKey, on));
    };
    apply();
    return usePreviewMarks.subscribe(apply);
  }, [editor]);

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

  const applySource = (text: string) => {
    if (!editor) return false;
    try {
      const next = fromMarkdown(text, headings);
      editor.schema.nodeFromJSON(next).check();
      if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) editor.commands.setContent(next);
      setSourceError('');
      return true;
    } catch (error) { setSourceError((error as Error).message); return false; }
  };
  useEffect(() => { if (editor) editor.setEditable(!sourceMode, false); }, [editor, sourceMode]);
  const restoredSource = useRef(false);
  useEffect(() => {
    if (!editor || restoredSource.current) return;
    restoredSource.current = true;
    if (savedSource !== undefined) { applySource(savedSource); useStore.getState().setSourceDraft(instanceKey, savedSource); }
  }, [editor]);
  useEffect(() => () => {
    window.clearTimeout(parseTimer.current);
    window.clearTimeout(saveTimer.current);
    commitChange();
  }, [instanceKey]);
  const changeSource = (text: string, composing: boolean) => {
    sourceRef.current = text;
    setSource(text);
    window.clearTimeout(parseTimer.current);
    window.clearTimeout(saveTimer.current);
    // GFM 解析和 ProseMirror 校验都会遍历整节内容。连续输入时合并处理，避免受控文本框丢键。
    if (!composing) parseTimer.current = window.setTimeout(() => applySource(sourceRef.current), 160);
    saveTimer.current = window.setTimeout(() => useStore.getState().setSourceDraft(instanceKey, sourceRef.current), 400);
  };
  const switchMode = (code: boolean) => {
    if (code === sourceMode || !editor) return;
    if (code) setSource(toMarkdown(editor.getJSON() as RichDoc));
    else {
      window.clearTimeout(parseTimer.current);
      window.clearTimeout(saveTimer.current);
      if (!applySource(source)) return;
      useStore.getState().setSourceDraft(instanceKey, undefined);
    }
    setSourceMode(code);
  };

  return (
    <NumberingContext.Provider value={numbering}>
      <RichKeyContext.Provider value={richKey}>
        <div className={`editor ${className ?? ''}`} style={{ '--rich-size': `${richSize}px` } as React.CSSProperties}>
          <div className="editor-mode" role="group" aria-label={t("编辑模式")}>
            <button type="button" className={`btn btn-xs ${!sourceMode ? 'btn-primary' : ''}`} aria-pressed={!sourceMode} onClick={() => switchMode(false)}>{t("富文本")}</button>
            <button type="button" className={`btn btn-xs ${sourceMode ? 'btn-primary' : ''}`} aria-pressed={sourceMode} onClick={() => switchMode(true)}>Markdown</button>
            {sourceMode && <span className="muted">GFM</span>}
          </div>
          {sourceMode && <>
            <textarea className="markdown-source" aria-label={t("Markdown 源代码")} value={source} spellCheck={false}
              onChange={(event) => changeSource(event.target.value, (event.nativeEvent as InputEvent).isComposing)}
              onCompositionStart={() => {
                if (!compositionActive.current) {
                  compositionActive.current = true;
                  useInputState.getState().begin();
                }
              }}
              onCompositionEnd={(event) => {
                if (compositionActive.current) {
                  compositionActive.current = false;
                  useInputState.getState().end();
                }
                changeSource(event.currentTarget.value, false);
              }}
              onBlur={() => {
                if (compositionActive.current) {
                  compositionActive.current = false;
                  useInputState.getState().end();
                  changeSource(sourceRef.current, false);
                }
                useStore.getState().setSourceDraft(instanceKey, sourceRef.current);
              }}
              onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Tab') { event.preventDefault(); const el = event.currentTarget; const start = el.selectionStart, end = el.selectionEnd; changeSource(source.slice(0, start) + '  ' + source.slice(end), false); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; }); } }} />
            {sourceError && <p className="diag err" role="alert">{sourceError} {' '}{t("草稿已保存，预览保留上次有效内容。")}</p>}
            <details className="markdown-help"><summary>{t("Markdown 语法")}</summary><p>{t("# 标题 · **加粗** · *斜体* · ~~删除线~~ · 列表 · 表格 · 代码块")}</p><p>{t("公式、图片、题注和引用等专用内容保留在 iota-node 代码块或 iota 注释中。任务列表在富文本中显示为 [ ] / [x]。")}</p></details>
          </>}
          <div hidden={sourceMode}>
            {editor && !sourceMode && <Bubble editor={editor} />}
            <EditorContent editor={editor} className="editor-body" />
          </div>
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
      <B title={t("变成行内公式（LaTeX）")} icon={<MathFormula20Regular />} run={() => { const { from, to } = editor.state.selection; const text = editor.state.doc.textBetween(from, to, ' '); editor.chain().focus().insertContent({ type: 'mathInline', attrs: { src: text, mode: 'latex' } }).run(); }} />
      <B title={t("在此引用文献")} icon={<Book20Regular />} run={() => { editor.chain().focus().setTextSelection(editor.state.selection.to).run(); insertInline('cite'); }} />
      <B title={t("登记为索引词")} icon={<BookmarkAdd20Regular />} run={() => { const { from, to } = editor.state.selection; const text = editor.state.doc.textBetween(from, to, ' '); editor.chain().focus().insertContent({ type: 'idx', attrs: { text } }).run(); }} />
    </BubbleMenu>
  );
}
