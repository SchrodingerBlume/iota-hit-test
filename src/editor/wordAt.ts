// 光标所在的那个词（Intl.Segmenter 分词；中文按词、英文按空格）
import type { Editor } from '@tiptap/core';

export function wordAt(ed: Editor, pos: number): { from: number; to: number } | null {
  const $p = ed.state.doc.resolve(pos);
  const text = $p.parent.textBetween(0, $p.parent.content.size, '\u0000');
  const off = $p.parentOffset;
  if (!text.trim()) return null;
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  const start = $p.start();
  if (seg) {
    for (const s of seg.segment(text)) {
      const a = s.index, b = s.index + s.segment.length;
      if (off >= a && off <= b && s.isWordLike) return { from: start + a, to: start + b };
    }
  }
  let a = off, b = off;
  while (a > 0 && /\S/.test(text[a - 1])) a--;
  while (b < text.length && /\S/.test(text[b])) b++;
  return b > a ? { from: start + a, to: start + b } : null;
}
