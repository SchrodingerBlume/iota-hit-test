// 行级 diff：工具卡画「这一笔改了哪几行」用（+N/−M 与逐行红绿，照 opencode 改动展示那套）。
// 文档块一般不大，LCS 全量算；真碰上超大段落就退化成整段删 + 加，别把内存吃爆
export interface DiffLine { kind: 'add' | 'del' | 'ctx'; text: string }
export interface LineDiff { add: number; del: number; lines: DiffLine[]; more: number }

/** 卡片里最多画这么多行，其余折成一句「还有 N 行」 */
const LIMIT = 300;
/** LCS 表超过这么多格就退化（约 1400×1400 行） */
const MAX_CELLS = 2_000_000;

export function lineDiff(before: string, after: string): LineDiff {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  const all: DiffLine[] = [];
  if (!a.length) for (const t of b) all.push({ kind: 'add', text: t });
  else if (!b.length) for (const t of a) all.push({ kind: 'del', text: t });
  else if (a.length * b.length > MAX_CELLS) {
    for (const t of a) all.push({ kind: 'del', text: t });
    for (const t of b) all.push({ kind: 'add', text: t });
  } else {
    const W = b.length + 1;
    const dp = new Int32Array((a.length + 1) * W);
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
      dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { all.push({ kind: 'ctx', text: a[i] }); i++; j++; }
      else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) all.push({ kind: 'del', text: a[i++] });
      else all.push({ kind: 'add', text: b[j++] });
    }
    while (i < a.length) all.push({ kind: 'del', text: a[i++] });
    while (j < b.length) all.push({ kind: 'add', text: b[j++] });
  }
  let add = 0, del = 0;
  for (const l of all) { if (l.kind === 'add') add++; else if (l.kind === 'del') del++; }
  return { add, del, lines: all.slice(0, LIMIT), more: Math.max(0, all.length - LIMIT) };
}
