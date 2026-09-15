// 标题：编号 + 中文名一行（编号是模板算出来的样子，不可编辑），英文名在下面一行小字
// （博士论文目录与页眉要双语；本硕可以空着）。看着就是文档里的一条标题。
import Heading from '@tiptap/extension-heading';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { useNumbering } from '../env';
import { useStore } from '../../model/store';
import { levelLabels } from '../../typst/numbering';
import { labelOf } from '../../typst/pmToTypst';
import { Hash } from 'lucide-react';

function HeadingView({ node, updateAttributes, editor }: NodeViewProps) {
  const level = node.attrs.level as number;
  const editable = editor.isEditable;
  const settings = useStore((s) => s.doc.settings);
  const levelName = levelLabels(settings).find((l) => l.level === level)?.name ?? `${level} 级`;
  const num = useNumbering().get(labelOf(node.attrs as any, 'sec'))?.number;
  const en = String(node.attrs.en ?? '');
  const numbered = node.attrs.numbered !== false;
  return (
    <NodeViewWrapper className={`hd hd-${level} ${en ? 'has-en' : ''} ${numbered ? '' : 'is-unnumbered'}`} data-level={level}>
      <div className="hd-row">
        {numbered && <span className="hd-num" contentEditable={false} title={`${levelName}标题（${level} 级）· 编号按模板规则算，预览为准`}>{num ?? ''}</span>}
        <NodeViewContent className="hd-zh" />
        <button type="button" className={`hd-toggle ${numbered ? '' : 'on'}`} contentEditable={false} disabled={!editable} title={numbered ? '这条标题不编号（如「引言」「结束语」这类）' : '恢复编号'} onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ numbered: !numbered })}><Hash /></button>
      </div>
      <div className="hd-en" contentEditable={false}>
        <input
          data-attr="en"
          value={en}
          placeholder="English title（博士双语目录用，可空）"
          disabled={!editable}
          onChange={(e) => updateAttributes({ en: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
        />
      </div>
    </NodeViewWrapper>
  );
}

export const HeadingEn = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      en: { default: '', parseHTML: (el) => el.getAttribute('data-en') ?? '', renderHTML: (a) => ({ 'data-en': a.en }) },
      uid: { default: null, parseHTML: (el) => el.getAttribute('data-uid'), renderHTML: (a) => ({ 'data-uid': a.uid }) },
      label: { default: '', parseHTML: (el) => el.getAttribute('data-label') ?? '', renderHTML: (a) => ({ 'data-label': a.label }) },
      numbered: { default: true, parseHTML: (el) => el.getAttribute('data-numbered') !== 'false', renderHTML: (a) => ({ 'data-numbered': String(a.numbered) }) },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(HeadingView);
  },
}).configure({ levels: [1, 2, 3, 4] });
