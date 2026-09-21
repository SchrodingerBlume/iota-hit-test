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
import { theoremKind } from './theorem';
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
  /** 只编当前章时，章外的引用不在这份文档里：按上次算好的编号印成字面（图 2-1） */
  refText?: Map<string, string>;
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
const CONTAINERS = new Set(['doc', 'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'tableFigure', 'table', 'tableRow', 'tableCell', 'tableHeader', 'theorem']);
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
export function indexPositions(doc: PMNode, start = 0): WeakMap<PMNode, number> {
  const posOf = new WeakMap<PMNode, number>();
  const walk = (n: PMNode, contentStart: number) => {
    let p = contentStart;
    for (const c of n.content ?? []) {
      posOf.set(c, p);
      if (CONTAINERS.has(c.type)) walk(c, p + 1);
      p += nodeSize(c);
    }
  };
  walk(doc, start);
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
  // 控制字符和源码映射使用的私用字符不应进入生成的 Typst；普通换行由编辑器节点表示。
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uE003]/g, '�');
  // 连打的空格照排：Typst 会把多个空格合成一个，多出来的写成 ~（不断行空格，宽度同空格）
  return s.replace(INLINE_SPECIAL, (c) => '\\' + c).replace(/ {2,}/g, (run) => '~'.repeat(run.length - 1) + ' ').replace(/-{2,}/g, (run) => run.split('').map((c) => '\\' + c).join(''));
}

/** Typst 标签只允许保守的 ASCII 子集；引用、文献和缩略语统一走同一条清洗规则。 */
const safeLabel = (value: unknown): string => String(value ?? '').trim().replace(/[^A-Za-z0-9_:.-]/g, '-').replace(/^-+|-+$/g, '');

/** 一段开头如果长得像列表、标题、词条，补一个反斜杠（跳过映射记号看内容） */
export function escapeLineStart(s: string): string {
  // 转义之后 * _ / 已经带反斜杠了，这里只管没转义的：= - + 与「1.」
  if (/^\s*(=+|-|\+|\d+\.)(\s|$)/.test(unmarked(s))) s = s.replace(/^((?:\s|\uE000[^\uE001]*\uE001)*)/, '$1\\');
  // 段首的空格 Typst 会吃掉，换成 ~
  return s.replace(/^((?:\uE000[^\uE001]*\uE001)*) /, '$1~');
}

// ── 行内 ────────────────────────────────────────────────────────

const hlFill = (m: { attrs?: Record<string, any> }) => `rgb(${JSON.stringify(/^#[0-9a-f]{6}$/i.test(m.attrs?.color ?? '') ? m.attrs!.color : '#ffff00')})`;

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
      case 'fontFamily': out = `#${['songti', 'heiti', 'kaishu', 'fangsong'].includes(m.attrs?.role) ? m.attrs!.role : 'songti'}[${out}]`; break;
      case 'fontSize': out = `#text(size: zihao.${/^[a-z]+$/.test(m.attrs?.size ?? '') ? m.attrs!.size : 'xiaosi'})[${out}]`; break;
      case 'textColor': out = `#text(fill: rgb(${JSON.stringify(/^#[0-9a-f]{6}$/i.test(m.attrs?.color ?? '') ? m.attrs!.color : '#000000')}))[${out}]`; break;
      case 'highlight': out = `#iota-hl(${hlFill(m)})[${out}]`; break;
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
  if (!mathReady(src)) return '#box[]';
  if (attrs.mode === 'typst') return `$${src}$`;
  return `#mi(${backtick(src)})`;
}

/** 输入公式的过程中允许括号、引号和占位符暂时不完整；主文档先留空，由公式编辑器就地提示。 */
function mathReady(src: string): boolean {
  if (!src || src.includes('□')) return false;
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let quote = false;
  let escaped = false;
  for (const ch of src) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { quote = !quote; continue; }
    if (quote) continue;
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (pairs[ch] && stack.pop() !== pairs[ch]) return false;
  }
  return !quote && !escaped && stack.length === 0;
}

function backtick(s: string): string {
  // 原始块：内容里有反引号就多包几个
  let fence = '`';
  while (s.includes(fence)) fence += '`';
  return `${fence}${s}${fence}`;
}

