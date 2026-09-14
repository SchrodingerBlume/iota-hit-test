// 块级节点：插图、带题注的表、公式、分页。
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { imageUrl } from '../imageCache';
import { useEditorEnv } from '../env';
import { Field } from './Chip';

const attr = (k: string, def: any) => ({ default: def, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k}`) ?? def, renderHTML: (a: any) => ({ [`data-${k}`]: a[k] }) });

function CaptionFields({ node, updateAttributes, kindName, editable }: { node: NodeViewProps['node']; updateAttributes: NodeViewProps['updateAttributes']; kindName: string; editable: boolean }) {
  return (
    <div className="fig-fields" contentEditable={false}>
      <input className="fig-caption" disabled={!editable} value={node.attrs.caption ?? ''} placeholder={`${kindName}题（中文）`} onChange={(e) => updateAttributes({ caption: e.target.value })} />
      <input className="fig-caption-en" disabled={!editable} value={node.attrs.captionEn ?? ''} placeholder={`${kindName}题（English，博士双语题注用）`} onChange={(e) => updateAttributes({ captionEn: e.target.value })} />
    </div>
  );
}

// ── 插图 ────────────────────────────────────────────────────────
function FigureView({ node, updateAttributes, selected, deleteNode, editor }: NodeViewProps) {
  const env = useEditorEnv();
  const [url, setUrl] = useState<string | null>(null);
  const name = String(node.attrs.image ?? '');
  useEffect(() => { let alive = true; void imageUrl(name).then((u) => { if (alive) setUrl(u); }); return () => { alive = false; }; }, [name, env.images]);
  const editable = editor.isEditable;
  const pick = async (file: File) => {
    const r = await env.addImage(file);
    const patch: Record<string, any> = { image: r.name };
    if (r.width && r.height) patch.width = Math.min(14, Math.max(4, Math.round((r.width / 96) * 2.54 * 10) / 10));
    updateAttributes(patch);
  };
  return (
    <NodeViewWrapper className={`fig ${selected ? 'is-selected' : ''}`} data-drag-handle>
      <div className="fig-body" contentEditable={false}>
        {url ? <img src={url} alt="" style={{ width: `${(node.attrs.width ?? 8) * 28}px`, maxWidth: '100%' }} /> : (
          <label className="fig-drop">
            <span>{name ? `找不到图片 ${name}` : '选择图片（PNG / JPG / SVG）'}</span>
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/gif" hidden disabled={!editable} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
          </label>
        )}
      </div>
      <CaptionFields node={node} updateAttributes={updateAttributes} kindName="图" editable={editable} />
      <div className="fig-tools" contentEditable={false}>
        <label>宽 <input type="number" min={2} max={16} step={0.5} value={node.attrs.width ?? 8} disabled={!editable} onChange={(e) => updateAttributes({ width: Number(e.target.value) || 8 })} /> cm</label>
        <label>标签 <input value={node.attrs.label ?? ''} placeholder={`fig:${node.attrs.uid ?? ''}`} disabled={!editable} onChange={(e) => updateAttributes({ label: e.target.value.trim() })} /></label>
        <label className="btn btn-xs">换图<input type="file" accept="image/*" hidden disabled={!editable} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} /></label>
        <button type="button" className="btn btn-xs btn-danger" disabled={!editable} onClick={deleteNode}>删除</button>
      </div>
    </NodeViewWrapper>
  );
}

export const Figure = Node.create({
  name: 'figure',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { image: attr('image', ''), width: attr('width', 8), caption: attr('caption', ''), captionEn: attr('captionEn', ''), label: attr('label', ''), uid: attr('uid', null) };
  },
  parseHTML() { return [{ tag: 'div[data-node="figure"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-node': 'figure' })]; },
  addNodeView() { return ReactNodeViewRenderer(FigureView); },
});

// ── 表（figure 壳 + 真表格） ─────────────────────────────────────
function TableFigureView({ node, updateAttributes, selected, deleteNode, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper className={`fig tab ${selected ? 'is-selected' : ''}`}>
      <CaptionFields node={node} updateAttributes={updateAttributes} kindName="表" editable={editable} />
      <NodeViewContent className="tab-body" />
      <div className="fig-tools" contentEditable={false}>
        <label>标签 <input value={node.attrs.label ?? ''} placeholder={`tab:${node.attrs.uid ?? ''}`} disabled={!editable} onChange={(e) => updateAttributes({ label: e.target.value.trim() })} /></label>
        <span className="muted">在单元格里右键或用工具栏加减行列</span>
        <button type="button" className="btn btn-xs btn-danger" disabled={!editable} onClick={deleteNode}>删除整表</button>
      </div>
    </NodeViewWrapper>
  );
}

export const TableFigure = Node.create({
  name: 'tableFigure',
  group: 'block',
  content: 'table',
  isolating: true,
  defining: true,
  draggable: false,
  addAttributes() {
    return { caption: attr('caption', ''), captionEn: attr('captionEn', ''), label: attr('label', ''), uid: attr('uid', null) };
  },
  parseHTML() { return [{ tag: 'div[data-node="tableFigure"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-node': 'tableFigure' }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(TableFigureView); },
});

// ── 行间公式 ────────────────────────────────────────────────────
function EquationView({ node, updateAttributes, selected, deleteNode, editor }: NodeViewProps) {
  const src = String(node.attrs.src ?? '');
  const mode = node.attrs.mode === 'latex' ? 'latex' : 'typst';
  const numbered = node.attrs.numbered !== false;
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper className={`eq ${selected ? 'is-selected' : ''}`} data-drag-handle>
      <div className="eq-row" contentEditable={false}>
        <span className="eq-badge">{mode === 'latex' ? 'LaTeX' : 'Typst'}</span>
        <textarea
          className="eq-src"
          rows={Math.max(1, Math.min(6, src.split('\n').length))}
          value={src}
          disabled={!editable}
          placeholder={mode === 'latex' ? '\\frac{a}{b} = c' : 'phi = D_"p"^2/150 psi^3/(1 - psi)^2'}
          onChange={(e) => updateAttributes({ src: e.target.value })}
          spellCheck={false}
        />
        <span className="eq-num">{numbered ? '(编号)' : ''}</span>
      </div>
      <div className="fig-tools" contentEditable={false}>
        <span className="seg">
          <button type="button" className={mode === 'typst' ? 'on' : ''} disabled={!editable} onClick={() => updateAttributes({ mode: 'typst' })}>Typst</button>
          <button type="button" className={mode === 'latex' ? 'on' : ''} disabled={!editable} onClick={() => updateAttributes({ mode: 'latex' })}>LaTeX</button>
        </span>
        <label><input type="checkbox" checked={numbered} disabled={!editable} onChange={(e) => updateAttributes({ numbered: e.target.checked })} /> 编号</label>
        <label>标签 <input value={node.attrs.label ?? ''} placeholder={`eq:${node.attrs.uid ?? ''}`} disabled={!editable} onChange={(e) => updateAttributes({ label: e.target.value.trim() })} /></label>
        <button type="button" className="btn btn-xs btn-danger" disabled={!editable} onClick={deleteNode}>删除</button>
      </div>
    </NodeViewWrapper>
  );
}

export const Equation = Node.create({
  name: 'equation',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { src: attr('src', ''), mode: attr('mode', 'typst'), numbered: { default: true, parseHTML: (el: HTMLElement) => el.getAttribute('data-numbered') !== 'false', renderHTML: (a: any) => ({ 'data-numbered': String(a.numbered) }) }, label: attr('label', ''), uid: attr('uid', null) };
  },
  parseHTML() { return [{ tag: 'div[data-node="equation"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-node': 'equation' })]; },
  addNodeView() { return ReactNodeViewRenderer(EquationView); },
});

// ── 分页 ────────────────────────────────────────────────────────
function PageBreakView({ selected, deleteNode }: NodeViewProps) {
  return (
    <NodeViewWrapper className={`pb ${selected ? 'is-selected' : ''}`} contentEditable={false}>
      <span>— 分页 —</span>
      <button type="button" className="btn btn-xs" onClick={deleteNode}>删除</button>
    </NodeViewWrapper>
  );
}
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() { return [{ tag: 'div[data-node="pageBreak"]' }]; },
  renderHTML() { return ['div', { 'data-node': 'pageBreak' }]; },
  addNodeView() { return ReactNodeViewRenderer(PageBreakView); },
});

export { Field };
