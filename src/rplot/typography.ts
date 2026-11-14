// R 设备按原版 Typst 的字形宽度放置文字；不能让正文的 Word 字距、网格或两端对齐影响图内标签。
// 这些设置同时用于量字、预览与导出的独立模块，且均为原版 Typst 支持的参数。
export const R_PLOT_STOCK_STYLES = `set par(linebreaks: "optimized", justify: false, leading: 0.65em, spacing: 1.2em, first-line-indent: 0pt, hanging-indent: 0pt)
set text(tracking: 0pt, spacing: 100%, kerning: true, baseline: 0pt, overhang: true)`;

export const R_PLOT_STOCK_PRELUDE = R_PLOT_STOCK_STYLES.replace(/^set /gm, '#set ');

export function stockRPlotSource(source: string): string {
  if (source.includes('// iota-rplot-stock-typography')) return source;
  return `${source}
// iota-rplot-stock-typography: only the plot body, not its thesis caption
#let iota-rplot-original = r-figure
#let r-figure(..args) = {
  ${R_PLOT_STOCK_STYLES}
  iota-rplot-original(..args)
}
`;
}
