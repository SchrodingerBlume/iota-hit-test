/** 只裁上下整行空白，保留完整宽度；像素检测用于确定边界，最终 CeTZ 仍为矢量。 */
export function verticalInkBounds(data: Uint8ClampedArray, width: number, height: number, padding = 3): { top: number; bottom: number } {
  const corners = [0, width - 1, (height - 1) * width, width * height - 1];
  // 透明图按 alpha 保留白色笔画；白底图忽略白色背景，有色背景不视为空白。
  const transparent = corners.filter((p) => data[p * 4 + 3] <= 4).length >= 2;
  const rowHasInk = (y: number) => {
    for (let p = y * width * 4, end = p + width * 4; p < end; p += 4) {
      const alpha = data[p + 3];
      if (alpha <= 4) continue;
      if (transparent || Math.max(255 - data[p], 255 - data[p + 1], 255 - data[p + 2]) * alpha > 3 * 255) return true;
    }
    return false;
  };
  let first = 0, last = height - 1;
  while (first < height && !rowHasInk(first)) first++;
  if (first === height) return { top: 0, bottom: 0 }; // 空图不能变成零高度。
  while (last > first && !rowHasInk(last)) last--;
  return { top: Math.max(0, first - padding), bottom: Math.max(0, height - 1 - last - padding) };
}
