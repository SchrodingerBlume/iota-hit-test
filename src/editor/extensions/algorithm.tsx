// lovelace 算法节点：未编号的输入/输出行使用 `-`，编号步骤使用 `+`，嵌套层级表示缩进。
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Handle } from './blocks';
import { useRef } from 'react';
import { Trash2, Plus, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Tag } from 'lucide-react';
import { useNumbering } from '../env';
import { labelOf } from '../../typst/pmToTypst';
import { AutoInput } from '../../ui/AutoInput';
import { t as tx } from '../../i18n';
import { MirrorInput } from '../mirror';

export interface AlgLine { text: string; level: number }
export function parseLines(v: unknown): AlgLine[] {
  if (Array.isArray(v)) return v as AlgLine[];
  if (typeof v !== 'string' || !v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}
export function parseIo(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v !== 'string' || !v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}

const attr = (k: string, def: any) => ({ default: def, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k}`) ?? def, renderHTML: (a: any) => ({ [`data-${k}`]: a[k] }) });

function AlgorithmView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const lines = parseLines(node.attrs.lines);
  const io = parseIo(node.attrs.io);
  const num = useNumbering().get(labelOf(node.attrs as any, 'alg'))?.number;
  const setLines = (l: AlgLine[]) => updateAttributes({ lines: JSON.stringify(l) });
  const setIo = (l: string[]) => updateAttributes({ io: JSON.stringify(l) });
  const wrap = useRef<HTMLDivElement>(null);
  const focusLine = (i: number) => window.setTimeout(() => wrap.current?.querySelectorAll<HTMLInputElement>('.alg-line input')[i]?.focus(), 30);
  const onKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); const l = [...lines]; l.splice(i + 1, 0, { text: '', level: lines[i].level }); setLines(l); focusLine(i + 1); }
    else if (e.key === 'Tab') { e.preventDefault(); const l = lines.map((x, k) => (k === i ? { ...x, level: Math.max(0, Math.min(6, x.level + (e.shiftKey ? -1 : 1))) } : x)); setLines(l); }
    else if (e.key === 'Backspace' && !lines[i].text && lines.length > 1) { e.preventDefault(); const l = lines.filter((_, k) => k !== i); setLines(l); focusLine(Math.max(0, i - 1)); }
    else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); focusLine(i - 1); }
    else if (e.key === 'ArrowDown' && i < lines.length - 1) { e.preventDefault(); focusLine(i + 1); }
  };
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= lines.length) return; const l = [...lines]; [l[i], l[j]] = [l[j], l[i]]; setLines(l); focusLine(j); };
  return (
    <NodeViewWrapper className={`blk alg ${selected ? 'is-selected' : ''}`} ref={wrap}>
      <Handle editor={editor} getPos={getPos} />
      <div className="alg-head" contentEditable={false}>
        {num && <span className="cap-num" title={tx("编号由模板生成，以页面视图为准")}>{num}</span>}
        <AutoInput className="cap-input" data-attr="caption" disabled={!editable} value={node.attrs.caption ?? ''} placeholder={tx("算法题注")} minWidth={80} onChange={(e) => updateAttributes({ caption: e.target.value })} />
        <AutoInput className="cap-input-en" data-attr="captionEn" disabled={!editable} value={node.attrs.captionEn ?? ''} placeholder={tx("英文题注（可留空）")} minWidth={60} onChange={(e) => updateAttributes({ captionEn: e.target.value })} />
      </div>
      <div className="alg-body" contentEditable={false}>
        {io.map((t, i) => (
          <div key={`io${i}`} className="alg-line alg-io">
            <span className="alg-no">–</span>
            <MirrorInput value={t} disabled={!editable} placeholder="input: …" onChange={(e) => setIo(io.map((x, k) => (k === i ? e.target.value : x)))} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); const l = [...io]; l.splice(i + 1, 0, ''); setIo(l); } else if (e.key === 'Backspace' && !t) { e.preventDefault(); setIo(io.filter((_, k) => k !== i)); } }} />
            <button type="button" className="alg-btn" title={tx("删除此行")} disabled={!editable} onClick={() => setIo(io.filter((_, k) => k !== i))}><Trash2 /></button>
          </div>
        ))}
        {lines.map((l, i) => (
          <div key={i} className="alg-line" style={{ paddingLeft: `${l.level * 1.6}em` }}>
            <span className="alg-no">{i + 1}</span>
            <MirrorInput value={l.text} disabled={!editable} placeholder={i === 0 ? tx("for $t = 1$ to $T$ do（Tab 增加缩进，Enter 新建一行）") : ''} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} onKeyDown={(e) => onKey(i, e)} />
            <span className="alg-tools">
              <button type="button" className="alg-btn" title={tx("减少缩进（Shift+Tab）")} disabled={!editable || !l.level} onClick={() => setLines(lines.map((x, k) => (k === i ? { ...x, level: Math.max(0, x.level - 1) } : x)))}><ChevronLeft /></button>
              <button type="button" className="alg-btn" title={tx("增加缩进（Tab）")} disabled={!editable} onClick={() => setLines(lines.map((x, k) => (k === i ? { ...x, level: Math.min(6, x.level + 1) } : x)))}><ChevronRight /></button>
              <button type="button" className="alg-btn" title={tx("上移")} disabled={!editable || i === 0} onClick={() => move(i, -1)}><ArrowUp /></button>
              <button type="button" className="alg-btn" title={tx("下移")} disabled={!editable || i === lines.length - 1} onClick={() => move(i, 1)}><ArrowDown /></button>
              <button type="button" className="alg-btn" title={tx("删除此行")} disabled={!editable || lines.length <= 1} onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 /></button>
            </span>
          </div>
        ))}
      </div>
      <div className="blk-tools" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="blk-tool is-btn" disabled={!editable} onClick={() => setIo([...io, io.length ? 'output: ' : 'input: '])}><Plus />{tx("输入或输出行")}</button>
        <button type="button" className="blk-tool is-btn" disabled={!editable} onClick={() => { setLines([...lines, { text: '', level: 0 }]); focusLine(lines.length); }}><Plus />{tx("添加一行")}</button>
        <label className="blk-tool" title={tx("交叉引用用的标签；留空则自动生成")}>
          <Tag />
          <MirrorInput value={node.attrs.label ?? ''} placeholder={`alg:${node.attrs.uid ?? ''}`} disabled={!editable} onChange={(e) => updateAttributes({ label: e.target.value.trim() })} />
        </label>
        <button type="button" className="blk-tool is-btn is-danger" title={tx("删除算法")} disabled={!editable} onClick={deleteNode}><Trash2 /></button>
      </div>
    </NodeViewWrapper>
  );
}

export const Algorithm = Node.create({
  name: 'algorithm',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { caption: attr('caption', ''), captionEn: attr('captionEn', ''), label: attr('label', ''), uid: attr('uid', null), io: attr('io', '[]'), lines: attr('lines', '[]') };
  },
  parseHTML() { return [{ tag: 'div[data-node="algorithm"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-node': 'algorithm' })]; },
  addNodeView() { return ReactNodeViewRenderer(AlgorithmView); },
});
