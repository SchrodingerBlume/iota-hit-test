// 大纲（Word 的导航窗格）：当前这一节里的标题树，点一下跳过去
import { useMemo } from 'react';
import { create } from 'zustand';
import { useStore, type RichKey } from '../model/store';
import { indexPositions, type PMNode } from '../typst/pmToTypst';
import { computeNumbering } from '../typst/numbering';
import { labelOf } from '../typst/pmToTypst';
import { getEditor } from '../editor/registry';
import { t } from '../i18n';

const KEY = 'iota4web-outline';
export const useOutline = create<{ on: boolean; toggle: () => void }>((set) => ({
  on: (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })(),
  toggle: () => set((s) => { const on = !s.on; try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* */ } return { on }; }),
}));

const RICH_OF: Record<string, RichKey | undefined> = { body: 'body', appendix: 'appendix' };

export function OutlinePane() {
  const section = useStore((s) => s.section);
  const doc = useStore((s) => s.doc);
  const key = RICH_OF[section];
  const items = useMemo(() => {
    if (!key) return [];
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
  if (!key) return <div className="outline muted">{t("大纲只有正文与附录有")}</div>;
  const jump = (pos: number) => {
    const ed = getEditor(key);
    if (!ed) return;
    ed.chain().focus().setTextSelection(Math.min(pos + 1, ed.state.doc.content.size)).scrollIntoView().run();
    (ed.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: 'center' });
  };
  return (
    <div className="outline">
      {!items.length && <div className="muted">{t("还没有标题")}</div>}
      {items.map((h, i) => (
        <button key={i} type="button" className={`outline-item l${h.level}`} onClick={() => jump(h.pos)} title={h.text}>
          {h.num && <span className="outline-num">{h.num}</span>}<span>{h.text || t("（空标题）")}</span>
        </button>
      ))}
    </div>
  );
}
