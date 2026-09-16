// 编辑器里显示的编号：章节、图、表、公式。规则照模板——
//   标题：src/config/numbering.typ（理工「第 1 章 / 1.1」、人文社科「第一章 / 一、/（一）/ 1.」、
//         英文「Chapter 1 / 1.1」、报告「1 / 1.1」、附录「附录 A / A.1」）
//   图表：caption-numbering-by-chapter（图 1-1 或图 1），公式：equation-numbering-by-chapter
// 两个「按章编号」开关走 options.ts 里的 auto 映射，所以这里显示的就是模板最终会印的。
// 预览里的才是准的；这里只是让人写的时候心里有数。
import type { Settings, StyleKey } from '../model/types';
import { SWITCHES, resolveSwitch } from '../model/options';
import type { PMNode } from './pmToTypst';
import { labelOf } from './pmToTypst';

export type Part = 'body' | 'appendix' | 'other';

export interface NumberInfo {
  kind: 'sec' | 'fig' | 'tab' | 'eq' | 'alg' | 'lst';
  label: string;
  /** 印在节点旁边的：第 2 章 / 2.1 / 图 2-1 / (2-1) */
  number: string;
  /** 引用时的说法：第 2 章 / 2.1 节 / 图 2-1 / 式 (2-1) */
  ref: string;
  title: string;
  level?: number;
}

const HANZI = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export function toHanzi(n: number): string {
  if (n < 10) return HANZI[n];
  if (n < 20) return '十' + (n % 10 ? HANZI[n % 10] : '');
  if (n < 100) return HANZI[Math.floor(n / 10)] + '十' + (n % 10 ? HANZI[n % 10] : '');
  return String(n);
}
const EN_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const letter = (n: number) => String.fromCharCode(64 + ((n - 1) % 26) + 1);

function sw<V>(key: keyof Settings, s: Settings): V {
  const def = SWITCHES.find((d) => d.key === key)!;
  return resolveSwitch<V>(def, s).effective;
}

/**
 * 各级标题在这一档里的叫法与样子（样式库、标题旁的提示用）。照指南「表 2」：
 * 论文是 章 / 节 / 条 / 款 四级；开题、中期报告没有「章」，第一级就是节（1 / 1.1 / 1.1.1）。
 * 款底下的「项」（（1）接排）是段落写法不是标题，模板不做，编辑器里对应编号列表。
 */
/** 某一级标题在模板样式表里叫什么（报告没有章，四级整体上移一格：section / subsection / subsubsection） */
export function styleKeyOfLevel(s: Settings, level: number): StyleKey {
  const isReport = s.stage !== 'final' && !(s.campus === 'shenzhen' && s.degreeLevel === 'bachelor');
  const names: StyleKey[] = isReport ? ['section', 'subsection', 'subsubsection', 'subsubsection'] : ['chapter', 'section', 'subsection', 'subsubsection'];
  return names[Math.max(0, Math.min(3, level - 1))];
}

export function levelLabels(s: Settings): { level: number; name: string; sample: string }[] {
  const isReport = s.stage !== 'final' && !(s.campus === 'shenzhen' && s.degreeLevel === 'bachelor');
  const en = s.lang === 'en';
  const hass = s.category === 'hass';
  if (isReport) return [{ level: 1, name: '节', sample: '1' }, { level: 2, name: '条', sample: '1.1' }, { level: 3, name: '款', sample: '1.1.1' }];
  if (en) return [{ level: 1, name: 'Chapter', sample: 'Chapter 1' }, { level: 2, name: 'Section', sample: '1.1' }, { level: 3, name: '', sample: '1.1.1' }, { level: 4, name: '', sample: '1.1.1.1' }];
  if (hass) return [{ level: 1, name: '章', sample: '第一章' }, { level: 2, name: '节', sample: '一、' }, { level: 3, name: '条', sample: '（一）' }, { level: 4, name: '款', sample: '1.' }];
  return [{ level: 1, name: '章', sample: '第 1 章' }, { level: 2, name: '节', sample: '1.1' }, { level: 3, name: '条', sample: '1.1.1' }, { level: 4, name: '款', sample: '1.1.1.1' }];
}

