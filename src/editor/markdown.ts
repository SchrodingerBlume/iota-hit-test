// 富文本 ↔ Markdown，编辑器里每一种节点都有一种写得出、读得回的写法（源码模式与 Agent 都靠它）。
// 写法尽量取 Pandoc / GFM 里现成的：标题属性 {#sec:x .unnumbered en="…"}、图 ![题](图){#fig:x width=8cm}、
// 表下一行 Table: 题注 {#tab:x}、公式 $$…$$ {#eq:x}、围栏块 ::: {.theorem #thm:x} … :::、行内 @key / [@key] / ^[脚注]、
// 标记用 HTML 标签 <u> <sub> <sup> <mark> <span color= font= size=>。旧的 ```iota-node、<!--iota-attrs:…-->、
// <!--iota-inline:…--> 照旧能读
import { marked, type Token, type Tokens } from 'marked';
import type { RichDoc } from '../model/types';
import { t as tx } from '../i18n';

type Node = NonNullable<RichDoc['content']>[number];
type Attrs = Record<string, unknown>;
const decode = (value: string) => JSON.parse(value.trim().startsWith('{') || value.trim().startsWith('[') ? value : decodeURIComponent(value));
const textNode = (text: string): Node[] => (text ? [{ type: 'text', text }] : []);
const esc = (s: string) => s.replace(/[\\`*_[\]<>~|$@^]/g, '\\$&').replace(/^(\s*)([#>+-])(?=\s)/gm, '$1\\$2').replace(/^(\s*)(\d+)([.)])(?=\s)/gm, '$1$2\\$3');
const fence = (text: string) => '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)));
const opaque = (node: Node) => { const json = JSON.stringify(node, null, 2); const f = fence(json); return `${f}iota-node\n${json}\n${f}`; };
const parseJsonList = (v: unknown): any[] => { if (Array.isArray(v)) return v; if (typeof v !== 'string' || !v) return []; try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } };
const plain = (n: Node): string => (n.text ?? '') + (n.content ?? []).map(plain).join('');

// ── 属性串 {#id .class key="value" key=value} ─────────────────────────────────
function fmtAttrs(a: Record<string, unknown>, opts: { id?: string; classes?: string[] } = {}): string {
  const parts: string[] = [];
  if (opts.id) parts.push(`#${opts.id}`);
  for (const c of opts.classes ?? []) parts.push(`.${c}`);
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null || v === '') continue;
    const s = String(v);
    parts.push(/^[\w.:-]+$/.test(s) ? `${k}=${s}` : `${k}="${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
  }
  return parts.length ? `{${parts.join(' ')}}` : '';
}
function parseAttrs(src: string): { id?: string; classes: string[]; attrs: Record<string, string> } {
  const out = { id: undefined as string | undefined, classes: [] as string[], attrs: {} as Record<string, string> };
  const re = /#([\w:.-]+)|\.([\w-]+)|([\w-]+)=("((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) out.id = m[1];
    else if (m[2]) out.classes.push(m[2]);
    else if (m[3]) out.attrs[m[3]] = (m[5] ?? m[6] ?? m[7] ?? '').replace(/\\n/g, '\n').replace(/\\(["'\\])/g, '$1');
  }
  return out;
}
/** 尾巴上的 {…}：给标题、公式、表题、代码围栏信息串用 */
function splitTrailing(s: string): { text: string; attrs: string | null } {
  const m = /\s*\{([^{}\n]*)\}\s*$/.exec(s);
  return m ? { text: s.slice(0, m.index), attrs: m[1] } : { text: s, attrs: null };
}
const num = (v: string | undefined) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const len = (v: string | undefined) => (v === undefined ? undefined : /^[\d.]+(cm)?$/.test(v) ? Number(v.replace('cm', '')) : v);

// ── 行内 ──────────────────────────────────────────────────────────────────────
const TAG_MARKS: Record<string, string> = { u: 'underline', sub: 'subscript', sup: 'superscript', mark: 'highlight' };
function markTag(mark: any): [string, string] {
  switch (mark.type) {
    case 'underline': return ['<u>', '</u>'];
    case 'subscript': return ['<sub>', '</sub>'];
    case 'superscript': return ['<sup>', '</sup>'];
    case 'highlight': return [`<mark${mark.attrs?.color && mark.attrs.color !== '#ffff00' ? ` color="${mark.attrs.color}"` : ''}>`, '</mark>'];
    case 'textColor': return [`<span color="${mark.attrs?.color ?? '#ff0000'}">`, '</span>'];
    case 'fontFamily': return [`<span font="${mark.attrs?.role ?? 'songti'}">`, '</span>'];
    case 'fontSize': return [`<span size="${mark.attrs?.size ?? 'xiaosi'}">`, '</span>'];
    default: return ['', ''];
  }
}
const ORDER = ['link', 'fontFamily', 'fontSize', 'textColor', 'highlight', 'underline', 'subscript', 'superscript', 'bold', 'italic', 'strike', 'code'];
function inline(nodes: Node[] = []): string {
  return nodes.map((n) => {
    switch (n.type) {
      case 'hardBreak': return '  \n';
      case 'mathInline': { const src = String(n.attrs?.src ?? '').trim(); return n.attrs?.mode === 'typst' ? `$typst: ${src}$` : `$${src}$`; }
      case 'cite': {
        // [@a; @b, p. 15]（pandoc 的补充信息写在最后一个键后面）；叙述式 / 只印作者 / 只印年份是 {.prose} {.author} {.year}
        const keys = String(n.attrs?.keys ?? '').split(/[,，;；\s]+/).filter(Boolean).map((k) => `@${k}`).join('; ');
        const sup = String(n.attrs?.supplement ?? '').trim();
        const form = String(n.attrs?.form ?? 'auto');
        return `[${keys}${sup ? `, ${sup}` : ''}]${form !== 'auto' ? `{.${form}}` : ''}`;
      }
      case 'ref': return `@${n.attrs?.target ?? ''}`;
      case 'abbr': return `@${n.attrs?.key ?? ''}`;
      case 'footnote': return `^[${String(n.attrs?.text ?? '')}]`;
      case 'idx': return `[${esc(String(n.attrs?.text ?? ''))}]{.index}`;
      case 'ccwd': return Number(n.attrs?.n ?? 1) === 1 ? '<ccwd/>' : `<ccwd n="${Number(n.attrs?.n)}"/>`;
      case 'text': break;
      default: return `<!--iota-inline:${JSON.stringify(n).replace(/--/g, '-\\u002d')}-->`;
    }
    const marks = [...(n.marks ?? [])].filter((m: any) => m.type !== 'comment').sort((a: any, b: any) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
    let value = esc(n.text ?? '');
    // 里层先包：code 最里，link 最外
    for (const mark of [...marks].reverse() as any[]) {
      if (mark.type === 'code') { const f = '`'.repeat(Math.max(1, ...Array.from((n.text ?? '').matchAll(/`+/g), (m: any) => m[0].length + 1))); value = `${f} ${n.text} ${f}`; }
      else if (mark.type === 'bold') value = `**${value}**`;
      else if (mark.type === 'italic') value = `*${value}*`;
      else if (mark.type === 'strike') value = `~~${value}~~`;
      else if (mark.type === 'link') value = `[${value}](<${String(mark.attrs?.href ?? '').replace(/>/g, '%3E')}>${mark.attrs?.title ? ` "${String(mark.attrs.title).replace(/"/g, '&quot;')}"` : ''})`;
      else { const [o, c] = markTag(mark); value = o + value + c; }
    }
    return value;
  }).join('');
}

