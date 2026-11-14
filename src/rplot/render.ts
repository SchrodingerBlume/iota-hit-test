import { compileDrawing } from '../compiler/client';
import { renderSnippetSvg } from '../compiler/renderer';
import { putImage } from '../editor/imageCache';
import { useStore } from '../model/store';
import { runRPlot, type RPlotOptions } from './runtime';
import { rPlotCrop, rPlotHeight, type RPlotData } from './files';
import { stockRPlotSource } from './typography';
import { verticalInkBounds } from './crop';

export interface RenderedRPlot { plot: RPlotData; png: Blob; svg: string; pixelWidth: number; pixelHeight: number; stdout: string }
let creating = false;
export const isRPlotRendering = () => creating;

/** 预览、富文本缩略图和 Word 导出都由同一份 CeTZ 画出来，正文/PDF 则直接编 CeTZ 矢量图。 */
export async function createRPlot(code: string, options: RPlotOptions = {}): Promise<RenderedRPlot> {
  // 锁覆盖 R 执行和后续 Typst/PNG 预览，用户窗口与 Agent 不会交叉占用同一绘图流水线。
  if (creating) throw new Error('另一个 R 绘图任务正在运行，请等它结束');
  creating = true;
  try { return await renderRPlot(code, options); }
  finally { creating = false; }
}

async function renderRPlot(code: string, options: RPlotOptions): Promise<RenderedRPlot> {
  const r = await runRPlot(code, options);
  options.signal?.throwIfAborted();
  if (r.plot.pages !== 1) throw new Error(`这段 R 代码画出了 ${r.plot.pages} 页；一张插图需为一页，多面板请使用 par(mfrow=...) 或 patchwork`);
  options.progress?.('正在编译 CeTZ 图并生成预览…');
  let preview = await renderPreview(r.plot, options.signal);
  options.signal?.throwIfAborted();
  const pixels = preview.canvas.getContext('2d')!.getImageData(0, 0, preview.pixelWidth, preview.pixelHeight);
  const crop = verticalInkBounds(pixels.data, preview.pixelWidth, preview.pixelHeight);
  if (crop.top || crop.bottom) {
    options.progress?.('正在去除图上下的空白（保持图宽和字号）…');
    const ptPerPixel = r.plot.height * 72 / preview.pixelHeight;
    r.plot.crop = { top: crop.top * ptPerPixel, bottom: crop.bottom * ptPerPixel };
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(r.plot.source + JSON.stringify(r.plot.crop))))].map(v => v.toString(16).padStart(2, '0')).join('').slice(0, 32);
    r.plot.path = `rplots/${hash}.typ`;
    preview = await renderPreview(r.plot, options.signal);
  }
  options.signal?.throwIfAborted();
  const png = await new Promise<Blob | null>((resolve) => preview.canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('R 图预览无法生成 PNG');
  return { plot: r.plot, png, svg: preview.svg, pixelWidth: preview.pixelWidth, pixelHeight: preview.pixelHeight, stdout: r.stdout };
}

async function renderPreview(plot: RPlotData, signal?: AbortSignal) {
  const result = await compileDrawing(`#set page(width: auto, height: auto, margin: 0pt, fill: none)\n#show math.equation: set text(font: "TeX Gyre Termes Math")\n#import ${JSON.stringify(plot.path)}: r-figure\n#r-figure()`, { [plot.path]: stockRPlotSource(plot.source, rPlotCrop(plot)) });
  if (!result.artifact) throw new Error(`R 图的 CeTZ 编译失败：${result.error ?? '没有生成版面'}`);
  signal?.throwIfAborted();
  let svg = (await renderSnippetSvg(new Uint8Array(result.artifact)))
    .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '');
  const pixelWidth = Math.round(plot.width * 192), pixelHeight = Math.max(1, Math.round(rPlotHeight(plot) * 192));
  // renderer 的页边界会取整；用原始物理尺寸恢复 viewBox，避免预览按取整后的框再次缩字。
  svg = svg.replace(/<svg([^>]*)>/, (_all, attrs: string) => `<svg${attrs.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '').replace(/\sviewBox="[^"]*"/, '')} viewBox="0 0 ${plot.width * 72} ${rPlotHeight(plot) * 72}" width="${pixelWidth}" height="${pixelHeight}">`);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('CeTZ SVG 预览无法解码')); im.src = url;
    });
    const canvas = document.createElement('canvas'); canvas.width = pixelWidth; canvas.height = pixelHeight;
    canvas.getContext('2d')!.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    return { canvas, svg, pixelWidth, pixelHeight };
  } finally { URL.revokeObjectURL(url); }
}

/** 插图沿用现成的图节点：PNG 是编辑器/Word 的显示副本，rPlot 才是正文编译的来源。 */
export async function saveRPlot(result: RenderedRPlot, docId: string, widthCm: number): Promise<Record<string, unknown>> {
  if (useStore.getState().doc.id !== docId) throw new Error('工程已切换，请在当前工程重新插入 R 图');
  const name = `rplot-${result.plot.path.split('/').pop()!.replace('.typ', '.png')}`;
  await putImage(name, result.png);
  if (useStore.getState().doc.id !== docId) throw new Error('工程已切换，R 图没有插入');
  const st = useStore.getState();
  st.setImages([...st.doc.images.filter((im) => im.name !== name), { name, mime: 'image/png', width: result.pixelWidth, height: result.pixelHeight }]);
  return { image: name, rPlot: JSON.stringify(result.plot), width: widthCm, subs: '[]' };
}
