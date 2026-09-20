// Word 的「更改大小写」：句首字母大写 / 小写 / 大写 / 每个单词首字母大写 / 切换大小写 / 半角 / 全角。
// 只改字面，标记原样留着；没选中就改光标所在的词。Shift+F3 照 Word 在小写 → 大写 → 首字母大写间轮
import type { Editor } from '@tiptap/core';
import { wordAt } from './wordAt';
import { t } from '../i18n';

export type CaseKind = 'sentence' | 'lower' | 'upper' | 'title' | 'toggle' | 'half' | 'full';

const isLetter = (ch: string) => /\p{L}/u.test(ch);
const isUpper = (ch: string) => ch !== ch.toLowerCase() && ch === ch.toUpperCase();

/** 逐段处理（一个选区可能跨几个文本节点），句首 / 词首的状态跨段接着算 */
function transformer(kind: CaseKind): (s: string) => string {
  let atSentenceStart = true, atWordStart = true;
  return (s) => {
    let out = '';
    for (const ch of s) {
      let c = ch;
      switch (kind) {
        case 'lower': c = ch.toLowerCase(); break;
        case 'upper': c = ch.toUpperCase(); break;
        case 'toggle': c = isLetter(ch) ? (isUpper(ch) ? ch.toLowerCase() : ch.toUpperCase()) : ch; break;
        case 'sentence': c = isLetter(ch) ? (atSentenceStart ? ch.toUpperCase() : ch.toLowerCase()) : ch; break;
        case 'title': c = isLetter(ch) ? (atWordStart ? ch.toUpperCase() : ch.toLowerCase()) : ch; break;
        case 'half': { const n = ch.codePointAt(0)!; c = n === 0x3000 ? ' ' : n >= 0xff01 && n <= 0xff5e ? String.fromCodePoint(n - 0xfee0) : ch; break; }
        case 'full': { const n = ch.codePointAt(0)!; c = n === 0x20 ? '　' : n >= 0x21 && n <= 0x7e ? String.fromCodePoint(n + 0xfee0) : ch; break; }
      }
      if (isLetter(ch) || /\d/.test(ch)) { atSentenceStart = false; atWordStart = false; }
      else { atWordStart = true; if (/[.!?。！？]/.test(ch)) atSentenceStart = true; }
      out += c;
    }
    return out;
  };
}

export function changeCase(ed: Editor, kind: CaseKind): boolean {
  const { from, to, empty } = ed.state.selection;
  const range = empty ? wordAt(ed, from) : { from, to };
  if (!range) return false;
  const fn = transformer(kind);
  const edits: { from: number; to: number; text: string; marks: readonly import('@tiptap/pm/model').Mark[] }[] = [];
  ed.state.doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!node.isText || !node.text) return;
    const s = Math.max(pos, range.from), e = Math.min(pos + node.nodeSize, range.to);
    const text = node.text.slice(s - pos, e - pos);
    const next = fn(text);
    if (next !== text) edits.push({ from: s, to: e, text: next, marks: node.marks });
  });
  if (!edits.length) return false;
  const tr = ed.state.tr;
  for (const c of edits.reverse()) tr.replaceWith(c.from, c.to, ed.schema.text(c.text, c.marks));
  tr.setMeta('undoLabel', t("更改大小写"));
  if (!empty) tr.setSelection(ed.state.selection.map(tr.doc, tr.mapping));
  ed.view.dispatch(tr);
  return true;
}

/** Shift+F3：小写 → 大写 → 每个单词首字母大写，看当前是哪一档往下轮 */
export function cycleCase(ed: Editor): boolean {
  const { from, to, empty } = ed.state.selection;
  const range = empty ? wordAt(ed, from) : { from, to };
  if (!range) return false;
  const text = ed.state.doc.textBetween(range.from, range.to, ' ');
  const letters = [...text].filter(isLetter);
  if (!letters.length) return false;
  const next: CaseKind = text === text.toLowerCase() ? 'upper' : text === text.toUpperCase() ? 'title' : 'lower';
  return changeCase(ed, next);
}