// ── 块 → Markdown ─────────────────────────────────────────────────────────────
const captionAttrs = (a: Attrs | undefined, extra: Record<string, unknown> = {}) => fmtAttrs({ en: a?.captionEn, ...extra, placement: a?.placement && a.placement !== 'none' ? a.placement : undefined, breakable: a?.breakable && a.breakable !== 'auto' ? a.breakable : undefined }, { id: a?.label ? String(a.label) : undefined });
const div = (attrs: string, body: string) => `::: ${attrs}\n${body}\n:::`;
function tableMd(table: Node | undefined): string {
  const rows = table?.content ?? [];
  const cell = (c: Node) => (c.content ?? []).map((p: Node) => inline(p.content)).join('<br>').replace(/\s*\n/g, '<br>');
  const width = Math.max(1, ...rows.map((r: Node) => (r.content ?? []).length));
  const line = (r: Node) => `| ${Array.from({ length: width }, (_, i) => (r.content?.[i] ? cell(r.content[i]) : '')).join(' | ')} |`;
  const aligns = Array.from({ length: width }, (_, i) => rows[0]?.content?.[i]?.attrs?.align);
  const sep = `| ${aligns.map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---')).join(' | ')} |`;
  const first = rows[0];
  const headed = first?.content?.every((c: Node) => c.type === 'tableHeader');
  return headed ? [line(first!), sep, ...rows.slice(1).map(line)].join('\n') : [`| ${Array(width).fill('').join(' | ')} |`, sep, ...rows.map(line)].join('\n');
}
function block(n: Node): string {
  const a = n.attrs ?? {};
  switch (n.type) {
    case 'paragraph': { const body = n.content?.length ? inline(n.content) : '&nbsp;'; return a.noIndent ? `${body} {.noindent}` : body; }
    case 'heading': {
      const attrs = fmtAttrs({ en: a.en, openright: a.openright && a.openright !== 'auto' ? a.openright : undefined, spread: a.spread && a.spread !== 'auto' ? a.spread : undefined }, { id: a.label ? String(a.label) : undefined, classes: a.numbered === false ? ['unnumbered'] : [] });
      return `${'#'.repeat(Number(a.level ?? 1))} ${inline(n.content)}${attrs ? ` ${attrs}` : ''}`;
    }
    case 'figure': {
      const subs = parseJsonList(a.subs);
      if (subs.length) {
        // 每张分图：宽 / 高钉死、排法（place=row/below/beside）、单张的图上标签（mark / markFill）、自定义标签（#id）
        const inner = subs.map((s: any) => `![${esc(String(s.caption ?? ''))}](${s.image ?? ''})${fmtAttrs({ width: s.width === '' || s.width === 'auto' ? undefined : s.width, height: s.height && s.height !== 'auto' ? s.height : undefined, en: s.captionEn, place: s.place && s.place !== 'next' ? s.place : undefined, mark: s.mark && s.mark !== 'auto' ? s.mark : undefined, markFill: s.markFill && s.markFill !== 'auto' ? s.markFill : undefined }, { id: s.label ? String(s.label) : undefined })}`).join('\n\n');
        // 整组宽只认带单位的字符串（数字是单图那档的像素折算，对整组没意义）；columns=0 一行排完；gutter 图与图的间距；
        // subLabelPattern / subLabelSize / subLabelFont 图上标签的写法、字号、字体
        const groupWidth = typeof a.width === 'string' && a.width.trim() && a.width !== 'auto' ? a.width : undefined;
        return div(fmtAttrs({ caption: a.caption, en: a.captionEn, columns: a.columns !== 2 ? a.columns : undefined, width: groupWidth, gutter: a.subGutter || undefined, subMode: a.subMode !== 'under' ? a.subMode : undefined, subLabel: a.subLabel && a.subLabel !== 'none' ? a.subLabel : undefined, subLabelFill: a.subLabelFill === 'white' ? 'white' : undefined, subLabelPattern: a.subLabelPattern || undefined, subLabelSize: a.subLabelSize || undefined, subLabelFont: a.subLabelFont || undefined, placement: a.placement !== 'none' ? a.placement : undefined }, { id: a.label ? String(a.label) : undefined, classes: ['figure'] }), inner);
      }
      return `![${esc(String(a.caption ?? ''))}](${String(a.image ?? '')})${captionAttrs(a, { width: a.width !== 8 ? a.width : undefined })}${notesMd(a)}`;
    }
    case 'equation': {
      const attrs = fmtAttrs({ mode: a.mode === 'typst' ? 'typst' : undefined }, { id: a.label ? String(a.label) : undefined, classes: a.numbered === false ? ['unnumbered'] : [] });
      return `$$\n${String(a.src ?? '')}\n$$${attrs ? ` ${attrs}` : ''}`;
    }
    case 'tableFigure': {
      const caption = `Table: ${esc(String(a.caption ?? ''))}${captionAttrs(a, { fit: a.fit && a.fit !== 'content' ? a.fit : undefined, colWidth: a.fit === 'fixed' ? a.colWidth : undefined, cols: a.cols ?? undefined })}`;
      return `${tableMd(n.content?.[0])}\n\n${caption}${notesMd(a)}`;
    }
    case 'codeBlock': { if (a.language === 'iota-node') return opaque(n); const text = (n.content ?? []).map((c: Node) => c.text ?? '').join(''); const f = fence(text); return `${f}${a.language ?? ''}\n${text}\n${f}`; }
    case 'codeFigure': {
      const code = n.content?.[0];
      const text = (code?.content ?? []).map((c: Node) => c.text ?? '').join('');
      const f = fence(text);
      return `${f}${code?.attrs?.language ?? ''} ${fmtAttrs({ caption: a.caption, en: a.captionEn }, { id: a.label ? String(a.label) : undefined, classes: ['listing'] })}\n${text}\n${f}`;
    }
    case 'algorithm': {
      const io = parseJsonList(a.io).map((s: any) => String(s)).filter(Boolean).map((s: string) => `> ${s}`);
      const lines = parseJsonList(a.lines).map((l: any) => `${'  '.repeat(Number(l.level ?? 0))}- ${String(l.text ?? '')}`);
      return div(fmtAttrs({ caption: a.caption, en: a.captionEn }, { id: a.label ? String(a.label) : undefined, classes: ['algorithm'] }), [...io, ...lines].join('\n'));
    }
    case 'theorem': return div(fmtAttrs({ note: a.note }, { id: a.label ? String(a.label) : undefined, classes: [String(a.kind ?? 'theorem')] }), (n.content ?? []).map(block).join('\n\n'));
    case 'eqdenote': {
      const rows = parseJsonList(a.rows).map((r: any) => `- ${r.mode === 'typst' ? `$typst: ${r.symbol}$` : `$${r.symbol}$`} — ${String(r.meaning ?? '')}`);
      return div(fmtAttrs({ lead: a.lead && a.lead !== 'auto' ? a.lead : undefined }, { classes: ['denote'] }), rows.join('\n'));
    }
    case 'pageBreak': return '\\newpage';
    case 'horizontalRule': return '---';
    case 'blockquote': return (n.content ?? []).map(block).join('\n\n').split('\n').map((line: string) => `> ${line}`).join('\n');
    case 'bulletList': case 'orderedList': return (n.content ?? []).map((item: Node, index: number) => {
      const marker = n.type === 'orderedList' ? `${Number(a.start ?? 1) + index}. ` : '- ';
      const content = (item.content ?? []).map(block).join('\n\n').replace(/^\\\[([ xX])\\\]/, '[$1]');
      return marker + content.split('\n').join('\n' + ' '.repeat(marker.length));
    }).join('\n');
    default: return opaque(n);
  }
}
export function toMarkdown(doc: RichDoc): string { return (doc.content ?? []).map(block).join('\n\n'); }

