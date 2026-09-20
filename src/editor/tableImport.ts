// 从文本造表：Markdown（GFM）表格、制表符 / 逗号分隔的行，都转成编辑器里的表节点（tableFigure 壳 + table）。
// 同时解析单元格中的加粗、倾斜、代码与公式；Markdown 对齐行转换为单元格对齐属性。

export interface ParsedTable {
  /** 每行的单元格，已去掉首尾空白 */
  rows: string[][];
  /** 第一行是不是表头（Markdown 有分隔行就是） */
  header: boolean;
  /** 每列对齐：Markdown 分隔行里的冒号 */
  aligns: (null | 'left' | 'center' | 'right')[];
}

const SEP_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitPipes(line: string): string[] {
  // 去掉行首行尾的管道，按未转义的 | 切
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** 认出文本里的表；认不出返回 null */
export function parseTableText(text: string): ParsedTable | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return null;
  const piped = lines.filter((l) => l.includes('|')).length >= Math.max(1, lines.length - 1);
  if (piped) {
    const rows: string[][] = [];
    let header = false;
    let aligns: ParsedTable['aligns'] = [];
    lines.forEach((l, i) => {
      if (i === 1 && SEP_ROW.test(l)) {
        header = true;
        aligns = splitPipes(l).map((c) => { const a = c.trim(); const left = a.startsWith(':'), right = a.endsWith(':'); return left && right ? 'center' : right ? 'right' : left ? 'left' : null; });
        return;
      }
      rows.push(splitPipes(l));
    });
    return normalize(rows, header, aligns);
  }
  // 制表符 / 逗号：Excel、CSV 粘过来的
  const tab = lines.every((l) => l.includes('\t'));
  const rows = lines.map((l) => (tab ? l.split('\t') : splitCsv(l)).map((c) => c.trim()));
  if (rows.every((r) => r.length <= 1)) return null;
  return normalize(rows, false, []);
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function normalize(rows: string[][], header: boolean, aligns: ParsedTable['aligns']): ParsedTable | null {
  if (!rows.length) return null;
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols < 1) return null;
  return { rows: rows.map((r) => [...r, ...Array(cols - r.length).fill('')]), header, aligns: [...aligns, ...Array(Math.max(0, cols - aligns.length)).fill(null)].slice(0, cols) };
}

type Inline = { type: 'text'; text: string; marks?: { type: string }[] } | { type: 'mathInline'; attrs: { src: string; mode: 'latex' | 'typst' } };

/** 单元格文本 → 行内节点：**粗** *斜* `代码` $公式$ */
export function inlineFromMarkdown(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(_(.+?)_)|(`(.+?)`)|(\$(.+?)\$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (t: string, marks?: { type: string }[]) => { if (t) out.push(marks ? { type: 'text', text: t, marks } : { type: 'text', text: t }); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    if (m[2] !== undefined) push(m[2], [{ type: 'bold' }]);
    else if (m[4] !== undefined) push(m[4], [{ type: 'italic' }]);
    else if (m[6] !== undefined) push(m[6], [{ type: 'italic' }]);
    else if (m[8] !== undefined) push(m[8], [{ type: 'code' }]);
    else if (m[10] !== undefined) out.push({ type: 'mathInline', attrs: { src: m[10].trim(), mode: 'latex' } });
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out;
}

/** 解析结果 → 编辑器的 table 节点（JSON） */
export function tableNodeFromParsed(t: ParsedTable, opts: { header?: boolean } = {}) {
  const header = opts.header ?? t.header;
  return {
    type: 'table',
    content: t.rows.map((r, ri) => ({
      type: 'tableRow',
      content: r.map((cell, ci) => ({
        type: header && ri === 0 ? 'tableHeader' : 'tableCell',
        attrs: { align: t.aligns[ci] ?? null },
        content: [{ type: 'paragraph', content: inlineFromMarkdown(cell) }],
      })),
    })),
  };
}
