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
//   eqdenote                #eqdenote[/ $x$: 说明]
// 纯文本里 Typst 的特殊字符一律转义，行首会被当成标记的字符再多转义一次。
// 带 map 选项时，文本与节点外面套上源码映射的记号（见 sourcemap.ts），预览区直接编辑靠它。
import { mark, unmarked } from './sourcemap';
import { lengthTypst } from '../model/length';

/** 分图 / 伪代码的属性都是 JSON 串（与 eqdenote 的 rows 同一套路） */
function parseJsonArr<T>(v: unknown): T[] { if (Array.isArray(v)) return v as T[]; if (typeof v !== 'string' || !v) return []; try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } }
const parseSubs = (v: unknown) => parseJsonArr<{ image: string; width: string | number; caption: string }>(v);
const parseIo = (v: unknown) => parseJsonArr<string>(v);
const parseLines = (v: unknown) => parseJsonArr<{ text: string; level: number }>(v);
import type { RichKey } from '../model/store';

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
  /** 全工程里存在的标签；引用了不存在的（比如公式取消了编号）就印红色 ??，别让整篇编译失败 */
  knownLabels?: Set<string>;
  /** 打源码映射记号：这份富文本的 key，以及每个节点的 ProseMirror 位置 */
  map?: { key: RichKey; posOf: WeakMap<PMNode, number> };
  /**
   * 站内预览用：空回车段排成 #blanks[¶][¶]（每个空段一个隐形的 ¶，点击才有落点；main.typ 开头定义，
   * 只在 sys.inputs.preview 下真的排字，落到 PDF 里仍是 #enter(n)），段落结尾另打零长记号，预览画 ¶ 用
   */
  preview?: boolean;
}

