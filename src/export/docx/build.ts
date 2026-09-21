// 直接从编辑器 JSON 生成 Word 文档。样式与页面参数由 template.ts 向 iota-hit 查询后映射为 OOXML。
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TabStopType, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, SectionType, Bookmark,
  FootnoteReferenceRun, TableOfContents, PageBreak, PageNumber, Header, Footer, NumberFormat, CommentRangeStart, CommentRangeEnd, CommentReference,
  ImportedXmlComponent, LineRuleType, DocumentGridType, ExternalHyperlink, VerticalAlign, SimpleField, type ParagraphChild, type ISectionOptions,
} from 'docx';
import { convertLatexToMathMl } from 'mathlive/ssr';
import JSZip from 'jszip';
import type { ThesisDoc, Settings, RichDoc, Comment } from '../../model/types';
import type { PMNode } from '../../typst/pmToTypst';
import { labelOf, CAPTION_CITE, captionCiteKeys } from '../../typst/pmToTypst';
import { computeNumbering, type NumberInfo } from '../../typst/numbering';
import { resolvePage } from '../../model/pages';
import { wordLinebreakOptions } from '../../typst/serialize';
import { parseLines } from '../../editor/extensions/algorithm';
import { imageBytes, imageDimensions } from '../../editor/imageCache';
import { mathmlToOmml } from './omml';
import { formatBibliography } from './bib';
import { renderTypstMath, type MathImage } from './typstMath';
import type { BibEntry } from '../../bib/bibtex';

import { fonts, fontsFor, NO_BORDERS, hasCJK } from './units';
import { coverPage, titlepageZh, titlepageEn, defensePage, declarationsPage, pageBreak } from './pages';
import { resolveSwitch, SWITCHES } from '../../model/options';
import { queryFacts, stylesXml, gapTwips, headingLevels, shown, tw, asianOf, type Facts, type PageSetup } from './template';
import { THEOREM_NAMES, theoremKind, joinHead } from '../../typst/theorem';

const DOC_TYPE = { bachelor: "本科毕业论文（设计）", master: "硕士学位论文", doctor: "博士学位论文" } as const;
const sw = <V,>(key: string, s: Settings): V => resolveSwitch<V>(SWITCHES.find((d) => d.key === key)!, s).effective;

// ── 上下文 ─────────────────────────────────────────────────────────
interface Ctx {
  doc: ThesisDoc; s: Settings;
  /** 模板交回的样式表、字体、各部件版面 */
  F: Facts;
  /** 文档级的页面设置：题注、装图段那些「几行」按它折缇 */
  P: PageSetup;
  nums: Map<string, NumberInfo>;
  /** 按节点对象记的号：标题、图表、公式没有 uid / 标签时也能编号 */
  byNode: Map<PMNode, NumberInfo>;
  cites: Map<string, number>;
  footnotes: Record<number, { children: Paragraph[] }>; nextFootnote: number;
  comments: { id: number; author: string; date: Date; children: Paragraph[] }[]; commentIds: Map<string, number>;
  images: Map<string, { data: ArrayBuffer; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number }>;
  abbrSeen: Set<string>;
  textWidth: number;
  /** Typst 写法的公式预先编成的图，键是 display + src */
  typstMath: Map<string, MathImage>;
}

const text = (n: PMNode): string => (n.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'hardBreak' ? '\n' : c.content ? text(c) : '')).join('');