// ── Markdown → 块 ─────────────────────────────────────────────────────────────
/** 纯文本里认的几种行内写法：$公式$、[@文献; @文献]、@标签 / @缩略语、^[脚注]、[字]{.index}、<ccwd/> */
const REF_PREFIX = /^(fig|tab|eq|sec|alg|lst|app|thm|sub):/;
function inlineSyntax(text: string): Node[] {
  const out: Node[] = [];
  const bal = '(?:[^\\[\\]\\n]|\\[[^\\[\\]\\n]*\\])*';
  const re = new RegExp(`${MATH_OPEN}(\\d+)${MATH_CLOSE}|\\$typst:\\s*([^$\\n]+?)\\$|\\$([^$\\n]+?)\\$(?!\\d)|\\[(@[^\\]\\n]+)\\]\\{\\.index\\}|\\[(${bal})\\]\\{\\.index\\}|\\[(@[^\\]\\n]+)\\](?:\\{\\.(prose|author|year)\\})?|(?<![\\w@\\\\])@([A-Za-z][\\w:.-]*[\\w])|\\^\\[(${bal})\\]|<ccwd(?:\\s+n="?(-?[\\d.]+)"?)?\\s*\\/?>`, 'g');
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(...textNode(text.slice(last, m.index)));
    if (m[1] !== undefined) out.push(mathNode(Number(m[1])));
    else if (m[2] !== undefined) out.push({ type: 'mathInline', attrs: { src: m[2].trim(), mode: 'typst' } } as Node);
    else if (m[3] !== undefined) out.push({ type: 'mathInline', attrs: { src: m[3].trim(), mode: 'latex' } } as Node);
    else if (m[4] !== undefined || m[5] !== undefined) out.push({ type: 'idx', attrs: { text: (m[4] ?? m[5]) } } as Node);
    else if (m[6] !== undefined) {
      const keys: string[] = []; const sups: string[] = [];
      for (const part of m[6].split(';')) { const mm = /^\s*@([\w:.-]+)\s*(?:,\s*(.*))?$/.exec(part); if (mm) { keys.push(mm[1]); if (mm[2]?.trim()) sups.push(mm[2].trim()); } }
      const form = m[7] ?? 'auto';
      out.push({ type: 'cite', attrs: { keys: keys.join(','), ...(sups.length ? { supplement: sups.join('; ') } : {}), ...(form !== 'auto' ? { form } : {}) } } as Node);
    }
    else if (m[8] !== undefined) out.push(REF_PREFIX.test(m[8]) ? ({ type: 'ref', attrs: { target: m[8] } } as Node) : ({ type: 'abbr', attrs: { key: m[8] } } as Node));
    else if (m[9] !== undefined) out.push({ type: 'footnote', attrs: { text: m[9] } } as Node);
    else out.push({ type: 'ccwd', attrs: { n: Number(m[10] ?? 1) } } as Node);
    last = m.index + m[0].length;
  }
  out.push(...textNode(text.slice(last)));
  return out;
}
// marked 把 \x 切成单独的 escape 记号；相邻同标记的文字并回一个节点，不然再转一次 **a****\\****b**
function mergeText(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.type === 'text' && prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) prev.text = (prev.text ?? '') + (n.text ?? '');
    else out.push(n.type === 'text' ? { ...n } : n);
  }
  return out;
}
const withMark = (nodes: Node[], mark: any): Node[] => nodes.map((n) => (n.type === 'text' ? { ...n, marks: [...(n.marks ?? []), mark] } : n));
/** 行内 HTML 标签配成对：<u> <sub> <sup> <mark> <span color= font= size=>，其余原样当字 */
function tagMark(raw: string): { open?: any; close?: string; void?: boolean } | null {
  const m = /^<(\/?)([a-zA-Z]+)([^>]*)>$/.exec(raw.trim());
  if (!m) return null;
  const name = m[2].toLowerCase();
  if (m[1]) return { close: name };
  const attr = (k: string) => new RegExp(`\\b${k}\\s*=\\s*"?([^"\\s>]+)"?`, 'i').exec(m[3])?.[1];
  if (name === 'br') return { void: true };
  if (TAG_MARKS[name]) return { open: name === 'mark' ? { type: 'highlight', attrs: { color: attr('color') ?? /background(?:-color)?:\s*([^;"]+)/.exec(m[3])?.[1]?.trim() ?? '#ffff00' } } : { type: TAG_MARKS[name] } };
  if (name === 'span' || name === 'font') {
    const color = attr('color') ?? /(?<!background-)color:\s*([^;"]+)/.exec(m[3])?.[1]?.trim();
    const font = attr('font') ?? attr('face');
    const size = attr('size');
    if (color) return { open: { type: 'textColor', attrs: { color } } };
    if (font) return { open: { type: 'fontFamily', attrs: { role: font } } };
    if (size) return { open: { type: 'fontSize', attrs: { size } } };
    return { open: null };
  }
  return null;
}
function inlines(tokens: Token[] = []): Node[] {
  const out: Node[] = [];
  const stack: { name: string; mark: any }[] = [];
  const apply = (nodes: Node[]) => stack.reduce((acc, s) => (s.mark ? withMark(acc, s.mark) : acc), nodes);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as any;
    switch (t.type) {
      case 'text': case 'escape': {
        if (t.tokens) { out.push(...apply(inlines(t.tokens))); break; }
        let text = t.text;
        while (i + 1 < tokens.length && ['text', 'escape'].includes((tokens[i + 1] as any).type) && !(tokens[i + 1] as any).tokens) text += (tokens[++i] as any).text;
        out.push(...apply(inlineSyntax(text))); break;
      }
      case 'strong': case 'em': case 'del': case 'link': {
        const mark = { type: ({ strong: 'bold', em: 'italic', del: 'strike', link: 'link' } as Record<string, string>)[t.type], ...(t.type === 'link' ? { attrs: { href: t.href, title: t.title } } : {}) };
        out.push(...apply(withMark(inlines(t.tokens), mark))); break;
      }
      case 'codespan': out.push(...apply([{ type: 'text', text: t.text, marks: [{ type: 'code' }] }])); break;
      case 'br': out.push({ type: 'hardBreak' }); break;
      case 'image': out.push({ type: 'figure', attrs: { image: t.href, caption: t.text ?? '' } } as Node); break;
      case 'html': {
        const raw = String(t.raw ?? '');
        const legacy = /^<!--iota-inline:(.*?)-->$/.exec(raw.trim());
        if (legacy) { out.push(decode(legacy[1])); break; }
        const ccwd = /^<ccwd(?:\s+n="?(-?[\d.]+)"?)?\s*\/?>$/.exec(raw.trim());
        if (ccwd) { out.push({ type: 'ccwd', attrs: { n: Number(ccwd[1] ?? 1) } } as Node); break; }
        const tag = tagMark(raw);
        if (!tag) { out.push(...apply(textNode(raw))); break; }
        if (tag.void) out.push({ type: 'hardBreak' });
        else if (tag.close) { const i = stack.map((s) => s.name).lastIndexOf(tag.close); if (i >= 0) stack.splice(i, 1); }
        else stack.push({ name: /^<([a-zA-Z]+)/.exec(raw.trim())![1].toLowerCase(), mark: tag.open });
        break;
      }
      default: out.push(...apply(textNode(t.raw ?? '')));
    }
  }
  return mergeText(out);
}

/** 顶层 ::: {…} … ::: 围栏先摘出来（marked 不认），换成占位注释，读到占位时再递归读里面 */
function extractDivs(source: string): { text: string; divs: { attrs: string; body: string }[] } {
  const lines = source.split('\n');
  const divs: { attrs: string; body: string }[] = [];
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^:::\s*(\{.*\}|[\w.#-][^\s]*)?\s*$/.exec(lines[i]);
    if (!m || !m[1]) { out.push(lines[i]); continue; }
    let depth = 1, j = i + 1;
    for (; j < lines.length; j++) {
      if (/^:::\s*(\{.*\}|[\w.#-][^\s]*)\s*$/.test(lines[j])) depth++;
      else if (/^:::\s*$/.test(lines[j]) && --depth === 0) break;
    }
    const attrs = m[1].startsWith('{') ? m[1].slice(1, -1) : m[1].replace(/^(?![.#])/, '.');
    divs.push({ attrs, body: lines.slice(i + 1, j).join('\n') });
    out.push('', `<!--iota-div:${divs.length - 1}-->`, '');
    i = j;
  }
  return { text: out.join('\n'), divs };
}

const NOTE_RE = /^(?:Note|注)(?:[(（]([^)）]*)[)）])?[:：]\s*(.*)$/;
/** 段落末尾的 Note 行拆出来：[{lead, text}]，lead 空 = 默认引导词 */
function splitNotes(raw: string): { main: string; notes: { lead: string; text: string }[] } {
  const lines = raw.split('\n');
  const notes: { lead: string; text: string }[] = [];
  while (lines.length > 1) {
    const m = NOTE_RE.exec(lines[lines.length - 1].trim());
    if (!m) break;
    notes.unshift({ lead: (m[1] ?? '').trim(), text: m[2].trim() });
    lines.pop();
  }
  return { main: lines.join('\n').trim(), notes };
}
const notesMd = (a: Attrs | undefined) => parseJsonList(a?.notes).filter((x: any) => (x.text ?? '').trim()).map((x: any) => `\nNote${(x.lead ?? '').trim() ? `(${x.lead.trim()})` : ''}: ${x.text.trim()}`).join('');
function divNode(attrsSrc: string, body: string, headings: boolean): Node {
  const { id, classes, attrs } = parseAttrs(attrsSrc);
  const kind = classes[0] ?? '';
  const label = id ?? attrs.label ?? '';
  if (kind === 'figure') {
    const inner = blocks(body, false);
    const pick = <T extends string>(v: unknown, ok: readonly T[]): T | undefined => (ok.includes(v as T) ? (v as T) : undefined);
    const subs = inner.filter((n) => n.type === 'figure').map((f) => {
      const x = f.attrs?.extra ?? {};
      return { image: f.attrs?.image ?? '', width: f.attrs?.width ?? '', caption: f.attrs?.caption ?? '', captionEn: f.attrs?.captionEn ?? '', ...(f.attrs?.label ? { label: f.attrs.label } : {}), ...(x.height ? { height: String(x.height) } : {}), ...(pick(x.place, ['row', 'below', 'beside'] as const) ? { place: x.place } : {}), ...(pick(x.mark, ['none', 'tl', 'tr', 'bl', 'br'] as const) ? { mark: x.mark } : {}), ...(pick(x.markFill, ['black', 'white'] as const) ? { markFill: x.markFill } : {}) };
    });
    const corner = ['tl', 'tr', 'bl', 'br'].includes(String(attrs.subLabel)) ? attrs.subLabel : 'none';
    return { type: 'figure', attrs: { image: subs[0]?.image ?? '', caption: attrs.caption ?? '', captionEn: attrs.en ?? '', label, subs: JSON.stringify(subs), columns: num(attrs.columns) ?? 2, subMode: attrs.subMode ?? 'under', subGutter: typeof attrs.gutter === 'string' ? attrs.gutter : '', subLabel: corner, subLabelFill: attrs.subLabelFill === 'white' ? 'white' : 'black', subLabelPattern: typeof attrs.subLabelPattern === 'string' ? attrs.subLabelPattern : '', subLabelSize: typeof attrs.subLabelSize === 'string' ? attrs.subLabelSize : '', subLabelFont: typeof attrs.subLabelFont === 'string' ? attrs.subLabelFont : '', placement: attrs.placement ?? 'none', ...(typeof attrs.width === 'string' && attrs.width ? { width: attrs.width } : {}) } } as Node;
  }
  if (kind === 'algorithm') {
    const io: string[] = [], lines: { text: string; level: number }[] = [];
    for (const raw of body.split('\n')) {
      if (!raw.trim()) continue;
      const q = /^>\s?(.*)$/.exec(raw);
      if (q) { io.push(q[1].trim()); continue; }
      const m = /^(\s*)(?:[-*+]|\d+[.)])?\s*(.*)$/.exec(raw)!;
      lines.push({ text: m[2], level: Math.floor(m[1].replace(/\t/g, '  ').length / 2) });
    }
    return { type: 'algorithm', attrs: { caption: attrs.caption ?? '', captionEn: attrs.en ?? '', label, io: JSON.stringify(io), lines: JSON.stringify(lines) } } as Node;
  }
  if (kind === 'denote') {
    const rows = body.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = /^(?:[-*+]\s+)?(?:\$typst:\s*([^$]+?)\$|\$([^$]+?)\$|`([^`]+)`|(\S+))\s*(?:—|–|-|:|：)\s*(.*)$/.exec(l);
      return m ? { symbol: (m[1] ?? m[2] ?? m[3] ?? m[4]).trim(), mode: m[1] !== undefined ? 'typst' : 'latex', meaning: m[5].trim() } : { symbol: l, mode: 'latex', meaning: '' };
    });
    return { type: 'eqdenote', attrs: { rows: JSON.stringify(rows), lead: attrs.lead ?? 'auto' } } as Node;
  }
  if (kind === 'listing') {
    const inner = blocks(body, false);
    const code = inner.find((n) => n.type === 'codeBlock') ?? { type: 'codeBlock', attrs: { language: null }, content: textNode(body) };
    return { type: 'codeFigure', attrs: { caption: attrs.caption ?? '', captionEn: attrs.en ?? '', label }, content: [code] } as Node;
  }
  if (kind === 'pagebreak') return { type: 'pageBreak' } as Node;
  // 定理族：类名就是 kind（theorem / lemma / definition / … / proof）
  const content = blocks(body, headings).filter((n) => ['paragraph', 'equation', 'eqdenote', 'bulletList', 'orderedList', 'codeBlock'].includes(n.type));
  return { type: 'theorem', attrs: { kind: kind || 'theorem', note: attrs.note ?? '', label }, content: content.length ? content : [{ type: 'paragraph' }] } as Node;
}

// 公式先摘出来换成占位符再交给 marked：$x_1$ 里的 _、* 会被它当成强调切碎，\alpha 的反斜杠会被当转义，
// 模型写的公式就原样印成了字。认 $…$、$$…$$、\(…\)、\[…\]、$typst: …$；围栏代码与行内代码里的不碰，\$ 是字面的
const MATH_OPEN = '\uE000', MATH_CLOSE = '\uE001';
let mathStash: { src: string; mode: 'latex' | 'typst'; display: boolean }[] = [];
function stashMath(text: string): string {
  let out = '';
  let i = 0;
  const put = (src: string, mode: 'latex' | 'typst', display: boolean) => { mathStash.push({ src: src.trim(), mode, display }); out += `${MATH_OPEN}${mathStash.length - 1}${MATH_CLOSE}`; };
  while (i < text.length) {
    const c = text[i];
    const atLineStart = i === 0 || text[i - 1] === '\n';
    if (atLineStart && /^ {0,3}(```|~~~)/.test(text.slice(i, i + 7))) {
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(text.slice(i))![1];
      const end = new RegExp(`\\n {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*(?=\\n|$)`).exec(text.slice(i));
      const j = end ? i + end.index + end[0].length : text.length;
      out += text.slice(i, j); i = j; continue;
    }
    if (c === '`') {
      const run = /^`+/.exec(text.slice(i))![0];
      const close = text.indexOf(run, i + run.length);
      const j = close < 0 ? i + run.length : close + run.length;
      out += text.slice(i, j); i = j; continue;
    }
    if (c === '\\' && (text[i + 1] === '$' || text[i + 1] === '\\')) { out += text.slice(i, i + 2); i += 2; continue; }
    let m: RegExpExecArray | null;
    const rest = text.slice(i);
    if (c === '$' && (m = /^\$\$([\s\S]+?)\$\$/.exec(rest))) { put(m[1], 'latex', true); i += m[0].length; continue; }
    if (c === '$' && (m = /^\$typst:\s*([^$\n]+?)\$/.exec(rest))) { put(m[1], 'typst', false); i += m[0].length; continue; }
    if (c === '$' && (m = /^\$([^$\n`]+?)\$(?!\d)/.exec(rest)) && mathLike(m[1])) { put(m[1], 'latex', false); i += m[0].length; continue; }
    if (c === '\\' && (m = /^\\\(([\s\S]+?)\\\)/.exec(rest))) { put(m[1], 'latex', false); i += m[0].length; continue; }
    if (c === '\\' && (m = /^\\\[([\s\S]+?)\\\]/.exec(rest))) { put(m[1], 'latex', true); i += m[0].length; continue; }
    out += c; i++;
  }
  return out;
}
// $5 和 $10 这种不是公式：里面有汉字（除非带 \text 之类命令）不算；两头带空格的（模型爱写 $ x $）得有个像公式的符号
const mathLike = (raw: string) => { const t = raw.trim(); if (!t) return false; if (/[\u3400-\u9fff]/.test(t) && !/\\[a-zA-Z]+/.test(t)) return false; return /^\s|\s$/.test(raw) ? /[\\^_=+\-*/(){}\[\]<>]/.test(t) : true; };
const mathNode = (idx: number): Node => { const m = mathStash[idx]; return { type: 'mathInline', attrs: { src: m.src, mode: m.mode } } as Node; };
function blocks(source: string, headings: boolean): Node[] {
  const { text, divs } = extractDivs(source);
  return tokensToBlocks(marked.lexer(stashMath(text), { gfm: true, breaks: false }), headings, divs);
}
function tokensToBlocks(tokens: Token[], headings: boolean, divs: { attrs: string; body: string }[]): Node[] {
  const out: Node[] = [];
  let attrs: Record<string, unknown> | undefined;
  const push = (node: Node) => { if (attrs) { node.attrs = { ...node.attrs, ...attrs }; attrs = undefined; } out.push(node); };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as any;
    if (t.type === 'space') continue;
    if (t.type === 'html') {
      const raw = String(t.raw).trim();
      const meta = /^<!--iota-attrs:(.*?)-->$/.exec(raw);
      if (meta) { attrs = decode(meta[1]); continue; }
      const dv = /^<!--iota-div:(\d+)-->$/.exec(raw);
      if (dv) { push(divNode(divs[Number(dv[1])].attrs, divs[Number(dv[1])].body, headings)); continue; }
      if (/^<div[^>]*page-break/i.test(raw)) { push({ type: 'pageBreak' } as Node); continue; }
      push({ type: 'paragraph', content: inlines(marked.Lexer.lexInline(raw)) }); continue;
    }
    switch (t.type) {
      case 'heading': {
        if (headings && t.depth > 4) throw new Error(tx("论文标题支持 1 至 4 级，请减少标题前的 #。"));
        const { text: title, attrs: as } = splitTrailing(String(t.text ?? ''));
        const pa = as ? parseAttrs(as) : null;
        const content = inlines(marked.Lexer.lexInline(title.trim()));
        if (!headings) { push({ type: 'paragraph', content }); break; }
        const ha: Attrs = { level: t.depth };
        if (pa) { if (pa.id) ha.label = pa.id; if (pa.classes.includes('unnumbered')) ha.numbered = false; if (pa.attrs.en) ha.en = pa.attrs.en; if (pa.attrs.openright) ha.openright = pa.attrs.openright; if (pa.attrs.spread) ha.spread = pa.attrs.spread; }
        push({ type: 'heading', attrs: ha, content }); break;
      }
      case 'paragraph': case 'text': {
        const raw0 = String(t.raw ?? t.text ?? '').trim();
        if (raw0 === '&nbsp;' || raw0 === '\u00a0') { push({ type: 'paragraph' }); break; }
        if (raw0 === '\\newpage' || raw0 === '\\pagebreak') { push({ type: 'pageBreak' } as Node); break; }
        const eq = new RegExp(`^${MATH_OPEN}(\\d+)${MATH_CLOSE}(?:\\s*\\{([^}\\n]*)\\})?$`).exec(raw0);
        if (eq && mathStash[Number(eq[1])]?.display) {
          const pa = eq[2] ? parseAttrs(eq[2]) : null;
          push({ type: 'equation', attrs: { src: mathStash[Number(eq[1])].src, mode: pa?.attrs.mode === 'typst' ? 'typst' : 'latex', ...(pa?.id ? { label: pa.id } : {}), ...(pa?.classes.includes('unnumbered') ? { numbered: false } : {}) } } as Node); break;
        }
        // 图注 / 表注：紧跟在 Table: 行或图那一行后面的 Note: / Note(引导词): 行（引导词空 = 「注：」，无 = 不印）
        const { main: raw, notes } = splitNotes(raw0);
        // 表题写在表下面一行：Table: 题注 {#tab:x …}
        const cap = /^Table:\s*(.*)$/s.exec(raw);
        if (cap && out[out.length - 1]?.type === 'tableFigure') {
          const { text: caption, attrs: as } = splitTrailing(cap[1]);
          const pa = as ? parseAttrs(as) : null;
          const prev = out[out.length - 1];
          prev.attrs = { ...prev.attrs, ...(notes.length ? { notes: JSON.stringify(notes) } : {}), caption: plain({ type: 'x', content: inlines(marked.Lexer.lexInline(caption.trim())) } as Node), ...(pa?.attrs.en ? { captionEn: pa.attrs.en } : {}), ...(pa?.id ? { label: pa.id } : {}), ...(pa?.attrs.fit ? { fit: pa.attrs.fit } : {}), ...(num(pa?.attrs.colWidth) !== undefined ? { colWidth: num(pa?.attrs.colWidth) } : {}), ...(pa?.attrs.cols ? { cols: pa.attrs.cols } : {}), ...(pa?.attrs.placement ? { placement: pa.attrs.placement } : {}), ...(pa?.attrs.breakable ? { breakable: pa.attrs.breakable } : {}) };
          break;
        }
        const { text: body, attrs: as } = splitTrailing(raw);
        const pa = as ? parseAttrs(as) : null;
        const content = inlines(marked.Lexer.lexInline(pa ? body.trim() : raw));
        // 一段只有一张图：图 + 属性
        if (content.length === 1 && content[0].type === 'figure') {
          const f = content[0];
          // 分图容器里那几张图才用得着的键（height / place / mark…）先留在 extra 里，容器组装时取；单图上不认
          f.attrs = { ...f.attrs, ...(notes.length ? { notes: JSON.stringify(notes) } : {}), ...(pa?.id ? { label: pa.id } : {}), ...(pa?.attrs.en ? { captionEn: pa.attrs.en } : {}), ...(len(pa?.attrs.width) !== undefined ? { width: len(pa?.attrs.width) } : {}), ...(pa?.attrs.placement ? { placement: pa.attrs.placement } : {}), ...(pa?.attrs.breakable ? { breakable: pa.attrs.breakable } : {}), ...(pa ? { extra: pa.attrs } : {}) };
          push(f); break;
        }
        // 不是图也不是表题：拆出去的 Note 行还是正文，整段按原样重来
        const sp = notes.length ? splitTrailing(raw0) : { text: body, attrs: as };
        const pp = notes.length ? (sp.attrs ? parseAttrs(sp.attrs) : null) : pa;
        const full = notes.length ? inlines(marked.Lexer.lexInline(pp ? sp.text.trim() : raw0)) : content;
        const node: Node = { type: 'paragraph', content: full.map((c) => (c.type === 'text' && c.text === '\u00a0' ? { ...c, text: '' } : c)).filter((c) => c.type !== 'text' || c.text) };
        if (pp?.classes.includes('noindent')) node.attrs = { noIndent: true };
        else if (pp && !pp.classes.length && !pp.id && !Object.keys(pp.attrs).length) { /* 空的 {}，当字 */ }
        push(node); break;
      }
      case 'hr': push({ type: 'horizontalRule' }); break;
      case 'code': {
        const info = String(t.lang ?? '');
        if (info === 'iota-node') {
          let node: Node;
          try { node = JSON.parse(t.text); } catch { throw new Error(tx("iota-node 代码块中的 JSON 不完整。")); }
          if (!node || typeof node.type !== 'string') throw new Error(tx("iota-node 代码块需要有效的文档节点。"));
          push(node); break;
        }
        const { text: lang, attrs: as } = splitTrailing(info);
        const pa = as ? parseAttrs(as) : null;
        const code: Node = { type: 'codeBlock', attrs: { language: lang.trim() || null }, content: textNode(t.text) };
        if (pa && (pa.classes.includes('listing') || pa.id || pa.attrs.caption)) push({ type: 'codeFigure', attrs: { caption: pa.attrs.caption ?? '', captionEn: pa.attrs.en ?? '', label: pa.id ?? '' }, content: [code] } as Node);
        else push(code);
        break;
      }
      case 'blockquote': push({ type: 'blockquote', content: tokensToBlocks(t.tokens, headings, divs) }); break;
      // Typst 的写法：+ 是编号列表
      case 'list': { const ordered = t.ordered || /^\s*\+/.test(String(t.raw ?? '')); push({ type: ordered ? 'orderedList' : 'bulletList', ...(ordered ? { attrs: { start: t.ordered ? t.start : 1 } } : {}), content: t.items.map((item: Tokens.ListItem) => {
        const content = tokensToBlocks(item.tokens, headings, divs);
        if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph', content: [] });
        if (item.task) content[0].content = [...textNode(item.checked ? '[x] ' : '[ ] '), ...(content[0].content ?? [])];
        return { type: 'listItem', content };
      }) }); break; }
      case 'table': {
        const cellNode = (cell: Tokens.TableCell, header: boolean, j: number) => ({ type: header ? 'tableHeader' : 'tableCell', attrs: { align: t.align[j] ?? null }, content: [{ type: 'paragraph', content: inlines(cell.tokens) }] });
        const headerEmpty = t.header.every((c: Tokens.TableCell) => !String(c.text ?? '').trim());
        const rows = headerEmpty ? t.rows.map((row: Tokens.TableCell[]) => ({ type: 'tableRow', content: row.map((c, j) => cellNode(c, false, j)) })) : [t.header, ...t.rows].map((row: Tokens.TableCell[], i: number) => ({ type: 'tableRow', content: row.map((c, j) => cellNode(c, i === 0, j)) }));
        push({ type: 'tableFigure', content: [{ type: 'table', content: rows }] }); break;
      }
      default: throw new Error(tx("暂不支持此 Markdown 内容：{{type}}", { type: t.type }));
    }
  }
  if (attrs) throw new Error(tx("属性注释后需要一个正文块。"));
  return out;
}
export function fromMarkdown(source: string, headings = true): RichDoc {
  mathStash = [];
  const content = blocks(source, headings);
  // 单图上暂存的分图键（extra）不进文档
  const strip = (n: Node) => { if (n.type === 'figure' && n.attrs?.extra) delete n.attrs.extra; for (const c of n.content ?? []) strip(c); };
  content.forEach(strip);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
