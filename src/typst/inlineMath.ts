// 一行说明文字里夹的公式：写成 $…$（LaTeX），式中的说明、题注这类只有一格文字的地方用
export type MathSeg = { math: false; text: string } | { math: true; src: string };

/** 按 $…$ 切开；`\$` 不算，落单的 $ 当字 */
export function splitDollarMath(s: string): MathSeg[] {
  const out: MathSeg[] = [];
  const re = /(?<!\\)\$([^$\n]+?)(?<!\\)\$/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ math: false, text: s.slice(last, m.index) });
    out.push({ math: true, src: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ math: false, text: s.slice(last) });
  return out.map((x) => (x.math ? x : { math: false, text: x.text.replace(/\\\$/g, '$') }));
}
export const hasDollarMath = (s: string) => /(?<!\\)\$[^$\n]+?(?<!\\)\$/.test(s);
