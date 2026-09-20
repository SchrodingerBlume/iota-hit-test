// 标题：编号 + 中文名一行（编号是模板算出来的样子，不可编辑），英文名在下面一行小字
// （博士论文目录与页眉要双语；本硕可以空着）。看着就是文档里的一条标题。
import Heading from '@tiptap/extension-heading';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { useNumbering, useRichKey } from '../env';
import { useBlockMenu } from '../BlockMenu';
import { useStore } from '../../model/store';
import { levelLabels } from '../../typst/numbering';
import { labelOf } from '../../typst/pmToTypst';
import { Hash } from 'lucide-react';
import { t } from '../../i18n';

function HeadingView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const richKey = useRichKey();
  // 右键：标题的样式菜单（级别、编号、章的排法、修改此级样式）。正文里的右键由 RichEditor 统一接，
  // 这里兜住编号、英文名那些不在 contenteditable 里的地方
  const onContextMenu = (e: React.MouseEvent) => {
    if (e.defaultPrevented || !richKey || !editor.isEditable) return;
    const pos = getPos();
    if (pos === undefined) return;
    e.preventDefault();
    useBlockMenu.getState().open({ key: richKey, pos, x: e.clientX, y: e.clientY });
  };
  const level = node.attrs.level as number;
  const editable = editor.isEditable;
  const settings = useStore((s) => s.doc.settings);
  const levelName = levelLabels(settings).find((l) => l.level === level)?.name ?? t("{{level}} 级", { level: level });
  const num = useNumbering().get(labelOf(node.attrs as any, 'sec'))?.number;
  const en = String(node.attrs.en ?? '');
  const numbered = node.attrs.numbered !== false;
  return (
    <NodeViewWrapper className={`hd hd-${level} ${en ? 'has-en' : ''} ${numbered ? '' : 'is-unnumbered'}`} data-level={level} onContextMenu={onContextMenu}>
      <div className="hd-row">
        {numbered && <span className="hd-num" contentEditable={false} title={t("{{levelName}}标题（{{level}} 级）", { levelName: levelName, level: level })}>{num ?? ''}</span>}
        <NodeViewContent className="hd-zh" />
        <button type="button" className={`hd-toggle ${numbered ? '' : 'on'}`} contentEditable={false} disabled={!editable} title={numbered ? t("不为此标题编号，例如“引言”或“结束语”") : t("恢复编号")} onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ numbered: !numbered })}><Hash /></button>
      </div>
      <div className="hd-en" contentEditable={false}>
        <input
          data-attr="en"
          value={en}
          placeholder={t("英文标题（用于博士双语目录，可留空）")}
          disabled={!editable}
          onChange={(e) => updateAttributes({ en: e.target.value })}
          onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
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
      /** 章（一级）才有：右手页起、两字标题撑开，三态，auto ＝ 跟文档级（模板 #chapter(openright:, spread:)） */
      openright: { default: 'auto', parseHTML: (el) => el.getAttribute('data-openright') ?? 'auto', renderHTML: (a) => ({ 'data-openright': a.openright }) },
      spread: { default: 'auto', parseHTML: (el) => el.getAttribute('data-spread') ?? 'auto', renderHTML: (a) => ({ 'data-spread': a.spread }) },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(HeadingView);
  },
}).configure({ levels: [1, 2, 3, 4] });
