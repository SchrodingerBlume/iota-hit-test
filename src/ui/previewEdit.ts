// 预览区直接编辑的几何部分（纯函数，不碰 DOM）。
//
// 编译器给一张字形表（每个字在第几页、哪个位置、对应 main.typ 里哪几个字符），
// 源码映射把字符再翻成编辑器里的位置。这里把两者拼成一份索引：
//   · 点到哪个字 → 编辑器里的位置（光标落在字的左半还是右半）
//   · 编辑器里的位置 → 该把光标画在哪（同一段字可能印了好几处：目录、页眉；挑离上次最近的）
//   · 一段选区 → 一行一条的高亮矩形
//   · 上下方向键 → 上一行 / 下一行里最近的字
import type { RichKey } from '../model/store';
import { segmentAt, type Segment, type SegKind } from '../typst/sourcemap';
import { GLYPH_STRIDE } from '../compiler/protocol';

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
  /** 首个码点（空格标记用） */
  cp: number;
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

/** 一段原文里按顺序对字形的游标 */
interface Cursor { k: number; lastStart: number; lastEnd: number; lastCp: number; lastFrom: number; lastTo: number }

/**
 * 把一个字形对到原文里的第几个字。字形是按阅读顺序来的，原文也是，所以顺着走就行：
 * 字对得上就认下一个，对不上（Typst 把直引号弯了、把 --- 合成了破折号）就当一个字，
 * 中间隔着几个原文字（折行处吞掉的空格、连字）就往前找一小段。不靠编译器给的源码
 * 偏移——模板的 show regex 会把文本元素切片，切片之后的偏移从 0 重新数，靠不住。
 */
function align(text: string, cur: Cursor, cp: number, nchars: number): [number, number] {
  if (nchars === 0) return [Math.min(cur.k, text.length), Math.min(cur.k, text.length)]; // 排版器自己加的字形（断词连字符）
  const c = cp ? String.fromCodePoint(cp) : '';
  let k = cur.k;
  // 原文走完了还有字形来：同一段字排了第二遍（罕见），从头再对
  if (k >= text.length && c && text.startsWith(c)) k = 0;
  let j = -1;
  if (c && text.startsWith(c, k)) j = k;
  else if (c && /\S/.test(c)) { const f = text.indexOf(c, k); if (f >= 0 && f <= k + 8) j = f; }
  // 对不上（弯引号、破折号、章标题前模板加的「第 1 章」）：零宽地站在当前位置，不吃原文的字，
  // 后面对得上的字自己会往前找
  if (j < 0) { const a = Math.min(k, text.length); return [a, a]; }
  let e = j;
  for (let q = 0; q < nchars && e < text.length; q++) e += (text.codePointAt(e) ?? 0) > 0xffff ? 2 : 1;
  cur.k = e;
  return [j, e];
}

/** 标题节点区间 [start, end) 里的那段标题正文（第一段 text） */
interface Run { segs: Segment[]; i: number }
// 一个区间里按阅读顺序排的文字 / 节点段：段落取整段（par 的 span 只到第一段文字），别的按源码区间
function rangeRun(segments: Segment[], start: number, end: number, at: Segment | null, cache: Map<number, Run | null>): Run | null {
  const hit = cache.get(start);
  if (hit !== undefined) return hit;
  const para = at && segments.find((p) => p.kind === 'para' && p.key === at.key && p.pmFrom <= at.pmFrom && p.pmTo >= at.pmTo);
  const segs = segments.filter((s) => (s.kind === 'text' || s.kind === 'node') && (para ? s.key === para.key && s.pmFrom >= para.pmFrom && s.pmTo <= para.pmTo : s.typFrom >= start && s.typTo <= end && s.typFrom < s.typTo));
  const run = segs.length ? { segs, i: 0 } : null;
  cache.set(start, run);
  return run;
}

