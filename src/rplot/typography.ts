// R 设备按原版 Typst 的字形宽度放置文字；不能让正文的 Word 字距、网格或两端对齐影响图内标签。
// 这些设置同时用于量字、预览与导出的独立模块，且均为原版 Typst 支持的参数。
export const R_PLOT_STOCK_STYLES = `set par(linebreaks: "optimized", justify: false, leading: 0.65em, spacing: 1.2em, first-line-indent: 0pt, hanging-indent: 0pt)
set text(tracking: 0pt, spacing: 100%, kerning: true, baseline: 0pt, overhang: true)`;

export const R_PLOT_STOCK_PRELUDE = R_PLOT_STOCK_STYLES.replace(/^set /gm, '#set ');

export function stockRPlotSource(source: string, crop?: { top: number; bottom: number }): string {
  const scoped = source.includes('// iota-rplot-stock-typography') ? source : `${source}
// iota-rplot-stock-typography: only the plot body, not its thesis caption
#let iota-rplot-original = r-figure
#let r-figure(..args) = {
  ${R_PLOT_STOCK_STYLES}
  iota-rplot-original(..args)
}
`;
  if (!crop || (!crop.top && !crop.bottom)) return scoped;
  return `${scoped}
// iota-rplot-vertical-crop: translate and clip, never scale the plot or its fonts
#let iota-rplot-uncropped = r-figure
#let r-figure(..args) = {
  let h = calc.max(1pt, r-size.at(1) * 1pt - ${crop.top}pt - ${crop.bottom}pt)
  block(width: r-size.at(0) * 1pt, height: h, spacing: 0pt, clip: true,
    place(top + left, dy: -${crop.top}pt, iota-rplot-uncropped(..args)))
}
`;
}
