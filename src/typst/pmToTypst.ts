// ProseMirror JSON → Typst 标记。
//
// 用户永远只看富文本；这里把编辑器里的每一种节点翻成 iota-hit 认得的写法：
//   heading(level, en)      = 标题#en[English]
//   figure                  #figure(image(...), caption: [...]) <label>
//   tableFigure > table     #figure(table(...), caption: [...]) <label>
//   equation                $ ... $ <label>     或 #mitex(`...`) <label>
//   mathInline              $...$              或 #mi(`...`)
//   cite / ref / abbr       #cite(<key>) / #ref(<label>)（不用 @key：后面贴着汉字会被吞进 label）
//   footnote                #footnote[...]
//   pageBreak               #pagebreak()
//   bulletList / orderedList  - / +
//   codeBlock               ```lang … ```
// 纯文本里 Typst 的特殊字符一律转义，行首会被当成标记的字符再多转义一次。

export interface PMNode {
  type: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, any> }[];
  text?: string;
}

export interface SerializeOptions {
  /** 标题允许出现（正文、附录）；摘要、结论这些页里不允许 */
  headings?: boolean;
  /** 一级标题从这一级起算：正文 1（= 章）。报告里模板自己把级别错开，这里不管 */
  headingBase?: number;
  /** 图片路径前缀 */
  imageDir?: string;
}

// ── 文本转义 ────────────────────────────────────────────────────

/** 行内任何位置都要转义的字符 */
const INLINE_SPECIAL = /[\\*_`#$@<>\[\]~]/g;

export function escapeText(s: string): string {
  return s
    .replace(INLINE_SPECIAL, (c) => '\\' + c)
    // 注释与斜线：// 与 /* 在标记里开注释
    .replace(/\/\//g, '\\/\\/')
    .replace(/\/\*/g, '\\/*')
    .replace(/\*\//g, '*\\/');
}

/** 一段开头如果长得像列表、标题、词条，补一个反斜杠 */
export function escapeLineStart(s: string): string {
  // 转义之后 * _ 已经带反斜杠了，这里只管没转义的：= - + / 与「1.」
  if (/^\s*(=|-|\+|\/|\d+\.)(\s|$)/.test(s)) return s.replace(/^(\s*)/, '$1\\');
  return s;
}

// ── 行内 ────────────────────────────────────────────────────────

function wrapMarks(text: string, marks: PMNode['marks'] = []): string {
  let out = text;
  for (const m of marks) {
    switch (m.type) {
      case 'bold': out = `#strong[${out}]`; break;
      case 'italic': out = `#emph[${out}]`; break;
      case 'underline': out = `#underline[${out}]`; break;
      case 'strike': out = `#strike[${out}]`; break;
      case 'code': out = `#raw(${JSON.stringify(rawOf(text))})`; break;
      case 'superscript': out = `#super[${out}]`; break;
      case 'subscript': out = `#sub[${out}]`; break;
      case 'link': out = `#link(${JSON.stringify(m.attrs?.href ?? '')})[${out}]`; break;
    }
  }
  return out;
}

// code 标记包着的是转义后的文本；raw 要的是原文
function rawOf(escaped: string): string {
  return escaped.replace(/\\([\\*_`#$@<>\[\]~/])/g, '$1');
}

function mathInline(attrs: Record<string, any> = {}): string {
  const src = String(attrs.src ?? '').trim();
  if (!src) return '';
  if (attrs.mode === 'latex') return `#mi(${backtick(src)})`;
  return `$${src}$`;
}

function backtick(s: string): string {
  // 原始块：内容里有反引号就多包几个
  let fence = '`';
  while (s.includes(fence)) fence += '`';
  return `${fence}${s}${fence}`;
}

export function serializeInline(nodes: PMNode[] = [], opts: SerializeOptions = {}): string {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text': {
        const isCode = n.marks?.some((m) => m.type === 'code');
        out += isCode ? wrapMarks(escapeText(n.text ?? ''), n.marks) : wrapMarks(escapeText(n.text ?? ''), n.marks);
        break;
      }
      case 'hardBreak': out += ' \\\n'; break;
      case 'mathInline': out += mathInline(n.attrs); break;
      case 'cite': {
        const keys = String(n.attrs?.keys ?? '').split(/[,，;；\s]+/).filter(Boolean);
        // 写成函数调用而不是 @key：Typst 0.15 的 @ 引用会把紧跟的汉字也吞进 label
        out += keys.map((k) => `#cite(<${k}>)`).join('');
        break;
      }
      case 'ref': out += n.attrs?.target ? `#ref(<${n.attrs.target}>)` : ''; break;
      case 'abbr': out += n.attrs?.key ? `#ref(<${n.attrs.key}>)` : ''; break;
      case 'footnote': out += `#footnote[${escapeText(String(n.attrs?.text ?? ''))}]`; break;
      case 'ccwd': out += `#ccwd(${n.attrs?.n ?? 1})`; break;
      case 'idx': out += n.attrs?.text ? `#idx[${escapeText(String(n.attrs.text))}]` : ''; break;
      default:
        if (n.content) out += serializeInline(n.content, opts);
    }
  }
  return out;
}