/** LaTeX 先清一遍再喂 MathLive：\label、\tag、\nonumber、equation 环境壳、\hline 它不认；有几条命令它吐空或吐错，换成它认的写法 */
const cleanLatex = (src: string) => src
  .replace(/\\(label|tag\*?)\{[^}]*\}/g, '').replace(/\\nonumber|\\notag|\\displaystyle/g, '')
  .replace(/\\begin\{(equation|displaymath)\*?\}|\\end\{(equation|displaymath)\*?\}/g, '').replace(/\\hline/g, '')
  .replace(/\\overline\{/g, '\\bar{').replace(/\\overrightarrow\{/g, '\\vec{').replace(/\\mbox\{/g, '\\text{').replace(/\\hspace\{[^}]*\}/g, '\\quad ')
  .replace(/\\iff\b/g, '\\Leftrightarrow ').replace(/\\longrightarrow\b/g, '\\rightarrow ').replace(/\\longleftarrow\b/g, '\\leftarrow ').replace(/\\not=/g, '\\neq ')
  .replace(/\\bmod\b/g, '\\;\\mathrm{mod}\\;').replace(/\\liminf\b/g, '\\operatorname{lim\\,inf}').replace(/\\limsup\b/g, '\\operatorname{lim\\,sup}')
  .trim();
/** MathLive 的 MathML 导出会把这几条的内容丢掉（\underbrace{a+b} 只剩 ⏟）或干脆不认——直接退回画图 */
const UNSUPPORTED = /\\(underbrace|overbrace|underline|overleftrightarrow|overleftarrow|underrightarrow|underleftarrow|phantom|vphantom|hphantom|smash|substack|sideset|ce|SI|si|num|xrightarrow|xleftarrow|stackrel|overset|underset|mathring|widehat|widetilde|cancel|bcancel|xcancel|boxed|color|textcolor|begin\{(?:split|multline|gather|gathered|alignat|flalign|eqnarray)\*?\})/;
/** LaTeX → OMML；转不过就 null（merror、空、丢内容、抛错都算） */
function latexOmml(src: string, display: boolean, number: string): ParagraphChild | null {
  try {
    if (UNSUPPORTED.test(src)) return null;
    const mml = convertLatexToMathMl(cleanLatex(src));
    if (!mml || /<m(?:under|over)\s*>[^<]*<\/m(?:under|over)>/.test(mml)) return null;
    // fromXmlString 返回的是一个没名字的文档节点，真正的 m:oMath / m:oMathPara 是它的第一个孩子
    return (ImportedXmlComponent.fromXmlString(mathmlToOmml(mml, { display, number })) as any).root[0] as ParagraphChild;
  } catch { return null; }
}
function mathXml(src: string, mode: string, ctx?: Ctx, display = false, number = ''): ParagraphChild | null {
  const image = (key: string) => { const img = ctx?.typstMath.get(key); return img ? new ImageRun({ type: 'png', data: img.data, transformation: { width: img.width, height: img.height } }) : null; };
  if (mode === 'typst') return image(`${display ? 'D' : 'I'}${src}`);
  // LaTeX：Word 原生公式；MathLive / OMML 那条路转不过的，用引擎（mitex）画成图
  return latexOmml(src, display, number) ?? image(`L${display ? 'D' : 'I'}${src}`);
}
/** 编号、引用里汉字与数字之间的空格去掉：Word 自己会在中西文之间留一小段 */
const tidy = (s: string) => s.replace(/([\u4e00-\u9fff]) (?=[\dA-Za-z(（])/g, '$1').replace(/(?<=[\dA-Za-z)）]) ([\u4e00-\u9fff])/g, '$1');

function citeText(ctx: Ctx, keys: string[]): string {
  const ns = keys.map((k) => ctx.cites.get(k)).filter((n): n is number => n !== undefined).sort((a, b) => a - b);
  if (!ns.length) return '[?]';
  const parts: string[] = [];
  for (let i = 0; i < ns.length;) { let j = i; while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++; parts.push(j - i >= 2 ? `${ns[i]}-${ns[j]}` : ns.slice(i, j + 1).join(',')); i = j + 1; }
  return `[${parts.join(',')}]`;
}

// ── 行内 ─────────────────────────────────────────────────────────
function inline(ctx: Ctx, nodes: PMNode[] = [], base: { size?: number; font?: string; latinBold?: boolean } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  const open = new Set<string>();
  nodes.forEach((n, i) => {
    const marks = n.marks ?? [];
    const cids = marks.filter((m) => m.type === 'comment' && m.attrs?.commentId).map((m) => String(m.attrs!.commentId));
    for (const c of cids) if (!open.has(c) && ctx.commentIds.has(c)) { out.push(new CommentRangeStart(ctx.commentIds.get(c)!)); open.add(c); }
    const push = (r: ParagraphChild) => out.push(r);
    switch (n.type) {
      case 'text': {
        const has = (t: string) => marks.some((m) => m.type === t);
        const link = marks.find((m) => m.type === 'link');
        // 强调：默认像 Word 斜切（汉字也伪斜）；开了「强调排楷体」汉字换楷体、西文斜体。latin-bold（英文报告的标题）：只有西文那一截加粗，汉字照旧
        const kai = ctx.s.emphKaishu === true;
        const pieces = base.latinBold && !has('bold') ? (n.text ?? '').split(/(?<=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])(?=[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])|(?<=[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])(?=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/) : [n.text ?? ''];
        for (const piece of pieces) {
          const run = new TextRun({
            text: piece, bold: has('bold') || (base.latinBold && !hasCJK(piece)) || undefined, italics: (has('italic') && !(kai && hasCJK(piece))) || undefined, underline: has('underline') ? {} : undefined, strike: has('strike') || undefined,
            superScript: has('superscript') || undefined, subScript: has('subscript') || undefined,
            font: has('code') ? fonts(ctx.F.fonts.mono, ctx.F.fonts.mono) : has('italic') && kai ? fontsFor(piece, ctx.F.fonts.kaishu, ctx.F.fonts.serif) : base.font ? fontsFor(piece, base.font, ctx.F.fonts.serif) : undefined, size: base.size,
          });
          push(link ? new ExternalHyperlink({ link: String(link.attrs?.href ?? ''), children: [run] }) : run);
        }
        break;
      }
      case 'hardBreak': push(new TextRun({ break: 1 })); break;
      case 'mathInline': { const m = mathXml(String(n.attrs?.src ?? ''), String(n.attrs?.mode ?? 'latex'), ctx); push(m ?? new TextRun({ text: String(n.attrs?.src ?? ''), italics: true })); break; }
      case 'ref': {
        const target = String(n.attrs?.target ?? '');
        const t = ctx.nums.get(target);
        if (!t) { push(new TextRun({ text: '??', size: base.size })); break; }
        // 号那一段是 REF 域指着题注 / 标题里的书签，前后的「式」「节」照文字
        const ref = tidy(t.ref), num = tidy(t.number);
        const at = num ? ref.indexOf(num) : -1;
        if (at < 0) { push(new TextRun({ text: ref, size: base.size })); break; }
        if (at > 0) push(new TextRun({ text: ref.slice(0, at), size: base.size }));
        push(new SimpleField(`REF ${bmName(target)} \\h`, num));
        if (at + num.length < ref.length) push(new TextRun({ text: ref.slice(at + num.length), size: base.size }));
        break;
      }
      case 'cite': push(new TextRun({ text: citeText(ctx, String(n.attrs?.keys ?? '').split(/[,，;；\s]+/).filter(Boolean)), superScript: true })); break;
      case 'footnote': {
        const id = ctx.nextFootnote++;
        ctx.footnotes[id] = { children: [new Paragraph({ style: 'FootnoteText', children: [new TextRun({ text: String(n.attrs?.text ?? '') })] })] };
        push(new FootnoteReferenceRun(id));
        break;
      }
      case 'abbr': {
        const key = String(n.attrs?.key ?? '');
        const a = ctx.doc.abbreviations.find((x) => x.key === key);
        const short = a?.short || key;
        const first = a && !ctx.abbrSeen.has(key);
        if (first) ctx.abbrSeen.add(key);
        // 首次出现照模板展开：中文档「全称（英文全称，缩写）」，英文档「full name (ABBR)」
        push(new TextRun({ text: first ? (ctx.s.lang === 'en' ? `${a!.longEn || a!.long} (${short})` : `${a!.long}（${a!.longEn ? `${a!.longEn}，` : ''}${short}）`) : short, size: base.size }));
        break;
      }
      case 'ccwd': push(new TextRun({ text: '　'.repeat(Number(n.attrs?.n ?? 1)) })); break;
      case 'idx': push(new TextRun({ text: String(n.attrs?.text ?? ''), size: base.size })); break;
      default: if (n.content) out.push(...inline(ctx, n.content, base));
    }
    const next = nodes[i + 1];
    const nextIds = new Set((next?.marks ?? []).filter((m) => m.type === 'comment').map((m) => String(m.attrs?.commentId)));
    for (const c of [...open]) if (!nextIds.has(c)) { const id = ctx.commentIds.get(c)!; out.push(new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })); open.delete(c); }
  });
  return out;
}

// ── 块 ───────────────────────────────────────────────────────────
/** 另起一页的标记：组节时换成「分页符 + 连续分节符」，标题作为新一节的第一段，段前距在哪个兼容模式下都不会被吃掉 */
const NEW_PAGE = { newPage: true } as const;
type NewPage = typeof NEW_PAGE;
type Block = Paragraph | Table | NewPage;
const isNewPage = (b: Block): b is NewPage => b === NEW_PAGE;
const centered = (children: ParagraphChild[], extra: object = {}) => new Paragraph({ alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, children, ...extra });
/** 题注串：[@key] 排成上标的文献号 */
const captionRuns = (ctx: Ctx, s: string): TextRun[] => s.split(CAPTION_CITE).flatMap((piece, i) => (i % 2 ? [new TextRun({ text: citeText(ctx, piece.split(/[,，;；\s]+/).filter(Boolean)), superScript: true })] : piece ? [new TextRun({ text: piece })] : []));
/** 书签名：Word 只认字母数字下划线、40 字以内 */
const bmName = (label: string) => ('R' + label.replace(/[^A-Za-z0-9_]/g, '_')).slice(0, 40);
/** 号套进书签：正文里的 REF 域指着它，Word 里 F9 能更新、Ctrl+点能跳 */
const numRun = (ctx: Ctx, n: PMNode, prefix: string, text: string): ParagraphChild => {
  const label = labelOf(n.attrs, prefix);
  return label ? new Bookmark({ id: bmName(label), children: [new TextRun({ text })] }) : new TextRun({ text });
};
/** 题注。图题在图下：最后一段用 FigureCaption（段后 = 图块之下）；表题在表上：第一段用 TableCaption（段前 = 表块之上、与下段同页）；
 *  其余（双语的另一段、上下都不留的伪代码 / 代码清单）用光 Caption */