export function buildIndex(raw: Float64Array | null, segments: Segment[], version: number): GlyphIndex {
  if (!raw || !segments.length) return { ...EMPTY_INDEX, version };
  const glyphs: Glyph[] = [];
  const cursors = new Map<Segment, Cursor>();
  const runCache = new Map<number, Run | null>();
  for (let i = 0; i + GLYPH_STRIDE - 1 < raw.length; i += GLYPH_STRIDE) {
    const start = raw[i + 5];
    const end = raw[i + 6];
    const kind = raw[i + 7];
    const cp = raw[i + 8];
    const nchars = raw[i + 9];
    // 3 = 目录条目、页眉页脚里的回声：不是编辑正文的地方
    if (kind === 3) continue;
    // 4 = 标题里模板自己重排的字（章标题）：给的是标题节点的区间，对到里面那段标题文字上
    let seg = segmentAt(segments, start);
    let from = 0, to = 0;
    const cursorOf = (s: Segment) => { let cur = cursors.get(s); if (!cur) { cur = { k: 0, lastStart: -1, lastEnd: -1, lastCp: -1, lastFrom: 0, lastTo: 0 }; cursors.set(s, cur); } return cur; };
    const place = (s: Segment): boolean => {
      const cur = cursorOf(s);
      if (cur.lastStart === start && cur.lastEnd === end && cur.lastCp === cp && nchars > 0) {
        // 同一个字符簇里的第二个字形（组合符号）：与前一个同位
        from = cur.lastFrom; to = cur.lastTo; return true;
      }
      const [a, b] = align(s.raw ?? '', cur, cp, nchars);
      from = s.pmFrom + a; to = s.pmFrom + b;
      cur.lastStart = start; cur.lastEnd = end; cur.lastCp = cp; cur.lastFrom = from; cur.lastTo = to;
      return a < b;
    };
    if (kind === 4 && !(seg && seg.kind === 'node')) {
      // 模板自己排出来的字（章号、mitex 公式、脚注号）：只给了外层节点的区间，按阅读顺序对到里面的文字 / 节点上
      const run = rangeRun(segments, start, end, seg, runCache);
      if (!run) continue;
      const s = run.segs[run.i];
      if (s.kind !== 'node' && place(s) === false && cp > 32 && run.i + 1 < run.segs.length) {
        const cur = cursorOf(s); cur.lastStart = -1;
        run.i++;
      }
      seg = run.segs[run.i];
      if (seg.kind === 'node') {
        const next = run.segs[run.i + 1];
        if (next && next.kind !== 'node' && place(next)) { run.i++; seg = next; }
        else { from = seg.pmFrom; to = seg.pmTo; }
      } else if (seg !== s) place(seg);
    } else if (!seg) continue;
    else if (seg.kind === 'node' || seg.raw === undefined) {
      from = seg.pmFrom; to = seg.pmTo;
    } else {
      place(seg);
    }
    glyphs.push({ page: raw[i], x: raw[i + 1], y: raw[i + 2], w: raw[i + 3], h: raw[i + 4], key: seg.key, kind: seg.kind, seg, from, to, cp });
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
  const zero: CaretRect[] = [];
  // 字后：to === pos 的（to 没排序，往前扫一小段）
  for (let i = Math.min(arr.length - 1, lowerBound(arr, pos)); i >= 0 && pos - arr[i].from < 40; i--) {
    const g = arr[i];
    if (g.kind === 'text' && g.to === pos && g.from < g.to) cands.push({ page: g.page, x: g.x + g.w, y: g.y, h: g.h, line: lineOf(g) });
  }
  // 字前；零宽的（没对上原文的字、空段的 ¶）排最后
  for (let i = lowerBound(arr, pos); i < arr.length && arr[i].from === pos; i++) {
    const g = arr[i];
    if (g.kind !== 'text') continue;
    (g.from === g.to ? zero : cands).push({ page: g.page, x: g.x, y: g.y, h: g.h, line: lineOf(g) });
  }
  if (!cands.length) cands.push(...zero);
  if (!cands.length) {
    // 落在原子节点（公式、引用）上：画在节点前 / 后
    // 一个节点画成好几个字形（公式）：节点前取最左的，节点后取最右的
    const edge = new Map<Line, CaretRect>();
    const keep = (g: Glyph, after: boolean) => {
      const line = lineOf(g), x = after ? g.x + g.w : g.x, old = edge.get(line);
      if (!old || (after ? x > old.x : x < old.x)) edge.set(line, { page: g.page, x, y: g.y, h: g.h, line });
    };
    // 只认 node 字形：attr 的（脚注正文、题注）画在别处，不是这一段的边
    for (let i = lowerBound(arr, pos); i < arr.length && arr[i].from === pos; i++) if (arr[i].kind === 'node') keep(arr[i], false);
    for (let i = Math.min(arr.length - 1, lowerBound(arr, pos)); i >= 0 && pos - arr[i].from < 40; i--) if (arr[i].to === pos && arr[i].kind === 'node') keep(arr[i], true);
    cands.push(...edge.values());
  }
  // 同一处「字后」与下一字「字前」重合时留一个就行；prefer 决定挑哪一处印本
  return pick(cands, prefer);
}

export interface SelRect { page: number; x: number; y: number; w: number; h: number }

export interface ParaMark { page: number; x: number; y: number; h: number; blank: boolean; noIndent?: boolean; space?: boolean; w?: number }
export interface MarkKindsOpt { paragraph?: boolean; space?: boolean; gutter?: boolean }
/** 编辑标记（Word 的 ¶）该画在哪：空回车段上是那个隐形的 ¶ 自己，有字的段落是最后一个字之后 */
export function paragraphMarks(index: GlyphIndex, segments: Segment[], kinds: MarkKindsOpt = {}): ParaMark[] {
  const out: ParaMark[] = [];
  const want = { paragraph: kinds.paragraph ?? true, space: kinds.space ?? true, gutter: kinds.gutter ?? true };
  for (const lines of index.pages) if (lines) for (const l of lines) for (const g of l.glyphs) {
    if (want.paragraph && (g.seg.attr === 'blank' || g.seg.attr === 'blank0')) out.push({ page: g.page, x: g.x, y: g.y, h: g.h, blank: true, noIndent: g.seg.attr === 'blank0' });
    if (want.space && (g.cp === 32 || g.cp === 160 || g.cp === 0x3000) && g.seg.kind === 'text' && g.w > 0) out.push({ page: g.page, x: g.x, y: g.y, h: g.h, w: g.w, blank: false, space: true });
  }
  for (const s of segments) {
    if (s.kind !== 'para') continue;
    let r = null as ReturnType<typeof caretRect>;
    for (let p = s.pmTo; p >= s.pmTo - 3 && !r; p--) r = caretRect(index, s.key, p, null);
    if (r && want.paragraph) out.push({ page: r.page, x: r.x, y: r.y, h: r.h, blank: false });
    if (s.attr === 'noindent' && want.gutter) { const f = caretRect(index, s.key, s.pmFrom, null); if (f) { const g0 = f.line.glyphs[0]; out.push({ page: f.page, x: g0 ? g0.x : f.x, y: f.y, h: f.h, blank: false, noIndent: true }); } }
  }
  return out;
}

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
