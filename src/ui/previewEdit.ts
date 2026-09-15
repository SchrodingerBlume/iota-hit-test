// 预览区直接编辑的几何部分（纯函数，不碰 DOM）。
//
// 编译器给一张字形表（每个字在第几页、哪个位置、对应 main.typ 里哪几个字符），
// 源码映射把字符再翻成编辑器里的位置。这里把两者拼成一份索引：
//   · 点到哪个字 → 编辑器里的位置（光标落在字的左半还是右半）
//   · 编辑器里的位置 → 该把光标画在哪（同一段字可能印了好几处：目录、页眉；挑离上次最近的）
//   · 一段选区 → 一行一条的高亮矩形
//   · 上下方向键 → 上一行 / 下一行里最近的字
import type { RichKey } from '../model/store';
import { segmentAt, typToRawOffset, type Segment, type SegKind } from '../typst/sourcemap';

export interface Glyph {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  key: RichKey | 'info';
  kind: SegKind;
  seg: Segment;
  /** text：ProseMirror 位置；attr / info：在属性值里的偏移；node：节点起止 */
  from: number;
  to: number;
}

export interface Line {
  page: number;
  y: number;
  h: number;
  /** 按 x 排好 */
  glyphs: Glyph[];
}

export interface GlyphIndex {
  /** 对应的文档版本 */
  version: number;
  pages: Line[][];
  /** 每份富文本的字形，按 from 排好 */
  byKey: Map<string, Glyph[]>;
  lineOf: Map<Glyph, Line>;
  count: number;
}

export const EMPTY_INDEX: GlyphIndex = { version: -1, pages: [], byKey: new Map(), lineOf: new Map(), count: 0 };

export function buildIndex(raw: Float64Array | null, segments: Segment[], version: number): GlyphIndex {
  if (!raw || !segments.length) return { ...EMPTY_INDEX, version };
  const glyphs: Glyph[] = [];
  for (let i = 0; i + 7 < raw.length; i += 8) {
    const start = raw[i + 5];
    const end = raw[i + 6];
    const kind = raw[i + 7];
    // 3 = 目录条目、页眉页脚里的回声：不是编辑正文的地方
    if (kind === 3) continue;
    const seg = segmentAt(segments, start);
    if (!seg) continue;
    let from: number, to: number;
    if (seg.kind === 'node') {
      from = seg.pmFrom; to = seg.pmTo;
    } else if (seg.raw !== undefined && kind !== 0) {
      const local = start - seg.typFrom;
      const a = typToRawOffset(seg.raw, local);
      const b = Math.max(a, typToRawOffset(seg.raw, Math.max(local, end - seg.typFrom)));
      from = seg.pmFrom + a; to = seg.pmFrom + b;
      if (to === from) to = Math.min(seg.pmTo, from + 1);
    } else {
      // 文本段里冒出的非文本字形（罕见）：当整段
      from = seg.pmFrom; to = seg.pmTo;
    }
    glyphs.push({ page: raw[i], x: raw[i + 1], y: raw[i + 2], w: raw[i + 3], h: raw[i + 4], key: seg.key, kind: seg.kind, seg, from, to });
  }
  // 行：同页、基线相近的归一行
  glyphs.sort((a, b) => a.page - b.page || (a.y + a.h) - (b.y + b.h) || a.x - b.x);
  const pages: Line[][] = [];
  let cur: Line | null = null;
  for (const g of glyphs) {
    const base = g.y + g.h;
    if (!cur || cur.page !== g.page || Math.abs((cur.y + cur.h) - base) > Math.max(cur.h, g.h) * 0.45) {
      cur = { page: g.page, y: g.y, h: g.h, glyphs: [g] };
      (pages[g.page] ??= []).push(cur);
    } else {
      cur.glyphs.push(g);
      // 行高取这一行里最高的
      const top = Math.min(cur.y, g.y);
      const bottom = Math.max(cur.y + cur.h, g.y + g.h);
      cur.y = top; cur.h = bottom - top;
    }
  }
  const lineOf = new Map<Glyph, Line>();
  for (const lines of pages) if (lines) for (const l of lines) { l.glyphs.sort((a, b) => a.x - b.x); for (const g of l.glyphs) lineOf.set(g, l); }
  const byKey = new Map<string, Glyph[]>();
  for (const g of glyphs) { (byKey.get(g.key) ?? byKey.set(g.key, []).get(g.key)!).push(g); }
  for (const arr of byKey.values()) arr.sort((a, b) => a.from - b.from || a.to - b.to);
  return { version, pages, byKey, lineOf, count: glyphs.length };
}

