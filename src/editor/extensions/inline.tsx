// 行内原子节点：行内公式、文献引用、交叉引用、缩略语、脚注、空格（ccwd）。
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useState, type ReactElement } from 'react';
import { InlineChip, Field } from './Chip';
import { useEditorEnv, useOpenNonce, focusAttrInput } from '../env';
import { useEffect, useRef } from 'react';
import { MathEditor, forPreview } from '../math/MathEditor';
import { MathPreview } from '../math/MathPreview';

const inlineAtom = (name: string, attrs: Record<string, { default: any }>, View: (p: NodeViewProps) => ReactElement) =>
  Node.create({
    name,
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(attrs)) {
        out[k] = { default: v.default, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k}`) ?? v.default, renderHTML: (a: any) => ({ [`data-${k}`]: a[k] }) };
      }
      return out;
    },
    parseHTML() { return [{ tag: `span[data-node="${name}"]` }]; },
    renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-node': name }), 0]; },
    addNodeView() { return ReactNodeViewRenderer(View); },
  });

// ── 行内公式 ────────────────────────────────────────────────────
function MathInlineView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const open = useOpenNonce(getPos);
  const src = String(node.attrs.src ?? '');
  const mode = node.attrs.mode === 'latex' ? 'latex' : 'typst';
  return (
    <InlineChip kind="math" openNonce={open.nonce} text={src ? <MathPreview src={forPreview(src, mode)} mode={mode} /> : <em>公式</em>} title={src || '行内公式'} selected={selected} editable={editor.isEditable} autoOpen={!src} onDelete={deleteNode} wide>
      {(close) => (
        <MathEditor value={src} mode={mode} display={false} compact autoFocus onChange={(v) => updateAttributes({ src: v })} onMode={(m) => updateAttributes({ mode: m })} onEnter={close} />
      )}
    </InlineChip>
  );
}
export const MathInline = inlineAtom('mathInline', { src: { default: '' }, mode: { default: 'latex' } }, MathInlineView);

/** 按分组归堆，没分组的排最后 */
function groupBy<T extends { group?: string }>(items: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) { const g = it.group?.trim() ?? ''; if (!m.has(g)) m.set(g, []); m.get(g)!.push(it); }
  return [...m.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0], 'zh')));
}

// ── 文献引用 ────────────────────────────────────────────────────
function CiteView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const open = useOpenNonce(getPos);
  const env = useEditorEnv();
  const keys = String(node.attrs.keys ?? '').split(/[,\s;]+/).filter(Boolean);
  const [q, setQ] = useState('');
  const toggle = (k: string) => {
    const next = keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k];
    updateAttributes({ keys: next.join(',') });
  };
  const list = env.bibKeys.filter((b) => !q || b.key.toLowerCase().includes(q.toLowerCase()) || b.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <InlineChip kind="cite" openNonce={open.nonce} text={keys.length ? `[${keys.join(', ')}]` : <em>引用</em>} title="参考文献引用" selected={selected} editable={editor.isEditable} autoOpen={!keys.length} onDelete={deleteNode}>
      {() => (
        <>
          <Field label="文献" hint={env.bibKeys.length ? '点选，可多选' : '先在「参考文献」里粘贴 BibTeX'}>
            <input autoFocus value={q} placeholder="搜索 key 或标题" onChange={(e) => setQ(e.target.value)} />
          </Field>
          <ul className="pick-list">
            {groupBy(list.slice(0, 80)).map(([g, items]) => (
              <li key={g} className="pick-group">
                {g && <div className="pick-group-head">{g}</div>}
                <ul>
                  {items.map((b) => (
                    <li key={b.key}>
                      <label><input type="checkbox" checked={keys.includes(b.key)} onChange={() => toggle(b.key)} /> <code>{b.key}</code> <span className="muted">{b.title}</span></label>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {!list.length && <li className="muted">没有匹配的条目</li>}
          </ul>
          <Field label="手填 key">
            <input value={node.attrs.keys ?? ''} placeholder="key1,key2" onChange={(e) => updateAttributes({ keys: e.target.value })} />
          </Field>
        </>
      )}
    </InlineChip>
  );
}
export const Cite = inlineAtom('cite', { keys: { default: '' } }, CiteView);

// ── 交叉引用 ────────────────────────────────────────────────────
const KIND_NAME: Record<string, string> = { fig: '图', tab: '表', eq: '式', sec: '节' };
const KIND_GROUP: Record<string, string> = { fig: '图', tab: '表', eq: '公式', alg: '算法', lst: '代码', sec: '章节' };
const KIND_ORDER = ['fig', 'tab', 'eq', 'alg', 'lst', 'sec'];

/** 交叉引用选择器：按图 / 表 / 公式 / 章节分组，可搜索 */
function RefPicker({ env, target, onPick }: { env: ReturnType<typeof useEditorEnv>; target: string; onPick: (label: string) => void }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string>('');
  const needle = q.trim().toLowerCase();
  const items = env.refTargets.filter((r) => (!kind || r.kind === kind) && (!needle || `${r.ref ?? ''} ${r.title} ${r.label}`.toLowerCase().includes(needle)));
  const kinds = KIND_ORDER.filter((k) => env.refTargets.some((r) => r.kind === k));
  return (
    <>
      <div className="row" style={{ marginBottom: 6, gap: 6 }}>
        <input autoFocus value={q} placeholder="搜索编号、题注、标题…" className="input" style={{ flex: 1 }} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row" style={{ marginBottom: 6, gap: 4 }}>
        <button type="button" className={`bib-group-chip ${kind === '' ? 'on' : ''}`} onClick={() => setKind('')}>全部</button>
        {kinds.map((k) => <button key={k} type="button" className={`bib-group-chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{KIND_GROUP[k]} <span className="muted">{env.refTargets.filter((r) => r.kind === k).length}</span></button>)}
      </div>
      <ul className="pick-list">
        {KIND_ORDER.filter((k) => items.some((r) => r.kind === k)).map((k) => (
          <li key={k} className="pick-group">
            {!kind && <div className="pick-group-head">{KIND_GROUP[k]}</div>}
            <ul>
              {items.filter((r) => r.kind === k).map((r) => (
                <li key={r.label} className={r.label === target ? 'on' : ''}>
                  <button type="button" onClick={() => onPick(r.label)}>
                    <b>{r.ref ?? `${KIND_NAME[r.kind]} ${r.index}`}</b> <span className="muted">{r.title || r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
        {!items.length && <li className="muted">{env.refTargets.length ? '没有匹配的' : '文档里还没有图、表、公式或标题'}</li>}
      </ul>
    </>
  );
}
function RefView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const open = useOpenNonce(getPos);
  const env = useEditorEnv();
  const target = String(node.attrs.target ?? '');
  const hit = env.refTargets.find((r) => r.label === target);
  const text = hit ? (hit.ref ?? `${KIND_NAME[hit.kind]} ${hit.index}`) : target ? <span className="ref-dangling" title="引用的对象不存在了（删了，或公式取消了编号）">??</span> : <em>引用</em>;
  return (
    <InlineChip kind="ref" openNonce={open.nonce} text={text} title={hit ? `${KIND_NAME[hit.kind]}：${hit.title}` : '交叉引用'} selected={selected} editable={editor.isEditable} autoOpen={!target} onDelete={deleteNode}>
      {(close) => <RefPicker env={env} target={target} onPick={(l) => { updateAttributes({ target: l }); close(); }} />}
    </InlineChip>
  );
}
export const Ref = inlineAtom('ref', { target: { default: '' } }, RefView);

// ── 缩略语 ──────────────────────────────────────────────────────
function AbbrView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const open = useOpenNonce(getPos);
  const env = useEditorEnv();
  const key = String(node.attrs.key ?? '');
  const hit = env.abbrs.find((a) => a.key === key);
  return (
    <InlineChip kind="abbr" openNonce={open.nonce} text={key || <em>缩写</em>} title={hit ? `${key}：${hit.long}（首次出现自动展开）` : '缩略语'} selected={selected} editable={editor.isEditable} autoOpen={!key} onDelete={deleteNode}>
      {(close) => (
        <>
          <div className="field-label">缩略语</div>
          <ul className="pick-list">
            {env.abbrs.map((a) => (
              <li key={a.key} className={a.key === key ? 'on' : ''}>
                <button type="button" onClick={() => { updateAttributes({ key: a.key }); close(); }}><b>{a.key}</b> <span className="muted">{a.long}</span></button>
              </li>
            ))}
            {!env.abbrs.length && <li className="muted">先在「符号与缩略语」里登记</li>}
          </ul>
        </>
      )}
    </InlineChip>
  );
}
export const Abbr = inlineAtom('abbr', { key: { default: '' } }, AbbrView);

// ── 脚注 ────────────────────────────────────────────────────────
function FootnoteView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const open = useOpenNonce(getPos);
  const text = String(node.attrs.text ?? '');
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (open.nonce && open.attr) requestAnimationFrame(() => focusAttrInput(wrap.current?.closest('.chip-wrap') as HTMLElement | null, open.attr, open.offset)); }, [open]);
  return (
    <InlineChip kind="footnote" openNonce={open.nonce} text={<span ref={wrap}>①</span>} title={text || '脚注'} selected={selected} editable={editor.isEditable} autoOpen={!text} onDelete={deleteNode}>
      {() => (
        <Field label="脚注内容">
          <textarea autoFocus rows={3} data-attr="text" value={text} onChange={(e) => updateAttributes({ text: e.target.value })} />
        </Field>
      )}
    </InlineChip>
  );
}
export const Footnote = inlineAtom('footnote', { text: { default: '' } }, FootnoteView);

// ── 索引词（#idx） ──────────────────────────────────────────────
function IdxView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const open = useOpenNonce(getPos);
  const text = String(node.attrs.text ?? '');
  return (
    <InlineChip kind="idx" openNonce={open.nonce} text={text || <em>索引词</em>} title="登记进索引页的词（正文里照常印出）" selected={selected} editable={editor.isEditable} autoOpen={!text} onDelete={deleteNode}>
      {(close) => (
        <Field label="索引词" hint="印在正文里，同时登记进索引页（要排索引页记得在「页面开关」里打开）">
          <input autoFocus value={text} onChange={(e) => updateAttributes({ text: e.target.value })} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); close(); } }} />
        </Field>
      )}
    </InlineChip>
  );
}
export const Idx = inlineAtom('idx', { text: { default: '' } }, IdxView);

// ── 空一个汉字（#ccwd） ──────────────────────────────────────────
function CcwdView({ node, selected }: NodeViewProps) {
  return (
    <InlineChip kind="ccwd" text="␣" title={`空 ${node.attrs.n} 个汉字宽`} selected={selected} editable={false}>
      {() => null}
    </InlineChip>
  );
}
export const Ccwd = inlineAtom('ccwd', { n: { default: 1 } }, CcwdView);
