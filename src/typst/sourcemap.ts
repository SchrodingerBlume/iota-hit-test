// 生成的 Typst 源码 ↔ 编辑器里的位置。
//
// 预览区直接编辑靠它：编译器给每个字形一个源码偏移（main.typ 里第几个字符），
// 这里把偏移翻成「哪一份富文本、ProseMirror 里第几个位置」，反过来也行。
//
// 做法：序列化时在文本外面套一对私用区字符做记号，` 头  正文 `，
// 最后扫一遍把记号摘掉、记下每段正文在成品里的起止。记号只是字符，
// 中途的 indent、join、trim 都不用管它。
import type { RichKey } from '../model/store';

export const SEG_OPEN = '';
export const SEG_MID = '';
export const SEG_CLOSE = '';
const FIELD = '';

export type SegKind =
  /** 文本节点：字形级映射，raw 是原文 */
  | 'text'
  /** 原子节点（公式、引用、缩略语、插图……）：整块对应一个节点 */
  | 'node'
  /** 节点的某个属性（题注、英文标题、脚注文字）：raw 是属性值 */
  | 'attr'
  /** 元信息字段：attr 是字段名 */
  | 'info';

export interface Segment {
  kind: SegKind;
  key: RichKey | 'info';
  /** ProseMirror 位置（text：第一个字的位置；node/attr：节点前的位置） */
  pmFrom: number;
  pmTo: number;
  /** attr / info：属性名或字段名 */
  attr?: string;
  /** text / attr：原文（未转义） */
  raw?: string;
  /** 在最终 main.typ 里的起止（UTF-16 下标，半开） */
  typFrom: number;
  typTo: number;
  /** 包着它的那一段（比如表格里的字被整张表的 node 段包着） */
  parent?: number;
}

const RE_MARK = /[-]/;

/** 给一段输出打上记号 */
export function mark(kind: SegKind, key: RichKey | 'info', pmFrom: number, pmTo: number, inner: string, extra: { attr?: string; raw?: string } = {}): string {
  const head = [kind, key, pmFrom, pmTo, extra.attr ?? '', (extra.raw ?? '').replace(RE_MARK, '')].join(FIELD);
  return `${SEG_OPEN}${head}${SEG_MID}${inner}${SEG_CLOSE}`;
}

/** 摘掉记号，得到干净的源码与各段位置 */
export function stripMarks(marked: string): { text: string; segments: Segment[] } {
  const segments: Segment[] = [];
  const stack: number[] = [];
  let out = '';
  let i = 0;
  const n = marked.length;
  while (i < n) {
    const c = marked[i];
    if (c === SEG_OPEN) {
      const mid = marked.indexOf(SEG_MID, i);
      if (mid < 0) { i++; continue; }
      const [kind, key, pmFrom, pmTo, attr, raw] = marked.slice(i + 1, mid).split(FIELD);
      const seg: Segment = { kind: kind as SegKind, key: key as RichKey | 'info', pmFrom: Number(pmFrom), pmTo: Number(pmTo), typFrom: out.length, typTo: out.length };
      if (attr) seg.attr = attr;
      if (raw) seg.raw = raw;
      if (stack.length) seg.parent = stack[stack.length - 1];
      stack.push(segments.length);
      segments.push(seg);
      i = mid + 1;
      continue;
    }
    if (c === SEG_CLOSE) {
      const idx = stack.pop();
      if (idx !== undefined) segments[idx].typTo = out.length;
      i++;
      continue;
    }
    if (c === SEG_MID || c === FIELD) { i++; continue; }
    out += c;
    i++;
  }
  for (const idx of stack) segments[idx].typTo = out.length;
  segments.sort((a, b) => a.typFrom - b.typFrom || b.typTo - a.typTo);
  // 排序后 parent 下标失效，按包含关系重算
  const order = new Map<Segment, number>();
  segments.forEach((s, k) => order.set(s, k));
  const open: number[] = [];
  segments.forEach((s, k) => {
    while (open.length && segments[open[open.length - 1]].typTo <= s.typFrom) open.pop();
    s.parent = open.length ? open[open.length - 1] : undefined;
    open.push(k);
  });
  return { text: out, segments };
}

/** 有记号的字符串里，去掉记号后的样子（给需要看内容的判断用） */
export const unmarked = (s: string) => s.replace(/[^]*|[]/g, '');

// ── 文本段里的偏移换算 ────────────────────────────────────────────
// 原文里的每个字符在源码里占 1 个或 2 个（转义了就是「\」+ 它）。

const ESCAPED = /[\\*_`#$@<>\[\]~/]/;
const width = (ch: string) => (ESCAPED.test(ch) ? 2 : 1);

/** 源码偏移 → 原文偏移（落在转义符中间算作那个字前面） */
export function typToRawOffset(raw: string, typOffset: number): number {
  let t = 0;
  for (let k = 0; k < raw.length; k++) {
    const w = width(raw[k]);
    if (typOffset < t + w) return typOffset > t ? k + 1 : k;
    t += w;
  }
  return raw.length;
}

/** 原文偏移 → 源码偏移 */
export function rawToTypOffset(raw: string, rawOffset: number): number {
  let t = 0;
  for (let k = 0; k < Math.min(rawOffset, raw.length); k++) t += width(raw[k]);
  return t;
}

/** 找出包住这个源码偏移的最里层段 */
export function segmentAt(segments: Segment[], typOffset: number): Segment | null {
  // 段按起点排好序：二分找最后一个起点 ≤ offset 的，不包含就顺着 parent 往外找
  let lo = 0, hi = segments.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].typFrom <= typOffset) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  let k: number | undefined = found >= 0 ? found : undefined;
  while (k !== undefined) {
    const s = segments[k];
    if (s.typFrom <= typOffset && typOffset < s.typTo) return s;
    k = s.parent;
  }
  return null;
}