/** 结尾是汉字（或中文标点） */
const CJK_EDGE = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]\s*$/;
const CJK_START = /^\s*[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/;
const INLINE_ATOM = new Set(['ref', 'cite', 'mathInline', 'footnote', 'abbr', 'ccwd', 'idx']);
// 相邻文字节点共有的标记只包一层：编辑器里「H₂O」带下划线存成三个节点，逐个包成
// #underline[H]#sub[#underline[2]]#underline[O]，模板的下划线就在上下标处断开、错位；
// 合成 #underline[H#sub[2]O] 才是用户手写的样子。挑覆盖最长一段的那个标记先包，里面递归
const GROUPABLE = ['link', 'highlight', 'fontFamily', 'fontSize', 'textColor', 'underline', 'strike', 'bold', 'italic', 'superscript', 'subscript'];
type Mark = NonNullable<PMNode['marks']>[number];
const sameMark = (a: Mark, b: Mark) => a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
// 引用、公式这些行内原子也带标记（选中一句加下划线，里面的「表 1-2」一样带着），一段里连着的一起包
const hasMark = (n: PMNode, m: Mark) => (n.marks ?? []).some((x) => sameMark(x, m));
// 节点对象不能复制（源码映射按对象身份查位置），外层已包掉的标记用 skip 传下去
const marksOf = (n: PMNode, skip: Mark[]) => (n.marks ?? []).filter((x) => !skip.some((s) => sameMark(s, x)));

export function serializeInline(nodes: PMNode[] = [], opts: SerializeOptions = {}, skip: Mark[] = []): string {
  let out = '';
  // 上一段输出是不是 #调用：紧跟的 ( 或 . 会被 Typst 当成续写的参数 / 字段（#cite(<a>)(图 1)），要用 ; 收住
  let code = false;
  const emit = (s: string, isCode: boolean) => { out += s; code = isCode; };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    // 原子自己身上还没包掉的标记（没和邻居成组时）就地包上，不然原子处的下划线 / 加粗断掉
    const atom = (s: string) => { const ms = marksOf(n, skip).filter((m) => GROUPABLE.includes(m.type)); emit(ms.length ? wrapMarks(s, ms) : s, true); };
    if (i + 1 < nodes.length) {
      let best: { mark: Mark; end: number } | null = null;
      for (const m of marksOf(n, skip).filter((x) => GROUPABLE.includes(x.type))) {
        let j = i + 1;
        while (j < nodes.length && hasMark(nodes[j], m)) j++;
        if (j > i + 1 && (!best || j > best.end || (j === best.end && GROUPABLE.indexOf(m.type) < GROUPABLE.indexOf(best.mark.type)))) best = { mark: m, end: j };
      }
      if (best) {
        emit(wrapMarks(serializeInline(nodes.slice(i, best.end), opts, [...skip, best.mark]), [best.mark]), true);
        i = best.end - 1;
        continue;
      }
    }
    switch (n.type) {
      case 'text': {
        const raw = n.text ?? '';
        let escaped = escapeText(raw);
        // 引用 / 公式后面照 Typst 的写法带一个语法空格（@fig 所示 里那个，模板的弱间距会吃掉它），
        // 用户敲的空格从第二个算起、逐个写成 ~；前面的空格是真空格，可模板在引用前也发弱间距，裸空格会被吃，同样写成 ~
        if (INLINE_ATOM.has(nodes[i - 1]?.type ?? '')) { const n = /^ */.exec(raw)![0].length; if (n) escaped = ' ' + '~'.repeat(n) + escaped.replace(/^~* /, ''); }
        if (INLINE_ATOM.has(nodes[i + 1]?.type ?? '')) { const n = / *$/.exec(raw)![0].length; if (n) escaped = escaped.replace(/~* $/, '') + '~'.repeat(n); }
        // 汉字加粗 / 强调 / 下划线这类标记两侧，模板补字距的弱间距会把紧挨着的裸空格吃掉——用户在编辑器里敲的空格
        // 预览里就没了。挨着汉字的那种写成 ~ 留住（西文两侧本来就不吃，照旧，别把断行机会换掉）
        const edge = (a?: PMNode, b?: PMNode) => !!a && !!b && a.type === 'text' && b.type === 'text' && (marksOf(a, skip).length > 0 || marksOf(b, skip).length > 0);
        const keepLead = edge(nodes[i - 1], n) && CJK_EDGE.test(nodes[i - 1]!.text ?? '') && /^ /.test(raw);
        const keepTrail = edge(n, nodes[i + 1]) && CJK_START.test(nodes[i + 1]!.text ?? '') && / $/.test(raw);
        if (/^ +$/.test(raw)) { if (keepLead || keepTrail) escaped = '~'.repeat(raw.length); }
        else {
          if (keepLead) { const k = /^ */.exec(raw)![0].length; escaped = '~'.repeat(k) + escaped.replace(/^ +/, ''); }
          if (keepTrail) { const k = / *$/.exec(raw)![0].length; escaped = escaped.replace(/ +$/, '') + '~'.repeat(k); }
        }
        const pos = opts.map?.posOf.get(n);
        const marks = marksOf(n, skip);
        const isCode = marks.some((m) => m.type === 'code');
        if (code && marks.length === 0 && /^[(.]/.test(escaped)) out += ';';
        if (pos !== undefined && opts.map) {
          // 等宽代码走 #raw("…")：记号套在引号里面，字形偏移就是从引号后数的
          const rawArg = isCode ? `"${mark('text', opts.map.key, pos, pos + raw.length, JSON.stringify(raw).slice(1, -1), { raw })}"` : undefined;
          emit(wrapMarks(mark('text', opts.map.key, pos, pos + raw.length, escaped, { raw }), marks, rawArg), marks.length > 0);
        } else {
          emit(wrapMarks(escaped, marks), marks.length > 0);
        }
        break;
      }
      case 'hardBreak': emit(' \\\n', false); break;
      case 'mathInline': {
        const ms = marksOf(n, skip).filter((m) => GROUPABLE.includes(m.type));
        let s = tag(opts, n, 'node', mathInline(n.attrs));
        // highlight 不给公式上色：公式里没有 text 元素。突出显示落在公式上的（自己带的或外层包着的），另外垫一块同高的底色
        const hl = [...ms, ...skip].find((m) => m.type === 'highlight');
        if (hl) s = `#iota-hl-math(${hlFill(hl)})[${s}]`;
        emit(ms.length ? wrapMarks(s, ms) : s, ms.length > 0 || !!hl || n.attrs?.mode === 'latex');
      } break;
      case 'cite': {
        const keys = String(n.attrs?.keys ?? '').split(/[,，;；\s]+/).map(safeLabel).filter(Boolean);
        // 写成函数调用而不是 @key：Typst 0.15 的 @ 引用会把紧跟的汉字也吞进 label。cite 是 omni-gb7714 的（主文件里盖掉原生的）：
        // 几个键一次合并，页码（supplement）与标注形式（叙述式 / 只著者 / 只年份）都是它的参数
        if (!keys.length) break;
        const form = ['prose', 'author', 'year'].includes(String(n.attrs?.form ?? '')) ? `, form: ${JSON.stringify(n.attrs!.form)}` : '';
        const sup = String(n.attrs?.supplement ?? '').trim();
        atom(tag(opts, n, 'node', `#cite(${keys.map((k) => `<${k}>`).join(', ')}${form}${sup ? `, supplement: [${escapeText(sup)}]` : ''})`));
        break;
      }
      case 'ref': {
        const t = safeLabel(n.attrs?.target);
        if (!t) break;
        const outside = opts.knownLabels && !opts.knownLabels.has(t) ? opts.refText?.get(t) : undefined;
        if (outside !== undefined) { atom(tag(opts, n, 'node', `#[${escapeText(outside)}]`)); break; }
        atom(tag(opts, n, 'node', opts.knownLabels && !opts.knownLabels.has(t) ? '#text(red)[??]' : `#ref(<${t}>)`));
        break;
      }
      case 'abbr': { const key = safeLabel(n.attrs?.key); if (key) atom(tag(opts, n, 'node', `#ref(<${key}>)`)); break; }
      case 'footnote': {
        const text = String(n.attrs?.text ?? '');
        atom(tag(opts, n, 'node', `#footnote[${tag(opts, n, 'attr', escapeText(text), { attr: 'text', raw: text })}]`));
        break;
      }
      case 'ccwd': { const count = Math.max(-20, Math.min(20, Number(n.attrs?.n) || 1)); atom(tag(opts, n, 'node', `#ccwd(${count})`)); break; }
      case 'idx': if (n.attrs?.text) atom(tag(opts, n, 'node', `#idx[${escapeText(String(n.attrs.text))}]`)); break;
      default:
        if (n.content) emit(serializeInline(n.content, opts), false);
    }
  }
  return out;
}

// ── 块 ──────────────────────────────────────────────────────────

export function labelOf(attrs: Record<string, any> | undefined, prefix: string): string {
  if (!attrs) return '';
  const custom = String(attrs.label ?? '').trim();
  const base = custom || (attrs.uid ? `${prefix}:${attrs.uid}` : '');
  return safeLabel(base);
}

/** 题注里的文献引用写成 [@key] 或 [@k1, k2]（题注是一串字，放不下 cite 节点） */
export const CAPTION_CITE = /\[@([^\]]+)\]/g;
export function captionCiteKeys(s: string): string[] {
  return [...s.matchAll(CAPTION_CITE)].flatMap((m) => m[1].split(/[,，;；\s]+/).map(safeLabel).filter(Boolean));
}
/** 题注文字 → Typst：转义之外把 [@key] 换成 #cite */
export function captionText(raw: string): string {
  return raw.split(CAPTION_CITE).map((piece, i) => (i % 2 ? piece.split(/[,，;；\s]+/).map(safeLabel).filter(Boolean).map((k) => `#cite(<${k}>)`).join('') : escapeText(piece))).join('');
}