export interface Hit {
  glyph: Glyph;
  /** 光标落在字前还是字后 */
  side: 'before' | 'after';
  line: Line;
}

/** 页内一点（pt）落在哪个字上；离哪行都远就 null */
export function hitTest(index: GlyphIndex, page: number, x: number, y: number, slack = 24): Hit | null {
  const lines = index.pages[page];
  if (!lines?.length) return null;
  let best: Line | null = null;
  let bestD = Infinity;
  for (const l of lines) {
    const d = y < l.y ? l.y - y : y > l.y + l.h ? y - (l.y + l.h) : 0;
    if (d < bestD) { bestD = d; best = l; }
  }
  if (!best || bestD > slack) return null;
  return hitInLine(best, x);
}

export function hitInLine(line: Line, x: number): Hit {
  const gs = line.glyphs;
  if (x <= gs[0].x) return { glyph: gs[0], side: 'before', line };
  const last = gs[gs.length - 1];
  if (x >= last.x + last.w) return { glyph: last, side: 'after', line };
  // 二分找 x 落在哪个字（字与字之间的空当归右边那个字的前面）
  let lo = 0, hi = gs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (gs[mid].x <= x) lo = mid; else hi = mid - 1;
  }
  const g = gs[lo];
  if (x > g.x + g.w && lo + 1 < gs.length) return { glyph: gs[lo + 1], side: 'before', line };
  return { glyph: g, side: x - g.x > g.w / 2 ? 'after' : 'before', line };
}

/** 一个点击点对应的编辑器位置 */
export const hitPos = (hit: Hit) => (hit.side === 'before' ? hit.glyph.from : hit.glyph.to);

export interface CaretRect { page: number; x: number; y: number; h: number; line: Line }

/** 挑候选：先同一页离 prefer 最近的，其次页码最近的 */
function pick<T extends { page: number; y: number }>(cands: T[], prefer: { page: number; y: number } | null): T | null {
  if (!cands.length) return null;
  if (!prefer) return cands[0];
  let best = cands[0];
  let bestScore = Infinity;
  for (const c of cands) {
    const score = Math.abs(c.page - prefer.page) * 1e5 + Math.abs(c.y - prefer.y);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/** 二分：这份富文本里 from ≥ pos 的第一个字形下标 */
function lowerBound(arr: Glyph[], pos: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].from < pos) lo = mid + 1; else hi = mid; }
  return lo;
}