const captionPara = (ctx: Ctx, num: string, title: PMNode[] | string, en: string | undefined, opts: { kind: 'figure' | 'table' | 'plain'; node?: PMNode; prefix?: string; last?: boolean }) => {
  const kids = typeof title === 'string' ? captionRuns(ctx, title) : inline(ctx, title);
  const bilingual = ctx.s.lang !== 'en' && !!en && sw<boolean>('captionBilingual', ctx.s);
  const last = opts.last ?? true;
  const numKids: ParagraphChild[] = num ? [opts.node && opts.prefix ? numRun(ctx, opts.node, opts.prefix, num) : new TextRun({ text: num }), new TextRun({ text: '  ' })] : [];
  const figLast = (isLast: boolean) => (opts.kind === 'figure' && last && isLast ? 'FigureCaption' : 'Caption');
  const out = [new Paragraph({ style: opts.kind === 'table' ? 'TableCaption' : figLast(!bilingual), keepNext: opts.kind !== 'figure' || undefined, children: [...numKids, ...kids] })];
  if (bilingual) out.push(new Paragraph({ style: figLast(true), keepNext: opts.kind !== 'figure' || undefined, children: captionRuns(ctx, en!) }));
  return out;
};
/** 表块之下那几行：Word 的表自己不带段后距，用一个定高的空段 */
const gapPara = (twips: number) => new Paragraph({ spacing: { before: 0, after: 0, line: Math.max(1, twips), lineRule: LineRuleType.EXACT }, children: [] });
const numOf = (ctx: Ctx, n: PMNode, prefix: string) => tidy((ctx.byNode.get(n) ?? ctx.nums.get(labelOf(n.attrs, prefix)))?.number ?? '');

function image(ctx: Ctx, name: string, widthCm: number): ParagraphChild | null {
  const img = ctx.images.get(name);
  if (!img) return null;
  const w = widthCm / 2.54 * 96;
  return new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(w), height: Math.round(w * img.height / Math.max(1, img.width)) } });
}
const cmOf = (v: unknown, fallback: number) => { const m = /^\s*([\d.]+)\s*(cm|mm|pt|in|%)?\s*$/.exec(String(v ?? '')); if (!m) return typeof v === 'number' ? v : fallback; const n = parseFloat(m[1]); return m[2] === 'mm' ? n / 10 : m[2] === 'pt' ? n / 72 * 2.54 : m[2] === 'in' ? n * 2.54 : m[2] === '%' ? n / 100 * 14.6 : n; };

function figure(ctx: Ctx, n: PMNode): Block[] {
  const num = numOf(ctx, n, 'fig');
  let subs: { image: string; caption?: string; width?: unknown }[] = [];
  try { subs = JSON.parse(String(n.attrs?.subs || '[]')); } catch { /* */ }
  const letter = (i: number) => 'abcdefghijklmnopqrstuvwxyz'[i] ?? String(i + 1);
  // 合成图配连排分图题：图照单图排，分图题在图题下一行「(a) … (b) …」
  if (subs.length && n.attrs?.image && !subs.some((s) => s.image)) {
    const img = image(ctx, String(n.attrs.image), cmOf(n.attrs?.width, 8));
    return [new Paragraph({ style: 'Figure', children: img ? [img] : [] }), ...captionPara(ctx, num, String(n.attrs?.caption ?? ''), String(n.attrs?.captionEn ?? ''), { kind: 'figure', node: n, prefix: 'fig', last: false }), new Paragraph({ style: 'FigureCaption', children: [new TextRun({ text: subs.map((s, i) => `(${letter(i)}) ${s.caption ?? ''}`).join('  ') })] })];
  }
  if (subs.length) {
    const cols = Math.max(1, Math.min(4, Number(n.attrs?.columns) || 2));
    const rows: TableRow[] = [];
    for (let r = 0; r < subs.length; r += cols) {
      const cells = subs.slice(r, r + cols).map((s, k) => new TableCell({ borders: NO_BORDERS, verticalAlign: VerticalAlign.BOTTOM, children: [centered([image(ctx, s.image, cmOf(s.width, 6))].filter((x): x is ParagraphChild => !!x)), new Paragraph({ style: 'Caption', children: [new TextRun({ text: `(${letter(r + k)}) ${s.caption ?? ''}` })] })] }));
      while (cells.length < cols) cells.push(new TableCell({ borders: NO_BORDERS, children: [new Paragraph('')] }));
      rows.push(new TableRow({ children: cells }));
    }
    return [gapPara(gapTwips(ctx.F.styles.figure.image.above, ctx.P)), new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, alignment: AlignmentType.CENTER }), ...captionPara(ctx, num, String(n.attrs?.caption ?? ''), String(n.attrs?.captionEn ?? ''), { kind: 'figure', node: n, prefix: 'fig' })];
  }
  const img = image(ctx, String(n.attrs?.image ?? ''), cmOf(n.attrs?.width, 8));
  // 装图段（Figure：段前 = 图块之上、与下段同页）+ 题注（Caption：段后 = 图块之下）
  return [new Paragraph({ style: 'Figure', children: img ? [img] : [new TextRun({ text: `[图 ${n.attrs?.image ?? ''}]` })] }), ...captionPara(ctx, num, String(n.attrs?.caption ?? ''), String(n.attrs?.captionEn ?? ''), { kind: 'figure', node: n, prefix: 'fig' })];
}

/** 表：模板 figure.table 那张「表格」卡——三条线（stroke 的 top / header / bottom，没写的边就是无线）、单元格边距（inset）、表块上下那几行 */
function tableFigure(ctx: Ctx, n: PMNode): Block[] {
  const table = (n.content ?? []).find((c) => c.type === 'table');
  const rows = (table?.content ?? []).filter((r) => r.type === 'tableRow');
  const num = numOf(ctx, n, 'tab');
  const T = ctx.F.styles.figure.table;
  const stroke = typeof T.stroke === 'number' ? { top: T.stroke, bottom: T.stroke, left: T.stroke, right: T.stroke, 'inside-h': T.stroke, 'inside-v': T.stroke } : (T.stroke ?? {});
  const side = (k: string) => { const v = stroke[k]; return v ? { style: BorderStyle.SINGLE, size: Math.round(v * 8) } : { style: BorderStyle.NIL, size: 0 }; };
  const inset = typeof T.inset === 'number' ? { x: T.inset, y: T.inset } : (T.inset ?? {});
  const pad = (k: 'left' | 'right' | 'top' | 'bottom') => tw(inset[k] ?? (k === 'left' || k === 'right' ? inset.x : inset.y) ?? 0);
  const trs = rows.map((r, ri) => new TableRow({
    tableHeader: ri === 0,
    children: (r.content ?? []).map((c) => new TableCell({
      columnSpan: Number(c.attrs?.colspan) > 1 ? Number(c.attrs?.colspan) : undefined, rowSpan: Number(c.attrs?.rowspan) > 1 ? Number(c.attrs?.rowspan) : undefined,
      borders: { top: ri === 0 ? side('top') : side('inside-h'), bottom: ri === rows.length - 1 ? side('bottom') : ri === 0 ? side('header') : side('inside-h'), left: side('left'), right: side('right') },
      verticalAlign: VerticalAlign.CENTER,
      children: (c.content ?? []).map((p) => new Paragraph({ style: 'TableText', alignment: c.attrs?.align === 'left' ? AlignmentType.LEFT : c.attrs?.align === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER, children: inline(ctx, p.content) })),
    })),
  }));
  const fit = String(n.attrs?.fit ?? 'content');
  return [
    ...captionPara(ctx, num, String(n.attrs?.caption ?? ''), String(n.attrs?.captionEn ?? ''), { kind: 'table', node: n, prefix: 'tab' }),
    new Table({ rows: trs, width: fit === 'window' ? { size: 100, type: WidthType.PERCENTAGE } : { size: 0, type: WidthType.AUTO }, alignment: AlignmentType.CENTER, borders: { ...NO_BORDERS, insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top }, margins: { top: pad('top'), bottom: pad('bottom'), left: pad('left'), right: pad('right') } }),
    gapPara(gapTwips(T.below, ctx.P)),
  ];
}

