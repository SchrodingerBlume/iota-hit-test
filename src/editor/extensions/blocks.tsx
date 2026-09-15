// 块级节点：插图、带题注的表、公式、分页。
// 默认长得像文档里的样子（图居中、题注一行、公式居中带编号）；选中或悬停时才浮出一条小工具条。
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { imageUrl } from '../imageCache';
import { useEditorEnv, useNumbering, useOpenNonce, focusAttrInput } from '../env';
import { labelOf } from '../../typst/pmToTypst';
import { MathEditor, forPreview } from '../math/MathEditor';
import { MathPreview } from '../math/MathPreview';
import { AutoInput } from '../../ui/AutoInput';
import { Trash2, ImageUp, Tag, MoveHorizontal, PencilLine, Check } from 'lucide-react';

const attr = (k: string, def: any) => ({ default: def, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k}`) ?? def, renderHTML: (a: any) => ({ [`data-${k}`]: a[k] }) });

/** 题注两行：「图 1-1  题注」+ 英文题注（小字） */
function Caption({ node, updateAttributes, kindName, editable, prefix }: { node: NodeViewProps['node']; updateAttributes: NodeViewProps['updateAttributes']; kindName: string; editable: boolean; prefix?: string }) {
  return (
    <div className="cap" contentEditable={false}>
      <div className="cap-zh">
        {prefix && <span className="cap-num" title="编号按模板规则算，预览为准">{prefix}</span>}
        <AutoInput className="cap-input" data-attr="caption" disabled={!editable} value={node.attrs.caption ?? ''} placeholder={`${kindName}题`} minWidth={60} onChange={(e) => updateAttributes({ caption: e.target.value })} />
      </div>
      <div className="cap-en">
        <AutoInput className="cap-input-en" data-attr="captionEn" disabled={!editable} value={node.attrs.captionEn ?? ''} placeholder="English caption（博士双语题注用，可空）" minWidth={60} onChange={(e) => updateAttributes({ captionEn: e.target.value })} />
      </div>
    </div>
  );
}

/** 悬停 / 选中时浮出的工具条 */
function Tools({ children }: { children: React.ReactNode }) {
  return <div className="blk-tools" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>{children}</div>;
}

function LabelField({ node, updateAttributes, prefix, editable }: { node: NodeViewProps['node']; updateAttributes: NodeViewProps['updateAttributes']; prefix: string; editable: boolean }) {
  return (
    <label className="blk-tool" title="交叉引用用的标签；留空则自动生成">
      <Tag />
      <input value={node.attrs.label ?? ''} placeholder={`${prefix}:${node.attrs.uid ?? ''}`} disabled={!editable} onChange={(e) => updateAttributes({ label: e.target.value.trim() })} />
    </label>
  );
}

// ── 插图 ────────────────────────────────────────────────────────
function FigureView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const env = useEditorEnv();
  const wrap = useRef<HTMLDivElement>(null);
  const open = useOpenNonce(getPos);
  useEffect(() => { if (open.nonce) requestAnimationFrame(() => focusAttrInput(wrap.current, open.attr ?? 'caption', open.offset)); }, [open]);
  const [url, setUrl] = useState<string | null>(null);
  const name = String(node.attrs.image ?? '');
  useEffect(() => { let alive = true; void imageUrl(name).then((u) => { if (alive) setUrl(u); }); return () => { alive = false; }; }, [name, env.images]);
  const editable = editor.isEditable;
  const num = useNumbering().get(labelOf(node.attrs as any, 'fig'))?.number;
  const pick = async (file: File) => {
    const r = await env.addImage(file);
    const patch: Record<string, any> = { image: r.name };
    if (r.width && r.height) patch.width = Math.min(14, Math.max(4, Math.round((r.width / 96) * 2.54 * 10) / 10));
    updateAttributes(patch);
  };
  return (
    <NodeViewWrapper className={`blk fig ${selected ? 'is-selected' : ''}`} data-drag-handle ref={wrap}>
      <div className="fig-body" contentEditable={false}>
        {url ? <img src={url} alt="" style={{ width: `${(node.attrs.width ?? 8) * 28}px`, maxWidth: '100%' }} draggable={false} /> : (
          <label className="fig-drop">
            <ImageUp />
            <span>{name ? `找不到图片 ${name}，点击重新选择` : '选择图片（PNG / JPG / SVG）'}</span>
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/gif" hidden disabled={!editable} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
          </label>
        )}
      </div>
      <Caption node={node} updateAttributes={updateAttributes} kindName="图" editable={editable} prefix={num} />
      <Tools>
        <label className="blk-tool" title="图的宽度（厘米）">
          <MoveHorizontal />
          <input type="number" min={2} max={16} step={0.5} value={node.attrs.width ?? 8} disabled={!editable} onChange={(e) => updateAttributes({ width: Number(e.target.value) || 8 })} />
          <span>cm</span>
        </label>
        <LabelField node={node} updateAttributes={updateAttributes} prefix="fig" editable={editable} />
        <label className="blk-tool is-btn" title="换一张图"><ImageUp /><input type="file" accept="image/*" hidden disabled={!editable} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} /></label>
        <button type="button" className="blk-tool is-btn is-danger" title="删除插图" disabled={!editable} onClick={deleteNode}><Trash2 /></button>
      </Tools>
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
function TableFigureView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const wrap = useRef<HTMLDivElement>(null);
  const open = useOpenNonce(getPos);
  useEffect(() => { if (open.nonce) requestAnimationFrame(() => focusAttrInput(wrap.current, open.attr ?? 'caption', open.offset)); }, [open]);
  const num = useNumbering().get(labelOf(node.attrs as any, 'tab'))?.number;
  return (
    <NodeViewWrapper className={`blk tab ${selected ? 'is-selected' : ''}`} ref={wrap}>
      <Caption node={node} updateAttributes={updateAttributes} kindName="表" editable={editable} prefix={num} />
      <NodeViewContent className="tab-body" />
      <Tools>
        <LabelField node={node} updateAttributes={updateAttributes} prefix="tab" editable={editable} />
        <span className="blk-hint">光标进单元格后工具栏有加减行列</span>
        <button type="button" className="blk-tool is-btn is-danger" title="删除整张表" disabled={!editable} onClick={deleteNode}><Trash2 /></button>
      </Tools>
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
// 平时就是一条居中的公式带编号；点它（或新建的空公式）才展开源码与符号面板。
function EquationView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const src = String(node.attrs.src ?? '');
  const open = useOpenNonce(getPos);
  useEffect(() => { if (open.nonce) setEditing(true); }, [open]);
  const mode = node.attrs.mode === 'latex' ? 'latex' : 'typst';
  const numbered = node.attrs.numbered !== false;
  const editable = editor.isEditable;
  const num = useNumbering().get(labelOf(node.attrs as any, 'eq'))?.number;
  const [editing, setEditing] = useState(!src.trim());
  // 失去选中就收起（点了别处）
  useEffect(() => { if (!selected && src.trim()) setEditing(false); }, [selected]);
  return (
    <NodeViewWrapper className={`blk eq ${selected ? 'is-selected' : ''} ${editing ? 'is-editing' : ''}`} data-drag-handle>
      {!editing && (
        <div className="eq-line" contentEditable={false} onClick={() => editable && setEditing(true)} title="点击编辑公式">
          <span className="eq-spacer" />
          <span className="eq-render"><MathPreview src={forPreview(src, mode)} mode={mode} display empty={<em className="muted">空公式，点击编辑</em>} /></span>
          <span className="eq-number">{numbered ? num : ''}</span>
        </div>
      )}
      {editing && (
        <div className="eq-editor" contentEditable={false}>
          <MathEditor value={src} mode={mode} display onChange={(v) => updateAttributes({ src: v })} onMode={(m) => updateAttributes({ mode: m })} autoFocus onEnter={() => setEditing(false)} />
          <div className="eq-editor-foot">
            <label className="blk-tool"><input type="checkbox" checked={numbered} disabled={!editable} onChange={(e) => updateAttributes({ numbered: e.target.checked })} /> 编号 {numbered && num && <b>{num}</b>}</label>
            <LabelField node={node} updateAttributes={updateAttributes} prefix="eq" editable={editable} />
            <span className="spacer" />
            <button type="button" className="blk-tool is-btn is-danger" title="删除公式" onClick={deleteNode}><Trash2 /></button>
            <button type="button" className="btn btn-xs btn-primary" onClick={() => setEditing(false)}><Check />完成</button>
          </div>
        </div>
      )}
      {!editing && (
        <Tools>
          <button type="button" className="blk-tool is-btn" title="编辑" onClick={() => setEditing(true)}><PencilLine /></button>
          <button type="button" className="blk-tool is-btn is-danger" title="删除公式" onClick={deleteNode}><Trash2 /></button>
        </Tools>
      )}
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
    return { src: attr('src', ''), mode: attr('mode', 'latex'), numbered: { default: true, parseHTML: (el: HTMLElement) => el.getAttribute('data-numbered') !== 'false', renderHTML: (a: any) => ({ 'data-numbered': String(a.numbered) }) }, label: attr('label', ''), uid: attr('uid', null) };
  },
  parseHTML() { return [{ tag: 'div[data-node="equation"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-node': 'equation' })]; },
  addNodeView() { return ReactNodeViewRenderer(EquationView); },
});

// ── 分页 ────────────────────────────────────────────────────────
function PageBreakView({ selected, deleteNode }: NodeViewProps) {
  return (
    <NodeViewWrapper className={`blk pb ${selected ? 'is-selected' : ''}`} contentEditable={false}>
      <span>分页</span>
      <Tools><button type="button" className="blk-tool is-btn is-danger" title="删除分页" onClick={deleteNode}><Trash2 /></button></Tools>
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