/** 该把光标画在哪：pos 是编译那一版里的位置 */
export function caretRect(index: GlyphIndex, key: string, pos: number, prefer: { page: number; y: number } | null): CaretRect | null {
  const arr = index.byKey.get(key);
  if (!arr?.length) return null;
  const cands: CaretRect[] = [];
  const lineOf = (g: Glyph): Line => index.lineOf.get(g) ?? { page: g.page, y: g.y, h: g.h, glyphs: [g] };
  // 字前
  for (let i = lowerBound(arr, pos); i < arr.length && arr[i].from === pos; i++) {
    const g = arr[i];
    if (g.kind !== 'text') continue;
    cands.push({ page: g.page, x: g.x, y: g.y, h: g.h, line: lineOf(g) });
  }
  // 字后：to === pos 的（to 没排序，往前扫一小段）
  for (let i = Math.min(arr.length - 1, lowerBound(arr, pos)); i >= 0 && pos - arr[i].from < 40; i--) {
    const g = arr[i];
    if (g.kind === 'text' && g.to === pos) cands.push({ page: g.page, x: g.x + g.w, y: g.y, h: g.h, line: lineOf(g) });
  }
  if (!cands.length) {
    // 落在原子节点（公式、引用）上：画在节点前 / 后
    for (let i = lowerBound(arr, pos); i < arr.length && arr[i].from === pos; i++) { const g = arr[i]; cands.push({ page: g.page, x: g.x, y: g.y, h: g.h, line: lineOf(g) }); }
    for (let i = Math.min(arr.length - 1, lowerBound(arr, pos)); i >= 0 && pos - arr[i].from < 40; i--) { const g = arr[i]; if (g.to === pos) cands.push({ page: g.page, x: g.x + g.w, y: g.y, h: g.h, line: lineOf(g) }); }
  }
  // 同一处「字后」与下一字「字前」重合时留一个就行；prefer 决定挑哪一处印本
  return pick(cands, prefer);
}

export interface SelRect { page: number; x: number; y: number; w: number; h: number }

/** 选区高亮：一行一条。同一段字印了几处时只亮光标所在那一处附近的页 */
export function selectionRects(index: GlyphIndex, key: string, from: number, to: number, prefer: { page: number; y: number } | null): SelRect[] {
  const arr = index.byKey.get(key);
  if (!arr?.length || to <= from) return [];
  const byLine = new Map<Line, SelRect>();
  for (let i = 0; i < arr.length; i++) {
    const g = arr[i];
    if (g.from >= to) break;
    if (g.to <= from) continue;
    const line = index.lineOf.get(g);
    if (!line) continue;
    const r = byLine.get(line);
    if (r) { const x1 = Math.min(r.x, g.x); const x2 = Math.max(r.x + r.w, g.x + g.w); r.x = x1; r.w = x2 - x1; }
    else byLine.set(line, { page: g.page, x: g.x, y: line.y, w: g.w, h: line.h });
  }
  const rects = [...byLine.values()].sort((a, b) => a.page - b.page || a.y - b.y);
  if (rects.length <= 1 || !prefer) return rects;
  // 同一段字印了几处（标题在正文里一处、别处又引了一处）：只亮离光标最近的那一串——
  // 从离 prefer 最近的一条出发，行与行挨着（同页隔不过两行半，或跨到相邻页的首尾行）就算一串
  let k = 0;
  let best = Infinity;
  rects.forEach((r, i) => { const d = Math.abs(r.page - prefer.page) * 1e5 + Math.abs(r.y - (prefer as { y?: number }).y!) ; if (d < best) { best = d; k = i; } });
  const near = (a: SelRect, b: SelRect) => (a.page === b.page ? Math.abs(b.y - (a.y + a.h)) < Math.max(a.h, b.h) * 2.5 : Math.abs(a.page - b.page) === 1);
  let lo = k, hi = k;
  while (lo > 0 && near(rects[lo - 1], rects[lo])) lo--;
  while (hi < rects.length - 1 && near(rects[hi], rects[hi + 1])) hi++;
  return rects.slice(lo, hi + 1);
}

/** 上一行 / 下一行里离 x 最近的位置（跨页就到相邻页的末行 / 首行） */
export function lineStep(index: GlyphIndex, line: Line, dir: -1 | 1, x: number): Hit | null {
  const lines = index.pages[line.page] ?? [];
  let k = lines.indexOf(line) + dir;
  let page = line.page;
  while (k < 0 || k >= lines.length) {
    page += dir;
    if (page < 0 || page >= index.pages.length) return null;
    const pl = index.pages[page];
    if (!pl?.length) continue;
    k = dir < 0 ? pl.length - 1 : 0;
    return hitInLine(pl[k], x);
  }
  return hitInLine(lines[k], x);
}