function equation(ctx: Ctx, n: PMNode): Block[] {
  const num = n.attrs?.numbered === false ? '' : tidy((ctx.byNode.get(n) ?? ctx.nums.get(labelOf(n.attrs, 'eq')))?.number ?? '');
  const mode = String(n.attrs?.mode ?? 'latex');
  const mid = Math.round(ctx.textWidth / 2);
  const m = mathXml(String(n.attrs?.src ?? ''), mode, ctx, true);
  // LaTeX 是 Word 原生的显示公式（oMathPara 才按显示样式排分式、求和），Typst 是引擎画的图；
  // 它们没法和制表位的编号同段，编号放在一张无边框三栏表里：左空、中公式、右编号——Word 里常见的做法
  if (m) {
    const cell = (children: Paragraph[], pct: number) => new TableCell({ borders: NO_BORDERS, width: { size: pct, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children });
    return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [
      cell([new Paragraph({ indent: { firstLine: 0 }, children: [] })], 10),
      cell([new Paragraph({ indent: { firstLine: 0 }, alignment: AlignmentType.CENTER, children: [m] })], 80),
      cell([new Paragraph({ indent: { firstLine: 0 }, alignment: AlignmentType.RIGHT, children: num ? [numRun(ctx, n, 'eq', num)] : [] })], 10),
    ] })] })];
  }
  return [new Paragraph({
    indent: { firstLine: 0 }, alignment: AlignmentType.LEFT,
    tabStops: [{ type: TabStopType.CENTER, position: mid }, { type: TabStopType.RIGHT, position: ctx.textWidth }],
    children: [new TextRun({ text: '\t' }), m ?? new TextRun({ text: String(n.attrs?.src ?? ''), italics: true }), ...(num ? [new TextRun({ text: '\t' }), numRun(ctx, n, 'eq', num)] : [])],
  })];
}

function codeLines(ctx: Ctx, code: PMNode): Paragraph[] {
  const lines = text(code).split('\n');
  return lines.map((l) => new Paragraph({ style: 'Code', children: [new TextRun({ text: l || ' ' })] }));
}

function algorithm(ctx: Ctx, n: PMNode): Block[] {
  const num = numOf(ctx, n, 'alg');
  let io: string[] = [];
  try { const v = n.attrs?.io; io = Array.isArray(v) ? v : typeof v === 'string' && v.startsWith('[') ? JSON.parse(v) : String(v ?? '').split('\n'); } catch { /* */ }
  const lines = parseLines(n.attrs?.lines).filter((l) => l.text.trim());
  const top = { top: { style: BorderStyle.SINGLE, size: 12 } };
  const bottom = { bottom: { style: BorderStyle.SINGLE, size: 12 } };
  const body: Paragraph[] = [];
  const serif = fonts(ctx.F.fonts.serif, ctx.F.fonts.serif);
  io.filter((t) => t.trim()).forEach((t, i) => body.push(new Paragraph({ style: 'Code', border: i === 0 ? top : undefined, children: [new TextRun({ text: t.trim(), font: serif })] })));
  lines.forEach((l, i) => body.push(new Paragraph({ style: 'Code', border: i === lines.length - 1 ? bottom : i === 0 && !io.length ? top : undefined, indent: { left: (l.level ?? 0) * 2 * tw(ctx.P['font-size']), firstLine: 0 }, children: [new TextRun({ text: `${i + 1}: ${l.text.trim()}`, font: serif })] })));
  return [...captionPara(ctx, num, String(n.attrs?.caption ?? ''), undefined, { kind: 'plain', node: n, prefix: 'alg' }), ...body];
}

function heading(ctx: Ctx, n: PMNode, part: 'body' | 'appendix', forceBreak = false): Block[] {
  const level = Math.max(1, Math.min(4, Number(n.attrs?.level ?? 1)));
  const info = n.attrs?.numbered === false ? undefined : (ctx.byNode.get(n) ?? ctx.nums.get(labelOf(n.attrs, 'sec')));
  const num = info ? tidy(info.number) : '';
  const en = ctx.s.lang === 'en' ? String(n.attrs?.en ?? '') : '';
  const plain = text(n).trim();
  // 两字章名撑开（模板的 two-hanzi）：「绪论」→「绪　论」，目录里也照此印
  const spread = level === 1 && !en && sw<boolean>('titleSpread', ctx.s) && /^[\u4e00-\u9fff]{2}$/.test(plain);
  // 英文报告的标题西文加粗（模板样式的 latin-bold）；一级另起页看模板写进第一级样式的 page-break-before
  const st = ctx.F.styles[headingLevels(ctx.s)[level - 1]] ?? {};
  const latinBold = !!st['latin-bold'] && !st.bold;
  const kids = en ? [new TextRun({ text: en, bold: latinBold || undefined })] : spread ? [new TextRun({ text: `${plain[0]}\u3000${plain[1]}` })] : inline(ctx, n.content, { latinBold });
  const pageBreak = forceBreak || (level === 1 && !!ctx.F.styles[headingLevels(ctx.s)[0]]?.['page-break-before']);
  const para = new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][level - 1], children: [...(num ? [numRun(ctx, n, 'sec', num), new TextRun({ text: '  ', bold: latinBold || undefined })] : []), ...kids] });
  return pageBreak ? [pageTop(), para] : [para];
}

/** 定理类环境（模板 src/math/theorem.typ）：头（名＋号＋说明）与第一段同段、首行顶格，头后空一个字（theorem-body-indent 默认一字），
 *  头的字体照样式表 theorem.head（中文黑体、英文加粗）；号那一截打书签给 REF 域；后面的段照正文 */
function theorem(ctx: Ctx, n: PMNode, part: 'body' | 'appendix' | 'other', depth: number): Block[] {
  const kind = theoremKind(n.attrs?.kind);
  const num = ctx.byNode.get(n)?.number ?? THEOREM_NAMES[kind][ctx.s.lang === 'en' ? 'en' : 'zh'];
  const note = String(n.attrs?.note ?? '').trim();
  const st = ctx.F.styles.theorem?.head ?? {};
  const zhFont = asianOf(st) ? ctx.F.fonts[asianOf(st)!] : undefined;
  const bold = !!st.bold, latinBold = !!st['latin-bold'];
  const run = (text: string) => new TextRun({ text, bold: bold || (latinBold && !hasCJK(text)) || undefined, font: zhFont ? fontsFor(text, zhFont, ctx.F.fonts.serif) : undefined });
  const pieces = (text: string) => (latinBold && !bold ? text.split(/(?<=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])(?=[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])|(?<=[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])(?=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/) : [text]).filter(Boolean).map(run);
  const label = kind === 'proof' ? '' : labelOf(n.attrs, 'thm');
  const headRuns: ParagraphChild[] = [...(label ? [new Bookmark({ id: bmName(label), children: pieces(tidy(num)) })] : pieces(tidy(num))), ...pieces(joinHead(num, note).slice(num.length)), new TextRun({ text: '\u3000' })];
  const [first, ...rest] = n.content ?? [];
  const lead = first?.type === 'paragraph' ? inline(ctx, first.content) : [];
  const out: Block[] = [new Paragraph({ style: 'Normal', indent: { firstLine: 0, left: depth ? depth * 2 * tw(ctx.P['font-size']) : undefined }, children: [...headRuns, ...lead] })];
  out.push(...blocks(ctx, first?.type === 'paragraph' ? rest : n.content, part, depth));
  return out;
}

