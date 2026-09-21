// 定理类环境（模板 theorem 族 + proof）：头一行选环境、印编号、填说明；正文是普通段落，模板把头与第一段拼成一段
import { Node, mergeAttributes } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { useEffect, useRef } from 'react';
import { Trash2, Tag } from 'lucide-react';
import { Handle, selectOnPadding, captionKeys } from './blocks';
import { useNumbering, useOpenNonce, focusAttrInput } from '../env';
import { labelOf } from '../../typst/pmToTypst';
import { THEOREM_KINDS, THEOREM_NAMES, theoremKind, type TheoremKind } from '../../typst/theorem';
import { AutoInput } from '../../ui/AutoInput';
import { t } from '../../i18n';
import { MirrorInput } from '../mirror';

const attr = (k: string, def: any) => ({ default: def, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k}`) ?? def, renderHTML: (a: any) => ({ [`data-${k}`]: a[k] }) });
export const kindLabel = (k: TheoremKind) => `${THEOREM_NAMES[k].zh} ${THEOREM_NAMES[k].en}`;

function TheoremView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const kind = theoremKind(node.attrs.kind);
  const wrap = useRef<HTMLDivElement>(null);
  const open = useOpenNonce(getPos);
  useEffect(() => { if (open.nonce) requestAnimationFrame(() => focusAttrInput(wrap.current, open.attr ?? 'note', open.offset)); }, [open]);
  const head = useNumbering().get(labelOf(node.attrs as any, 'thm'))?.number ?? THEOREM_NAMES[kind].zh;
  return (
    <NodeViewWrapper className={`blk thm ${selected ? 'is-selected' : ''}`} ref={wrap} onMouseDown={selectOnPadding(editor, getPos)} onKeyDown={captionKeys(editor, getPos)}>
      <Handle editor={editor} getPos={getPos} />
      <div className="thm-head" contentEditable={false}>
        <select className="thm-kind" value={kind} disabled={!editable} title={t("环境")} onChange={(e) => updateAttributes({ kind: e.target.value })}>
          {THEOREM_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
        </select>
        <span className="cap-num" title={t("编号由模板生成，以页面视图为准")}>{head}</span>
        <AutoInput className="cap-input thm-note" data-attr="note" disabled={!editable} value={node.attrs.note ?? ''} placeholder={t("说明（可留空）")} minWidth={60} onChange={(e) => updateAttributes({ note: e.target.value })} />
      </div>
      <NodeViewContent className="thm-body" />
      <div className="blk-tools" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
        {kind !== 'proof' && (
          <label className="blk-tool" title={t("交叉引用用的标签；留空则自动生成")}>
            <Tag />
            <MirrorInput value={node.attrs.label ?? ''} placeholder={`thm:${node.attrs.uid ?? ''}`} disabled={!editable} onChange={(e) => updateAttributes({ label: e.target.value.trim() })} />
          </label>
        )}
        <span className="blk-hint">{t("末尾空段落上按 Enter 退出")}</span>
        <button type="button" className="blk-tool is-btn is-danger" title={t("删除")} disabled={!editable} onClick={deleteNode}><Trash2 /></button>
      </div>
    </NodeViewWrapper>
  );
}

export const Theorem = Node.create({
  name: 'theorem',
  group: 'block',
  content: '(paragraph | equation | eqdenote | bulletList | orderedList | codeBlock)+',
  isolating: true,
  defining: true,
  draggable: true,
  addAttributes() {
    return { kind: attr('kind', 'theorem'), note: attr('note', ''), label: attr('label', ''), uid: attr('uid', null) };
  },
  parseHTML() { return [{ tag: 'div[data-node="theorem"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-node': 'theorem' }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(TheoremView); },
  addKeyboardShortcuts() {
    return {
      // 末尾的空段落上再按 Enter：退出定理，接着在后面写（照列表的样子）
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.depth < 2) return false;
        const para = $from.parent, box = $from.node($from.depth - 1);
        if (box.type.name !== 'theorem' || para.type.name !== 'paragraph' || para.content.size || $from.index($from.depth - 1) !== box.childCount - 1) return false;
        const boxPos = $from.before($from.depth - 1);
        const tr = state.tr;
        if (box.childCount > 1) tr.delete($from.before(), $from.after());
        const after = tr.mapping.map(boxPos + box.nodeSize);
        tr.insert(after, state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
        this.editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});
