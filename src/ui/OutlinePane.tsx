// 大纲（Word 的导航窗格）：当前这一节里的标题树，点一下跳过去
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { useStore, type RichKey } from '../model/store';
import { indexPositions, type PMNode } from '../typst/pmToTypst';
import { computeNumbering } from '../typst/numbering';
import { labelOf } from '../typst/pmToTypst';
import { getEditor, onRegistryChange } from '../editor/registry';
import { t } from '../i18n';

// 收起状态按节记（正文 / 附录各自），存本机
const KEY = 'iota4web-outline-folded';
const readFolded = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
export const useOutline = create<{ folded: Record<string, boolean>; toggle: (key: string) => void }>((set) => ({
  folded: readFolded(),
  toggle: (key) => set((s) => { const folded = { ...s.folded, [key]: !s.folded[key] }; try { localStorage.setItem(KEY, JSON.stringify(folded)); } catch { /* */ } return { folded }; }),
}));

export function OutlinePane({ richKey: key, onJump }: { richKey: RichKey; onJump?: () => void }) {
  const doc = useStore((s) => s.doc);
  const items = useMemo(() => {
    const d = doc[key] as PMNode;
    const posOf = indexPositions(d);
    const nums = computeNumbering(d, doc.settings, key === 'appendix' ? 'appendix' : 'body');
    const out: { pos: number; level: number; text: string; num: string }[] = [];
    for (const n of d.content ?? []) {
      if (n.type !== 'heading') continue;
      const text = (n.content ?? []).map((c) => c.text ?? '').join('');
      out.push({ pos: posOf.get(n) ?? 0, level: n.attrs?.level ?? 1, text, num: nums.get(labelOf(n.attrs, 'sec'))?.number ?? '' });
    }
    return out;
  }, [doc, key]);
  // 光标落在哪个标题底下，那一条点亮并保持在视野里（Word 导航窗格的样子）
  const [cur, setCur] = useState(-1);
  useEffect(() => {
    let raf = 0;
    let ed = getEditor(key);
    const sync = () => {
      raf = 0;
      const e = getEditor(key);
      if (!e || e.isDestroyed) { setCur(-1); return; }
      const from = e.state.selection.from;
      let hit = -1;
      for (let i = 0; i < items.length; i++) { if (items[i].pos < from) hit = i; else break; }
      setCur(hit);
    };
    const onSel = () => { if (!raf) raf = requestAnimationFrame(sync); };
    const attach = () => { ed?.off('selectionUpdate', onSel); ed = getEditor(key); ed?.on('selectionUpdate', onSel); onSel(); };
    attach();
    const off = onRegistryChange(attach);
    return () => { off(); ed?.off('selectionUpdate', onSel); cancelAnimationFrame(raf); };
  }, [key, items]);
  const folded = useOutline((s) => !!s.folded[key]);
  const curRef = useRef<HTMLButtonElement>(null);
  // 展开动画没走完别滚：outline-wrap-inner 是 overflow: hidden，半路滚会把列表滚歪、动画也一顿；等它展开完再平滑滚过去
  useEffect(() => {
    const el = curRef.current;
    if (folded || !el) return;
    const wrap = el.closest('.outline-wrap');
    const go = () => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (!wrap?.getAnimations().length) { go(); return; }
    const onEnd = (e: Event) => { if (e.target === wrap) { wrap.removeEventListener('transitionend', onEnd); go(); } };
    wrap.addEventListener('transitionend', onEnd);
    return () => wrap.removeEventListener('transitionend', onEnd);
  }, [cur, folded]);
  const jump = (pos: number) => {
    onJump?.();
    const ed = getEditor(key);
    if (!ed) return;
    ed.chain().focus().setTextSelection(Math.min(pos + 1, ed.state.doc.content.size)).scrollIntoView().run();
    const el = ed.view.nodeDOM(pos) as HTMLElement | null;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.classList.add('is-flash');
    setTimeout(() => el?.classList.remove('is-flash'), 1200);
  };
  return (
    <div className="outline">
      {!items.length && <div className="muted outline-empty">{t("还没有标题")}</div>}
      {items.map((h, i) => (
        <button key={i} ref={i === cur ? curRef : undefined} type="button" className={`outline-item l${h.level} ${i === cur ? 'is-current' : ''}`} aria-current={i === cur ? 'location' : undefined} onClick={() => jump(h.pos)} title={h.text}>
          {h.num && <span className="outline-num">{h.num}</span>}<span>{h.text || t("（空标题）")}</span>
        </button>
      ))}
    </div>
  );
}