function blocks(ctx: Ctx, nodes: PMNode[] = [], part: 'body' | 'appendix' | 'other', depth = 0, breakFirst = false): Block[] {
  const out: Block[] = [];
  nodes = [...nodes];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    switch (n.type) {
      case 'paragraph': out.push(new Paragraph({ style: 'Normal', indent: n.attrs?.noIndent || depth ? { firstLine: 0, left: depth ? depth * 2 * tw(ctx.P['font-size']) : undefined } : undefined, children: inline(ctx, n.content) })); break;
      case 'heading': out.push(...heading(ctx, n, part === 'appendix' ? 'appendix' : 'body', breakFirst && !out.length)); break;
      case 'figure': out.push(...figure(ctx, n)); break;
      case 'tableFigure': out.push(...tableFigure(ctx, n)); break;
      case 'equation': out.push(...equation(ctx, n)); break;
      case 'codeBlock': out.push(...codeLines(ctx, n)); break;
      case 'codeFigure': { const code = (n.content ?? []).find((c) => c.type === 'codeBlock'); out.push(...captionPara(ctx, numOf(ctx, n, 'lst'), String(n.attrs?.caption ?? ''), undefined, { kind: 'plain', node: n, prefix: 'lst' }), ...(code ? codeLines(ctx, code) : [])); break; }
      case 'algorithm': out.push(...algorithm(ctx, n)); break;
      case 'theorem': out.push(...theorem(ctx, n, part, depth)); break;
      case 'bulletList': case 'orderedList': {
        (n.content ?? []).forEach((item, idx) => {
          const [first, ...rest] = item.content ?? [];
          const marker = n.type === 'orderedList' ? `（${(Number(n.attrs?.start) || 1) + idx}）` : '• ';
          if (first) out.push(new Paragraph({ style: 'Normal', indent: depth ? { left: depth * 2 * tw(ctx.P['font-size']) } : undefined, children: [new TextRun({ text: marker }), ...inline(ctx, first.type === 'paragraph' ? first.content : [first])] }));
          out.push(...blocks(ctx, rest, part, depth + 1));
        });
        break;
      }
      case 'blockquote': out.push(...blocks(ctx, n.content, part, depth + 1)); break;
      case 'horizontalRule': out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6 } }, children: [] })); break;
      case 'pageBreak': { const next = nodes[i + 1]; if (next?.type === 'heading') { out.push(...heading(ctx, next, part === 'appendix' ? 'appendix' : 'body', true)); i++; } else out.push(new Paragraph({ children: [new PageBreak()] })); break; }
      default: if (n.content) out.push(...blocks(ctx, n.content, part, depth));
    }
  }
  return out;
}

// ── 页 ───────────────────────────────────────────────────────────
// 另起一页的标题：Word 2013+ 模式把新页第一段的段前距吃掉（2003 模式不吃），靠段前分页不稳——
// 照 Word 排版的正规做法「分页符 + 连续分节符」：标题是新一节的第一段，段前距照留（组节见 pushParts）
const pageTop = (): Block => NEW_PAGE;
const titlePara = (t: string, newPage = true): Block[] => [...(newPage ? [pageTop()] : []), new Paragraph({ style: 'Abstract', children: [new TextRun({ text: t })] })];
function abstractPages(ctx: Ctx): Block[] {
  const { doc, s } = ctx;
  const out: Block[] = [];
  const zh = doc.abstractZh as PMNode, en = doc.abstractEn as PMNode;
  if (text(zh).trim()) {
    out.push(...titlePara('摘\u3000要', false), ...blocks(ctx, zh.content, 'other'));
    // 关键词前是真的一个空段（模板 enter(1, weak: true)，范例第 67 项也是空段），不是段前距
    if (doc.info.keywords?.length) out.push(new Paragraph({ style: 'Normal', indent: { firstLine: 0 }, children: [] }), new Paragraph({ style: 'Normal', indent: { firstLine: 0 }, children: [new TextRun({ text: "关键词：", font: fonts(ctx.F.fonts.heiti, ctx.F.fonts.serif) }), new TextRun({ text: doc.info.keywords.join('；') })] }));
  }
  if (text(en).trim()) {
    out.push(...titlePara('Abstract', out.length > 0), ...blocks(ctx, en.content, 'other'));
    if (doc.info.keywordsEn?.length) out.push(new Paragraph({ style: 'Normal', indent: { firstLine: 0 }, children: [] }), new Paragraph({ style: 'Normal', indent: { firstLine: 0 }, children: [new TextRun({ text: 'Keywords: ', bold: true }), new TextRun({ text: doc.info.keywordsEn.join(', ') })] }));
  }
  void s;
  return out;
}

/** 符号表、缩略语表的两列悬挂（模板 src/pages/terms.typ）：标签列 = 最宽的标签（不超版心 1/3，下限 2.5cm）+ 0.5cm 间距，两列都顶格靠左。
 *  标签是公式时后面垫一个零宽空格：光一个公式的段 Word 当显示公式居中排 */
function termRow(ctx: Ctx, labels: string[]) {
  const approx = (t: string) => [...t].reduce((w, c) => w + (hasCJK(c) ? 12 : 6), 0);
  const cap = (ctx.textWidth / 20) / 3;
  const labelW = Math.max(2.5 / 2.54 * 72, ...labels.map(approx).filter((w) => w <= cap)) + 0.5 / 2.54 * 72;
  const cell = (kids: ParagraphChild[], w?: number) => new TableCell({ borders: NO_BORDERS, margins: { top: 0, bottom: 0, left: 0, right: 0 }, width: w ? { size: tw(w), type: WidthType.DXA } : undefined, children: [new Paragraph({ indent: { firstLine: 0 }, alignment: AlignmentType.LEFT, children: kids })] });
  return (a: ParagraphChild[], b: string) => new TableRow({ children: [cell([...a, new TextRun({ text: '\u200b' })], labelW), cell([new TextRun({ text: b })])] });
}
function nomenclature(ctx: Ctx): Block[] {
  const { doc } = ctx;
  const out: Block[] = [];
  const wantSym = resolvePage(doc, 'symbolsPage').value && doc.symbols.length;
  const wantAbbr = resolvePage(doc, 'abbreviationsPage').value && doc.abbreviations.length;
  if (!wantSym && !wantAbbr) return out;
  // 两张都排且合成一页：「符号及缩略语」一个标题，两段各一个小标题（模板 nomenclatureMerged）
  if (wantSym && wantAbbr && resolvePage(doc, 'nomenclatureMerged').value) {
    const row = termRow(ctx, [...doc.symbols.map((e) => e.symbol), ...doc.abbreviations.map((a) => a.short || a.key)]);
    // 合并页的小标题默认照成果页的组名（模板 nomenclature form: auto → "achievements"，group-heading）
    const sub = (t: string) => new Paragraph({ style: 'GroupHeading', keepNext: true, children: [new TextRun({ text: t })] });
    out.push(...titlePara("符号及缩略语"), sub("物理量名称及符号表"));
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: doc.symbols.map((e) => row([mathXml(e.symbol, e.mode === 'typst' ? 'typst' : 'latex', ctx) ?? new TextRun({ text: e.symbol })], e.meaning)) }));
    out.push(sub("缩略语表"));
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: doc.abbreviations.map((a) => row([new TextRun({ text: a.short || a.key })], ctx.s.lang === 'en' ? a.longEn || a.long : a.long + (a.longEn ? `（${a.longEn}）` : ''))) }));
    return out;
  }
  const row = termRow(ctx, [...doc.symbols.map((e) => e.symbol), ...doc.abbreviations.map((a) => a.short || a.key)]);
  if (wantSym) {
    out.push(...titlePara("物理量名称及符号表"));
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: doc.symbols.map((e) => row([mathXml(e.symbol, e.mode === 'typst' ? 'typst' : 'latex', ctx) ?? new TextRun({ text: e.symbol })], e.meaning)) }));
  }
  if (wantAbbr) {
    out.push(...titlePara("缩略语表"));
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: doc.abbreviations.map((a) => row([new TextRun({ text: a.short || a.key })], ctx.s.lang === 'en' ? a.longEn || a.long : a.long + (a.longEn ? `（${a.longEn}）` : ''))) }));
  }
  return out;
}