export function computeNumbering(doc: PMNode | null | undefined, settings: Settings, part: Part): Map<string, NumberInfo> {
  const out = new Map<string, NumberInfo>();
  if (!doc) return out;
  const s = settings;
  const isReportBody = s.stage !== 'final' && !(s.campus === 'shenzhen' && s.degreeLevel === 'bachelor');
  const figByChapter = sw<boolean>('captionNumberingByChapter', s);
  const eqByChapter = sw<boolean>('equationNumberingByChapter', s);
  const appPattern = sw<'letters' | 'numbers' | 'hanzi'>('appendixNumbering', s);
  const en = s.lang === 'en';
  const hass = s.category === 'hass';

  const counters = [0, 0, 0, 0];
  let fig = 0, tab = 0, eq = 0, alg = 0, lst = 0;
  const text = (n: PMNode): string => (n.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : c.content ? text(c) : '')).join('');

  /** 章那一位的记号：正文是数字，附录按 A / 1 / 一 */
  const chapterMark = (): string => {
    if (!counters[0]) return '';
    if (part === 'appendix') {
      if (appPattern === 'letters') return letter(counters[0]);
      if (appPattern === 'numbers') return String(counters[0]);
      return en ? EN_WORDS[counters[0] - 1] ?? String(counters[0]) : toHanzi(counters[0]);
    }
    return String(counters[0]);
  };

  const headingNumber = (level: number): string => {
    const n = counters.slice(0, level);
    const last = n[level - 1];
    if (part === 'appendix') {
      if (level === 1) return en ? `Appendix ${chapterMark()}` : `附录 ${chapterMark()}`;
      if (appPattern === 'hanzi') return level === 2 ? `${toHanzi(last)}、` : level === 3 ? `（${toHanzi(last)}）` : `${last}.`;
      return [chapterMark(), ...n.slice(1)].join('.');
    }
    if (isReportBody) return n.join('.');
    if (en) return level === 1 ? `Chapter ${last}` : n.join('.');
    if (hass) return level === 1 ? `第${toHanzi(last)}章` : level === 2 ? `${toHanzi(last)}、` : level === 3 ? `（${toHanzi(last)}）` : `${last}.`;
    return level === 1 ? `第 ${last} 章` : n.join('.');
  };

  const numbered = (byChapter: boolean, k: number) => {
    const mark = chapterMark();
    return byChapter && mark ? `${mark}-${k}` : String(k);
  };

  const walk = (n: PMNode) => {
    if (n.type === 'heading') {
      const level = Math.max(1, Math.min(4, n.attrs?.level ?? 1));
      if (n.attrs?.numbered === false) {
        // 不编号：不走计数器，也不重置图表计数（Typst 里 numbering: none 的标题不动 counter）
        const label = labelOf(n.attrs, 'sec');
        if (label) out.set(label, { kind: 'sec', label, number: '', ref: text(n), title: text(n), level });
        return;
      }
      counters[level - 1]++;
      for (let i = level; i < 4; i++) counters[i] = 0;
      if (level === 1) { fig = 0; tab = 0; eq = 0; alg = 0; lst = 0; }
      const label = labelOf(n.attrs, 'sec');
      const num = headingNumber(level);
      if (label) out.set(label, { kind: 'sec', label, number: num, ref: level === 1 || /^(第|Chapter|Appendix|附录)/.test(num) ? num : en ? `Section ${num}` : `${num} 节`, title: text(n), level });
      return;
    }
    if (n.type === 'figure') {
      fig++;
      const label = labelOf(n.attrs, 'fig');
      const num = `${en ? 'Fig. ' : '图 '}${numbered(figByChapter, fig)}`;
      if (label) out.set(label, { kind: 'fig', label, number: num, ref: num, title: n.attrs?.caption ?? '' });
      return;
    }
    if (n.type === 'tableFigure') {
      tab++;
      const label = labelOf(n.attrs, 'tab');
      const num = `${en ? 'Table ' : '表 '}${numbered(figByChapter, tab)}`;
      if (label) out.set(label, { kind: 'tab', label, number: num, ref: num, title: n.attrs?.caption ?? '' });
      return;
    }
    if (n.type === 'algorithm') {
      alg++;
      const label = labelOf(n.attrs, 'alg');
      const num = `${en ? 'Algo. ' : '算法 '}${numbered(figByChapter, alg)}`;
      if (label) out.set(label, { kind: 'alg', label, number: num, ref: num, title: n.attrs?.caption ?? '' });
      return;
    }
    if (n.type === 'codeFigure') {
      lst++;
      const label = labelOf(n.attrs, 'lst');
      const num = `${en ? 'Listing ' : '代码 '}${numbered(figByChapter, lst)}`;
      if (label) out.set(label, { kind: 'lst', label, number: num, ref: num, title: n.attrs?.caption ?? '' });
      return;
    }
    if (n.type === 'equation' && n.attrs?.numbered !== false) {
      eq++;
      const label = labelOf(n.attrs, 'eq');
      const fullwidth = sw<boolean>('equationNumberingFullwidth', s);
      const num = fullwidth ? `（${numbered(eqByChapter, eq)}）` : `(${numbered(eqByChapter, eq)})`;
      if (label) out.set(label, { kind: 'eq', label, number: num, ref: `${en ? 'Eq. ' : '式 '}${num}`, title: n.attrs?.src ?? '' });
      return;
    }
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}
