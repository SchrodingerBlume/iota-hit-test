// 大纲（Word 的导航窗格）：当前这一节里的标题树，点一下跳过去
import { useMemo } from 'react';
import { create } from 'zustand';
import { useStore, type RichKey } from '../model/store';
import { indexPositions, type PMNode } from '../typst/pmToTypst';
import { computeNumbering } from '../typst/numbering';
import { labelOf } from '../typst/pmToTypst';
import { getEditor } from '../editor/registry';
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
  const jump = (pos: number) => {
    onJump?.();
    const ed = getEditor(key);
    if (!ed) return;
    ed.chain().focus().setTextSelection(Math.min(pos + 1, ed.state.doc.content.size)).scrollIntoView().run();
    (ed.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: 'center' });
  };
  return (
    <div className="outline">
      {!items.length && <div className="muted outline-empty">{t("还没有标题")}</div>}
      {items.map((h, i) => (
        <button key={i} type="button" className={`outline-item l${h.level}`} onClick={() => jump(h.pos)} title={h.text}>
          {h.num && <span className="outline-num">{h.num}</span>}<span>{h.text || t("（空标题）")}</span>
        </button>
      ))}
    </div>
  );
}
