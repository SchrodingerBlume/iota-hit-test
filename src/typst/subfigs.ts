// 分图的数据与排布：模板 subs() 收「一行里的格」与嵌套的 stack(dir: ttb | ltr)，这里把每张分图上记的 place 折成行 / 格 / 叠

/** 分图一张：图、钉死的宽 / 高（空 = 自动，跟同一行等高）、题、英文题、自定义标签（默认 fig:x-a）、
 *  place（排法：next 接着排、row 另起一行、below 叠在前一格之下、beside 在叠里与前一张并排）、
 *  mark / markFill（图上标签这一张单独的角 / 字色，auto 跟整图，none 不印） */
export interface SubFig {
  image: string;
  width: string | number;
  height?: string;
  caption: string;
  captionEn?: string;
  label?: string;
  place?: SubPlace;
  mark?: SubMark;
  markFill?: 'auto' | 'black' | 'white';
}
export type SubPlace = 'next' | 'row' | 'below' | 'beside';
export type SubMark = 'auto' | 'none' | 'tl' | 'tr' | 'bl' | 'br';
export const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

export function parseSubs(v: unknown): SubFig[] {
  if (Array.isArray(v)) return v as SubFig[];
  if (typeof v !== 'string' || !v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}

/** 排出来的形状：行 → 格；格是一张图或一摞（ttb）；摞里的一项是一张图或并排的几张（ltr）。下标都是 subs 里的序号 */
export type SubItem = number | { pair: number[] };
export type SubCell = number | { stack: SubItem[] };
export type SubRow = SubCell[];

/** 写了 place 的按 place 排，没写的按 columns 切行（0 = 一行排完） */
export function subLayout(subs: SubFig[], columns: number): SubRow[] {
  const idx = subs.map((_, i) => i);
  if (!subs.some((s) => s.place && s.place !== 'next')) {
    const n = columns >= 1 ? Math.min(6, Math.round(columns)) : idx.length;
    const rows: SubRow[] = [];
    for (let i = 0; i < idx.length; i += Math.max(1, n)) rows.push(idx.slice(i, i + Math.max(1, n)));
    return rows;
  }
  const rows: SubRow[] = [];
  for (const i of idx) {
    const place = i === 0 ? 'row' : subs[i].place ?? 'next';
    const row = rows[rows.length - 1];
    const last = row?.[row.length - 1];
    if (place === 'row' || !row) { rows.push([i]); continue; }
    if (place === 'below') {
      if (typeof last === 'number') row[row.length - 1] = { stack: [last, i] };
      else last.stack.push(i);
      continue;
    }
    if (place === 'beside' && typeof last !== 'number') {
      const tail = last.stack[last.stack.length - 1];
      if (typeof tail === 'number') last.stack[last.stack.length - 1] = { pair: [tail, i] };
      else tail.pair.push(i);
      continue;
    }
    row.push(i);
  }
  return rows;
}

export const explicitLayout = (subs: SubFig[]) => subs.some((s) => s.place && s.place !== 'next');

/** 分图号的字母（模板 subcaption-numbering 的样式，默认 "(a)"）：给引用与编辑器里的题注用 */
export function subNumber(pattern: string, k: number): string {
  const p = pattern || '(a)';
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const core = p.includes('A') ? (letters[k - 1] ?? String(k)).toUpperCase() : p.includes('a') ? letters[k - 1] ?? String(k) : String(k);
  return p.replace(/[aA1]/, core);
}
/** 引用里跟在图号后面：半角的补一个不断行的半角空格，全角的「（」自带边距（模板 caption.typ） */
export const subRef = (num: string, pattern: string, k: number) => `${num}${/^[（(]/.test(pattern || '(a)') && (pattern || '(a)').startsWith('（') ? '' : ' '}${subNumber(pattern, k)}`;
