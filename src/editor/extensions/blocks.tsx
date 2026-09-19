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
import { LengthInput } from '../../ui/LengthInput';
import { parseLength, toPx } from '../../model/length';
import { t } from '../../i18n';

/** 编辑区里图的显示宽度：绝对长度按 28px/cm 的缩小比例画，百分比按容器，其余按 8cm */
function figurePx(w: unknown): string {
  const l = parseLength(w, 'cm');
  if (!l) return `${8 * 28}px`;
  if (l.unit === '%') return `${Math.min(100, l.value)}%`;
  const px = toPx(l, 12);
  return px ? `${px * (28 / 37.8)}px` : `${8 * 28}px`;
}

const attr = (k: string, def: any) => ({ default: def, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k}`) ?? def, renderHTML: (a: any) => ({ [`data-${k}`]: a[k] }) });

/** 题注两行：「图 1-1  题注」+ 英文题注（小字） */
function Caption({ node, updateAttributes, kindName, editable, prefix }: { node: NodeViewProps['node']; updateAttributes: NodeViewProps['updateAttributes']; kindName: string; editable: boolean; prefix?: string }) {
  return (
    <div className="cap" contentEditable={false}>
      <div className="cap-zh">
        {prefix && <span className="cap-num" title={t("编号按模板规则算，预览为准")}>{prefix}</span>}
        <AutoInput className="cap-input" data-attr="caption" disabled={!editable} value={node.attrs.caption ?? ''} placeholder={t("{{kindName}}题", { kindName: kindName })} minWidth={60} onChange={(e) => updateAttributes({ caption: e.target.value })} />
      </div>
      <div className="cap-en">
        <AutoInput className="cap-input-en" data-attr="captionEn" disabled={!editable} value={node.attrs.captionEn ?? ''} placeholder={t("English caption（博士双语题注用，可空）")} minWidth={60} onChange={(e) => updateAttributes({ captionEn: e.target.value })} />
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
    <label className="blk-tool" title={t("交叉引用用的标签；留空则自动生成")}>
      <Tag />
      <input value={node.attrs.label ?? ''} placeholder={`${prefix}:${node.attrs.uid ?? ''}`} disabled={!editable} onChange={(e) => updateAttributes({ label: e.target.value.trim() })} />
    </label>
  );
}

// ── 插图 ────────────────────────────────────────────────────────
/** 分图：每张一个 {image, width, caption, captionEn} */
export interface SubFig { image: string; width: string | number; caption: string; captionEn?: string }
export function parseSubs(v: unknown): SubFig[] {
  if (Array.isArray(v)) return v as SubFig[];
  if (typeof v !== 'string' || !v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}

function SubFigureCell({ sub, index, editable, onChange, onRemove, letter, labelBase }: { sub: SubFig; index: number; editable: boolean; onChange: (p: Partial<SubFig>) => void; onRemove: () => void; letter: string; labelBase: string }) {
  const env = useEditorEnv();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let alive = true; void imageUrl(sub.image).then((u) => { if (alive) setUrl(u); }); return () => { alive = false; }; }, [sub.image, env.images]);
  const pick = async (file: File) => { const r = await env.addImage(file); onChange({ image: r.name, width: r.width && r.height ? `${Math.min(7, Math.max(3, Math.round((r.width / 96) * 2.54 * 10) / 10))}cm` : sub.width }); };
  return (
    <div className="subfig" title={t("分图 ({{letter}})，标签 {{labelBase}}-{{v2}}", { letter: letter, labelBase: labelBase, v2: letter })}>
      {url ? <img src={url} alt="" style={{ width: figurePx(sub.width), maxWidth: '100%' }} draggable={false} /> : (
        <label className="fig-drop fig-drop-sm"><ImageUp /><span>{sub.image ? t("找不到 {{image}}", { image: sub.image }) : t("选图")}</span><input type="file" accept="image/*" hidden disabled={!editable} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} /></label>
      )}
      <div className="subfig-cap"><span className="cap-num">({letter})</span><AutoInput className="cap-input" disabled={!editable} value={sub.caption} placeholder={t("分图题")} minWidth={40} onChange={(e) => onChange({ caption: e.target.value })} /></div>
      <div className="subfig-tools">
        <LengthInput value={sub.width} defaultUnit="cm" disabled={!editable} onChange={(v) => onChange({ width: v ?? '6cm' })} width={70} />
        <label className="blk-tool is-btn" title={t("换图")}><ImageUp /><input type="file" accept="image/*" hidden disabled={!editable} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} /></label>
        <button type="button" className="blk-tool is-btn is-danger" title={t("删掉分图 ({{letter}})", { letter: letter })} disabled={!editable} onClick={onRemove}><Trash2 /></button>
        <span className="muted" style={{ fontSize: 11 }}>#{index + 1}</span>
      </div>
    </div>
  );
}

function FigureView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const env = useEditorEnv();
  const subs = parseSubs(node.attrs.subs);
  const setSubs = (s: SubFig[]) => updateAttributes({ subs: JSON.stringify(s) });
  const columns = Math.max(1, Math.min(4, Number(node.attrs.columns) || 2));
  const letters = 'abcdefghijklmnopqrstuvwxyz';
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
  // 合成图配连排分图题：分图条目都没有图、母图有图——图照常显示，分图题在图题下一行一条
  const captionOnly = subs.length > 0 && !!name && !subs.some((s) => s.image);
  return (
    <NodeViewWrapper className={`blk fig ${selected ? 'is-selected' : ''} ${subs.length && !captionOnly ? 'has-subs' : ''}`} data-drag-handle ref={wrap}>
      <div className="fig-body" contentEditable={false}>
        {subs.length && !captionOnly ? (
          <div className="subfig-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {subs.map((s, i) => <SubFigureCell key={i} sub={s} index={i} letter={letters[i] ?? String(i + 1)} labelBase={labelOf(node.attrs as any, 'fig')} editable={editable} onChange={(p) => setSubs(subs.map((x, k) => (k === i ? { ...x, ...p } : x)))} onRemove={() => setSubs(subs.filter((_, k) => k !== i))} />)}
          </div>
        ) : url ? <img src={url} alt="" style={{ width: figurePx(node.attrs.width), maxWidth: '100%' }} draggable={false} /> : (
          <label className="fig-drop">
            <ImageUp />
            <span>{name ? t("找不到图片 {{name}}，点击重新选择", { name: name }) : t("选择图片（PNG / JPG / SVG）")}</span>
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/gif" hidden disabled={!editable} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
          </label>
        )}
      </div>
      <Caption node={node} updateAttributes={updateAttributes} kindName={t("图")} editable={editable} prefix={num} />
      {captionOnly && (
        <div className="subcaps" contentEditable={false}>
          {subs.map((s, i) => (
            <span key={i} className="subfig-cap"><span className="cap-num">({letters[i] ?? i + 1})</span><AutoInput className="cap-input" disabled={!editable} value={s.caption} placeholder={t("分图题")} minWidth={40} onChange={(e) => setSubs(subs.map((x, k) => (k === i ? { ...x, caption: e.target.value } : x)))} /><button type="button" className="blk-tool is-btn is-danger" title={t("删掉这条分图题")} disabled={!editable} onClick={() => setSubs(subs.filter((_, k) => k !== i))}><Trash2 /></button></span>
          ))}
        </div>
      )}
      <Tools>
        <label className="blk-tool" title={t("图的宽度：cm / mm / pt / em / %（相对版心宽）")}>
          <MoveHorizontal />
          <LengthInput value={node.attrs.width ?? 8} defaultUnit="cm" disabled={!editable} onChange={(v) => updateAttributes({ width: v ?? 8 })} width={84} />
        </label>
        <LabelField node={node} updateAttributes={updateAttributes} prefix="fig" editable={editable} />
        <button type="button" className="blk-tool is-btn" title={t("加一张分图（多张分图排成一张母图，分图题 (a)(b)…）")} disabled={!editable} onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.onchange = async () => { const files = [...(input.files ?? [])]; const add: SubFig[] = []; for (const f of files) { const r = await env.addImage(f); add.push({ image: r.name, width: r.width && r.height ? `${Math.min(7, Math.max(3, Math.round((r.width / 96) * 2.54 * 10) / 10))}cm` : '6cm', caption: '' }); } const base = subs.length ? subs : (name ? [{ image: name, width: node.attrs.width ?? '6cm', caption: '' }] : []); setSubs([...base, ...add]); }; input.click(); }}><PencilLine />{t("分图")}</button>
        {!!name && (!subs.length || captionOnly) && <button type="button" className="blk-tool is-btn" title={t("这张图里已经画着 (a)(b)：分图题连排在图题之下（模板的 #subs）")} disabled={!editable} onClick={() => setSubs([...subs, { image: '', width: '', caption: '' }])}><PencilLine />{t("分图题")}</button>}
        {!subs.length && <label className="blk-tool is-btn" title={t("换一张图")}><ImageUp /><input type="file" accept="image/*" hidden disabled={!editable} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} /></label>}
        <button type="button" className="blk-tool is-btn is-danger" title={t("删除插图")} disabled={!editable} onClick={deleteNode}><Trash2 /></button>
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
    // placement：浮动（none / auto / top / bottom，Typst 的 figure(placement:)）；breakable：跨页三态（auto 按模板：图不拆、表可拆）
    // subs：分图（JSON），非空时母图由分图组成；columns 每行几张；subMode under = 分图题排在分图之下（#subfigure），
    // caption = 分图题跟在图题之下连排（#subs）
    return { image: attr('image', ''), width: attr('width', 8), caption: attr('caption', ''), captionEn: attr('captionEn', ''), label: attr('label', ''), uid: attr('uid', null), placement: attr('placement', 'none'), breakable: attr('breakable', 'auto'), subs: attr('subs', '[]'), columns: attr('columns', 2), subMode: attr('subMode', 'under') };
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
      <Caption node={node} updateAttributes={updateAttributes} kindName={t("表")} editable={editable} prefix={num} />
      <NodeViewContent className="tab-body" />
      <Tools>
        <LabelField node={node} updateAttributes={updateAttributes} prefix="tab" editable={editable} />
        <span className="blk-hint">{t("将光标置于单元格内，可在功能区添加或删除行列。")}</span>
        <button type="button" className="blk-tool is-btn is-danger" title={t("删除整张表")} disabled={!editable} onClick={deleteNode}><Trash2 /></button>
      </Tools>
    </NodeViewWrapper>
  );
}

// ── 代码清单（figure 壳 + 代码块）：模板按 raw-style 排（框、行号），这里只给题注与标签 ──
function CodeFigureView({ node, updateAttributes, selected, deleteNode, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  const num = useNumbering().get(labelOf(node.attrs as any, 'lst'))?.number;
  return (
    <NodeViewWrapper className={`blk lst ${selected ? 'is-selected' : ''}`}>
      <Caption node={node} updateAttributes={updateAttributes} kindName={t("代码")} editable={editable} prefix={num} />
      <NodeViewContent className="lst-body" />
      <Tools>
        <LabelField node={node} updateAttributes={updateAttributes} prefix="lst" editable={editable} />
        <span className="blk-hint">{t("边框和行号使用模板样式。")}</span>
        <button type="button" className="blk-tool is-btn is-danger" title={t("删除代码清单")} disabled={!editable} onClick={deleteNode}><Trash2 /></button>
      </Tools>
    </NodeViewWrapper>
  );
}

export const CodeFigure = Node.create({
  name: 'codeFigure',
  group: 'block',
  content: 'codeBlock',
  isolating: true,
  defining: true,
  addAttributes() {
    return { caption: attr('caption', ''), captionEn: attr('captionEn', ''), label: attr('label', ''), uid: attr('uid', null) };
  },
  parseHTML() { return [{ tag: 'div[data-node="codeFigure"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-node': 'codeFigure' }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(CodeFigureView); },
});

export const TableFigure = Node.create({
  name: 'tableFigure',
  group: 'block',
  content: 'table',
  isolating: true,
  defining: true,
  draggable: false,
  addAttributes() {
    // fit：Word 的「自动调整」——content 根据内容、window 根据窗口（撑满版心）、fixed 固定列宽（colWidth 厘米）；拖过列线的列另算
    return { caption: attr('caption', ''), captionEn: attr('captionEn', ''), label: attr('label', ''), uid: attr('uid', null), placement: attr('placement', 'none'), breakable: attr('breakable', 'auto'), fit: attr('fit', 'content'), colWidth: attr('colWidth', 2.5), cols: attr('cols', null) };
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
  // 编完（完成 / Enter / Esc）：收起，焦点回编辑器、公式块保持选中，方向键接着能走
  const finish = () => { setEditing(false); const p = getPos(); if (p !== undefined) editor.chain().focus().setNodeSelection(p).run(); };
  return (
    <NodeViewWrapper className={`blk eq ${selected ? 'is-selected' : ''} ${editing ? 'is-editing' : ''}`} data-drag-handle>
      {!editing && (
        <div className="eq-line" contentEditable={false} onClick={() => editable && setEditing(true)} title={t("点击编辑公式")}>
          <span className="eq-spacer" />
          <span className="eq-render"><MathPreview src={forPreview(src, mode)} mode={mode} display empty={<em className="muted">{t("空公式，点击编辑")}</em>} /></span>
          <span className="eq-number">{numbered ? num : ''}</span>
        </div>
      )}
      {editing && (
        <div className="eq-editor" contentEditable={false}>
          <MathEditor value={src} mode={mode} display onChange={(v) => updateAttributes({ src: v })} onMode={(m) => updateAttributes({ mode: m })} autoFocus onEnter={finish} />
          <div className="eq-editor-foot">
            <label className="blk-tool"><input type="checkbox" checked={numbered} disabled={!editable} onChange={(e) => updateAttributes({ numbered: e.target.checked })} /> {' '}{t("编号")}{' '}{numbered && num && <b>{num}</b>}</label>
            <LabelField node={node} updateAttributes={updateAttributes} prefix="eq" editable={editable} />
            <span className="spacer" />
            <button type="button" className="blk-tool is-btn is-danger" title={t("删除公式")} onClick={deleteNode}><Trash2 /></button>
            <button type="button" className="btn btn-xs btn-primary" onClick={finish}><Check />{t("完成")}</button>
          </div>
        </div>
      )}
      {!editing && (
        <Tools>
          <button type="button" className="blk-tool is-btn" title={t("编辑")} onClick={() => setEditing(true)}><PencilLine /></button>
          <button type="button" className="blk-tool is-btn is-danger" title={t("删除公式")} onClick={deleteNode}><Trash2 /></button>
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
      <span>{t("分页")}</span>
      <Tools><button type="button" className="blk-tool is-btn is-danger" title={t("删除分页")} onClick={deleteNode}><Trash2 /></button></Tools>
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
