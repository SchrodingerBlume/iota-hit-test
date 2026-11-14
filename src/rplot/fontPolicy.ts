/** 自动按五号→小五→六号尝试；显式 pt 与 R 代码中的显式字号不参与取整。 */
export const R_AUTO_FONT_SIZES = [10.5, 9, 7.5] as const;
export interface RLabelBox { label: string; size: number; x: number; y: number; width: number; ascent: number; descent: number; angle: number; clip: number[] }
export interface RFontReport { mode: 'auto' | 'manual'; pointsize: number; overlaps: number; clipped: number; autoOverlaps?: number; autoClipped?: number }

export function inspectRLabels(labels: RLabelBox[], size: number): Pick<RFontReport, 'overlaps' | 'clipped' | 'autoOverlaps' | 'autoClipped'> {
  const boxes = labels.filter((l) => [l.x, l.y, l.width, l.ascent, l.descent, l.angle].every(Number.isFinite)).map((l) => {
    const a = l.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const points = [[0, -l.descent], [l.width, -l.descent], [l.width, l.ascent], [0, l.ascent]].map(([x, y]) => [l.x + x * c - y * s, l.y + x * s + y * c]);
    return { l, points, auto: Math.abs(l.size - size) < .0001, left: Math.min(...points.map((p) => p[0])), right: Math.max(...points.map((p) => p[0])), bottom: Math.min(...points.map((p) => p[1])), top: Math.max(...points.map((p) => p[1])) };
  }).filter((b) => b.right > b.l.clip[0] && b.left < b.l.clip[1] && b.top > b.l.clip[2] && b.bottom < b.l.clip[3]).sort((a, b) => a.left - b.left);
  let overlaps = 0, autoOverlaps = 0;
  const outside = boxes.filter((b) => b.left < b.l.clip[0] - 1 || b.right > b.l.clip[1] + 1 || b.bottom < b.l.clip[2] - 1 || b.top > b.l.clip[3] + 1);
  const clipped = outside.length, autoClipped = outside.filter((b) => b.auto).length;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length && boxes[j].left < boxes[i].right - 1; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.l.label.length < 2 || b.l.label.length < 2 || Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) <= 1) continue;
    // 同一标签的描边/阴影叠印不是标签冲突；plotmath 的逐字符排版也不据此缩字号。
    if (a.l.label === b.l.label && Math.hypot(a.l.x - b.l.x, a.l.y - b.l.y) < .5) continue;
    let separated = false;
    for (const polygon of [a.points, b.points]) for (let k = 0; k < 2; k++) {
      const dx = polygon[k + 1][0] - polygon[k][0], dy = polygon[k + 1][1] - polygon[k][1], length = Math.hypot(dx, dy);
      if (!length) continue;
      const project = (p: number[]) => (-dy * p[0] + dx * p[1]) / length;
      const x = a.points.map(project), y = b.points.map(project);
      if (Math.min(Math.max(...x), Math.max(...y)) - Math.max(Math.min(...x), Math.min(...y)) <= 1) separated = true;
    }
    if (!separated) { overlaps++; if (a.auto || b.auto) autoOverlaps++; }
    // 足够判定拥挤即停止，避免上万条重叠标注让主线程做平方级比较。
    if (overlaps >= 100) return { overlaps, clipped, autoOverlaps, autoClipped };
  }
  return { overlaps, clipped, autoOverlaps, autoClipped };
}