// ── 块 ──────────────────────────────────────────────────────────

export function labelOf(attrs: Record<string, any> | undefined, prefix: string): string {
  if (!attrs) return '';
  const custom = String(attrs.label ?? '').trim();
  const base = custom || (attrs.uid ? `${prefix}:${attrs.uid}` : '');
  return base.replace(/[^A-Za-z0-9_:.\-]/g, '-');
}

function caption(attrs: Record<string, any> = {}): string {
  const zh = escapeText(String(attrs.caption ?? '').trim());
  const en = escapeText(String(attrs.captionEn ?? '').trim());
  return en ? `${zh}#en[${en}]` : zh;
}

function serializeTable(table: PMNode): string {
  const rows = (table.content ?? []).filter((r) => r.type === 'tableRow');
  if (!rows.length) return '';
  // 列数按第一行的 colspan 之和算
  const ncols = (rows[0].content ?? []).reduce((s, c) => s + (c.attrs?.colspan ?? 1), 0);
  const cell = (c: PMNode): string => {
    const body = (c.content ?? []).map((p) => serializeInline(p.content, {})).join(' \\ ');
    const colspan = c.attrs?.colspan ?? 1;
    const rowspan = c.attrs?.rowspan ?? 1;
    if (colspan > 1 || rowspan > 1) {
      const args = [colspan > 1 ? `colspan: ${colspan}` : '', rowspan > 1 ? `rowspan: ${rowspan}` : ''].filter(Boolean).join(', ');
      return `table.cell(${args})[${body}]`;
    }
    return `[${body}]`;
  };
  const lines: string[] = [];
  const headerRows: PMNode[] = [];
  let i = 0;
  while (i < rows.length && (rows[i].content ?? []).every((c) => c.type === 'tableHeader')) { headerRows.push(rows[i]); i++; }
  if (headerRows.length) {
    lines.push(`    table.header(${headerRows.map((r) => (r.content ?? []).map(cell).join(', ')).join(',\n      ')}),`);
  }
  for (; i < rows.length; i++) lines.push(`    ${(rows[i].content ?? []).map(cell).join(', ')},`);
  return `table(\n    columns: ${ncols},\n    align: center + horizon,\n${lines.join('\n')}\n  )`;
}

function serializeList(node: PMNode, marker: '-' | '+', opts: SerializeOptions, depth: number): string {
  const indent = '  '.repeat(depth);
  const items = (node.content ?? []).filter((n) => n.type === 'listItem');
  return items.map((item) => {
    const parts: string[] = [];
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph') parts.push(serializeInline(child.content, opts));
      else if (child.type === 'bulletList') parts.push('\n' + serializeList(child, '-', opts, depth + 1));
      else if (child.type === 'orderedList') parts.push('\n' + serializeList(child, '+', opts, depth + 1));
      else parts.push(serializeBlock(child, opts, depth + 1));
    }
    return `${indent}${marker} ${parts.join('\n' + indent + '  ')}`;
  }).join('\n');
}

