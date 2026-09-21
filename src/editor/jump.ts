// ⌘ / Ctrl + 点击的跳转：交叉引用跳到被引的图表 / 公式 / 标题 / 定理，引文跳到参考文献页那条，缩略语跳到符号页，
// 链接在新窗口打开。编辑器里的芯片与预览区里的链接都走这里
import { create } from 'zustand';
import { useStore, type RichKey } from '../model/store';
import { getEditor } from './registry';
import { labelOf, parseJsonArr, type PMNode } from '../typst/pmToTypst';
import { theoremKind } from '../typst/theorem';

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const isJumpModifier = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);

/** 参考文献页要选中哪条（引文芯片 ⌘点过来） */
export const useBibFocus = create<{ key: string | null; request: (key: string) => void; clear: () => void }>((set) => ({ key: null, request: (key) => set({ key }), clear: () => set({ key: null }) }));

const PREFIX: Record<string, string> = { figure: 'fig', tableFigure: 'tab', equation: 'eq', heading: 'sec', algorithm: 'alg', codeFigure: 'lst', theorem: 'thm' };

/** 标签在哪份富文本的第几个位置（顶层与嵌套都找；分图 fig:x-a 落到母图） */
function findLabel(label: string): { key: RichKey; pos: number } | null {
  const doc = useStore.getState().doc;
  const base = label.replace(/-[a-z]$/, '');
  for (const key of ['body', 'appendix'] as RichKey[]) {
    let found = -1;
    const walk = (n: PMNode, pos: number) => {
      if (found >= 0) return;
      const prefix = PREFIX[n.type];
      if (prefix && !(n.type === 'theorem' && theoremKind(n.attrs?.kind) === 'proof')) {
        const l = labelOf(n.attrs, prefix);
        if (l && (l === label || (n.type === 'figure' && l === base && parseJsonArr(n.attrs?.subs).length))) { found = pos; return; }
      }
      let p = pos + 1;
      for (const c of n.content ?? []) { walk(c, p); p += size(c); }
    };
    let p = 0;
    for (const c of doc[key].content ?? []) { walk(c, p); if (found >= 0) return { key, pos: found }; p += size(c); }
  }
  return null;
}
const CONTAINERS = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'tableFigure', 'table', 'tableRow', 'tableCell', 'tableHeader', 'theorem']);
function size(n: PMNode): number {
  if (n.type === 'text') return (n.text ?? '').length;
  if (!CONTAINERS.has(n.type)) return 1;
  let s = 2;
  for (const c of n.content ?? []) s += size(c);
  return s;
}

const SECTION_OF: Record<string, string> = { body: 'body', appendix: 'appendix' };
/** 等那一节的编辑器挂上来再选中它 */
function selectIn(key: RichKey, pos: number, tries = 30) {
  const ed = getEditor(key);
  if (ed && !ed.isDestroyed) {
    const node = ed.state.doc.nodeAt(pos);
    try {
      if (node && !node.isText && node.type.name !== 'paragraph') ed.chain().focus().setNodeSelection(pos).scrollIntoView().run();
      else ed.chain().focus().setTextSelection(Math.min(pos + 1, ed.state.doc.content.size)).scrollIntoView().run();
      // 让它进视口中间，不是贴着边
      requestAnimationFrame(() => { const dom = ed.view.nodeDOM(pos) as Node | null; const el = dom instanceof HTMLElement ? dom : dom?.parentElement ?? null; el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
    } catch { /* 位置对不上就算了 */ }
    return;
  }
  if (tries > 0) window.setTimeout(() => selectIn(key, pos, tries - 1), 50);
}

/** 跳到标签指向的那个东西；找不到返回 false */
export function jumpToLabel(label: string): boolean {
  const hit = findLabel(label);
  if (!hit) return false;
  useStore.getState().setSection(SECTION_OF[hit.key] as never);
  selectIn(hit.key, hit.pos);
  return true;
}
export function jumpToCite(key: string) {
  useStore.getState().setSection('bibliography');
  useBibFocus.getState().request(key);
}
export function jumpToAbbr() { useStore.getState().setSection('nomenclature'); }
export function openLink(href: string) { if (/^(https?:|mailto:)/i.test(href)) window.open(href, '_blank', 'noopener'); }