/** 中文档的文献条目照模板（omni-gb7714）的标点：号、文献类型标识用全角方括号，条目内的逗号、冒号全角 */
const gbPunct = (l: string, lang: 'zh' | 'en') => (lang === 'en' ? l : l.replace(/\[/g, '［').replace(/\]/g, '］').replace(/, /g, '，').replace(/: /g, '：').replace(/］\. /g, '］. ').replace(/^(［\d+］) /, '$1'));
function references(ctx: Ctx): Block[] {
  // 先按引用序排引用过的；full: true（默认）再把没引用的按登记顺序接上
  const order = [...ctx.cites.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  const byKey = new Map(ctx.doc.references.map((e) => [e.key, e] as const));
  const cited = order.map((k) => byKey.get(k)).filter((e): e is BibEntry => !!e);
  const rest = ctx.s.bibliographyFull === false ? [] : ctx.doc.references.filter((e) => !ctx.cites.has(e.key));
  const entries = [...cited, ...rest];
  if (!entries.length) return [];
  const lang = ctx.s.lang === 'en' ? 'en' : 'zh';
  let lines: string[] = [];
  try { lines = formatBibliography(entries, lang); } catch { lines = entries.map((e, i) => `[${i + 1}] ${e.fields.title ?? e.key}`); }
  return [...titlePara("参考文献"), ...lines.map((l) => new Paragraph({ style: 'Reference', children: [new TextRun({ text: gbPunct(l, lang) })] }))];
}

function achievements(ctx: Ctx): Block[] {
  const entries = ctx.doc.achievementEntries ?? [];
  if (!resolvePage(ctx.doc, 'achievements').value || !entries.length) return [];
  let lines: string[] = [];
  try { lines = formatBibliography(entries.map((e) => ({ ...e, fields: Object.fromEntries(Object.entries(e.fields).filter(([k]) => k !== 'annote')) })), ctx.s.lang === 'en' ? 'en' : 'zh'); } catch { lines = entries.map((e, i) => `[${i + 1}] ${e.fields.title ?? e.key}`); }
  const degree = ctx.s.degreeLevel === 'doctor' ? "博士" : "硕士";
  return [...titlePara(`攻读${degree}学位期间取得创新性成果`), ...lines.map((l, i) => new Paragraph({ style: 'Reference', children: [new TextRun({ text: l + (entries[i]?.fields.annote ? entries[i].fields.annote : '') })] }))];
}

// ── 引用序、图片 ───────────────────────────────────────────────────
function collectCites(ctx: Ctx, docs: PMNode[]) {
  const add = (k: string) => { if (!ctx.cites.has(k)) ctx.cites.set(k, ctx.cites.size + 1); };
  const walk = (n: PMNode) => {
    if (n.type === 'cite') for (const k of String(n.attrs?.keys ?? '').split(/[,，;；\s]+/).filter(Boolean)) add(k);
    // 题注里的 [@key]，按出现顺序编号
    for (const a of ['caption', 'captionEn'] as const) if (typeof n.attrs?.[a] === 'string') captionCiteKeys(n.attrs[a]).forEach(add);
    if (typeof n.attrs?.subs === 'string') for (const sub of (() => { try { return JSON.parse(n.attrs.subs) as { caption?: string }[]; } catch { return []; } })()) captionCiteKeys(String(sub.caption ?? '')).forEach(add);
    for (const c of n.content ?? []) walk(c);
  };
  docs.forEach(walk);
}

async function loadImages(ctx: Ctx) {
  for (const img of ctx.doc.images) {
    const data = await imageBytes(img.name);
    if (!data) continue;
    const type = /jpe?g$/i.test(img.name) ? 'jpg' : /gif$/i.test(img.name) ? 'gif' : /bmp$/i.test(img.name) ? 'bmp' : 'png';
    let { width, height } = img;
    if (!width || !height) { const d = await imageDimensions(new Blob([data], { type: img.mime })); width = d?.width ?? 800; height = d?.height ?? 600; }
    ctx.images.set(img.name, { data, type, width: width!, height: height! });
  }
}

/** Typst 写法的公式（行内、行间、符号表里的）先用引擎编成图 */
async function renderTypstFormulas(ctx: Ctx) {
  const jobs = new Map<string, { src: string; display: boolean; latex?: boolean }>();
  // LaTeX 写法的先试一遍 MathML → OMML，转不过的也排进去画图
  const latexJob = (src: string, display: boolean) => { if (!latexOmml(src, display, '')) jobs.set(`L${display ? 'D' : 'I'}${src}`, { src, display, latex: true }); };
  const walk = (n: PMNode) => {
    if (n.type === 'mathInline' || n.type === 'equation') {
      const src = String(n.attrs?.src ?? ''), display = n.type === 'equation';
      if (n.attrs?.mode === 'typst') jobs.set(`${display ? 'D' : 'I'}${src}`, { src, display }); else latexJob(src, display);
    }
    for (const c of n.content ?? []) walk(c);
  };
  for (const k of ['abstractZh', 'abstractEn', 'body', 'conclusion', 'appendix', 'acknowledgement', 'resume'] as const) walk(ctx.doc[k] as PMNode);
  for (const e of ctx.doc.symbols) { if (e.mode === 'typst') jobs.set(`I${e.symbol}`, { src: e.symbol, display: false }); else latexJob(e.symbol, false); }
  for (const [key, j] of jobs) { try { const img = await renderTypstMath(j.src, j.display, !!j.latex); if (img) ctx.typstMath.set(key, img); } catch { /* 编不过就退成文字 */ } }
}

// ── 整篇 ─────────────────────────────────────────────────────────
export async function buildDocx(doc: ThesisDoc): Promise<Blob> {
  const s = doc.settings;
  const F = await queryFacts(doc);
  const P = F.layout.doc;
  const byNode = new Map<PMNode, NumberInfo>();
  const nums = new Map<string, NumberInfo>([...computeNumbering(doc.body as PMNode, s, 'body', byNode), ...computeNumbering(doc.appendix as PMNode, s, 'appendix', byNode)]);
  const ctx: Ctx = { doc, s, F, P, nums, byNode, cites: new Map(), footnotes: {}, nextFootnote: 1, comments: [], commentIds: new Map(), images: new Map(), abbrSeen: new Set(), textWidth: tw(P['paper-width'] - P.margin.left - P.margin.right), typstMath: new Map() };
  collectCites(ctx, [doc.body, doc.conclusion, doc.appendix] as PMNode[]);
  await loadImages(ctx);
  await renderTypstFormulas(ctx);
  (doc.comments ?? []).forEach((c: Comment, i) => {
    ctx.commentIds.set(c.id, i);
    ctx.comments.push({ id: i, author: c.author || "批注", date: new Date(c.createdAt || Date.now()), children: [new Paragraph({ indent: { firstLine: 0 }, children: [new TextRun({ text: c.text })] }), ...(c.replies ?? []).map((r) => new Paragraph({ indent: { firstLine: 0 }, children: [new TextRun({ text: `${r.author}：${r.text}` })] }))] });
  });

  const isReport = s.stage !== 'final';
  // 页眉：范例里校名式「哈尔滨工业大学博士学位论文」；博士双面交替，奇数页排本章章标题（STYLEREF 1 取当前标题 1）
  // 下边框在 Header 样式里（文档级版面的 header.border）；某一节的版面另给了边框才直接写在段上
  const sameBorder = (LL: PageSetup) => JSON.stringify(LL.header.border) === JSON.stringify(P.header.border);
  const headerPara = (LL: PageSetup, kids: ParagraphChild[]) => new Paragraph({ style: 'Header', ...(sameBorder(LL) ? {} : { border: LL.header.border ? { bottom: { style: LL.header.border.style === 'thin-thick-small-gap' ? BorderStyle.THIN_THICK_SMALL_GAP : BorderStyle.SINGLE, size: Math.round(LL.header.border.thickness * 8), space: Math.round(LL.header.border['from-text']) } } : {} }), children: kids });
  const school = `哈尔滨工业大学${DOC_TYPE[s.degreeLevel]}`;
  const alternating = s.degreeLevel === 'doctor' && !isReport;
  const oddHeader = (LL: PageSetup) => new Header({ children: [headerPara(LL, alternating ? [new SimpleField('STYLEREF 1 \\* MERGEFORMAT', school)] : [new TextRun({ text: school })])] });
  const plainHeader = (LL: PageSetup) => new Header({ children: [headerPara(LL, [new TextRun({ text: school })])] });
  // 页码：前置罗马、主体阿拉伯，都写成「- X -」（模板的样子；docx 库的 NUMBER_IN_DASH 会连目录里的页码也带上短横）
  const footerFor = () => new Footer({ children: [new Paragraph({ style: 'Footer', children: [new TextRun({ text: '- ' }), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun({ text: ' -' })] })] });
  // 节属性：页面设置对话框那张表——纸张、页边距、页眉页脚距边界、文档网格（无 / 只指定行 / 行和字符，字符网格的增量写成 charSpace）
  const props = (LL: PageSetup, roman: boolean, first: boolean) => {
    const g = LL.docgrid;
    const chars = LL.inputs.grid === 'lines-and-chars' || (LL.inputs.grid == null && g.tracking !== 0);
    return {
      page: {
        size: { width: tw(LL['paper-width']), height: tw(LL['paper-height']) },
        margin: { top: tw(LL.margin.top), bottom: tw(LL.margin.bottom), left: tw(LL.margin.left), right: tw(LL.margin.right), header: tw(LL.header['from-edge']), footer: tw(LL.footer['from-edge']) },
        pageNumbers: first ? { start: 1, formatType: roman ? NumberFormat.UPPER_ROMAN : NumberFormat.DECIMAL } : { formatType: roman ? NumberFormat.UPPER_ROMAN : NumberFormat.DECIMAL },
      },
      grid: g.grid ? { type: chars ? DocumentGridType.LINES_AND_CHARS : DocumentGridType.LINES, linePitch: tw(g['line-pitch']), charSpace: chars ? Math.round((g['char-pitch'] - LL['font-size']) * 4096) : undefined } : undefined,
    };
  };
  const pageLayout = (k: string, fallback: PageSetup) => F.pages[k] ?? fallback;

  const sections: ISectionOptions[] = [];
  // 封面、内封：没有页眉页脚页码，各占一页；各自的页级版面单独成节
  const Lfront = F.layout.front;
  const coverSections: { L: PageSetup; blocks: Block[] }[] = [];
  if (resolvePage(doc, 'cover').value) { const LL = pageLayout('cover', Lfront); coverSections.push({ L: LL, blocks: coverPage(doc, LL.margin.top) }); }
  if (!isReport && resolvePage(doc, 'titlepage').value) { const LL = pageLayout('titlepage', Lfront); coverSections.push({ L: LL, blocks: [...titlepageZh(doc, LL.margin.top), pageBreak(), ...titlepageEn(doc, LL.margin.top)] }); }
  for (let i = 0; i < coverSections.length; i++) {
    const c = coverSections[i], prev = coverSections[i - 1];
    // 版面相同的合成一节，页与页之间硬分页
    if (prev && JSON.stringify(prev.L) === JSON.stringify(c.L)) { const last = sections[sections.length - 1]; (last.children as (Paragraph | Table)[]).push(pageBreak(), ...c.blocks.filter((b): b is Paragraph | Table => !isNewPage(b))); continue; }
    sections.push({ properties: { ...props(c.L, false, false), titlePage: false }, children: c.blocks.filter((b): b is Paragraph | Table => !isNewPage(b)) });
  }
  // 开了奇偶页不同（博士）后每一节都要把 even 也给全，不然前置部分的偶数页页眉页脚是空的
  // 这一节不要页眉 / 页脚的：得给一个空的，不然 Word 沿用上一节的
  const blank = () => new Header({ children: [new Paragraph({ children: [] })] });
  const blankF = () => new Footer({ children: [new Paragraph({ children: [] })] });
  const hf = (LL: PageSetup, roman: boolean, first: boolean) => ({
    properties: props(LL, roman, first),
    headers: shown(LL.header, s) ? { default: roman ? plainHeader(LL) : oddHeader(LL), ...(alternating ? { even: plainHeader(LL) } : {}) } : { default: blank(), ...(alternating ? { even: blank() } : {}) },
    footers: shown(LL.footer, s) ? { default: footerFor(), ...(alternating ? { even: footerFor() } : {}) } : { default: blankF(), ...(alternating ? { even: blankF() } : {}) },
  });
  /** 一串「页 / 块」组成节：另起一页的地方（NEW_PAGE）＝ 上一节末尾一个分页符、下一节是连续分节符（页眉页脚、版面沿用），
   *  版面变了的另起「下一页」分节符并把页眉页脚重给；页码在一串里接着编 */
  type Sec = ISectionOptions & { __L?: string };
  const pushParts = (parts: { L: PageSetup; blocks: Block[] }[], roman: boolean) => {
    let firstOfRun = true;
    for (const part of parts) {
      const segs: (Paragraph | Table)[][] = [[]];
      for (const b of part.blocks) { if (isNewPage(b)) segs.push([]); else segs[segs.length - 1].push(b); }
      const key = JSON.stringify(part.L);
      for (const seg of segs) {
        if (!seg.length) continue;
        const last = sections[sections.length - 1] as Sec | undefined;
        if (last && last.__L === key && !firstOfRun) {
          // 同版面：分页符 + 连续分节符
          (last.children as (Paragraph | Table)[]).push(new Paragraph({ children: [new PageBreak()] }));
          sections.push({ properties: { ...props(part.L, roman, false), type: SectionType.CONTINUOUS }, children: seg, __L: key } as Sec);
        } else {
          sections.push({ ...hf(part.L, roman, firstOfRun), children: seg, __L: key } as Sec);
          firstOfRun = false;
        }
      }
    }
  };
  // 前置：摘要、Abstract、符号及缩略语、目录（罗马页码；顺序照模板）
  if (!isReport) {
    const parts: { L: PageSetup; blocks: Block[] }[] = [];
    parts.push({ L: pageLayout('abstract', Lfront), blocks: abstractPages(ctx) });
    parts.push({ L: pageLayout('nomenclature', Lfront), blocks: nomenclature(ctx) });
    if (resolvePage(doc, 'tableOfContents').value) {
      const any = parts.some((x) => x.blocks.length);
      parts.push({ L: pageLayout('toc', Lfront), blocks: [...(any ? [pageTop()] : []), new Paragraph({ style: 'FrontTitle', children: [new TextRun({ text: '目　录' })] }), new TableOfContents("目录", { hyperlink: true, headingStyleRange: '1-3', stylesWithLevels: [{ styleName: 'Abstract Title', level: 1 }] }) as unknown as Paragraph] });
    }
    pushParts(parts, true);
  }

  // 主体（阿拉伯页码）：正文、结论、参考文献、附录；后置：成果、答辩决议、声明、致谢、简历——顺序照模板
  const Lmain = F.layout.main, Lback = F.layout.back;
  const main: Block[] = [...blocks(ctx, (doc.body as PMNode).content, 'body')];
  const conclusion = doc.conclusion as PMNode;
  if (text(conclusion).trim()) main.push(...titlePara(isReport ? "结论" : '结　论'), ...blocks(ctx, conclusion.content, 'other'));
  const refs = references(ctx);
  if (refs.length) main.push(...refs);
  const appendix = doc.appendix as PMNode;
  if (resolvePage(doc, 'appendix').value && text(appendix).trim()) main.push(...blocks(ctx, appendix.content, 'appendix', 0, true));
  const back: { L: PageSetup; blocks: Block[] }[] = [];
  const ach = achievements(ctx);
  if (ach.length) back.push({ L: pageLayout('achievements', Lback), blocks: ach });
  if (!isReport && resolvePage(doc, 'defense').value) back.push({ L: Lback, blocks: defensePage(doc, titlePara("学位论文评阅人、答辩委员会名单及答辩决议")) });
  if (!isReport && resolvePage(doc, 'declarations').value) back.push({ L: pageLayout(s.degreeLevel === 'bachelor' ? 'declarations' : 'declarations-graduate', Lback), blocks: declarationsPage(doc, titlePara("哈尔滨工业大学学位论文原创性声明和使用权限"), (t) => new Paragraph({ style: 'SubTitle', children: [new TextRun({ text: t })] })) });
  const ack = doc.acknowledgement as PMNode;
  if (text(ack).trim()) back.push({ L: Lback, blocks: [...titlePara('致　谢'), ...blocks(ctx, ack.content, 'other')] });
  const resume = doc.resume as PMNode;
  if (resolvePage(doc, 'resume').value && text(resume).trim()) back.push({ L: Lback, blocks: [...titlePara("个人简历"), ...blocks(ctx, resume.content, 'other')] });
  pushParts([{ L: Lmain, blocks: main }, ...back], false);
  for (const sec of sections) delete (sec as { __L?: string }).__L;

  // 断行引擎那几个 Word 开关照样写进 docx：兼容模式、调整中西文字符宽度、断字；字体紧缩在 Normal 样式的 kern 上，
  // 标点压缩（characterSpacingControl）docx 库没有口，包好后往 settings.xml 里补
  const W = wordLinebreakOptions(s);
  const document = new Document({
    creator: doc.info.author || 'iota-hit', title: doc.info.title,
    numbering: { config: [] },
    footnotes: ctx.footnotes,
    comments: { children: ctx.comments },
    features: { updateFields: true },
    evenAndOddHeaderAndFooters: alternating,
    compatabilityModeVersion: W.compat,
    // 版式兼容选项照范例的 settings.xml：中文 Word 新建文档就带的那几条——表格里的行高对齐网格（不然表格一行排不到一个网格行）、
    // 下划线的字距 / 尾随空格、Shift+回车不撑满、反斜杠、远东版式；「平衡 SBCS / DBCS 字符」是用户的开关
    compatibility: { balanceSingleByteDoubleByteWidth: W.balance, adjustLineHeightInTable: true, useFELayout: true, spaceForUnderline: true, underlineTrailingSpaces: true, doNotLeaveBackslashAlone: true, doNotExpandShiftReturn: true },
    hyphenation: s.hyphenate === true ? { autoHyphenation: true, hyphenationZone: 360, consecutiveHyphenLimit: W.hyphenLimit || undefined, doNotHyphenateCaps: !W.hyphenateCaps } : undefined,
    sections,
  });
  const refCount = Math.max(ctx.doc.references.length, (ctx.doc.achievementEntries ?? []).length, 1);
  return postprocess(await Packer.toBlob(document), W, stylesXml(F, s, { hangingChars: hangingChars(refCount, s.lang === 'en' ? 'en' : 'zh') }));
}

/** 文献条目悬挂几个字：最宽的号「［12］」——全角方括号一个字一个、数字半个字（英文档半角方括号各三分之一）；模板（omni）是量号的宽 */
const hangingChars = (n: number, lang: 'zh' | 'en') => Math.round(((lang === 'zh' ? 2 : 0.67) + 0.5 * String(n).length) * 100) / 100;

/** 使用模板样式替换 docx 同名默认项，保留模板未提供的超链接、脚注引用和批注样式；
 *  同时在 settings.xml 中补充字符间距控制。 */
async function postprocess(blob: Blob, W: ReturnType<typeof wordLinebreakOptions>, sx: { docDefaults: string; styles: string[] }): Promise<Blob> {
  const zip = await JSZip.loadAsync(blob);
  const path = 'word/styles.xml';
  let xml = await zip.file(path)!.async('string');
  xml = xml.replace(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/, sx.docDefaults);
  const ids = new Set(sx.styles.map((x) => /w:styleId="([^"]+)"/.exec(x)![1]));
  xml = xml.replace(/<w:style [^>]*>[\s\S]*?<\/w:style>/g, (m) => (ids.has(/w:styleId="([^"]+)"/.exec(m)![1]) ? '' : m));
  xml = xml.replace('</w:styles>', sx.styles.join('') + '</w:styles>');
  zip.file(path, xml);
  // 首行缩进清零的段：Normal 写的是 firstLineChars（按字），直接格式里光写 firstLine=0 压不过它，Chars 也要清零
  const dp = 'word/document.xml';
  zip.file(dp, (await zip.file(dp)!.async('string')).replace(/<w:ind w:firstLine="0"\/>/g, '<w:ind w:firstLineChars="0" w:firstLine="0"/>').replace(/<w:ind w:left="(\d+)" w:firstLine="0"\/>/g, '<w:ind w:left="$1" w:firstLineChars="0" w:firstLine="0"/>'));
  // settings.xml：字符间距控制。放在 <w:compat> 前面（schema 里 characterSpacingControl 在 compat 之前）
  const sp = 'word/settings.xml';
  let sxml = await zip.file(sp)!.async('string');
  if (!sxml.includes('w:characterSpacingControl')) {
    const tag = `<w:characterSpacingControl w:val="${W.compress ? 'compressPunctuation' : 'doNotCompress'}"/>`;
    sxml = sxml.includes('<w:compat>') || sxml.includes('<w:compat/>') ? sxml.replace(/<w:compat\b/, tag + '<w:compat') : sxml.replace('</w:settings>', tag + '</w:settings>');
    zip.file(sp, sxml);
  }
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export type { RichDoc };
