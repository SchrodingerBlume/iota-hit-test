// 字数统计，照 Word 的口径：中文一个字算一个，西文按空格分词，中文标点也计入字数；
// 从各富文本节的 ProseMirror JSON 里数，行数拿不到（那要排版结果）
import type { RichDoc } from './types';

export interface WordStats { words: number; charsNoSpace: number; charsWithSpace: number; paragraphs: number; nonCjkWords: number; cjk: number }

const CJK = /[㐀-鿿豈-﫿]/;
const CJK_PUNCT = /[　-〿＀-￯]/;
const WORD = /[^\s　-〿㐀-鿿豈-﫿＀-￯]+/g;

export function countWords(docs: RichDoc[]): WordStats {
  const s: WordStats = { words: 0, charsNoSpace: 0, charsWithSpace: 0, paragraphs: 0, nonCjkWords: 0, cjk: 0 };
  const block = (text: string) => {
    if (!text.trim()) return;
    s.paragraphs++;
    for (const ch of text) {
      if (/\s/.test(ch)) { s.charsWithSpace++; continue; }
      s.charsWithSpace++; s.charsNoSpace++;
      if (CJK.test(ch)) { s.cjk++; s.words++; } else if (CJK_PUNCT.test(ch)) s.words++;
    }
    const n = text.match(WORD)?.length ?? 0;
    s.nonCjkWords += n; s.words += n;
  };
  const walk = (n: { type?: string; text?: string; content?: any[] }) => {
    const kids = n.content ?? [];
    if (kids.some((k) => k.type === 'text')) { block(kids.map((k) => k.text ?? '').join('')); return; }
    for (const k of kids) walk(k);
  };
  for (const d of docs) walk(d);
  return s;
}
