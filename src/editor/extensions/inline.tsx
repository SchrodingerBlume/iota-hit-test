// 行内原子节点：行内公式、文献引用、交叉引用、缩略语、脚注、空格（ccwd）。
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useState, type ReactElement } from 'react';
import { InlineChip, Field } from './Chip';
import { useEditorEnv, useOpenNonce, focusAttrInput } from '../env';
import { useEffect, useRef } from 'react';
import { MathEditor, forPreview } from '../math/MathEditor';
import { MathPreview } from '../math/MathPreview';
import { t } from '../../i18n';
import { MirrorInput, MirrorTextarea } from '../mirror';

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
  const mode = node.attrs.mode === 'typst' ? 'typst' : 'latex';
  return (
    <InlineChip onSelect={() => { const p = getPos(); if (p !== undefined) editor.chain().focus().setNodeSelection(p).run(); }} kind="math" openNonce={open.nonce} text={src ? <MathPreview src={forPreview(src, mode)} mode={mode} /> : <em>{t("公式")}</em>} title={src || t("行内公式")} selected={selected} editable={editor.isEditable} autoOpen={!src} onDelete={deleteNode} wide>
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
  const form = String(node.attrs.form ?? 'auto');
  const supplement = String(node.attrs.supplement ?? '').trim();
  const missing = keys.filter((k) => !env.bibKeys.some((b) => b.key === k));
  const chipText = keys.length ? `[${keys.join(', ')}${supplement ? `: ${supplement}` : ''}]${form === 'prose' ? t("·叙") : form === 'author' ? t("·著") : form === 'year' ? t("·年") : ''}` : '';
  const chip = chipText ? (missing.length ? <span className="ref-dangling" title={t("文献 {{keys}} 没有登记，排出来是 ??", { keys: missing.join(', ') })}>{chipText}</span> : chipText) : '';
  return (
    <InlineChip onSelect={() => { const p = getPos(); if (p !== undefined) editor.chain().focus().setNodeSelection(p).run(); }} kind="cite" openNonce={open.nonce} text={chip || <em>{t("引用")}</em>} title={t("参考文献引用")} selected={selected} editable={editor.isEditable} autoOpen={!keys.length} onDelete={deleteNode}>
      {() => (
        <>
          <Field label={t("文献")} hint={env.bibKeys.length ? t("选择一项或多项") : t("请先在“参考文献”中添加文献。")}>
            <input autoFocus value={q} placeholder={t("搜索引用键或题名")} onChange={(e) => setQ(e.target.value)} />
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
            {!list.length && <li className="muted">{t("未找到匹配的条目")}</li>}
          </ul>
          <Field label={t("手动输入引用键")}>
            <MirrorInput value={node.attrs.keys ?? ''} placeholder="key1,key2" onChange={(e) => updateAttributes({ keys: e.target.value })} />
          </Field>
          <Field label={t("页码等")} hint={t("引文出处的页码（如 15 或 15-20），顺序编码制印在 [1] 外，著者-出版年制印在年后，脚注里接在条目末")}>
            <MirrorInput value={node.attrs.supplement ?? ''} placeholder="15-20" onChange={(e) => updateAttributes({ supplement: e.target.value })} />
          </Field>
          <Field label={t("标注形式")} hint={t("叙述式把著者写进句子：张三（2020）认为…；只著者 / 只年份给自己拼句子用")}>
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {(['auto', 'prose', 'author', 'year'] as const).map((f) => <button key={f} type="button" className={`bib-group-chip ${form === f ? 'on' : ''}`} onClick={() => updateAttributes({ form: f })}>{{ auto: t("默认"), prose: t("叙述式"), author: t("只著者"), year: t("只年份") }[f]}</button>)}
            </div>
          </Field>
        </>
      )}
    </InlineChip>
  );
}
export const Cite = inlineAtom('cite', { keys: { default: '' }, form: { default: 'auto' }, supplement: { default: '' } }, CiteView);

