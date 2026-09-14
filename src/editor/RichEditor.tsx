// 富文本编辑器：TipTap + 我们的节点。value 是 ProseMirror JSON，onChange 回同样的 JSON。
import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit, createTable } from '@tiptap/extension-table';
import type { RichDoc } from '../model/types';
import { HeadingEn } from './extensions/HeadingEn';
import { UniqueId } from './extensions/UniqueId';
import { MathInline, Cite, Ref, Abbr, Footnote, Ccwd, Idx } from './extensions/inline';
import { Figure, TableFigure, Equation, PageBreak } from './extensions/blocks';
import { useEditorEnv } from './env';

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
}

export function RichEditor({ value, onChange, headings = true, blocks = true, placeholder, className, instanceKey }: RichEditorProps) {
  const lastEmitted = useRef<RichDoc | null>(null);
  const env = useEditorEnv();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, link: false, codeBlock: { defaultLanguage: 'python' } }),
      ...(headings ? [HeadingEn] : []),
      Superscript, Subscript,
      Placeholder.configure({ placeholder: placeholder ?? '在这里写……' }),
      TableKit.configure({ table: { resizable: false } }),
      Figure, TableFigure, Equation, PageBreak,
      MathInline, Cite, Ref, Abbr, Footnote, Ccwd, Idx,
      UniqueId,
    ],
    content: value,
    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as RichDoc;
      lastEmitted.current = json;
      onChange(json);
    },
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
    if (value === lastEmitted.current) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  return (
    <div className={`editor ${className ?? ''}`}>
      {editor && <Toolbar editor={editor} headings={headings} blocks={blocks} />}
      <EditorContent editor={editor} className="editor-body" />
    </div>
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

function Toolbar({ editor, headings, blocks }: { editor: Editor; headings: boolean; blocks: boolean }) {
  useEditorTick(editor);
  const env = useEditorEnv();
  const inTable = editor.isActive('table');
  const B = ({ on, run, title, children, disabled }: { on?: boolean; run: () => void; title: string; children: React.ReactNode; disabled?: boolean }) => (
    <button type="button" className={`tb ${on ? 'on' : ''}`} title={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={run}>{children}</button>
  );
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

  return (
    <div className="toolbar">
      <div className="tb-group">
        <B title="撤销 (⌘Z)" run={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>↶</B>
        <B title="重做 (⌘⇧Z)" run={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>↷</B>
      </div>
      {headings && (
        <div className="tb-group">
          <B title="正文段落" on={editor.isActive('paragraph')} run={() => editor.chain().focus().setParagraph().run()}>¶</B>
          {[1, 2, 3, 4].map((l) => (
            <B key={l} title={['章', '节', '条', '款'][l - 1] + `（${l} 级标题）`} on={editor.isActive('heading', { level: l })} run={() => editor.chain().focus().toggleHeading({ level: l as 1 }).run()}>H{l}</B>
          ))}
        </div>
      )}
      <div className="tb-group">
        <B title="加粗 (⌘B)" on={editor.isActive('bold')} run={() => editor.chain().focus().toggleBold().run()}><b>B</b></B>
        <B title="强调（排楷体）(⌘I)" on={editor.isActive('italic')} run={() => editor.chain().focus().toggleItalic().run()}><i>I</i></B>
        <B title="下划线 (⌘U)" on={editor.isActive('underline')} run={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></B>
        <B title="上标" on={editor.isActive('superscript')} run={() => editor.chain().focus().toggleSuperscript().run()}>x²</B>
        <B title="下标" on={editor.isActive('subscript')} run={() => editor.chain().focus().toggleSubscript().run()}>x₂</B>
        <B title="等宽代码" on={editor.isActive('code')} run={() => editor.chain().focus().toggleCode().run()}>{'</>'}</B>
      </div>
      <div className="tb-group">
        <B title="无序列表" on={editor.isActive('bulletList')} run={() => editor.chain().focus().toggleBulletList().run()}>•≡</B>
        <B title="编号列表" on={editor.isActive('orderedList')} run={() => editor.chain().focus().toggleOrderedList().run()}>1≡</B>
        <B title="代码块" on={editor.isActive('codeBlock')} run={() => editor.chain().focus().toggleCodeBlock().run()}>{'{ }'}</B>
      </div>
      <div className="tb-group">
        <B title="行内公式" run={() => insertInline('mathInline')}>∑</B>
        {blocks && <B title="行间公式（编号）" run={() => editor.chain().focus().insertContent({ type: 'equation', attrs: {} }).run()}>∫=</B>}
        <B title="引用参考文献" run={() => insertInline('cite')}>[1]</B>
        <B title="交叉引用图 / 表 / 式 / 节" run={() => insertInline('ref')}>→图</B>
        <B title="缩略语（首次出现自动展开）" run={() => insertInline('abbr')}>Ab</B>
        <B title="脚注" run={() => insertInline('footnote')}>①</B>
        <B title="索引词（登记进索引页）" run={() => insertInline('idx')}>索</B>
        <B title="空一个汉字宽" run={() => insertInline('ccwd', { n: 1 })}>␣</B>
      </div>
      {blocks && (
        <div className="tb-group">
          <B title="插图" run={insertFigure}>🖼</B>
          <B title="表格（带题注）" run={insertTable}>▦</B>
          <B title="分页" run={() => editor.chain().focus().insertContent({ type: 'pageBreak' }).run()}>⤓页</B>
        </div>
      )}
      {inTable && (
        <div className="tb-group tb-table">
          <B title="上方插行" run={() => editor.chain().focus().addRowBefore().run()}>行↑</B>
          <B title="下方插行" run={() => editor.chain().focus().addRowAfter().run()}>行↓</B>
          <B title="删行" run={() => editor.chain().focus().deleteRow().run()}>−行</B>
          <B title="左侧插列" run={() => editor.chain().focus().addColumnBefore().run()}>列←</B>
          <B title="右侧插列" run={() => editor.chain().focus().addColumnAfter().run()}>列→</B>
          <B title="删列" run={() => editor.chain().focus().deleteColumn().run()}>−列</B>
          <B title="合并 / 拆分单元格" run={() => editor.chain().focus().mergeOrSplit().run()}>⊞</B>
          <B title="表头行切换" run={() => editor.chain().focus().toggleHeaderRow().run()}>表头</B>
        </div>
      )}
    </div>
  );
}