function caption(n: PMNode, opts: SerializeOptions): string {
  const attrs = n.attrs ?? {};
  const zhRaw = String(attrs.caption ?? '').trim();
  const enRaw = String(attrs.captionEn ?? '').trim();
  const zh = tag(opts, n, 'attr', captionText(zhRaw), { attr: 'caption', raw: zhRaw });
  const en = tag(opts, n, 'attr', captionText(enRaw), { attr: 'captionEn', raw: enRaw });
  return enRaw ? `${zh}#en[${en}]` : zh;
}

function serializeTable(table: PMNode, opts: SerializeOptions, fit: string = 'content', colWidth: unknown = 2.5, cols: Record<string, string> = {}): string {
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
  const rel = (i: number) => (cols[i] ? lengthTypst(cols[i], 'cm', 'auto', ['cm', 'mm', 'in', 'pt', 'em', '%', 'fr']) : null);
  if (widths.some((w) => w) || Object.keys(cols).length) {
    if (widths.every((w) => w) && !Object.keys(cols).length) {
      // 全部拖过 / 设过：按比例分，总宽由模板的版心定
      const min = Math.min(...(widths as number[]));
      columns = `(${widths.map((w) => `${(w! / min).toFixed(2)}fr`).join(', ')})`;
    } else {
      // 只设了几列：设了的按厘米，其余自动
      columns = `(${widths.map((w, i) => rel(i) ?? (w ? `${(w / 37.8).toFixed(2)}cm` : 'auto')).join(', ')})`;
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
  // iota-table：主文件里定义的壳，列宽超过版心就压回来（serialize.ts TABLE_RULE）
  return `iota-table(\n    columns: ${columns},${rowsArg}\n    align: center + horizon,\n${lines.join('\n')}\n  )`;
}

function serializeList(node: PMNode, marker: '-' | '+', opts: SerializeOptions, depth: number): string {
  const indent = '  '.repeat(depth);
  const items = (node.content ?? []).filter((n) => n.type === 'listItem');
  return items.map((item) => {
    const parts: string[] = [];
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph') parts.push(isEmptyParagraph(child) ? blankItem(opts, child) : serializeInline(child.content, opts) + paraEnd(opts, child));
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
      // 带参数的标题走模板的函数式写法 #chapter(numbering: none, openright: true, two-hanzi: false)[…]
      // （section / subsection / subsubsection 同形，只收 numbering）；什么都不改就是 = 标题
      const fnArgs: string[] = [];
      if (n.attrs?.numbered === false) fnArgs.push('numbering: none');
      if (level === 1) {
        for (const [k, param] of [['openright', 'openright'], ['spread', 'two-hanzi']] as const) {
          const v = n.attrs?.[k];
          if (v === 'true' || v === 'false' || v === true || v === false) fnArgs.push(`${param}: ${v}`);
        }
      }
      if (fnArgs.length) return `#${['chapter', 'section', 'subsection', 'subsubsection'][level - 1]}(${fnArgs.join(', ')})[${zh}${en}]${label ? ` <${label}>` : ''}` + paraEnd(opts, n);
      return `${'='.repeat(level)} ${zh}${en}${label ? ` <${label}>` : ''}` + paraEnd(opts, n);
    }
    case 'figure': {
      const subs = parseSubs(n.attrs?.subs);
      const label = labelOf(n.attrs, 'fig');
      // 一张合成图（(a)(b) 画在图里）配连排分图题：分图条目都没有图、母图有图 → 单图 + 图题里的 #subs
      if (subs.length && n.attrs?.image && !subs.some((s) => s.image)) {
        const letter = (i: number) => 'abcdefghijklmnopqrstuvwxyz'[i] ?? String(i + 1);
        const subsArg = `#subs(${subs.map((s, i) => `[${(s.caption ?? '').trim() ? captionText(s.caption ?? '') : '#box[]'}${label ? ` <${label}-${letter(i)}>` : ''}]`).join(', ')},)`;
        const width = lengthTypst(n.attrs?.width ?? 8, 'cm', '8cm');
        return floatWrap(n, 'image', tag(opts, n, 'node', `#figure(\n  image(${JSON.stringify(`${opts.imageDir ?? 'images'}/${n.attrs.image}`)}, width: ${width}),\n  caption: [${caption(n, opts)}${subsArg}],${placementArg(n)}\n)`) + (label ? ` <${label}>` : ''));
      }
      if (subs.length) {
        // 分图：grid 里一张张排，分图题两档（模板：#subfigure 排在分图之下，#subs 连排在图题之下）
        const cols = Math.max(1, Math.min(4, Number(n.attrs?.columns) || 2));
        const under = n.attrs?.subMode !== 'caption';
        const letter = (i: number) => 'abcdefghijklmnopqrstuvwxyz'[i] ?? String(i + 1);
        const subLabel = (i: number) => (label ? ` <${label}-${letter(i)}>` : '');
        const img = (s: { image: string; width: string | number }) => `image(${JSON.stringify(`${opts.imageDir ?? 'images'}/${s.image}`)}, width: ${lengthTypst(s.width, 'cm', '6cm')})`;
        const cells = subs.filter((s) => s.image).map((s, i) => (under ? `    [#subfigure(${img(s)}, caption: [${escapeText(s.caption ?? '')}])${subLabel(i)}],` : `    ${img(s)},`));
        // 分图题连排那一档标签写在条目里（模板 README 的写法）；题空着时标签得有东西可挂，给个空盒
        const subsArg = under ? '' : `#subs(${subs.map((s, i) => `[${(s.caption ?? '').trim() ? escapeText(s.caption ?? '') : '#box[]'}${subLabel(i)}]`).join(', ')},)`;
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
      return floatWrap(n, 'table', tag(opts, n, 'node', `#figure(\n  kind: table,\n  caption: [${caption(n, opts)}],${placementArg(n)}\n  ${serializeTable(table, opts, String(n.attrs?.fit ?? 'content'), n.attrs?.colWidth ?? 2.5, n.attrs?.cols ?? {})},\n)`) + (label ? ` <${label}>` : ''));
    }
    case 'equation': {
      const src = String(n.attrs?.src ?? '').trim();
      if (!src) return '';
      if (!mathReady(src)) return tag(opts, n, 'node', '#box[]');
      const unnumbered = n.attrs?.numbered === false;
      const label = unnumbered ? '' : labelOf(n.attrs, 'eq');
      const body = n.attrs?.mode === 'typst' ? `$ ${src} $` : `#mitex(${backtick(src)})`;
      // 模板默认给行间公式编号；未编号公式需在局部禁用 numbering。
      if (unnumbered) return tag(opts, n, 'node', `#[#set math.equation(numbering: none)\n${body}]`);
      return tag(opts, n, 'node', body) + (label ? ` <${label}>` : '');
    }
    case 'eqdenote': {
      // 公式底下的「式中　x——…」：模板收原生 terms 语法，一行一个 / 符号: 说明
      const rows = parseDenoteRows(n.attrs?.rows);
      if (!rows.length) return '';
      const term = (sym: string, mode: string) => sym.split(/[、,，]/).map((x) => x.trim()).filter(Boolean).map((x) => !mathReady(x) ? '#box[]' : mode === 'typst' ? `$${x}$` : `#mi(${backtick(x)})`).join('、');
      const lines = rows.map((r, i) => {
        const meaning = r.meaning.trim();
        const body = opts.map ? mark('attr', opts.map.key, opts.map.posOf.get(n) ?? 0, (opts.map.posOf.get(n) ?? 0) + 1, escapeText(meaning), { attr: `rows.${i}.meaning`, raw: meaning }) : escapeText(meaning);
        return `  / ${term(r.symbol, r.mode)}: ${body}`;
      });
      const lead = n.attrs?.lead === 'none' ? 'lead: none' : n.attrs?.lead && n.attrs.lead !== 'auto' ? `lead: [${escapeText(String(n.attrs.lead))}]` : '';
      return tag(opts, n, 'node', `#eqdenote(${lead})[\n${lines.join('\n')}\n]`);
    }
    case 'codeBlock': {
      const lang = String(n.attrs?.language ?? '').trim().replace(/[^A-Za-z0-9_+.-]/g, '');
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
      const io = parseIo(n.attrs?.io).map((t) => `  - ${escapeText(t.trim())}`);
      const lines = parseLines(n.attrs?.lines).filter((l) => l.text.trim()).map((l) => `  ${'  '.repeat(Math.max(0, Math.min(8, Number(l.level) || 0)))}+ ${escapeText(l.text.trim())}`);
      if (!lines.length) return '';
      const label = labelOf(n.attrs, 'alg');
      return tag(opts, n, 'node', `#figure(lovelace[\n${[...io, ...lines].join('\n')}\n], caption: [${caption(n, opts)}])`) + (label ? ` <${label}>` : '');
    }
    case 'theorem': {
      // 定理类环境：#theorem(note: [勾股])[…] <thm:label>；头与第一段同段由模板拼，证明不编号也不能引用
      const kind = theoremKind(n.attrs?.kind);
      const note = String(n.attrs?.note ?? '').trim();
      const body = serializeBlocks(n.content, opts, depth + 1);
      if (!unmarked(body).trim()) return '';
      const label = kind === 'proof' ? '' : labelOf(n.attrs, 'thm');
      const arg = note ? `(note: [${tag(opts, n, 'attr', escapeText(note), { attr: 'note', raw: note })}])` : '';
      return tag(opts, n, 'node', `#${kind}${arg}[\n${body}\n]`) + (label ? ` <${label}>` : '');
    }
    case 'blockquote':
      return `#quote(block: true)[\n${serializeBlocks(n.content, opts, depth + 1)}\n]`;
    case 'bulletList': return serializeList(n, '-', opts, depth);
    case 'orderedList': return serializeList(n, '+', opts, depth);
    case 'pageBreak': return '#pagebreak()';
    case 'horizontalRule': return '#line(length: 100%)';
    case 'enter': return `#enter(${Math.max(1, Math.min(100, Number(n.attrs?.n) || 1))})`;
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
  return mark('para', opts.map.key, pos + 1, end, '', n.attrs?.noIndent ? { attr: 'noindent' } : {});
}

/** 列表里的空项：预览放一个隐形 ¶ 当落点（正式排版就是空项） */
function blankItem(opts: SerializeOptions, n: PMNode): string {
  const p = opts.map?.posOf.get(n);
  if (!opts.preview || !opts.map || p === undefined) return '';
  return `#blank-item[${mark('text', opts.map.key, p + 1, p + 1, '¶', { attr: n.attrs?.noIndent ? 'blank0' : 'blank', raw: '' })}]`;
}

/** 一串空回车段：正式排 #enter(n)；预览排 #blanks[¶]…，每个 ¶ 映射到那个空段里面的位置 */
function blankRun(opts: SerializeOptions, blanks: PMNode[]): string {
  if (opts.preview && opts.map) {
    const key = opts.map.key;
    const out: string[] = [];
    let i = 0;
    while (i < blanks.length) {
      const noIndent = !!blanks[i].attrs?.noIndent;
      const run: string[] = [];
      while (i < blanks.length && !!blanks[i].attrs?.noIndent === noIndent) {
        const p = opts.map.posOf.get(blanks[i]);
        run.push(p === undefined ? '[¶]' : `[${mark('text', key, p + 1, p + 1, '¶', { attr: noIndent ? 'blank0' : 'blank', raw: '' })}]`);
        i++;
      }
      out.push(`#blanks${noIndent ? '(indent: false)' : ''}${run.join('')}`);
    }
    return out.join('\n\n');
  }
  return `#enter(${blanks.length})`;
}

export function serializeBlocks(nodes: PMNode[] = [], opts: SerializeOptions = {}, depth = 0): string {
  // 连着的空段落 = 用户敲的空回车，合成模板的 #enter(n)（真占一行的空段，Word 的写法）
  // 正式排版时首尾的空段落是编辑器自带的（空文档、末尾那个光标位），不算；预览里照 Word 一个不少地排——
  // 空着的一节、末尾那个光标位在页面上都得有个隐形 ¶ 可点，只在预览里写的人才有地方接着写
  const out: string[] = [];
  let blanks: PMNode[] = [];
  const edges = !!opts.preview;
  for (const n of nodes) {
    if (isEmptyParagraph(n)) { if (out.length || edges) blanks.push(n); continue; }
    const s = serializeBlock(n, opts, depth);
    if (!unmarked(s).trim()) continue;
    if (blanks.length) { out.push(blankRun(opts, blanks)); blanks = []; }
    out.push(s);
  }
  if (edges && blanks.length) out.push(blankRun(opts, blanks));
  return out.join('\n\n');
}

export function serializeDoc(doc: PMNode | undefined | null, opts: SerializeOptions = {}): string {
  if (!doc) return '';
  return serializeBlocks(doc.content, opts);
}

/** 文档里所有能被引用的东西：图、表、公式、标题（带 uid 的） */
export interface RefTarget {
  label: string;
  kind: 'fig' | 'tab' | 'eq' | 'sec' | 'alg' | 'lst' | 'thm';
  title: string;
  index: number;
}

export function collectRefTargets(doc: PMNode | undefined | null): RefTarget[] {
  const out: RefTarget[] = [];
  const counters = { fig: 0, tab: 0, eq: 0, sec: 0, alg: 0, lst: 0, thm: 0 };
  const walk = (n: PMNode) => {
    let kind: RefTarget['kind'] | null = null;
    let title = '';
    if (n.type === 'figure') { kind = 'fig'; title = n.attrs?.caption ?? ''; }
    else if (n.type === 'tableFigure') { kind = 'tab'; title = n.attrs?.caption ?? ''; }
    else if (n.type === 'equation' && n.attrs?.numbered !== false) { kind = 'eq'; title = n.attrs?.src ?? ''; }
    else if (n.type === 'heading') { kind = 'sec'; title = (n.content ?? []).map((t) => t.text ?? '').join(''); }
    else if (n.type === 'algorithm') { kind = 'alg'; title = n.attrs?.caption ?? ''; }
    else if (n.type === 'codeFigure') { kind = 'lst'; title = n.attrs?.caption ?? ''; }
    else if (n.type === 'theorem' && theoremKind(n.attrs?.kind) !== 'proof') { kind = 'thm'; title = (n.content ?? []).map((c) => (c.content ?? []).map((t) => t.text ?? '').join('')).join(' ').trim().slice(0, 60); }
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
    if (n.type === 'figure') { const subs = parseSubs(n.attrs?.subs); subs.forEach((s) => { if (s.image) out.add(String(s.image)); }); if (n.attrs?.image && (!subs.length || !subs.some((s) => s.image))) out.add(String(n.attrs.image)); }
    for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc);
  return [...out];
}

/** 文档里引用过的文献键 */
export function collectCiteKeys(doc: PMNode | undefined | null): Set<string> {
  const out = new Set<string>();
  const walk = (n: PMNode) => {
    if (n.type === 'cite') for (const k of String(n.attrs?.keys ?? '').split(/[,，;；\s]+/).map(safeLabel).filter(Boolean)) out.add(k);
    for (const a of ['caption', 'captionEn']) if (typeof n.attrs?.[a] === 'string') captionCiteKeys(n.attrs[a]).forEach((k) => out.add(k));
    if (n.type === 'figure') parseSubs(n.attrs?.subs).forEach((sub) => captionCiteKeys(String(sub.caption ?? '')).forEach((k) => out.add(k)));
    for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc);
  return out;
}