// ── 交叉引用 ────────────────────────────────────────────────────
const KIND_NAME: Record<string, string> = { fig: t("图"), tab: t("表"), eq: t("式"), sec: t("节"), thm: t("定理") };
const KIND_GROUP: Record<string, string> = { fig: t("图"), tab: t("表"), eq: t("公式"), alg: t("算法"), lst: t("代码"), thm: t("定理"), sec: t("章节") };
const KIND_ORDER = ['fig', 'tab', 'eq', 'alg', 'lst', 'thm', 'sec'];

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
        <input autoFocus value={q} placeholder={t("搜索编号、题注、标题…")} className="input" style={{ flex: 1 }} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row" style={{ marginBottom: 6, gap: 4 }}>
        <button type="button" className={`bib-group-chip ${kind === '' ? 'on' : ''}`} onClick={() => setKind('')}>{t("全部")}</button>
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
        {!items.length && <li className="muted">{env.refTargets.length ? t("未找到匹配的") : t("文档中没有可引用的图、表、公式或标题。")}</li>}
      </ul>
    </>
  );
}
function RefView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const open = useOpenNonce(getPos);
  const env = useEditorEnv();
  const target = String(node.attrs.target ?? '');
  const hit = env.refTargets.find((r) => r.label === target);
  const text = hit ? (hit.ref ?? `${KIND_NAME[hit.kind]} ${hit.index}`) : target ? <span className="ref-dangling" title={t("未找到引用对象。该对象可能已被删除或取消编号。")}>??</span> : <em>{t("引用")}</em>;
  return (
    <InlineChip onSelect={() => { const p = getPos(); if (p !== undefined) editor.chain().focus().setNodeSelection(p).run(); }} kind="ref" openNonce={open.nonce} text={text} title={hit ? `${KIND_NAME[hit.kind]}：${hit.title}` : t("交叉引用")} selected={selected} editable={editor.isEditable} autoOpen={!target} onDelete={deleteNode}>
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
    <InlineChip onSelect={() => { const p = getPos(); if (p !== undefined) editor.chain().focus().setNodeSelection(p).run(); }} kind="abbr" openNonce={open.nonce} text={key || <em>{t("缩写")}</em>} title={hit ? t("{{key}}：{{long}}（首次出现自动展开）", { key: key, long: hit.long }) : t("缩略语")} selected={selected} editable={editor.isEditable} autoOpen={!key} onDelete={deleteNode}>
      {(close) => (
        <>
          <div className="field-label">{t("缩略语")}</div>
          <ul className="pick-list">
            {env.abbrs.map((a) => (
              <li key={a.key} className={a.key === key ? 'on' : ''}>
                <button type="button" onClick={() => { updateAttributes({ key: a.key }); close(); }}><b>{a.key}</b> <span className="muted">{a.long}</span></button>
              </li>
            ))}
            {!env.abbrs.length && <li className="muted">{t("请先在“符号与缩略语”中添加缩略语。")}</li>}
          </ul>
        </>
      )}
    </InlineChip>
  );
}
export const Abbr = inlineAtom('abbr', { key: { default: '' } }, AbbrView);

// ── 脚注 ────────────────────────────────────────────────────────
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
function useFootnoteIndex(editor: NodeViewProps['editor'], getPos: NodeViewProps['getPos']): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const calc = () => { const p = getPos(); if (p === undefined) return; let k = 0; editor.state.doc.nodesBetween(0, p, (x) => { if (x.type.name === 'footnote') k++; return true; }); setN(k + 1); };
    calc();
    editor.on('transaction', calc);
    return () => { editor.off('transaction', calc); };
  }, [editor, getPos]);
  return n;
}

function FootnoteView({ node, updateAttributes, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const open = useOpenNonce(getPos);
  const text = String(node.attrs.text ?? '');
  const idx = useFootnoteIndex(editor, getPos);
  const mark = CIRCLED[idx - 1] ?? `(${idx})`;
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (open.nonce && open.attr) requestAnimationFrame(() => focusAttrInput(wrap.current?.closest('.chip-wrap') as HTMLElement | null, open.attr, open.offset)); }, [open]);
  return (
    <InlineChip onSelect={() => { const p = getPos(); if (p !== undefined) editor.chain().focus().setNodeSelection(p).run(); }} kind="footnote" openNonce={open.nonce} text={<span ref={wrap}>{mark}</span>} title={text || t("脚注")} selected={selected} editable={editor.isEditable} autoOpen={!text} onDelete={deleteNode}>
      {() => (
        <Field label={t("脚注内容")}>
          <MirrorTextarea autoFocus rows={3} data-attr="text" value={text} onChange={(e) => updateAttributes({ text: e.target.value })} />
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
    <InlineChip onSelect={() => { const p = getPos(); if (p !== undefined) editor.chain().focus().setNodeSelection(p).run(); }} kind="idx" openNonce={open.nonce} text={text || <em>{t("索引项")}</em>} title={t("将所选文字标记为索引项；正文显示不变")} selected={selected} editable={editor.isEditable} autoOpen={!text} onDelete={deleteNode}>
      {(close) => (
        <Field label={t("索引项")} hint={t("标记索引项")}>
          <MirrorInput autoFocus value={text} onChange={(e) => updateAttributes({ text: e.target.value })} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); close(); } }} />
        </Field>
      )}
    </InlineChip>
  );
}
export const Idx = inlineAtom('idx', { text: { default: '' } }, IdxView);

// ── 空一个汉字（#ccwd） ──────────────────────────────────────────
function CcwdView({ node, selected, editor, getPos }: NodeViewProps) {
  return (
    <InlineChip onSelect={() => { const p = getPos(); if (p !== undefined) editor.chain().focus().setNodeSelection(p).run(); }} kind="ccwd" text="␣" title={t("插入 {{n}} 个汉字宽的空格", { n: node.attrs.n })} selected={selected} editable={false}>
      {() => null}
    </InlineChip>
  );
}
export const Ccwd = inlineAtom('ccwd', { n: { default: 1 } }, CcwdView);
