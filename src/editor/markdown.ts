import { marked, type Token, type Tokens } from 'marked';
import type { RichDoc } from '../model/types';

// GFM handles ordinary text. Valid GFM comments/fences preserve thesis-only data.
type Node = NonNullable<RichDoc['content']>[number];
// 注释里放可读的 JSON；HTML 注释里不许出现 --，串里的写成 \u002d
const encode = (value: unknown) => JSON.stringify(value).replace(/--/g, '-\\u002d');
const decode = (value: string) => JSON.parse(value.trim().startsWith('{') || value.trim().startsWith('[') ? value : decodeURIComponent(value));
/** 只留与默认值不同的属性（uid 是标签的身份，一直留） */
const DEFAULTS: Record<string, Record<string, unknown>> = {
  heading: { en: '', label: '', numbered: true, openright: 'auto', spread: 'auto', level: undefined },
  paragraph: { noIndent: false },
  figure: { width: 8, caption: '', captionEn: '', label: '', placement: 'none', breakable: 'auto', subs: '[]', columns: 2, subMode: 'under', image: undefined },
  equation: { src: undefined, mode: 'latex', numbered: true, label: '' },
  tableFigure: { caption: '', captionEn: '', label: '', placement: 'none', breakable: 'auto', fit: 'content', colWidth: 2.5 },
  codeBlock: { language: null },
  orderedList: { start: 1 },
};
function trimAttrs(type: string, attrs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!attrs) return undefined;
  const d = DEFAULTS[type] ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) { if (k in d && (d[k] === undefined || d[k] === v || v == null)) continue; out[k] = v; }
  return Object.keys(out).length ? out : undefined;
}
const textNode = (text: string): Node[] => text ? [{ type: 'text', text }] : [];
const esc = (s: string) => s.replace(/[\\`*_[\]<>~|]/g, '\\$&').replace(/^(\s*)([#>+-]|\d+[.)])(?=\s)/gm, '$1\\$2');
const fence = (text: string) => '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)));
const opaque = (node: Node) => { const json = JSON.stringify(node, null, 2); const f = fence(json); return `${f}iota-node\n${json}\n${f}`; };

function inline(nodes: Node[] = []): string {
  return nodes.map((n) => {
    if (n.type === 'hardBreak') return '  \n';
    // 常见的几种行内节点有 Markdown 世界的通行写法：$公式$、[@文献]、@标签（pandoc / GitHub 的样子）
    if (n.type === 'mathInline' && n.attrs?.mode !== 'typst' && n.attrs?.src && !/\$/.test(String(n.attrs.src))) return `$${String(n.attrs.src).trim()}$`;
    if (n.type === 'cite' && n.attrs?.keys) return `[${String(n.attrs.keys).split(/[,，;；\s]+/).filter(Boolean).map((k) => `@${k}`).join('; ')}]`;
    if (n.type === 'ref' && n.attrs?.target && /^[A-Za-z0-9_:.\-]+$/.test(String(n.attrs.target))) return `@${n.attrs.target}`;
    if (n.type === 'footnote' && n.attrs?.text && !/[\]\n]/.test(String(n.attrs.text))) return `^[${n.attrs.text}]`;
    if (n.type !== 'text' || n.marks?.some((m: any) => !['bold', 'italic', 'strike', 'code', 'link'].includes(m.type))) return `<!--iota-inline:${encode(n)}-->`;
    let value = esc(n.text ?? '');
    for (const mark of n.marks ?? []) {
      if (mark.type === 'code') { const f = '`'.repeat(Math.max(1, ...Array.from((n.text ?? '').matchAll(/`+/g), (m: any) => m[0].length + 1))); value = `${f} ${n.text} ${f}`; }
      if (mark.type === 'bold') value = `**${value}**`;
      if (mark.type === 'italic') value = `*${value}*`;
      if (mark.type === 'strike') value = `~~${value}~~`;
      if (mark.type === 'link') value = `[${value}](<${String(mark.attrs?.href ?? '').replace(/>/g, '%3E')}>${mark.attrs?.title ? ` "${String(mark.attrs.title).replace(/"/g, '&quot;')}"` : ''})`;
    }
    return value;
  }).join('');
}
function block(n: Node): string {
  const kept = trimAttrs(n.type, n.attrs);
  const attrs = kept ? `<!--iota-attrs:${encode(kept)}-->\n\n` : '';
  switch (n.type) {
    case 'paragraph': return n.content?.length ? attrs + inline(n.content) : '&nbsp;';
    // 图：![题注](图片名)，其余属性进注释；有分图的整块原样存
    case 'figure': {
      if (n.attrs?.subs && n.attrs.subs !== '[]') return opaque(n);
      const rest = trimAttrs('figure', { ...n.attrs, caption: '', image: undefined });
      return (rest ? `<!--iota-attrs:${encode(rest)}-->\n\n` : '') + `![${esc(String(n.attrs?.caption ?? ''))}](${String(n.attrs?.image ?? '')})`;
    }
    // 行间公式：$$ … $$（GitHub 也这么认），标签 / 不编号 / typst 模式进注释
    case 'equation': {
      const src = String(n.attrs?.src ?? '');
      if (/\$\$/.test(src)) return opaque(n);
      const rest = trimAttrs('equation', { ...n.attrs, src: undefined });
      return (rest ? `<!--iota-attrs:${encode(rest)}-->\n\n` : '') + `$$\n${src}\n$$`;
    }
    case 'heading': return attrs + '#'.repeat(n.attrs?.level ?? 1) + ' ' + inline(n.content);
    case 'horizontalRule': return '---';
    case 'codeBlock': { if (n.attrs?.language === 'iota-node') return opaque(n); const text = (n.content ?? []).map((c: Node) => c.text ?? '').join(''); const f = fence(text); return `${attrs}${f}${n.attrs?.language ?? ''}\n${text}\n${f}`; }
    case 'blockquote': return attrs + (n.content ?? []).map(block).join('\n\n').split('\n').map((line: string) => `> ${line}`).join('\n');
    case 'bulletList': case 'orderedList': {
      // Keep unusual list attributes/inline annotations without flattening them.
      if (n.attrs && Object.entries(n.attrs).some(([k, v]) => k !== 'start' && v != null)) return opaque(n);
      return (n.content ?? []).map((item: Node, index: number) => {
        const marker = n.type === 'orderedList' ? `${(n.attrs?.start ?? 1) + index}. ` : '- ';
        const content = (item.content ?? []).map(block).join('\n\n').replace(/^\\\[([ xX])\\\]/, '[$1]');
        return marker + content.split('\n').join('\n' + ' '.repeat(marker.length));
      }).join('\n');
    }
    default: return opaque(n);
  }
}
export function toMarkdown(doc: RichDoc): string { return (doc.content ?? []).map(block).join('\n\n'); }

