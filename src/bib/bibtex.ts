// BibTeX 解析与生成。结构化条目是真身（界面上逐字段填），BibTeX 只是交换格式：
// 编译时生成、导出时生成、导入时解析。解析容忍常见写法：{…} / "…" / 裸数字、
// 嵌套花括号、@comment / @string / @preamble 跳过、字段间的 # 拼接按字面拼。

export interface BibEntry {
  /** 界面用的稳定 id，不进 .bib */
  id: string;
  key: string;
  type: string;
  fields: Record<string, string>;
  /** 编辑器里的分组（像 Zotero 的分类），不进 .bib */
  group?: string;
}

export const newEntryId = () => Math.random().toString(36).slice(2, 10);

export function parseBibtex(src: string): BibEntry[] {
  const out: BibEntry[] = [];
  let i = 0;
  const n = src.length;
  const skipWs = () => { while (i < n && /\s/.test(src[i])) i++; };
  const readBalanced = (open: string, close: string): string => {
    // 光标在 open 上
    let depth = 0;
    let s = '';
    for (; i < n; i++) {
      const c = src[i];
      if (c === '\\' && i + 1 < n) { s += c + src[i + 1]; i++; continue; }
      if (c === open) { depth++; if (depth === 1) continue; }
      if (c === close) { depth--; if (depth === 0) { i++; return s; } }
      s += c;
    }
    return s;
  };
  const readQuoted = (): string => {
    // 光标在 " 上
    i++;
    let s = '';
    let depth = 0;
    for (; i < n; i++) {
      const c = src[i];
      if (c === '\\' && i + 1 < n) { s += c + src[i + 1]; i++; continue; }
      if (c === '{') depth++;
      if (c === '}') depth--;
      if (c === '"' && depth === 0) { i++; return s; }
      s += c;
    }
    return s;
  };
  const readValue = (): string => {
    let parts: string[] = [];
    for (;;) {
      skipWs();
      if (i >= n) break;
      const c = src[i];
      if (c === '{') parts.push(readBalanced('{', '}'));
      else if (c === '"') parts.push(readQuoted());
      else {
        let s = '';
        while (i < n && !/[,}#\s]/.test(src[i])) s += src[i++];
        parts.push(s);
      }
      skipWs();
      if (src[i] === '#') { i++; continue; }
      break;
    }
    return parts.join('').replace(/\s*\n\s*/g, ' ').trim();
  };

  while (i < n) {
    const at = src.indexOf('@', i);
    if (at < 0) break;
    i = at + 1;
    let type = '';
    while (i < n && /[A-Za-z]/.test(src[i])) type += src[i++];
    type = type.toLowerCase();
    skipWs();
    if (src[i] !== '{' && src[i] !== '(') continue;
    const close = src[i] === '{' ? '}' : ')';
    const bodyStart = i;
    if (type === 'comment' || type === 'string' || type === 'preamble') { i = bodyStart; readBalanced(src[i], close); continue; }
    i++;
    skipWs();
    let key = '';
    while (i < n && !/[,\s]/.test(src[i]) && src[i] !== close) key += src[i++];
    skipWs();
    if (src[i] === ',') i++;
    const fields: Record<string, string> = {};
    for (;;) {
      skipWs();
      if (i >= n || src[i] === close) { i++; break; }
      let name = '';
      while (i < n && /[A-Za-z0-9_\-:.+/]/.test(src[i])) name += src[i++];
      skipWs();
      if (src[i] !== '=') { // 语法坏了：跳到条目结束
        while (i < n && src[i] !== close) i++;
        i++;
        break;
      }
      i++;
      const value = readValue();
      if (name) fields[name.toLowerCase()] = value;
      skipWs();
      if (src[i] === ',') i++;
    }
    out.push({ id: newEntryId(), key: key.trim(), type, fields });
  }
  return out;
}

function escapeValue(v: string): string {
  // 值里已经有的花括号原样保留（用户可能故意写 {NASA} 保护大小写）；只保证平衡
  let depth = 0;
  for (const c of v) { if (c === '{') depth++; else if (c === '}') depth = Math.max(0, depth - 1); }
  return depth > 0 ? v + '}'.repeat(depth) : v;
}

export function generateBibtex(entries: BibEntry[]): string {
  return entries
    .filter((e) => e.key.trim())
    .map((e) => {
      const lines = Object.entries(e.fields)
        .filter(([, v]) => v != null && String(v).trim() !== '')
        .map(([k, v]) => `  ${k} = {${escapeValue(String(v).trim())}},`);
      return `@${e.type || 'misc'}{${e.key.trim()},\n${lines.join('\n')}\n}`;
    })
    .join('\n\n') + (entries.length ? '\n' : '');
}

/** 作者字段 ↔ 一行一个人 */
export const splitNames = (s: string) => s.split(/\s+and\s+/i).map((x) => x.trim()).filter(Boolean);
export const joinNames = (lines: string) => lines.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(' and ');

/** 从作者 + 年份造一个 key：西文取姓，中文取前两个字的拼音做不到就用字面 */
export function suggestKey(entry: BibEntry, taken: Set<string>): string {
  const first = splitNames(entry.fields.author ?? entry.fields.editor ?? '')[0] ?? '';
  let stem = first.includes(',') ? first.split(',')[0] : first.split(/\s+/).pop() ?? '';
  stem = stem.replace(/[{}\\]/g, '');
  const latin = stem.replace(/[^A-Za-z]/g, '').toLowerCase();
  const base = (latin || (stem ? 'ref' : 'ref')) + (entry.fields.year ?? entry.fields.date ?? '').slice(0, 4);
  let key = base || 'ref';
  let suffix = 0;
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  while (taken.has(key)) key = base + letters[suffix++ % 26] + (suffix > 26 ? String(suffix) : '');
  return key;
}
