import { queryTypst, startCompiler } from '../compiler/client';

export type MetricCache = Record<string, number[]>;

/** 原包用 Typst CLI query 的同一套测量公式，在站内一次批量完成。 */
export async function measureLabels(missing: Record<string, string>): Promise<MetricCache> {
  const entries = Object.entries(missing);
  if (!entries.length) return {};
  startCompiler();
  const source = `#set page(width: 10000pt, height: 10000pt, margin: 0pt)
#show math.equation: set text(font: "TeX Gyre Termes Math")
#let r-label-scope = (:)
${entries.some(([, e]) => e.includes('r-mitext(')) ? '#import "@preview/mitex:0.2.6": mitext as r-mitext' : ''}
#context {
${entries.map(([key, expression]) => `{
  let body = ${expression}
  let bounded = text(top-edge: "bounds", bottom-edge: "bounds", body)
  let size = measure(bounded)
  let p = size.height + 1pt
  let up = box(width: 0pt, height: p, baseline: 0pt)
  let down = box(width: 0pt, height: p, baseline: p)
  let hu = measure(box[#box(bounded)#up]).height
  let hd = measure(box[#box(bounded)#down]).height
  let a = if hu - hd > size.height { p + size.height - hu } else { hd - p }
  [#metadata((key: ${JSON.stringify(key)}, metrics: (size.width / 1pt, a / 1pt, (size.height - a) / 1pt))) <rplot-metric>]
}`).join('\n')}
}`;
  const r = await queryTypst(source, '<rplot-metric>');
  if (r.error) throw new Error(`R 图中文字测量失败：${r.error}`);
  const out: MetricCache = {};
  for (const value of (Array.isArray(r.result) ? r.result : [])) {
    const v = value?.value ?? value;
    if (typeof v?.key === 'string' && Array.isArray(v.metrics) && v.metrics.length === 3 && v.metrics.every(Number.isFinite)) out[v.key] = v.metrics;
  }
  if (Object.keys(out).length !== entries.length) throw new Error('Typst 没有返回完整的 R 图中文字度量');
  return out;
}