// ── ProseMirror 位置 ──────────────────────────────────────────────
// 文本节点占字数，容器节点占 2 + 内容，其余（原子）占 1。
const CONTAINERS = new Set(['doc', 'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'tableFigure', 'table', 'tableRow', 'tableCell', 'tableHeader']);
const sizeCache = new WeakMap<PMNode, number>();
export function nodeSize(n: PMNode): number {
  if (n.type === 'text') return (n.text ?? '').length;
  if (!CONTAINERS.has(n.type)) return 1;
  const hit = sizeCache.get(n);
  if (hit !== undefined) return hit;
  let s = 2;
  for (const c of n.content ?? []) s += nodeSize(c);
  sizeCache.set(n, s);
  return s;
}

/** 每个节点在文档里的位置（文本：第一个字；其余：节点前） */
export function indexPositions(doc: PMNode): WeakMap<PMNode, number> {
  const posOf = new WeakMap<PMNode, number>();
  const walk = (n: PMNode, contentStart: number) => {
    let p = contentStart;
    for (const c of n.content ?? []) {
      posOf.set(c, p);
      if (CONTAINERS.has(c.type)) walk(c, p + 1);
      p += nodeSize(c);
    }
  };
  walk(doc, 0);
  return posOf;
}

/** 给节点套记号（没开映射就原样） */
function tag(opts: SerializeOptions, n: PMNode, kind: 'node' | 'attr', inner: string, extra: { attr?: string; raw?: string } = {}): string {
  const pos = opts.map?.posOf.get(n);
  if (pos === undefined || !opts.map) return inner;
  return mark(kind, opts.map.key, pos, pos + nodeSize(n), inner, extra);
}


// ── 文本转义 ────────────────────────────────────────────────────

/** 行内任何位置都要转义的字符。斜线也转（// 与 /* 会开注释），一个字对一个转义，映射好算 */
const INLINE_SPECIAL = /[\\*_`#$@<>\[\]~/]/g;

export function escapeText(s: string): string {
  return s.replace(INLINE_SPECIAL, (c) => '\\' + c);
}

/** 一段开头如果长得像列表、标题、词条，补一个反斜杠（跳过映射记号看内容） */
export function escapeLineStart(s: string): string {
  // 转义之后 * _ / 已经带反斜杠了，这里只管没转义的：= - + 与「1.」
  if (/^\s*(=|-|\+|\d+\.)(\s|$)/.test(unmarked(s))) return s.replace(/^((?:\s|\uE000[^\uE001]*\uE001)*)/, '$1\\');
  return s;
}

// ── 行内 ────────────────────────────────────────────────────────

function wrapMarks(text: string, marks: PMNode['marks'] = [], rawText?: string): string {
  let out = text;
  for (const m of marks) {
    switch (m.type) {
      case 'bold': out = `#strong[${out}]`; break;
      case 'italic': out = `#emph[${out}]`; break;
      case 'underline': out = `#underline[${out}]`; break;
      case 'strike': out = `#strike[${out}]`; break;
      case 'code': out = `#raw(${rawText ?? JSON.stringify(rawOf(text))})`; break;
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
        const raw = n.text ?? '';
        const escaped = escapeText(raw);
        const pos = opts.map?.posOf.get(n);
        const isCode = n.marks?.some((m) => m.type === 'code');
        if (pos !== undefined && opts.map) {
          // 等宽代码走 #raw("…")：记号套在引号里面，字形偏移就是从引号后数的
          const rawArg = isCode ? `"${mark('text', opts.map.key, pos, pos + raw.length, JSON.stringify(raw).slice(1, -1), { raw })}"` : undefined;
          out += wrapMarks(mark('text', opts.map.key, pos, pos + raw.length, escaped, { raw }), n.marks, rawArg);
        } else {
          out += wrapMarks(escaped, n.marks);
        }
        break;
      }
      case 'hardBreak': out += ' \\\n'; break;
      case 'mathInline': out += tag(opts, n, 'node', mathInline(n.attrs)); break;
      case 'cite': {
        const keys = String(n.attrs?.keys ?? '').split(/[,，;；\s]+/).filter(Boolean);
        // 写成函数调用而不是 @key：Typst 0.15 的 @ 引用会把紧跟的汉字也吞进 label
        out += tag(opts, n, 'node', keys.map((k) => `#cite(<${k}>)`).join(''));
        break;
      }
      case 'ref': {
        const t = n.attrs?.target;
        if (!t) break;
        out += tag(opts, n, 'node', opts.knownLabels && !opts.knownLabels.has(t) ? '#text(red)[??]' : `#ref(<${t}>)`);
        break;
      }
      case 'abbr': out += n.attrs?.key ? tag(opts, n, 'node', `#ref(<${n.attrs.key}>)`) : ''; break;
      case 'footnote': {
        const text = String(n.attrs?.text ?? '');
        out += `#footnote[${tag(opts, n, 'attr', escapeText(text), { attr: 'text', raw: text })}]`;
        break;
      }
      case 'ccwd': out += tag(opts, n, 'node', `#ccwd(${n.attrs?.n ?? 1})`); break;
      case 'idx': out += n.attrs?.text ? tag(opts, n, 'node', `#idx[${escapeText(String(n.attrs.text))}]`) : ''; break;
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

function caption(n: PMNode, opts: SerializeOptions): string {
  const attrs = n.attrs ?? {};
  const zhRaw = String(attrs.caption ?? '').trim();
  const enRaw = String(attrs.captionEn ?? '').trim();
  const zh = tag(opts, n, 'attr', escapeText(zhRaw), { attr: 'caption', raw: zhRaw });
  const en = tag(opts, n, 'attr', escapeText(enRaw), { attr: 'captionEn', raw: enRaw });
  return enRaw ? `${zh}#en[${en}]` : zh;
}

function serializeTable(table: PMNode, opts: SerializeOptions, fit: string = 'content', colWidth: unknown = 2.5): string {
  const rows = (table.content ?? []).filter((r) => r.type === 'tableRow');
  if (!rows.length) return '';
  // 列数按第一行的 colspan 之和算
  const ncols = (rows[0].content ?? []).reduce((s, c) => s + (c.attrs?.colspan ?? 1), 0);
  // 列宽：拖过列线的表在单元格 colwidth（像素）里；取每列出现过的最大值，折成 fr 比例
  const widths: (number | null)[] = new Array(ncols).fill(null);
  for (const r of rows) {
    let col = 0;
    for (const c of r.content ?? []) {
      const span = c.attrs?.colspan ?? 1;
      const cw: (number | null)[] = Array.isArray(c.attrs?.colwidth) ? c.attrs.colwidth : [];
      for (let i = 0; i < span && col + i < ncols; i++) if (cw[i]) widths[col + i] = Math.max(widths[col + i] ?? 0, cw[i]!);
      col += span;
    }
  }
  // 没拖过列线时按「自动调整」：根据内容 = auto 列；根据窗口 = 每列 1fr 撑满版心；固定列宽 = 每列 X cm
  let columns = fit === 'window' ? `(${Array(ncols).fill('1fr').join(', ')})` : fit === 'fixed' ? `(${Array(ncols).fill(lengthTypst(colWidth, 'cm', '2.5cm', ['cm', 'mm', 'in', 'pt', 'em', '%', 'fr'])).join(', ')})` : String(ncols);
  if (widths.some((w) => w)) {
    if (widths.every((w) => w)) {
      // 全部拖过 / 设过：按比例分，总宽由模板的版心定
      const min = Math.min(...(widths as number[]));
      columns = `(${widths.map((w) => `${(w! / min).toFixed(2)}fr`).join(', ')})`;
    } else {
      // 只设了几列：设了的按厘米，其余自动
      columns = `(${widths.map((w) => (w ? `${(w / 37.8).toFixed(2)}cm` : 'auto')).join(', ')})`;
    }
  }
  const rowHeights = rows.map((r) => (r.attrs?.height ? lengthTypst(r.attrs.height, 'cm', 'auto') : 'auto'));
  const rowsArg = rowHeights.some((h) => h !== 'auto') ? `\n    rows: (${rowHeights.join(', ')}),` : '';
  const cell = (c: PMNode): string => {
    const body = (c.content ?? []).map((p) => serializeInline(p.content, opts)).join(' \\ ');
    const colspan = c.attrs?.colspan ?? 1;
    const rowspan = c.attrs?.rowspan ?? 1;
    const align = [c.attrs?.align, c.attrs?.valign].filter(Boolean).join(' + ');
    const args = [colspan > 1 ? `colspan: ${colspan}` : '', rowspan > 1 ? `rowspan: ${rowspan}` : '', align ? `align: ${align}` : ''].filter(Boolean).join(', ');
    return args ? `table.cell(${args})[${body}]` : `[${body}]`;
  };
  const lines: string[] = [];
  const headerRows: PMNode[] = [];
  let i = 0;
  while (i < rows.length && (rows[i].content ?? []).every((c) => c.type === 'tableHeader')) { headerRows.push(rows[i]); i++; }
  if (headerRows.length) {
    lines.push(`    table.header(${headerRows.map((r) => (r.content ?? []).map(cell).join(', ')).join(',\n      ')}),`);
  }
  for (; i < rows.length; i++) lines.push(`    ${(rows[i].content ?? []).map(cell).join(', ')},`);
  return `table(\n    columns: ${columns},${rowsArg}\n    align: center + horizon,\n${lines.join('\n')}\n  )`;
}

function serializeList(node: PMNode, marker: '-' | '+', opts: SerializeOptions, depth: number): string {
  const indent = '  '.repeat(depth);
  const items = (node.content ?? []).filter((n) => n.type === 'listItem');
  return items.map((item) => {
    const parts: string[] = [];
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph') parts.push(serializeInline(child.content, opts) + paraEnd(opts, child));
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
      const s = escapeLineStart(serializeInline(n.content, opts));
      // 不缩进的续段：模板全篇 first-line-indent 两字，这一段单独归零
      if (n.attrs?.noIndent && s.trim()) return `#par(first-line-indent: 0pt)[${s}]` + paraEnd(opts, n);
      return s + paraEnd(opts, n);
    }
    case 'heading': {
      if (opts.headings === false) {
        // 不许出标题的页里，退成加粗段落
        return `#strong[${serializeInline(n.content, opts)}]` + paraEnd(opts, n);
      }
      const level = Math.max(1, Math.min(4, (n.attrs?.level ?? 1) + ((opts.headingBase ?? 1) - 1)));
      const zh = serializeInline(n.content, opts).trim();
      const enRaw = String(n.attrs?.en ?? '').trim();
      const en = enRaw ? `#en[${tag(opts, n, 'attr', escapeText(enRaw), { attr: 'en', raw: enRaw })}]` : '';
      const label = labelOf(n.attrs, 'sec');
      // 带参数的标题走模板的函数式写法 #chapter(numbering: none, openright: true, spread: false)[…]
      // （section / subsection / subsubsection 同形，只收 numbering）；什么都不改就是 = 标题
      const fnArgs: string[] = [];
      if (n.attrs?.numbered === false) fnArgs.push('numbering: none');
      if (level === 1) {
        for (const k of ['openright', 'spread'] as const) {
          const v = n.attrs?.[k];
          if (v === 'true' || v === 'false' || v === true || v === false) fnArgs.push(`${k}: ${v}`);
        }
      }
      if (fnArgs.length) return `#${['chapter', 'section', 'subsection', 'subsubsection'][level - 1]}(${fnArgs.join(', ')})[${zh}${en}]${label ? ` <${label}>` : ''}` + paraEnd(opts, n);
      return `${'='.repeat(level)} ${zh}${en}${label ? ` <${label}>` : ''}` + paraEnd(opts, n);
    }
    case 'figure': {
      const subs = parseSubs(n.attrs?.subs);
      const label = labelOf(n.attrs, 'fig');
      if (subs.length) {
        // 分图：grid 里一张张排，分图题两档（模板：#subfigure 排在分图之下，#subs 连排在图题之下）
        const cols = Math.max(1, Math.min(4, Number(n.attrs?.columns) || 2));
        const under = n.attrs?.subMode !== 'caption';
        const letter = (i: number) => 'abcdefghijklmnopqrstuvwxyz'[i] ?? String(i + 1);
        const subLabel = (i: number) => (label ? ` <${label}-${letter(i)}>` : '');
        const img = (s: { image: string; width: string | number }) => `image(${JSON.stringify(`${opts.imageDir ?? 'images'}/${s.image}`)}, width: ${lengthTypst(s.width, 'cm', '6cm')})`;
        const cells = subs.filter((s) => s.image).map((s, i) => (under ? `    [#subfigure(${img(s)}, caption: [${escapeText(s.caption ?? '')}])${subLabel(i)}],` : `    ${img(s)},`));
        const subsArg = under ? '' : `#subs(${subs.map((s, i) => `[${escapeText(s.caption ?? '')}${subLabel(i)}]`).join(', ')},)`;
        const body = `#figure(\n  grid(\n    columns: ${cols}, column-gutter: 1cm, row-gutter: 12pt,\n${cells.join('\n')}\n  ),\n  caption: [${caption(n, opts)}${subsArg}],${placementArg(n)}\n)`;
        return floatWrap(n, 'image', tag(opts, n, 'node', body) + (label ? ` <${label}>` : ''));
      }
      const img = String(n.attrs?.image ?? '');
      if (!img) return '';
      const width = lengthTypst(n.attrs?.width ?? 8, 'cm', '8cm');
      return floatWrap(n, 'image', tag(opts, n, 'node', `#figure(\n  image(${JSON.stringify(`${opts.imageDir ?? 'images'}/${img}`)}, width: ${width}),\n  caption: [${caption(n, opts)}],${placementArg(n)}\n)`) + (label ? ` <${label}>` : ''));
    }
    case 'tableFigure': {
      const table = (n.content ?? []).find((c) => c.type === 'table');
      if (!table) return '';
      const label = labelOf(n.attrs, 'tab');
      return floatWrap(n, 'table', tag(opts, n, 'node', `#figure(\n  caption: [${caption(n, opts)}],${placementArg(n)}\n  ${serializeTable(table, opts, String(n.attrs?.fit ?? 'content'), n.attrs?.colWidth ?? 2.5)},\n)`) + (label ? ` <${label}>` : ''));
    }
    case 'equation': {
      const src = String(n.attrs?.src ?? '').trim();
      if (!src) return '';
      const unnumbered = n.attrs?.numbered === false;
      const label = unnumbered ? '' : labelOf(n.attrs, 'eq');
      const body = n.attrs?.mode === 'latex' ? `#mitex(${backtick(src)})` : `$ ${src} $`;
      // 不编号：模板给所有块公式编号，要在局部把 numbering 关掉
      if (unnumbered) return tag(opts, n, 'node', `#[#set math.equation(numbering: none)\n${body}]`);
      return tag(opts, n, 'node', body) + (label ? ` <${label}>` : '');
    }
    case 'eqdenote': {
      // 公式底下的「式中　x——…」：模板收原生 terms 语法，一行一个 / 符号: 说明
      const rows = parseDenoteRows(n.attrs?.rows);
      if (!rows.length) return '';
      const term = (sym: string, mode: string) => sym.split(/[、,，]/).map((x) => x.trim()).filter(Boolean).map((x) => (mode === 'latex' ? `#mi(${backtick(x)})` : `$${x}$`)).join('、');
      const lines = rows.map((r, i) => {
        const meaning = r.meaning.trim();
        const body = opts.map ? mark('attr', opts.map.key, opts.map.posOf.get(n) ?? 0, (opts.map.posOf.get(n) ?? 0) + 1, escapeText(meaning), { attr: `rows.${i}.meaning`, raw: meaning }) : escapeText(meaning);
        return `  / ${term(r.symbol, r.mode)}: ${body}`;
      });
      const lead = n.attrs?.lead === 'none' ? 'lead: none' : n.attrs?.lead && n.attrs.lead !== 'auto' ? `lead: [${escapeText(String(n.attrs.lead))}]` : '';
      return tag(opts, n, 'node', `#eqdenote(${lead})[\n${lines.join('\n')}\n]`);
    }
    case 'codeBlock': {
      const lang = String(n.attrs?.language ?? '').trim();
      const text = (n.content ?? []).map((t) => t.text ?? '').join('');
      let fence = '```';
      while (text.includes(fence)) fence += '`';
      return `${fence}${lang}\n${text}\n${fence}`;
    }
    case 'codeFigure': {
      // 代码清单：进了 figure 的代码块，模板按 raw-style 排框与行号、题注「代码 1-1」
      const code = (n.content ?? []).find((c) => c.type === 'codeBlock');
      if (!code) return '';
      const label = labelOf(n.attrs, 'lst');
      return tag(opts, n, 'node', `#figure(\n${serializeBlock(code, opts, depth)},\n  caption: [${caption(n, opts)}],\n)`) + (label ? ` <${label}>` : '');
    }
    case 'algorithm': {
      // 伪代码：模板的 lovelace 那一路——`-` 不编号（输入输出），`+` 编号，嵌套就是缩进；行里是 Typst 标记
      const io = parseIo(n.attrs?.io).map((t) => `  - ${t.trim()}`);
      const lines = parseLines(n.attrs?.lines).filter((l) => l.text.trim()).map((l) => `  ${'  '.repeat(Math.max(0, l.level))}+ ${l.text.trim()}`);
      if (!lines.length) return '';
      const label = labelOf(n.attrs, 'alg');
      return tag(opts, n, 'node', `#figure(lovelace[\n${[...io, ...lines].join('\n')}\n], caption: [${caption(n, opts)}])`) + (label ? ` <${label}>` : '');
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

/** 图 / 表的浮动：Typst 的 figure(placement: auto / top / bottom)，模板原样放行（浮动块不拆页） */
const placementOf = (n: PMNode): string | null => { const p = String(n.attrs?.placement ?? ''); return ['auto', 'top', 'bottom'].includes(p) ? p : null; };
const placementArg = (n: PMNode): string => { const p = placementOf(n); return p ? `\n  placement: ${p},` : ''; };
/**
 * 跨页：模板的口子是 show figure.where(kind: …): set block(breakable:)（图默认不拆、表默认可拆；
 * 图拆了按指南排「续图」），单张要改就在局部套一层。浮动的没有跨页可言，不发
 */
function floatWrap(n: PMNode, kind: 'image' | 'table', body: string): string {
  const br = String(n.attrs?.breakable ?? 'auto');
  if ((br !== 'true' && br !== 'false') || placementOf(n)) return body;
  return `#[\n#show figure.where(kind: ${kind}): set block(breakable: ${br})\n${body}\n]`;
}

export interface DenoteRow { symbol: string; mode: 'typst' | 'latex'; meaning: string }
/** eqdenote 的行存在属性里（JSON 串），坏了就当空 */
export function parseDenoteRows(v: unknown): DenoteRow[] {
  if (Array.isArray(v)) return v as DenoteRow[];
  if (typeof v !== 'string' || !v) return [];
  try { const arr = JSON.parse(v); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

const isEmptyParagraph = (n: PMNode) => n.type === 'paragraph' && !(n.content ?? []).some((c) => c.type !== 'text' || (c.text ?? '').trim() !== '');

/** 段落结尾的零长记号（预览画 ¶ 用）：位置是段内最后一个位置 */
function paraEnd(opts: SerializeOptions, n: PMNode): string {
  const pos = opts.map?.posOf.get(n);
  if (!opts.preview || !opts.map || pos === undefined) return '';
  const end = pos + nodeSize(n) - 1;
  return mark('para', opts.map.key, end, end, '');
}

/** 一串空回车段：正式排 #enter(n)；预览排 #blanks[¶]…，每个 ¶ 映射到那个空段里面的位置 */
function blankRun(opts: SerializeOptions, blanks: PMNode[]): string {
  if (opts.preview && opts.map) {
    const key = opts.map.key;
    const marks = blanks.map((b) => { const p = opts.map!.posOf.get(b); return p === undefined ? '[¶]' : `[${mark('text', key, p + 1, p + 1, '¶', { attr: 'blank', raw: '' })}]`; });
    return `#blanks${marks.join('')}`;
  }
  return `#enter(${blanks.length})`;
}

export function serializeBlocks(nodes: PMNode[] = [], opts: SerializeOptions = {}, depth = 0): string {
  // 连着的空段落 = 用户敲的空回车，合成模板的 #enter(n)（真占一行的空段，Word 的写法）
  // 首尾的空段落是编辑器自带的（空文档、末尾那个光标位），不算；夹在内容中间的才算
  const out: string[] = [];
  let blanks: PMNode[] = [];
  for (const n of nodes) {
    if (isEmptyParagraph(n)) { if (out.length) blanks.push(n); continue; }
    const s = serializeBlock(n, opts, depth);
    if (!unmarked(s).trim()) continue;
    if (blanks.length) { out.push(blankRun(opts, blanks)); blanks = []; }
    out.push(s);
  }
  return out.join('\n\n');
}

export function serializeDoc(doc: PMNode | undefined | null, opts: SerializeOptions = {}): string {
  if (!doc) return '';
  return serializeBlocks(doc.content, opts);
}

/** 文档里所有能被引用的东西：图、表、公式、标题（带 uid 的） */
export interface RefTarget {
  label: string;
  kind: 'fig' | 'tab' | 'eq' | 'sec' | 'alg' | 'lst';
  title: string;
  index: number;
}

export function collectRefTargets(doc: PMNode | undefined | null): RefTarget[] {
  const out: RefTarget[] = [];
  const counters = { fig: 0, tab: 0, eq: 0, sec: 0, alg: 0, lst: 0 };
  const walk = (n: PMNode) => {
    let kind: RefTarget['kind'] | null = null;
    let title = '';
    if (n.type === 'figure') { kind = 'fig'; title = n.attrs?.caption ?? ''; }
    else if (n.type === 'tableFigure') { kind = 'tab'; title = n.attrs?.caption ?? ''; }
    else if (n.type === 'equation' && n.attrs?.numbered !== false) { kind = 'eq'; title = n.attrs?.src ?? ''; }
    else if (n.type === 'heading') { kind = 'sec'; title = (n.content ?? []).map((t) => t.text ?? '').join(''); }
    else if (n.type === 'algorithm') { kind = 'alg'; title = n.attrs?.caption ?? ''; }
    else if (n.type === 'codeFigure') { kind = 'lst'; title = n.attrs?.caption ?? ''; }
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
    if (n.type === 'figure') { const subs = parseSubs(n.attrs?.subs); if (subs.length) subs.forEach((s) => { if (s.image) out.add(String(s.image)); }); else if (n.attrs?.image) out.add(String(n.attrs.image)); }
    for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc);
  return [...out];
}
