// 打字回显的断行：等排版器重排那一会儿，光标后面的字得自己让开——让到行尾放不下了就该折到下一行去。
// 不重算版面，只看光标所在的那一行：字格宽、西文的量法都从这一行现成的字形上标定（同一份字体、同一档字距，
// 比拿 canvas 的通用字体栈量准），右缘取这一页各行的最右端（两端对齐的行正好顶到版心右缘）。
//
// 这里刻意不搬断行引擎的规则（压缩位、挂标点、汉西隙那一套在 fork 的 MODEL.md 里）：量的是排好的字形，
// 引擎改了规则这边照样对，误差最多是行尾一个标点该不该挂出——半秒后真版面回来就覆盖了。fork 更新只用重编 wasm。
import type { CaretRect, Glyph, Line } from './previewEdit';

const isCJK = (cp: number) => (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef);
const cjkChar = (c: string) => isCJK(c.codePointAt(0) ?? 0);

/** 这一行的量法：一个汉字占多宽（字格）、西文按 canvas 量出来再乘一个校准系数 */
export interface Metrics { cell: number; latin: number; size: number }
let ctx: CanvasRenderingContext2D | null = null;
const FONTS = '"TeX Gyre Termes", "Noto Serif CJK SC", "Times New Roman", serif';
function canvasWidth(text: string, px: number): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * px * 0.5;
  ctx.font = `${px}px ${FONTS}`;
  return ctx.measureText(text).width;
}

/** 从一行现成的字形上标定：相邻汉字的步进就是字格，西文那截用实际宽比 canvas 量的宽校准 */
export function calibrate(line: Line): Metrics {
  const gs = line.glyphs;
  const size = gs.length ? Math.max(...gs.map((g) => g.h)) : 12;
  const steps: number[] = [];
  for (let i = 1; i < gs.length; i++) {
    const a = gs[i - 1], b = gs[i];
    if (cjkChar(String.fromCodePoint(a.cp || 0x4e00)) && cjkChar(String.fromCodePoint(b.cp || 0x4e00)) && b.x > a.x) steps.push(b.x - a.x);
  }
  steps.sort((a, b) => a - b);
  const cell = steps.length ? steps[steps.length >> 1] : size;
  const latinGs = gs.filter((g) => g.cp && !isCJK(g.cp) && g.w > 0);
  const text = latinGs.map((g) => String.fromCodePoint(g.cp)).join('');
  const measured = latinGs.reduce((w, g) => w + g.w, 0);
  const canvasW = text ? canvasWidth(text, size) : 0;
  return { cell, latin: canvasW > 1 && measured > 1 ? measured / canvasW : 1, size };
}

/** 一段字在这一行上占多宽：汉字一格一个，西文按量的来（半角空格算半格） */
export function textWidth(text: string, m: Metrics): number {
  let w = 0, latin = '';
  const flush = () => { if (latin) { w += canvasWidth(latin, m.size) * m.latin + latin.length * (m.cell - m.size) / 2; latin = ''; } };
  for (const c of text) { if (cjkChar(c)) { flush(); w += m.cell; } else latin += c; }
  flush();
  return w;
}

export interface EchoMove { glyph: Glyph; x: number; y: number }
export interface EchoPlan {
  /** 留在本行的字形往右挪多少 */
  dx: number;
  /** 折到下一行去的字形（连同新位置）；下一行原有的字形也跟着右移 */
  moves: EchoMove[];
}

/** 这一页的版心右缘：各行最右端里最大的那个（两端对齐的行顶到版心） */
export function rightEdgeOf(lines: Line[] | undefined, fallback: number): number {
  if (!lines?.length) return fallback;
  let max = 0;
  for (const l of lines) { const last = l.glyphs[l.glyphs.length - 1]; if (last) max = Math.max(max, last.x + last.w); }
  return max || fallback;
}

/**
 * 排一次回显：插入的字占 dx 宽，光标后面同一行的字形右移；移出右缘的折到下一行行首，
 * 下一行原有的字形右移同样的宽（只折一层——真版面 1 秒内就回来了）。
 */
export function planEcho(caret: CaretRect, dx: number, next: Line | null, rightEdge: number, leftEdge?: number): EchoPlan {
  const line = caret.line;
  const after = line.glyphs.filter((g) => g.x >= caret.x - 0.5);
  if (dx <= 0 || !after.length) return { dx, moves: [] };
  const wrapFrom = after.findIndex((g) => g.x + dx + g.w > rightEdge + 0.5);
  if (wrapFrom < 0) return { dx, moves: [] };
  const wrapped = after.slice(wrapFrom);
  // 下一行是不是同一段接下去的（同一份富文本、位置接得上）：是就把它的字往右让，不是（题注、另一段）就只把这截放到下一行的位置上
  const tail = line.glyphs[line.glyphs.length - 1];
  const head = next?.glyphs[0];
  const sameFlow = !!next && !!head && head.key === tail.key && head.from >= tail.to && head.from - tail.to <= 2;
  const startX = sameFlow ? head!.x : leftEdge ?? line.glyphs[0].x;
  const y = next?.y ?? line.y + line.h;
  const h = next?.h ?? line.h;
  const moves: EchoMove[] = [];
  let x = startX;
  for (const g of wrapped) { moves.push({ glyph: g, x, y: y + (h - g.h) }); x += g.w; }
  if (sameFlow) { const shift = x - startX; for (const g of next!.glyphs) moves.push({ glyph: g, x: g.x + shift, y: g.y }); }
  return { dx, moves };
}

/** 这一页的版心左缘：各行起点里最常见的那个（正文行都从版心左缘起，首行缩进的除外） */
export function leftEdgeOf(lines: Line[] | undefined, fallback: number): number {
  if (!lines?.length) return fallback;
  const counts = new Map<number, number>();
  for (const l of lines) { const g = l.glyphs[0]; if (g) { const k = Math.round(g.x); counts.set(k, (counts.get(k) ?? 0) + 1); } }
  let best = fallback, n = 0;
  for (const [x, c] of counts) if (c > n || (c === n && x < best)) { best = x; n = c; }
  return best;
}
