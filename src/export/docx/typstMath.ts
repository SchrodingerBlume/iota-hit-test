// Typst 写法的公式没有 MathML 可转，让站内的引擎编成 SVG、再画成 PNG 贴进 Word
import { compileSnippet } from '../../compiler/client';
import { renderSnippetSvg } from '../../compiler/renderer';

export interface MathImage { data: ArrayBuffer; width: number; height: number }
const SCALE = 4;

export async function renderTypstMath(src: string, display: boolean): Promise<MathImage | null> {
  const r = await compileSnippet(src, display);
  if (!r.artifact) return null;
  // 语义文本层（foreignObject）会把 canvas 弄成「被污染」导不出 PNG，一并去掉
  let svg = (await renderSnippetSvg(new Uint8Array(r.artifact))).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '');
  const m = /viewBox="([\d.\-]+) ([\d.\-]+) ([\d.]+) ([\d.]+)"/.exec(svg) ?? /width="([\d.]+)(?:pt)?" height="([\d.]+)/.exec(svg);
  if (!m) return null;
  const wPt = m.length > 3 ? parseFloat(m[3]) : parseFloat(m[1]);
  const hPt = m.length > 3 ? parseFloat(m[4]) : parseFloat(m[2]);
  const w = Math.max(1, Math.round(wPt / 72 * 96)), h = Math.max(1, Math.round(hPt / 72 * 96));
  // 字形是 <use> 引的 symbol，画进 canvas 前要把 svg 自己的尺寸钉成像素
  svg = svg.replace(/<svg([^>]*)>/, (all, attrs) => `<svg${attrs.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '')} width="${w * SCALE}" height="${h * SCALE}">`);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('svg')); i.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = w * SCALE; canvas.height = h * SCALE;
    const g = canvas.getContext('2d')!;
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
    if (!blob) return null;
    return { data: await blob.arrayBuffer(), width: w, height: h };
  } finally { URL.revokeObjectURL(url); }
}
