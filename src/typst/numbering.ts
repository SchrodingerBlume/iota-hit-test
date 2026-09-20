// 编辑器里显示的编号：章节、图、表、公式。规则照模板——
//   标题：src/heading/numbering.typ（理工「第 1 章 / 1.1」、人文社科「第一章 / 一、/（一）/ 1.」、
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
const toRoman = (n: number) => { let out = ''; for (const [v, r] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as [number, string][]) while (n >= v) { out += r; n -= v; } return out; };

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

export function levelLabels(s: Settings, part: 'body' | 'appendix' = 'body'): { level: number; name: string; sample: string }[] {
  const isReport = s.stage !== 'final' && !(s.campus === 'shenzhen' && s.degreeLevel === 'bachelor');
  const en = s.lang === 'en';
  const hass = s.category === 'hass';
  if (part === 'appendix') {
    const pat = sw<'letters' | 'roman' | 'numbers' | 'hanzi' | 'words'>('appendixNumbering', s);
    if (pat === 'words') return [{ level: 1, name: 'Appendix', sample: 'Appendix One' }, { level: 2, name: '节', sample: '一、' }, { level: 3, name: '条', sample: '（一）' }, { level: 4, name: '款', sample: '1.' }];
    if (en) { const m = pat === 'numbers' ? '1' : pat === 'roman' ? 'I' : 'A'; return [{ level: 1, name: 'Appendix', sample: `Appendix ${m}` }, { level: 2, name: 'Section', sample: `${m}.1` }, { level: 3, name: '', sample: `${m}.1.1` }, { level: 4, name: '', sample: `${m}.1.1.1` }]; }
    if (pat === 'hanzi') return [{ level: 1, name: '附录', sample: '附录一' }, { level: 2, name: '节', sample: '一、' }, { level: 3, name: '条', sample: '（一）' }, { level: 4, name: '款', sample: '1.' }];
    const m = pat === 'numbers' ? '1' : pat === 'roman' ? 'I' : 'A';
    return [{ level: 1, name: '附录', sample: `附录 ${m}` }, { level: 2, name: '节', sample: `${m}.1` }, { level: 3, name: '条', sample: `${m}.1.1` }, { level: 4, name: '款', sample: `${m}.1.1.1` }];
  }
  if (isReport) return [{ level: 1, name: '节', sample: '1' }, { level: 2, name: '条', sample: '1.1' }, { level: 3, name: '款', sample: '1.1.1' }];
  if (en) return [{ level: 1, name: 'Chapter', sample: 'Chapter 1' }, { level: 2, name: 'Section', sample: '1.1' }, { level: 3, name: '', sample: '1.1.1' }, { level: 4, name: '', sample: '1.1.1.1' }];
  if (hass) return [{ level: 1, name: '章', sample: '第一章' }, { level: 2, name: '节', sample: '一、' }, { level: 3, name: '条', sample: '（一）' }, { level: 4, name: '款', sample: '1.' }];
  return [{ level: 1, name: '章', sample: '第 1 章' }, { level: 2, name: '节', sample: '1.1' }, { level: 3, name: '条', sample: '1.1.1' }, { level: 4, name: '款', sample: '1.1.1.1' }];
}

