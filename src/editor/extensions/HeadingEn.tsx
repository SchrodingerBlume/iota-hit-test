// 标题：中文在主行，英文名在右侧一个小输入框（博士论文目录与页眉要双语）。
import Heading from '@tiptap/extension-heading';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { useNumbering } from '../env';
import { labelOf } from '../../typst/pmToTypst';

const LEVEL_NAME = ['章', '节', '条', '款'];

function HeadingView({ node, updateAttributes, editor }: NodeViewProps) {
  const level = node.attrs.level as number;
    const editable = editor.isEditable;
  const num = useNumbering().get(labelOf(node.attrs as any, 'sec'))?.number ?? '='.repeat(level);
  return (
    <NodeViewWrapper className={`hd hd-${level}`} data-level={level}>
      <span className="hd-badge" contentEditable={false} title={`${LEVEL_NAME[level - 1] ?? ''}标题（${level} 级）——编号按模板规则算，预览里的为准`}>
        {num}
      </span>
      <NodeViewContent className="hd-zh" />
      <span className="hd-en" contentEditable={false}>
        <input
          value={node.attrs.en ?? ''}
          placeholder="English title"
          disabled={!editable}
          onChange={(e) => updateAttributes({ en: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
        />
      </span>
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
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(HeadingView);
  },
}).configure({ levels: [1, 2, 3, 4] });
