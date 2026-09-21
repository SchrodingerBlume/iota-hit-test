// 行级差异（LCS），给本地历史与 Git 的对照看：只留改动行附近几行，其余折成「… n 行未变 …」
export type DiffOp = { type: 'same' | 'add' | 'del' | 'skip'; text: string; n?: number };

export function lineDiff(a: string, b: string): DiffOp[] {
  const al = a.split('\n'), bl = b.split('\n');
  const m = al.length, n = bl.length;
  if (m * n > 4_000_000) return [{ type: 'skip', text: '', n: -1 }];
  // 先剥掉相同的头尾，中间才跑 LCS
  let head = 0; while (head < m && head < n && al[head] === bl[head]) head++;
  let tail = 0; while (tail < m - head && tail < n - head && al[m - 1 - tail] === bl[n - 1 - tail]) tail++;
  const A = al.slice(head, m - tail), B = bl.slice(head, n - tail);
  const dp: Uint32Array[] = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: DiffOp[] = al.slice(0, head).map((text) => ({ type: 'same', text }));
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { ops.push({ type: 'same', text: A[i] }); i++; j++; }
    else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) { ops.push({ type: 'add', text: B[j] }); j++; }
    else { ops.push({ type: 'del', text: A[i] }); i++; }
  }
  for (const text of al.slice(m - tail)) ops.push({ type: 'same', text });
  return ops;
}

/** 改动行前后留 ctx 行，其余折起来 */
export function withContext(ops: DiffOp[], ctx = 2): DiffOp[] {
  const keep = new Set<number>();
  ops.forEach((op, idx) => { if (op.type !== 'same') for (let d = -ctx; d <= ctx; d++) keep.add(idx + d); });
  const out: DiffOp[] = [];
  let skipped = 0;
  ops.forEach((op, idx) => {
    if (keep.has(idx)) { if (skipped) { out.push({ type: 'skip', text: '', n: skipped }); skipped = 0; } out.push(op); }
    else skipped++;
  });
  if (skipped) out.push({ type: 'skip', text: '', n: skipped });
  return out;
}

export const countChanges = (ops: DiffOp[]) => ({ add: ops.filter((o) => o.type === 'add').length, del: ops.filter((o) => o.type === 'del').length });