export function serializeBlock(n: PMNode, opts: SerializeOptions, depth = 0): string {
  switch (n.type) {
    case 'paragraph': {
      const s = serializeInline(n.content, opts);
      return escapeLineStart(s);
    }
    case 'heading': {
      if (opts.headings === false) {
        // 不许出标题的页里，退成加粗段落
        return `#strong[${serializeInline(n.content, opts)}]`;
      }
      const level = Math.max(1, Math.min(4, (n.attrs?.level ?? 1) + ((opts.headingBase ?? 1) - 1)));
      const zh = serializeInline(n.content, opts).trim();
      const en = escapeText(String(n.attrs?.en ?? '').trim());
      const label = labelOf(n.attrs, 'sec');
      return `${'='.repeat(level)} ${zh}${en ? `#en[${en}]` : ''}${label ? ` <${label}>` : ''}`;
    }
    case 'figure': {
      const img = String(n.attrs?.image ?? '');
      if (!img) return '';
      const width = Number(n.attrs?.width) || 8;
      const label = labelOf(n.attrs, 'fig');
      return `#figure(\n  image(${JSON.stringify(`${opts.imageDir ?? 'images'}/${img}`)}, width: ${width}cm),\n  caption: [${caption(n.attrs)}],\n)${label ? ` <${label}>` : ''}`;
    }
    case 'tableFigure': {
      const table = (n.content ?? []).find((c) => c.type === 'table');
      if (!table) return '';
      const label = labelOf(n.attrs, 'tab');
      return `#figure(\n  caption: [${caption(n.attrs)}],\n  ${serializeTable(table)},\n)${label ? ` <${label}>` : ''}`;
    }
    case 'equation': {
      const src = String(n.attrs?.src ?? '').trim();
      if (!src) return '';
      const label = n.attrs?.numbered === false ? '' : labelOf(n.attrs, 'eq');
      const body = n.attrs?.mode === 'latex' ? `#mitex(${backtick(src)})` : `$ ${src} $`;
      return `${body}${label ? ` <${label}>` : ''}`;
    }
    case 'codeBlock': {
      const lang = String(n.attrs?.language ?? '').trim();
      const text = (n.content ?? []).map((t) => t.text ?? '').join('');
      let fence = '```';
      while (text.includes(fence)) fence += '`';
      return `${fence}${lang}\n${text}\n${fence}`;
    }
    case 'blockquote':
      return `#quote(block: true)[\n${serializeBlocks(n.content, opts, depth + 1)}\n]`;
    case 'bulletList': return serializeList(n, '-', opts, depth);
    case 'orderedList': return serializeList(n, '+', opts, depth);
    case 'pageBreak': return '#pagebreak()';
    case 'horizontalRule': return '#line(length: 100%)';
    case 'enter': return `#enter(${n.attrs?.n ?? 1})`;
    default:
      return n.content ? serializeBlocks(n.content, opts, depth) : '';
  }
}

export function serializeBlocks(nodes: PMNode[] = [], opts: SerializeOptions = {}, depth = 0): string {
  return nodes.map((n) => serializeBlock(n, opts, depth)).filter((s) => s.trim().length > 0).join('\n\n');
}

export function serializeDoc(doc: PMNode | undefined | null, opts: SerializeOptions = {}): string {
  if (!doc) return '';
  return serializeBlocks(doc.content, opts);
}

/** 文档里所有能被引用的东西：图、表、公式、标题（带 uid 的） */
export interface RefTarget {
  label: string;
  kind: 'fig' | 'tab' | 'eq' | 'sec';
  title: string;
  index: number;
}

export function collectRefTargets(doc: PMNode | undefined | null): RefTarget[] {
  const out: RefTarget[] = [];
  const counters = { fig: 0, tab: 0, eq: 0, sec: 0 };
  const walk = (n: PMNode) => {
    let kind: RefTarget['kind'] | null = null;
    let title = '';
    if (n.type === 'figure') { kind = 'fig'; title = n.attrs?.caption ?? ''; }
    else if (n.type === 'tableFigure') { kind = 'tab'; title = n.attrs?.caption ?? ''; }
    else if (n.type === 'equation' && n.attrs?.numbered !== false) { kind = 'eq'; title = n.attrs?.src ?? ''; }
    else if (n.type === 'heading') { kind = 'sec'; title = (n.content ?? []).map((t) => t.text ?? '').join(''); }
    if (kind) {
      const label = labelOf(n.attrs, kind);
      if (label) { counters[kind]++; out.push({ label, kind, title, index: counters[kind] }); }
    }
    for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc);
  return out;
}

/** 文档里用到的图片名 */
export function collectImages(doc: PMNode | undefined | null): string[] {
  const out = new Set<string>();
  const walk = (n: PMNode) => {
    if (n.type === 'figure' && n.attrs?.image) out.add(String(n.attrs.image));
    for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc);
  return [...out];
}