/** 纯文本里认几种行内写法：$公式$、[@文献; @文献]、@标签、^[脚注] */
function inlineSyntax(text: string): Node[] {
  const out: Node[] = [];
  const re = /\$([^$\n]+?)\$|\[(@[^\]\n]+)\]|(?<![\w@])@((?:fig|tab|eq|sec|alg|lst|app):[A-Za-z0-9_:.\-]*[A-Za-z0-9_])|\^\[([^\]\n]+)\]/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(...textNode(text.slice(last, m.index)));
    if (m[1] !== undefined) out.push({ type: 'mathInline', attrs: { src: m[1].trim(), mode: 'latex' } } as Node);
    else if (m[2] !== undefined) out.push({ type: 'cite', attrs: { keys: m[2].split(/[;,\s]+/).map((k) => k.replace(/^@/, '')).filter(Boolean).join(',') } } as Node);
    else if (m[3] !== undefined) out.push({ type: 'ref', attrs: { target: m[3] } } as Node);
    else if (m[4] !== undefined) out.push({ type: 'footnote', attrs: { text: m[4] } } as Node);
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
function inlines(tokens: Token[] = []): Node[] {
  return mergeText(tokens.flatMap((token): Node[] => {
    const t = token as any;
    switch (t.type) {
      case 'text': case 'escape': return t.tokens ? inlines(t.tokens) : inlineSyntax(t.text);
      case 'strong': case 'em': case 'del': case 'link': {
        const mark = { type: ({ strong: 'bold', em: 'italic', del: 'strike', link: 'link' } as Record<string, string>)[t.type], ...(t.type === 'link' ? { attrs: { href: t.href, title: t.title } } : {}) };
        return inlines(t.tokens).map((n) => ({ ...n, marks: [...(n.marks ?? []), mark] }));
      }
      case 'codespan': return [{ type: 'text', text: t.text, marks: [{ type: 'code' }] }];
      case 'br': return [{ type: 'hardBreak' }];
      case 'image': return [{ type: 'figure', attrs: { image: t.href, caption: t.text ?? '' } } as Node];
      case 'html': {
        const match = /^<!--iota-inline:(.*?)-->$/.exec(t.raw.trim());
        if (match) return [decode(match[1])];
        return textNode(t.raw); // Never execute raw HTML from source text.
      }
      default: return textNode(t.raw ?? '');
    }
  }));
}
function blocks(tokens: Token[], headings: boolean): Node[] {
  const out: Node[] = [];
  let attrs: Record<string, unknown> | undefined;
  for (const token of tokens) {
    const t = token as any;
    if (t.type === 'space') continue;
    const meta = t.type === 'html' && /^<!--iota-attrs:(.*?)-->$/.exec(t.raw.trim());
    if (meta) { attrs = decode(meta[1]); continue; }
    let node: Node;
    switch (t.type) {
      case 'heading':
        if (headings && t.depth > 4) throw new Error('论文标题支持 1 至 4 级，请减少标题前的 #。');
        node = { type: headings ? 'heading' : 'paragraph', ...(headings ? { attrs: { level: t.depth } } : {}), content: inlines(t.tokens) }; break;
      case 'paragraph': case 'text': {
        const raw = String(t.raw ?? t.text ?? '').trim();
        if (raw === '&nbsp;' || raw === '\u00a0') { node = { type: 'paragraph' }; break; }
        const eq = /^\$\$\s*\n?([\s\S]*?)\n?\s*\$\$$/.exec(raw);
        if (eq) { node = { type: 'equation', attrs: { src: eq[1].trim(), mode: 'latex' } }; break; }
        const content = inlines(t.tokens ?? marked.Lexer.lexInline(t.text));
        if (content.length === 1 && content[0].type === 'figure') { node = content[0]; break; }
        node = { type: 'paragraph', content: content.map((c) => (c.type === 'text' && c.text === '\u00a0' ? { ...c, text: '' } : c)).filter((c) => c.type !== 'text' || c.text) };
        break;
      }
      case 'hr': node = { type: 'horizontalRule' }; break;
      case 'code':
        if (t.lang === 'iota-node') {
          try { node = JSON.parse(t.text); } catch { throw new Error('iota-node 代码块中的 JSON 不完整。'); }
          if (!node || typeof node.type !== 'string') throw new Error('iota-node 代码块需要有效的文档节点。');
        } else node = { type: 'codeBlock', attrs: { language: t.lang || null }, content: textNode(t.text) };
        break;
      case 'blockquote': node = { type: 'blockquote', content: blocks(t.tokens, headings) }; break;
      case 'list': node = { type: t.ordered ? 'orderedList' : 'bulletList', ...(t.ordered ? { attrs: { start: t.start } } : {}), content: t.items.map((item: Tokens.ListItem) => {
        const content = blocks(item.tokens, headings);
        if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph', content: [] });
        if (item.task) content[0].content = [...textNode(item.checked ? '[x] ' : '[ ] '), ...(content[0].content ?? [])];
        return { type: 'listItem', content };
      }) }; break;
      case 'table': node = { type: 'tableFigure', content: [{ type: 'table', content: [t.header, ...t.rows].map((row: Tokens.TableCell[], i: number) => ({ type: 'tableRow', content: row.map((cell, j) => ({ type: i === 0 ? 'tableHeader' : 'tableCell', attrs: { align: t.align[j] }, content: [{ type: 'paragraph', content: inlines(cell.tokens) }] })) })) }] }; break;
      case 'html': node = { type: 'paragraph', content: textNode(t.raw) }; break;
      default: throw new Error(`暂不支持此 Markdown 内容：${t.type}`);
    }
    if (attrs) { node.attrs = { ...node.attrs, ...attrs }; attrs = undefined; }
    out.push(node);
  }
  if (attrs) throw new Error('属性注释后需要一个正文块。');
  return out;
}
export function fromMarkdown(source: string, headings = true): RichDoc {
  const content = blocks(marked.lexer(source, { gfm: true, breaks: false }), headings);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