/** byNode：不管有没有标签，按节点对象也记一份（导出 Word 编号靠它——没 uid 的老标题在预览里是 Typst 自己编的号，Word 里不能没有） */
export function computeNumbering(doc: PMNode | null | undefined, settings: Settings, part: Part, byNode?: Map<PMNode, NumberInfo>): Map<string, NumberInfo> {
  const out = new Map<string, NumberInfo>();
  if (!doc) return out;
  const s = settings;
  const isReportBody = s.stage !== 'final' && !(s.campus === 'shenzhen' && s.degreeLevel === 'bachelor');
  const figByChapter = sw<boolean>('captionNumberingByChapter', s);
  const eqByChapter = sw<boolean>('equationNumberingByChapter', s);
  const appPattern = sw<'letters' | 'roman' | 'numbers' | 'hanzi' | 'words'>('appendixNumbering', s);
  const en = s.lang === 'en';
  const hass = s.category === 'hass';

  const counters = [0, 0, 0, 0];
  let fig = 0, tab = 0, eq = 0, alg = 0, lst = 0;
  // 附录只有一章时不编号（模板数出来的：编号的一级标题 ≤ 1）——章标题光印「附录」，中文档的图表少一位（附图1）
  const single = part === 'appendix' && (doc.content ?? []).filter((n) => n.type === 'heading' && (n.attrs?.level ?? 1) === 1 && n.attrs?.numbered !== false).length <= 1;
  const text = (n: PMNode): string => (n.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : c.content ? text(c) : '')).join('');

  /** 章那一位的记号：正文是数字，附录按 A / 1 / 一 */
  const chapterMark = (): string => {
    if (!counters[0]) return '';
    if (part === 'appendix') {
      if (appPattern === 'letters') return letter(counters[0]);
      if (appPattern === 'roman') return toRoman(counters[0]);
      if (appPattern === 'numbers') return String(counters[0]);
      if (appPattern === 'words') return EN_WORDS[counters[0] - 1] ?? String(counters[0]);
      return toHanzi(counters[0]);
    }
    return String(counters[0]);
  };

  const headingNumber = (level: number): string => {
    const n = counters.slice(0, level);
    const last = n[level - 1];
    if (part === 'appendix') {
      if (level === 1) return single ? (en ? 'Appendix' : '附录') : en ? `Appendix ${chapterMark()}` : `附录 ${chapterMark()}`;
      if (appPattern === 'hanzi' || appPattern === 'words') return level === 2 ? `${toHanzi(last)}、` : level === 3 ? `（${toHanzi(last)}）` : `${last}.`;
      // 只有一个附录：章号那一位不存在，中文档节往下也少一位（1、1.1）；英文档照 APA 仍带字母（A.1）
      if (single && !en) return n.slice(1).join('.');
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
  /**
   * 附录里图表公式的号与名（模板 src/heading/chapter.typ 一处定）：
   *   英文档一律字母 Fig. A-1（单个附录也是 A）；中文·字母 图A-1；
   *   中文·数（1 / 一）附图1-1（章号那一位用阿拉伯数）；中文·只有一个附录 附图1。
   * 连续编号（不按章）那一档不加「附」，接着正文数。
   */
  const figLike = (zhName: string, enName: string, byChapter: boolean, k: number): string => {
    if (part !== 'appendix' || !byChapter || !counters[0]) return `${en ? enName : zhName}${numbered(byChapter, k)}`;
    if (en) return `${enName}${appPattern === 'roman' ? toRoman(counters[0]) : letter(counters[0])}-${k}`;
    if (single) return `附${zhName.trim()} ${k}`;
    // 字母与罗马数字两档与正文的号本来分得开，不加「附」（模板 appendix-numeric）
    if (appPattern === 'letters' || appPattern === 'roman') return `${zhName}${chapterMark()}-${k}`;
    return `附${zhName.trim()} ${counters[0]}-${k}`;
  };
  const eqNum = (byChapter: boolean, k: number, fullwidth: boolean): string => {
    const wrap = (s: string) => (fullwidth ? `（${s}）` : `(${s})`);
    if (part !== 'appendix' || !byChapter || !counters[0]) return wrap(numbered(byChapter, k));
    if (en) return wrap(`${appPattern === 'roman' ? toRoman(counters[0]) : letter(counters[0])}-${k}`);
    if (single) return wrap(`附 ${k}`);
    if (appPattern === 'letters' || appPattern === 'roman') return wrap(`${chapterMark()}-${k}`);
    return wrap(`附 ${counters[0]}-${k}`);
  };

  const walk = (n: PMNode) => {
    if (n.type === 'heading') {
      const level = Math.max(1, Math.min(4, n.attrs?.level ?? 1));
      if (n.attrs?.numbered === false) {
        // 不编号：不走计数器，也不重置图表计数（Typst 里 numbering: none 的标题不动 counter）
        const label = labelOf(n.attrs, 'sec');
        { const info: NumberInfo = { kind: 'sec', label, number: '', ref: text(n), title: text(n), level }; byNode?.set(n, info); if (label) out.set(label, info); }
        return;
      }
      counters[level - 1]++;
      for (let i = level; i < 4; i++) counters[i] = 0;
      if (level === 1) { fig = 0; tab = 0; eq = 0; alg = 0; lst = 0; }
      const label = labelOf(n.attrs, 'sec');
      const num = headingNumber(level);
      { const info: NumberInfo = { kind: 'sec', label, number: num, ref: level === 1 || /^(第|Chapter|Appendix|附录)/.test(num) ? num : en ? `Section ${num}` : `${num} 节`, title: text(n), level }; byNode?.set(n, info); if (label) out.set(label, info); }
      return;
    }
    if (n.type === 'figure') {
      fig++;
      const label = labelOf(n.attrs, 'fig');
      const num = figLike('图 ', 'Fig. ', figByChapter, fig);
      { const info: NumberInfo = { kind: 'fig', label, number: num, ref: num, title: n.attrs?.caption ?? '' }; byNode?.set(n, info); if (label) out.set(label, info); }
      return;
    }
    if (n.type === 'tableFigure') {
      tab++;
      const label = labelOf(n.attrs, 'tab');
      const num = figLike('表 ', 'Table ', figByChapter, tab);
      { const info: NumberInfo = { kind: 'tab', label, number: num, ref: num, title: n.attrs?.caption ?? '' }; byNode?.set(n, info); if (label) out.set(label, info); }
      return;
    }
    if (n.type === 'algorithm') {
      alg++;
      const label = labelOf(n.attrs, 'alg');
      const num = figLike('算法 ', 'Algo. ', figByChapter, alg);
      { const info: NumberInfo = { kind: 'alg', label, number: num, ref: num, title: n.attrs?.caption ?? '' }; byNode?.set(n, info); if (label) out.set(label, info); }
      return;
    }
    if (n.type === 'codeFigure') {
      lst++;
      const label = labelOf(n.attrs, 'lst');
      const num = figLike('代码 ', 'Listing ', figByChapter, lst);
      { const info: NumberInfo = { kind: 'lst', label, number: num, ref: num, title: n.attrs?.caption ?? '' }; byNode?.set(n, info); if (label) out.set(label, info); }
      return;
    }
    if (n.type === 'equation' && n.attrs?.numbered !== false) {
      eq++;
      const label = labelOf(n.attrs, 'eq');
      const fullwidth = sw<boolean>('equationNumberingFullwidth', s);
      const num = eqNum(eqByChapter, eq, fullwidth);
      { const info: NumberInfo = { kind: 'eq', label, number: num, ref: `${en ? 'Eq. ' : '式 '}${num}`, title: n.attrs?.src ?? '' }; byNode?.set(n, info); if (label) out.set(label, info); }
      return;
    }
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}
