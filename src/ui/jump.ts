// 预览里双击一段字 → 左侧编辑器定位到它。
// typst.ts 的 SVG 每个字形组带一个 .tsel 文本层，先把双击那一行的字拼起来，
// 在工程的各份富文本（以及元信息字段）里找，命中哪一份就切到哪一节、选中那段字。
import { useStore, type RichKey } from '../model/store';
import type { Section } from '../model/store';

const RICH_SECTION: Record<RichKey, Section> = {
  body: 'body', appendix: 'appendix', abstractZh: 'abstract', abstractEn: 'abstract',
  conclusion: 'conclusion', acknowledgement: 'acknowledgement', resume: 'resume',
};

/** 双击点所在的一行：同一页里、竖向重叠的所有文本组，按 x 排序拼起来 */
function lineTextAt(target: Element): { line: string; index: number } | null {
  const run = target.closest('.typst-text') as SVGGElement | null;
  if (!run) return null;
  const page = run.closest('.typst-page') as SVGGElement | null;
  if (!page) return null;
  const r0 = run.getBoundingClientRect();
  const midY = (r0.top + r0.bottom) / 2;
  const runs = [...page.querySelectorAll<SVGGElement>('.typst-text')]
    .map((g) => ({ g, r: g.getBoundingClientRect() }))
    .filter(({ r }) => r.top <= midY && r.bottom >= midY && r.height > 0)
    .sort((a, b) => a.r.left - b.r.left);
  let line = '';
  let index = 0;
  for (const { g, r } of runs) {
    const t = g.querySelector('.tsel')?.textContent ?? '';
    if (g === run) index = line.length + Math.min(t.length - 1, Math.max(0, Math.floor(((r.left + r.right) / 2 - r.left) / (r.width / Math.max(1, t.length)))));
    line += t;
  }
  return line.trim() ? { line, index } : null;
}

function flatText(node: any): string {
  if (!node) return '';
  let s = '';
  if (node.type === 'text') s += node.text ?? '';
  for (const k of ['caption', 'captionEn', 'en', 'text']) if (typeof node.attrs?.[k] === 'string') s += ' ' + node.attrs[k];
  for (const c of node.content ?? []) s += flatText(c);
  return s;
}

export function jumpToPreviewText(target: Element) {
  const hit = lineTextAt(target);
  if (!hit) return;
  const clean = hit.line.replace(/\s+/g, '');
  if (clean.length < 2) return;
  // 以双击的字为中心取一段，别太长（页眉、目录条目那种拼出来的行会带页码）
  const center = Math.min(clean.length - 1, Math.max(0, hit.index));
  const needle = clean.slice(Math.max(0, center - 10), center + 10);
  const st = useStore.getState();
  const doc = st.doc;
  const keys: RichKey[] = ['body', 'appendix', 'conclusion', 'abstractZh', 'abstractEn', 'acknowledgement', 'resume'];
  // 逐步缩短去找，先富文本，再元信息
  for (let len = needle.length; len >= 3; len = Math.floor(len * 0.7)) {
    const mid = Math.floor(needle.length / 2);
    const piece = needle.slice(Math.max(0, mid - Math.floor(len / 2)), Math.max(0, mid - Math.floor(len / 2)) + len);
    for (const k of keys) {
      if (flatText(doc[k]).replace(/\s+/g, '').includes(piece)) {
        st.setView('editor');
        st.setSection(RICH_SECTION[k]);
        // 等编辑器挂上再定位
        setTimeout(() => useStore.getState().requestJump(k, piece), 60);
        return;
      }
    }
    for (const [key, v] of Object.entries(doc.info)) {
      const text = Array.isArray(v) ? v.join(' ') : String(v ?? '');
      if (text.replace(/\s+/g, '').includes(piece)) {
        st.setView('editor');
        st.setSection('info');
        setTimeout(() => { const el = document.querySelector<HTMLElement>(`[data-info="${key}"]`); el?.focus(); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); el?.classList.add('is-flash'); setTimeout(() => el?.classList.remove('is-flash'), 1200); }, 80);
        return;
      }
    }
  }
}
