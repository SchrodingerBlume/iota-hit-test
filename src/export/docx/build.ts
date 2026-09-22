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
import { labelOf, CAPTION_CITE, captionCiteKeys, parseDenoteRows } from '../../typst/pmToTypst';
import { parseSubs, subLayout, subNumber, CORNERS, type SubFig, type SubItem } from '../../typst/subfigs';
import { computeNumbering, type NumberInfo } from '../../typst/numbering';
import { resolvePage } from '../../model/pages';
import { wordLinebreakOptions } from '../../typst/serialize';
import { parseLines } from '../../editor/extensions/algorithm';
import { imageBytes, imageDimensions } from '../../editor/imageCache';
import { mathmlToOmml } from './omml';
import { formatBibliography } from './bib';
import { renderTypstMath, type MathImage } from './typstMath';
import type { BibEntry } from '../../bib/bibtex';
import { splitNames } from '../../bib/bibtex';

import { fonts, fontsFor, NO_BORDERS, hasCJK, PT } from './units';
import { coverPage, titlepageZh, titlepageEn, defensePage, declarationsPage } from './pages';
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
  /** 英文目录的条目（按出现顺序）：级、英文名、标题段上的书签；Word 的目录域只会照中文标题印，英文那份是静态条目 + PAGEREF 域 */
  toc: { level: number; text: string; bm: string }[];
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
        // 强调一律像 Word 斜切（汉字也伪斜）。latin-bold（英文报告的标题）：只有西文那一截加粗，汉字照旧
        const pieces = base.latinBold && !has('bold') ? (n.text ?? '').split(/(?<=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])(?=[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])|(?<=[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])(?=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/) : [n.text ?? ''];
        for (const piece of pieces) {
          const run = new TextRun({
            text: piece, bold: has('bold') || (base.latinBold && !hasCJK(piece)) || undefined, italics: has('italic') || undefined, underline: has('underline') ? {} : undefined, strike: has('strike') || undefined,
            superScript: has('superscript') || undefined, subScript: has('subscript') || undefined,
            font: has('code') ? fonts(ctx.F.fonts.mono, ctx.F.fonts.mono) : base.font ? fontsFor(piece, base.font, ctx.F.fonts.serif) : undefined, size: base.size,
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
        // 分图没有自己的书签：域指母图的号，(b) 照文字接在后面
        const parent = t.parent ? ctx.nums.get(t.parent) : undefined;
        if (parent && t.number.startsWith(parent.number)) { push(new SimpleField(`REF ${bmName(t.parent!)} \\h`, tidy(parent.number))); push(new TextRun({ text: t.number.slice(parent.number.length), size: base.size })); break; }
        // 号那一段是 REF 域指着题注 / 标题里的书签，前后的「式」「节」照文字
        const ref = tidy(t.ref), num = tidy(t.number);
        const at = num ? ref.indexOf(num) : -1;
        if (at < 0) { push(new TextRun({ text: ref, size: base.size })); break; }
        if (at > 0) push(new TextRun({ text: ref.slice(0, at), size: base.size }));
        push(new SimpleField(`REF ${bmName(target)} \\h`, num));
        if (at + num.length < ref.length) push(new TextRun({ text: ref.slice(at + num.length), size: base.size }));
        break;
      }
      case 'cite': {
        // Word 里只有顺序编码制：[1]，页码接在括号外（GB：序号外著录引文页码）；叙述式前面带首位责任者
        const keys = String(n.attrs?.keys ?? '').split(/[,，;；\s]+/).filter(Boolean);
        const sup = String(n.attrs?.supplement ?? '').trim();
        if (n.attrs?.form === 'prose' && keys.length === 1) { const who = splitNames(ctx.doc.references.find((e) => e.key === keys[0])?.fields.author ?? '')[0]; if (who) push(new TextRun({ text: `${who.replace(/,.*$/, '')} `, size: base.size })); }
        push(new TextRun({ text: citeText(ctx, keys) + sup, superScript: ctx.s.citeForm !== 'inline' || undefined }));
        break;
      }
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
/** 另起一页的标记：组节时从这里起新的一节（「下一页」分节符，节属性折进上一段的段落属性里，不多占一段——
 *  上一页排满时多出的那一段会掉到新页上，凭空多出一张白纸）；标题作为新一节的第一段，段前距在哪个兼容模式下都不会被吃掉。
 *  title：这一部分单页页眉印的名（摘要、结论那些没编号的部分）；没给的按 STYLEREF 1 取本章章标题 */
interface NewPage { readonly newPage: true; readonly title?: string }
type Block = Paragraph | Table | NewPage;
const isNewPage = (b: Block): b is NewPage => (b as NewPage).newPage === true;
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

/** 图注 / 表注（模板 note）：跟题注同字号字体，左起不缩进，引导词「注：」后面的续行悬挂到引导词之后 */
function notePara(ctx: Ctx, n: PMNode): Paragraph[] {
  let notes: { lead: string; text: string }[] = [];
  try { notes = JSON.parse(String(n.attrs?.notes || '[]')); } catch { /* */ }
  const zh = ctx.s.lang !== 'en';
  return notes.filter((x) => (x.text ?? '').trim()).map((x) => {
    const lead = (x.lead ?? '').trim();
    const head = !lead ? (zh ? '注：' : 'Note: ') : lead === '无' || lead === 'none' ? '' : lead + (hasCJK(lead) ? '' : ' ');
    const size = ctx.F.styles.figure.caption.size ?? 10.5;
    const hang = Math.round([...head].reduce((w, c) => w + (hasCJK(c) ? size : size * 0.5), 0) * PT);
    return new Paragraph({ style: 'Caption', alignment: AlignmentType.LEFT, keepNext: true, indent: { firstLine: 0, left: hang, hanging: hang }, children: [new TextRun({ text: head }), ...inline(ctx, [{ type: 'text', text: x.text.trim() }])] });
  });
}
/** 浮动体（figure(placement: top / bottom / auto)）：整块装进一个图文框（framePr），钉在版心顶 / 底（auto 当 top），与版心同宽，
 *  与正文的间距照图 / 表块的上下行数。Word 里图文框是随文流的：钉着它的那一页放得下就在那页，放不下整块挪到下一页——与 Typst 一样；
 *  （浮动表格 tblpPr 不行：放不下会被劈开跨页。）图文框只是段落属性，表格里每一段都要带同一份，所以这里只放起止记号，
 *  包好后往 XML 里每个 pPr 补 framePr（postprocess 的 frameFloats） */
function floatWrap(ctx: Ctx, n: PMNode, inner: Block[]): Block[] {
  const p = String(n.attrs?.placement ?? '');
  if (!['auto', 'top', 'bottom'].includes(p)) return inner;
  const T = n.type === 'tableFigure' ? ctx.F.styles.figure.table : ctx.F.styles.figure.image;
  const mark = (name: string) => new Paragraph({ children: [new Bookmark({ id: name, children: [] })] });
  return [mark(`FLOAT_${p === 'bottom' ? 'bottom' : 'top'}_${gapTwips(T.above, ctx.P)}_${ctx.textWidth}`), ...inner, mark('FLOATEND')];
}
/** 分图这一张的图上标签怎么印：角与字色，单张 mark / markFill 另有交代的按单张，none 不印 */
const subMark = (n: PMNode, s: SubFig): { corner: string; fill: string } | null => {
  const corner = s.mark && s.mark !== 'auto' ? s.mark : String(n.attrs?.subLabel ?? 'none');
  if (!(CORNERS as readonly string[]).includes(corner)) return null;
  return { corner, fill: s.markFill && s.markFill !== 'auto' ? s.markFill : String(n.attrs?.subLabelFill ?? 'black') };
};
const subKey = (image: string, num: string, m: { corner: string; fill: string }) => `${image}#${num}${m.corner}${m.fill}`;
function figure(ctx: Ctx, n: PMNode): Block[] {
  const num = numOf(ctx, n, 'fig');
  const subs = parseSubs(n.attrs?.subs);
  const pattern = sw<string>('subcaptionNumbering', ctx.s);
  const subNum = (i: number) => subNumber(pattern, i + 1);
  // 图上标签的写法可以跟整图另定（subLabelPattern），画进图里那份的键按它
  const markNum = (i: number) => subNumber(String(n.attrs?.subLabelPattern || '') || pattern, i + 1);
  const bilingual = ctx.s.lang !== 'en' && sw<boolean>('subcaptionBilingual', ctx.s);
  const subCap = (s: SubFig, i: number) => `${subNum(i)} ${s.caption ?? ''}${bilingual && (s.captionEn ?? '').trim() ? `  ${s.captionEn!.trim()}` : ''}`;
  // 合成图配连排分图题：图照单图排，分图题在图题下一行「(a) … (b) …」
  if (subs.length && n.attrs?.image && !subs.some((s) => s.image)) {
    const img = image(ctx, String(n.attrs.image), cmOf(n.attrs?.width, 8));
    return [new Paragraph({ style: 'Figure', children: img ? [img] : [] }), ...notePara(ctx, n), ...captionPara(ctx, num, String(n.attrs?.caption ?? ''), String(n.attrs?.captionEn ?? ''), { kind: 'figure', node: n, prefix: 'fig', last: false }), new Paragraph({ style: 'FigureCaption', children: [new TextRun({ text: subs.map(subCap).join('  ') })] })];
  }
  if (subs.length) {
    // 行 / 格 / 叠照 place（没写的按每行几张）：一行一张无边框表，叠是格里竖着的几段、叠里并排的再套一张表；
    // 图上标签预先画进图里的那一份（labelImages）；图与图的间距（gutter，默认一个字）折成格的左右边距
    const shown = subs.filter((s) => s.image);
    const gut = Math.round((n.attrs?.subGutter ? cmOf(n.attrs.subGutter, 0.42) : 0.42) / 2.54 * 1440 / 2);
    const one = (i: number, w: number): (Paragraph | Table)[] => {
      const s = shown[i]; const m = subMark(n, s);
      const key = m && ctx.images.has(subKey(s.image, markNum(i), m)) ? subKey(s.image, markNum(i), m) : s.image;
      return [centered([image(ctx, key, s.width && s.width !== 'auto' ? cmOf(s.width, w) : w)].filter((x): x is ParagraphChild => !!x)), new Paragraph({ style: 'Caption', children: [new TextRun({ text: subCap(s, i) })] })];
    };
    const cellOf = (kids: (Paragraph | Table)[], margin = gut) => new TableCell({ borders: NO_BORDERS, verticalAlign: VerticalAlign.BOTTOM, margins: { top: 0, bottom: 0, left: margin, right: margin }, children: kids });
    const rows = subLayout(shown, Number(n.attrs?.columns));
    const textCm = ctx.textWidth / 1440 * 2.54 * 0.9;
    const item = (it: SubItem, w: number): (Paragraph | Table)[] => (typeof it === 'number' ? one(it, w) : [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, alignment: AlignmentType.CENTER, borders: { ...NO_BORDERS, insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top }, rows: [new TableRow({ children: it.pair.map((k) => cellOf(one(k, w / it.pair.length), Math.round(gut / 2))) })] })]);
    const tables = rows.map((row) => {
      const w = textCm / row.length;
      return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, alignment: AlignmentType.CENTER, borders: { ...NO_BORDERS, insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top }, rows: [new TableRow({ children: row.map((c) => cellOf(typeof c === 'number' ? one(c, w) : c.stack.flatMap((it) => item(it, w)))) })] });
    });
    // 行与行之间隔一个间距（模板 v(g)）；两张表挨着 Word 会并成一张
    const rowsOut = tables.flatMap((tb, i) => (i ? [gapPara(2 * gut), tb] : [tb]));
    return [gapPara(gapTwips(ctx.F.styles.figure.image.above, ctx.P)), ...rowsOut, ...notePara(ctx, n), ...captionPara(ctx, num, String(n.attrs?.caption ?? ''), String(n.attrs?.captionEn ?? ''), { kind: 'figure', node: n, prefix: 'fig' })];
  }
  const img = image(ctx, String(n.attrs?.image ?? ''), cmOf(n.attrs?.width, 8));
  // 装图段（Figure：段前 = 图块之上、与下段同页）+ 题注（Caption：段后 = 图块之下）
  return [new Paragraph({ style: 'Figure', children: img ? [img] : [new TextRun({ text: `[图 ${n.attrs?.image ?? ''}]` })] }), ...notePara(ctx, n), ...captionPara(ctx, num, String(n.attrs?.caption ?? ''), String(n.attrs?.captionEn ?? ''), { kind: 'figure', node: n, prefix: 'fig' })];
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
  // 不许跨页的表（breakable: false）：行不拆、末行之前每一段都「与下段同页」——Word 里让整张表挪到下一页的正规做法
  const whole = String(n.attrs?.breakable ?? 'auto') === 'false';
  const trs = rows.map((r, ri) => new TableRow({
    tableHeader: ri === 0, cantSplit: whole || undefined,
    children: (r.content ?? []).map((c) => new TableCell({
      columnSpan: Number(c.attrs?.colspan) > 1 ? Number(c.attrs?.colspan) : undefined, rowSpan: Number(c.attrs?.rowspan) > 1 ? Number(c.attrs?.rowspan) : undefined,
      borders: { top: ri === 0 ? side('top') : side('inside-h'), bottom: ri === rows.length - 1 ? side('bottom') : ri === 0 ? side('header') : side('inside-h'), left: side('left'), right: side('right') },
      verticalAlign: VerticalAlign.CENTER,
      children: (c.content ?? []).map((p) => new Paragraph({ style: 'TableText', keepNext: (whole && ri < rows.length - 1) || undefined, alignment: c.attrs?.align === 'left' ? AlignmentType.LEFT : c.attrs?.align === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER, children: inline(ctx, p.content) })),
    })),
  }));
  const fit = String(n.attrs?.fit ?? 'content');
  return [
    ...captionPara(ctx, num, String(n.attrs?.caption ?? ''), String(n.attrs?.captionEn ?? ''), { kind: 'table', node: n, prefix: 'tab' }),
    new Table({ rows: trs, width: fit === 'window' ? { size: 100, type: WidthType.PERCENTAGE } : { size: 0, type: WidthType.AUTO }, alignment: AlignmentType.CENTER, borders: { ...NO_BORDERS, insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top }, margins: { top: pad('top'), bottom: pad('bottom'), left: pad('left'), right: pad('right') } }),
    ...notePara(ctx, n),
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

/** 公式底下的「式中　x——…」（模板 src/math/eqdenote.typ）：四栏——引导词（至少两字宽，后隔一字）、符号右对齐、破折号、说明；
 *  符号照公式画（Typst 写法是引擎的图、LaTeX 是 Word 公式），一个符号栏里几个用「、」隔 */
function eqdenote(ctx: Ctx, n: PMNode): Block[] {
  const rows = parseDenoteRows(n.attrs?.rows).filter((r) => (r.symbol ?? '').trim() || (r.meaning ?? '').trim());
  if (!rows.length) return [];
  const lead = n.attrs?.lead === 'none' ? '' : n.attrs?.lead && n.attrs.lead !== 'auto' ? String(n.attrs.lead) : ctx.s.lang === 'en' ? 'where' : '式中';
  const ch = tw(ctx.P['font-size']);
  const leadW = Math.max(2 * ch, Math.round([...lead].reduce((w, c) => w + (hasCJK(c) ? 1 : 0.5), 0) * ch)) + ch;
  // 符号栏的宽按最宽的符号估（命令算一个字、字母六成字宽、汉字一个字），Word 自动调整会把说明栏挤扁
  const approx = (t: string) => [...t.replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}^_\\$]/g, '')].reduce((w, c) => w + (hasCJK(c) ? 1 : 0.6), 0);
  const symW = Math.round(Math.max(1, ...rows.map((r) => approx(r.symbol ?? ''))) * ch) + Math.round(0.5 * ch);
  const widths = [leadW, symW, 2 * ch, Math.max(ch, ctx.textWidth - leadW - symW - 2 * ch)];
  const cell = (kids: ParagraphChild[], jc: (typeof AlignmentType)[keyof typeof AlignmentType], w: number) => new TableCell({ borders: NO_BORDERS, margins: { top: 0, bottom: 0, left: 0, right: 0 }, width: { size: w, type: WidthType.DXA }, children: [new Paragraph({ indent: { firstLine: 0 }, alignment: jc, children: kids })] });
  const sym = (r: { symbol: string; mode: string }) => r.symbol.split(/[、,，]/).map((x) => x.trim()).filter(Boolean).flatMap((x, i) => [...(i ? [new TextRun({ text: '、' })] : []), mathXml(x, r.mode === 'typst' ? 'typst' : 'latex', ctx) ?? new TextRun({ text: x, italics: true })]);
  const trs = rows.map((r, i) => new TableRow({ children: [cell(i === 0 && lead ? [new TextRun({ text: lead })] : [], AlignmentType.LEFT, widths[0]), cell([...sym(r), new TextRun({ text: '\u200b' })], AlignmentType.RIGHT, widths[1]), cell([new TextRun({ text: '——' })], AlignmentType.CENTER, widths[2]), cell([new TextRun({ text: (r.meaning ?? '').trim() })], AlignmentType.LEFT, widths[3])] }));
  return [new Table({ width: { size: ctx.textWidth, type: WidthType.DXA }, columnWidths: widths, layout: 'fixed' as any, borders: { ...NO_BORDERS, insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top }, rows: trs })];
}

/** 三线的线：模板 figure.table 的 stroke（top / header / bottom），伪代码与代码清单的框（tabular）借它 */
function ruleOf(ctx: Ctx, k: 'top' | 'header' | 'bottom') {
  const T = ctx.F.styles.figure.table;
  const v = typeof T.stroke === 'number' ? T.stroke : (T.stroke ?? {})[k];
  return v ? { style: BorderStyle.SINGLE, size: Math.round(v * 8) } : { style: BorderStyle.NIL, size: 0 };
}
/** 代码清单（模板 raw-style tabular）：行号悬在版心外（左缩进为负、制表位回到版心），上下各一条线；配色不搬 */
function codeLines(ctx: Ctx, code: PMNode, numbered = true): Paragraph[] {
  const lines = text(code).split('\n');
  const numW = 2 * tw(ctx.P['font-size']);
  return lines.map((l, i) => new Paragraph({
    style: 'Code',
    border: { ...(i === 0 ? { top: ruleOf(ctx, 'top') } : {}), ...(i === lines.length - 1 ? { bottom: ruleOf(ctx, 'bottom') } : {}) },
    ...(numbered ? { indent: { left: -numW, firstLine: 0 }, tabStops: [{ type: TabStopType.LEFT, position: 0 }] } : {}),
    children: numbered ? [new TextRun({ text: String(i + 1), color: '808080' }), new TextRun({ text: '\t' }), new TextRun({ text: l || ' ' })] : [new TextRun({ text: l || ' ' })],
  }));
}

const ALG_KEYWORDS = /\b(input|output|if|then|else|for|to|do|while|repeat|until|each|return|end|function|procedure|break|continue)\b/gi;
/** 伪代码（模板 lovelace 那一路，tabular 框）：两栏——号（1.5 字宽 + 半字间隔，输入输出行不编号）、行（按层缩进两字），
 *  关键词加粗大写（模板 algorithm-style.keyword-case 默认 upper），框的三条线借表格的 */
function algorithm(ctx: Ctx, n: PMNode): Block[] {
  const num = numOf(ctx, n, 'alg');
  let io: string[] = [];
  try { const v = n.attrs?.io; io = Array.isArray(v) ? v : typeof v === 'string' && v.startsWith('[') ? JSON.parse(v) : String(v ?? '').split('\n'); } catch { /* */ }
  io = io.filter((t) => t.trim());
  const lines = parseLines(n.attrs?.lines).filter((l) => l.text.trim());
  const ch = tw(ctx.P['font-size']);
  const serif = fonts(ctx.F.fonts.serif, ctx.F.fonts.serif);
  const runs = (t: string): TextRun[] => t.split(ALG_KEYWORDS).map((piece, i) => new TextRun({ text: i % 2 ? piece.toUpperCase() : piece, bold: i % 2 ? true : undefined, font: serif }));
  const all = [...io.map((t) => ({ t: t.trim(), level: 0, num: '' })), ...lines.map((l, i) => ({ t: l.text.trim(), level: l.level ?? 0, num: String(i + 1) }))];
  const cell = (kids: ParagraphChild[], w: number, o: { jc?: (typeof AlignmentType)[keyof typeof AlignmentType]; left?: number; right?: number; top?: boolean; header?: boolean; bottom?: boolean }) => new TableCell({
    width: { size: w, type: WidthType.DXA }, margins: { top: 0, bottom: 0, left: 0, right: o.right ?? 0 },
    borders: { left: { style: BorderStyle.NIL, size: 0 }, right: { style: BorderStyle.NIL, size: 0 }, top: o.top ? ruleOf(ctx, 'top') : { style: BorderStyle.NIL, size: 0 }, bottom: o.bottom ? ruleOf(ctx, 'bottom') : o.header ? ruleOf(ctx, 'header') : { style: BorderStyle.NIL, size: 0 } },
    children: [new Paragraph({ style: 'Code', alignment: o.jc ?? AlignmentType.LEFT, indent: { left: o.left ?? 0, firstLine: 0 }, children: kids })],
  });
  const trs = all.map((l, i) => {
    const flags = { top: i === 0, header: io.length > 0 && i === io.length - 1, bottom: i === all.length - 1 };
    return new TableRow({ cantSplit: true, children: [cell(l.num ? [new TextRun({ text: l.num, font: serif, size: Math.round((ctx.F.styles.figure.caption.size ?? 10.5) * 2) - 2 })] : [], Math.round(2 * ch), { jc: AlignmentType.RIGHT, right: Math.round(0.5 * ch), ...flags }), cell(runs(l.t), ctx.textWidth - Math.round(2 * ch), { left: l.level * 2 * ch, ...flags })] });
  });
  return [...captionPara(ctx, num, String(n.attrs?.caption ?? ''), undefined, { kind: 'plain', node: n, prefix: 'alg' }), new Table({ rows: trs, layout: 'fixed' as any, width: { size: ctx.textWidth, type: WidthType.DXA }, columnWidths: [Math.round(2 * ch), ctx.textWidth - Math.round(2 * ch)], borders: { ...NO_BORDERS, insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top } }), gapPara(gapTwips(ctx.F.styles.figure.table.below, ctx.P))];
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
  // 英文目录的条目：号照模板的英文式（Chapter 1 / 1.1；附录一级 Appendix、往下照中文的号），名取 #en 那半，没写的照中文
  const path = info?.path ?? [];
  const numEn = !info ? '' : part === 'appendix' ? num.replace(/^附录/, 'Appendix') : level === 1 ? `Chapter ${path[0]}` : path.join('.');
  // 书签不能套书签（docx 库会把里面那个写坏），目录用的这个只套标题文字，号那一截归 REF 用的
  const bm = `T${ctx.toc.length + 1}`;
  ctx.toc.push({ level, text: `${numEn ? `${numEn}  ` : ''}${String(n.attrs?.en ?? '').trim() || plain}`, bm });
  const para = new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][level - 1], children: [...(num ? [numRun(ctx, n, 'sec', num), new TextRun({ text: '  ', bold: latinBold || undefined })] : []), new Bookmark({ id: bm, children: kids })] });
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
      case 'figure': out.push(...floatWrap(ctx, n, figure(ctx, n))); break;
      case 'tableFigure': out.push(...floatWrap(ctx, n, tableFigure(ctx, n))); break;
      case 'equation': out.push(...equation(ctx, n)); break;
      case 'eqdenote': out.push(...eqdenote(ctx, n)); break;
      case 'codeBlock': out.push(...codeLines(ctx, n, false)); break;
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
const pageTop = (title?: string): Block => ({ newPage: true, title });
/** 没编号的部分的标题（摘要、结论、参考文献……）：另起一节、单页页眉印它；en 是英文目录里的名，标题段打书签给 PAGEREF 域 */
const titlePara = (ctx: Ctx, zh: string, en: string, enTitle = en): Block[] => {
  const bm = `T${ctx.toc.length + 1}`;
  ctx.toc.push({ level: 1, text: en, bm });
  const t = ctx.s.lang === 'en' ? enTitle : zh;
  return [pageTop(t), new Paragraph({ style: 'Abstract', children: [new Bookmark({ id: bm, children: [new TextRun({ text: t })] })] })];
};
function abstractPages(ctx: Ctx): Block[] {
  const { doc, s } = ctx;
  const out: Block[] = [];
  const zh = doc.abstractZh as PMNode, en = doc.abstractEn as PMNode;
  if (text(zh).trim()) {
    out.push(...titlePara(ctx, '摘\u3000要', 'Abstract (In Chinese)', '摘\u3000要'), ...blocks(ctx, zh.content, 'other'));
    // 关键词前是真的一个空段（模板 enter(1, weak: true)，范例第 67 项也是空段），不是段前距
    if (doc.info.keywords?.length) out.push(new Paragraph({ style: 'Normal', indent: { firstLine: 0 }, children: [] }), new Paragraph({ style: 'Normal', indent: { firstLine: 0 }, children: [new TextRun({ text: "关键词：", font: fonts(ctx.F.fonts.heiti, ctx.F.fonts.serif) }), new TextRun({ text: doc.info.keywords.join('；') })] }));
  }
  if (text(en).trim()) {
    out.push(...titlePara(ctx, 'Abstract', 'Abstract (In English)', 'Abstract'), ...blocks(ctx, en.content, 'other'));
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
    out.push(...titlePara(ctx, "符号及缩略语", 'Nomenclature'), sub("物理量名称及符号表"));
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: doc.symbols.map((e) => row([mathXml(e.symbol, e.mode === 'typst' ? 'typst' : 'latex', ctx) ?? new TextRun({ text: e.symbol })], e.meaning)) }));
    out.push(sub("缩略语表"));
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: doc.abbreviations.map((a) => row([new TextRun({ text: a.short || a.key })], ctx.s.lang === 'en' ? a.longEn || a.long : a.long + (a.longEn ? `（${a.longEn}）` : ''))) }));
    return out;
  }
  const row = termRow(ctx, [...doc.symbols.map((e) => e.symbol), ...doc.abbreviations.map((a) => a.short || a.key)]);
  if (wantSym) {
    out.push(...titlePara(ctx, "物理量名称及符号表", 'List of Physical Quantities and Symbols'));
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: doc.symbols.map((e) => row([mathXml(e.symbol, e.mode === 'typst' ? 'typst' : 'latex', ctx) ?? new TextRun({ text: e.symbol })], e.meaning)) }));
  }
  if (wantAbbr) {
    out.push(...titlePara(ctx, "缩略语表", 'List of Abbreviations'));
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
  return [...titlePara(ctx, "参考文献", 'References'), ...lines.map((l) => new Paragraph({ style: 'Reference', children: [new TextRun({ text: gbPunct(l, lang) })] }))];
}

function achievements(ctx: Ctx): Block[] {
  const entries = ctx.doc.achievementEntries ?? [];
  if (!resolvePage(ctx.doc, 'achievements').value || !entries.length) return [];
  let lines: string[] = [];
  try { lines = formatBibliography(entries.map((e) => ({ ...e, fields: Object.fromEntries(Object.entries(e.fields).filter(([k]) => k !== 'annote')) })), ctx.s.lang === 'en' ? 'en' : 'zh'); } catch { lines = entries.map((e, i) => `[${i + 1}] ${e.fields.title ?? e.key}`); }
  const degree = ctx.s.degreeLevel === 'doctor' ? "博士" : "硕士";
  return [...titlePara(ctx, `攻读${degree}学位期间取得创新性成果`, `Innovative achievements for ${ctx.s.degreeLevel === 'doctor' ? 'Ph.D' : 'Master'}`), ...lines.map((l, i) => new Paragraph({ style: 'Reference', children: [new TextRun({ text: l + (entries[i]?.fields.annote ? entries[i].fields.annote : '') })] }))];
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

/** 分图的图上标签（模板 subs(numbering: (alignment: 角, fill:))）：Word 里没有叠在图上的字，把「(a)」直接画进图的一份拷贝里——
 *  字号照题注（按图在版面上的宽换算成像素），角照 subLabel，黑字 / 白字照 subLabelFill，离边 3 磅 */
async function labelImages(ctx: Ctx) {
  const pattern = sw<string>('subcaptionNumbering', ctx.s);
  const jobs: { node: PMNode; sub: SubFig; num: string; m: { corner: string; fill: string } }[] = [];
  const walk = (n: PMNode) => {
    if (n.type === 'figure') parseSubs(n.attrs?.subs).filter((s) => s.image).forEach((sub, i) => { const m = subMark(n, sub); if (m) jobs.push({ node: n, sub, num: subNumber(String(n.attrs?.subLabelPattern || '') || pattern, i + 1), m }); });
    for (const c of n.content ?? []) walk(c);
  };
  for (const k of ['body', 'appendix'] as const) walk(ctx.doc[k] as PMNode);
  const zihao: Record<string, number> = { xiaosi: 12, wuhao: 10.5, xiaowu: 9, liuhao: 7.5 };
  for (const j of jobs) {
    const key = subKey(j.sub.image, j.num, j.m);
    const img = ctx.images.get(j.sub.image);
    if (!img || ctx.images.has(key)) continue;
    try {
      const bmp = await createImageBitmap(new Blob([img.data]));
      const canvas = document.createElement('canvas'); canvas.width = bmp.width; canvas.height = bmp.height;
      const g = canvas.getContext('2d'); if (!g) continue;
      g.drawImage(bmp, 0, 0);
      const scale = bmp.width / (cmOf(j.sub.width, 6) / 2.54 * 72);
      const { corner } = j.m, pad = 3 * scale;
      const size = zihao[String(j.node.attrs?.subLabelSize ?? '')] ?? 10.5;
      const font = String(j.node.attrs?.subLabelFont ?? '');
      g.font = `${size * scale}px ${font === 'serif' || font === 'songti' ? '"Times New Roman", "SimSun", serif' : font === 'heiti' ? '"SimHei", sans-serif' : font === 'kaishu' ? '"KaiTi", serif' : 'Arial, "SimHei", sans-serif'}`;
      g.fillStyle = j.m.fill === 'white' ? '#fff' : '#000';
      g.textBaseline = corner.startsWith('t') ? 'top' : 'bottom'; g.textAlign = corner.endsWith('l') ? 'left' : 'right';
      g.fillText(j.num, corner.endsWith('l') ? pad : bmp.width - pad, corner.startsWith('t') ? pad : bmp.height - pad);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (blob) ctx.images.set(key, { data: await blob.arrayBuffer(), type: 'png', width: bmp.width, height: bmp.height });
    } catch { /* 画不了就用原图 */ }
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
    if (n.type === 'eqdenote') for (const r of parseDenoteRows(n.attrs?.rows)) for (const x of (r.symbol ?? '').split(/[、,，]/).map((t) => t.trim()).filter(Boolean)) { if (r.mode === 'typst') jobs.set(`I${x}`, { src: x, display: false }); else latexJob(x, false); }
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
  const ctx: Ctx = { doc, s, F, P, nums, byNode, cites: new Map(), footnotes: {}, nextFootnote: 1, comments: [], commentIds: new Map(), images: new Map(), abbrSeen: new Set(), textWidth: tw(P['paper-width'] - P.margin.left - P.margin.right), typstMath: new Map(), toc: [] };
  collectCites(ctx, [doc.body, doc.conclusion, doc.appendix] as PMNode[]);
  await loadImages(ctx);
  await labelImages(ctx);
  await renderTypstFormulas(ctx);
  (doc.comments ?? []).forEach((c: Comment, i) => {
    ctx.commentIds.set(c.id, i);
    ctx.comments.push({ id: i, author: c.author || "批注", date: new Date(c.createdAt || Date.now()), children: [new Paragraph({ indent: { firstLine: 0 }, children: [new TextRun({ text: c.text })] }), ...(c.replies ?? []).map((r) => new Paragraph({ indent: { firstLine: 0 }, children: [new TextRun({ text: `${r.author}：${r.text}` })] }))] });
  });

  const isReport = s.stage !== 'final';
  // 页眉：范例里校名式「哈尔滨工业大学博士学位论文」；博士双面交替，奇数页排本部分的名——章是 STYLEREF 1 取当前标题 1，
  // 摘要、结论那些没编号的部分照字印（它们各自成节）。下边框在 Header 样式里（文档级版面的 header.border）；某一节的版面另给了边框才直接写在段上
  const sameBorder = (LL: PageSetup) => JSON.stringify(LL.header.border) === JSON.stringify(P.header.border);
  const headerPara = (LL: PageSetup, kids: ParagraphChild[]) => new Paragraph({ style: 'Header', ...(sameBorder(LL) ? {} : { border: LL.header.border ? { bottom: { style: LL.header.border.style === 'thin-thick-small-gap' ? BorderStyle.THIN_THICK_SMALL_GAP : BorderStyle.SINGLE, size: Math.round(LL.header.border.thickness * 8), space: Math.round(LL.header.border['from-text']) } } : {} }), children: kids });
  const school = `哈尔滨工业大学${DOC_TYPE[s.degreeLevel]}`;
  const alternating = s.degreeLevel === 'doctor' && !isReport;
  const oddHeader = (LL: PageSetup, title?: string) => new Header({ children: [headerPara(LL, !alternating ? [new TextRun({ text: school })] : title ? [new TextRun({ text: title })] : [new SimpleField('STYLEREF 1 \\* MERGEFORMAT', school)])] });
  const plainHeader = (LL: PageSetup) => new Header({ children: [headerPara(LL, [new TextRun({ text: school })])] });
  // 页码：前置罗马、主体阿拉伯，都写成「- X -」（模板的样子；docx 库的 NUMBER_IN_DASH 会连目录里的页码也带上短横）
  const footerFor = () => new Footer({ children: [new Paragraph({ style: 'Footer', children: [new TextRun({ text: '- ' }), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun({ text: ' -' })] })] });
  // 节属性：页面设置对话框那张表——纸张、页边距、页眉页脚距边界、文档网格（无 / 只指定行 / 行和字符，字符网格的增量写成 charSpace）
  const props = (LL: PageSetup, roman: boolean, first: boolean, odd = false) => {
    const g = LL.docgrid;
    const chars = LL.inputs.grid === 'lines-and-chars' || (LL.inputs.grid == null && g.tracking !== 0);
    return {
      type: odd ? SectionType.ODD_PAGE : SectionType.NEXT_PAGE,
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
  // 封面、内封：没有页眉页脚页码，各占一页、各自一节；博士的内封从奇数页起（模板 openright 只内封），后一节用「奇数页」分节符，Word 自己补白页
  const Lfront = F.layout.front;
  const openright = sw<boolean>('openright', s);
  const coverSections: { L: PageSetup; blocks: Block[] }[] = [];
  if (resolvePage(doc, 'cover').value) { const LL = pageLayout('cover', Lfront); coverSections.push({ L: LL, blocks: coverPage(doc, LL.margin.top) }); }
  if (!isReport && resolvePage(doc, 'titlepage').value) {
    const LL = pageLayout('titlepage', Lfront);
    coverSections.push({ L: LL, blocks: titlepageZh(doc, tw(LL['paper-width'] - LL.margin.left - LL.margin.right)) });
    if (s.degreeLevel !== 'bachelor') coverSections.push({ L: LL, blocks: titlepageEn(doc, LL.margin.top) });
  }
  const blank = () => new Header({ children: [new Paragraph({ children: [] })] });
  const blankF = () => new Footer({ children: [new Paragraph({ children: [] })] });
  coverSections.forEach((c, i) => sections.push({ properties: { ...props(c.L, false, false, openright && i > 0), titlePage: false }, headers: { default: blank(), ...(alternating ? { even: blank() } : {}) }, footers: { default: blankF(), ...(alternating ? { even: blankF() } : {}) }, children: c.blocks.filter((b): b is Paragraph | Table => !isNewPage(b)) }));
  // 开了奇偶页不同（博士）后每一节都要把 even 也给全，不然前置部分的偶数页页眉页脚是空的
  // 这一节不要页眉 / 页脚的：得给一个空的，不然 Word 沿用上一节的
  const hf = (LL: PageSetup, roman: boolean, first: boolean, title?: string, odd = false) => ({
    properties: props(LL, roman, first, odd),
    headers: shown(LL.header, s) ? { default: oddHeader(LL, title), ...(alternating ? { even: plainHeader(LL) } : {}) } : { default: blank(), ...(alternating ? { even: blank() } : {}) },
    footers: shown(LL.footer, s) ? { default: footerFor(), ...(alternating ? { even: footerFor() } : {}) } : { default: blankF(), ...(alternating ? { even: blankF() } : {}) },
  });
  /** 一串「页 / 块」组成节：另起一页的地方（NewPage）起新的一节（「下一页」分节符），页眉页脚重给（单页页眉按这一部分的名）；页码在一串里接着编 */
  const pushParts = (parts: { L: PageSetup; blocks: Block[] }[], roman: boolean, oddFirst = false) => {
    let firstOfRun = true;
    for (const part of parts) {
      const segs: { title?: string; blocks: (Paragraph | Table)[] }[] = [{ blocks: [] }];
      for (const b of part.blocks) {
        if (!isNewPage(b)) { segs[segs.length - 1].blocks.push(b); continue; }
        const last = segs[segs.length - 1];
        if (last.blocks.length) segs.push({ title: b.title, blocks: [] }); else last.title = b.title;
      }
      for (const seg of segs) {
        if (!seg.blocks.length) continue;
        sections.push({ ...hf(part.L, roman, firstOfRun, seg.title, firstOfRun && oddFirst), children: seg.blocks });
        firstOfRun = false;
      }
    }
  };
  // 前置：摘要、Abstract、符号及缩略语、目录（罗马页码；顺序照模板）——目录的英文那份要等全篇的条目齐了再排，所以主体先建块、后组节
  const front: { L: PageSetup; blocks: Block[] }[] = [];
  if (!isReport) {
    front.push({ L: pageLayout('abstract', Lfront), blocks: abstractPages(ctx) });
    front.push({ L: pageLayout('nomenclature', Lfront), blocks: nomenclature(ctx) });
  }

  // 主体（阿拉伯页码）：正文、结论、参考文献、附录；后置：成果、答辩决议、声明、致谢、简历——顺序照模板
  const Lmain = F.layout.main, Lback = F.layout.back;
  const main: Block[] = [...blocks(ctx, (doc.body as PMNode).content, 'body')];
  const conclusion = doc.conclusion as PMNode;
  if (text(conclusion).trim()) main.push(...titlePara(ctx, isReport ? "结论" : '结　论', 'Conclusions'), ...blocks(ctx, conclusion.content, 'other'));
  const refs = references(ctx);
  if (refs.length) main.push(...refs);
  const appendix = doc.appendix as PMNode;
  if (resolvePage(doc, 'appendix').value && text(appendix).trim()) main.push(...blocks(ctx, appendix.content, 'appendix', 0, true));
  const back: { L: PageSetup; blocks: Block[] }[] = [];
  const ach = achievements(ctx);
  if (ach.length) back.push({ L: pageLayout('achievements', Lback), blocks: ach });
  if (!isReport && resolvePage(doc, 'defense').value) back.push({ L: Lback, blocks: defensePage(doc, titlePara(ctx, "学位论文评阅人、答辩委员会名单及答辩决议", 'List of Dissertation Reviewers and Defense Committee and Defense Resolution')) });
  if (!isReport && resolvePage(doc, 'declarations').value) back.push({ L: pageLayout(s.degreeLevel === 'bachelor' ? 'declarations' : 'declarations-graduate', Lback), blocks: declarationsPage(doc, titlePara(ctx, "哈尔滨工业大学学位论文原创性声明和使用权限", 'Statement of copyright and Letter of authorization'), (t) => new Paragraph({ style: 'SubTitle', children: [new TextRun({ text: t })] })) });
  const ack = doc.acknowledgement as PMNode;
  if (text(ack).trim()) back.push({ L: Lback, blocks: [...titlePara(ctx, '致　谢', 'Acknowledgements'), ...blocks(ctx, ack.content, 'other')] });
  const resume = doc.resume as PMNode;
  if (resolvePage(doc, 'resume').value && text(resume).trim()) back.push({ L: Lback, blocks: [...titlePara(ctx, "个人简历", 'Resume'), ...blocks(ctx, resume.content, 'other')] });

  // 目录：中文那份是 Word 的目录域（打开时更新）；英文那份（模板 lang: auto 博士两份）Word 没有，照条目静态排、页码用 PAGEREF 域指标题上的书签
  if (!isReport && resolvePage(doc, 'tableOfContents').value) {
    const want = sw<string>('tocLang', s);
    const tocBlocks: Block[] = [];
    // 英文档的标题本来就是英文，目录域照印；中文档只要英文那份时也得静态排
    if (s.lang === 'en' || want !== 'en') tocBlocks.push(pageTop(s.lang === 'en' ? 'Contents' : '目　录'), new Paragraph({ style: 'FrontTitle', children: [new TextRun({ text: s.lang === 'en' ? 'Contents' : '目　录' })] }), new TableOfContents("目录", { hyperlink: true, headingStyleRange: '1-3', stylesWithLevels: [{ styleName: 'Abstract Title', level: 1 }] }) as unknown as Paragraph);
    if (s.lang !== 'en' && want !== 'zh') {
      tocBlocks.push(pageTop('Contents'), new Paragraph({ style: 'FrontTitle', children: [new TextRun({ text: 'Contents', bold: true })] }));
      for (const e of ctx.toc) tocBlocks.push(new Paragraph({ style: `TOC${Math.min(3, e.level)}`, children: [new TextRun({ text: e.text, bold: e.level === 1 || undefined }), new TextRun({ text: '\t', bold: e.level === 1 || undefined }), new SimpleField(`PAGEREF ${e.bm} \\h`, '0')] }));
    }
    front.push({ L: pageLayout('toc', Lfront), blocks: tocBlocks });
  }
  pushParts(front, true, openright && coverSections.length > 0);
  pushParts([{ L: Lmain, blocks: main }, ...back], false);

  // 断行引擎那几个 Word 开关照样写进 docx：兼容模式、调整中西文字符宽度、断字；字体紧缩在 Normal 样式的 kern 上，
  // 标点压缩（characterSpacingControl）docx 库没有口，包好后往 settings.xml 里补
  const W = wordLinebreakOptions(s);
  const document = new Document({
    creator: doc.info.author || 'iota-hit', title: doc.info.title,
    numbering: { config: [] },
    footnotes: ctx.footnotes,
    comments: { children: ctx.comments },
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

/** 浮动体：起止记号（FLOAT_边_间距_宽 / FLOATEND 两个空书签段）之间每一段的 pPr 都补上同一份 framePr，记号段去掉。
 *  framePr 在 pPr 里排在 pStyle / keepNext / keepLines / pageBreakBefore 之后 */
function frameFloats(xml: string): string {
  const re = /<w:p><w:bookmarkStart w:name="FLOAT_(top|bottom)_(\d+)_(\d+)" w:id="\d+"\/><w:bookmarkEnd w:id="\d+"\/><\/w:p>([\s\S]*?)<w:p><w:bookmarkStart w:name="FLOATEND" w:id="\d+"\/><w:bookmarkEnd w:id="\d+"\/><\/w:p>/g;
  return xml.replace(re, (_, side, gap, width, body) => {
    const fr = `<w:framePr w:w="${width}" w:h="200" w:hRule="auto" w:hSpace="0" w:vSpace="${gap}" w:wrap="notBeside" w:hAnchor="margin" w:vAnchor="margin" w:xAlign="center" w:yAlign="${side}"/>`;
    return body
      .replace(/<w:pPr>((?:<w:pStyle[^>]*\/>)?(?:<w:keepNext[^>]*\/>)?(?:<w:keepLines[^>]*\/>)?(?:<w:pageBreakBefore[^>]*\/>)?)/g, (m: string, head: string) => `<w:pPr>${head}${fr}`)
      .replace(/<w:p>(?!<w:pPr>)/g, `<w:p><w:pPr>${fr}</w:pPr>`);
  });
}

/** docx 库把每一节的节属性写在一个只有它的空段里：上一页正好排满时这一段掉到新页上，凭空多一张白纸。
 *  节属性折进前一段的段落属性里（sectPr 是 pPr 的最后一项）；前面是表格的折不了，把那一段压到 1 缇高 */
function foldSectPr(xml: string): string {
  const re = /<w:p><w:pPr><w:sectPr>([\s\S]*?)<\/w:sectPr><\/w:pPr><\/w:p>/g;
  let out = '', pos = 0, m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const before = xml.slice(pos, m.index);
    const sect = `<w:sectPr>${m[1]}</w:sectPr>`;
    if (before.endsWith('</w:p>')) {
      const at = Math.max(before.lastIndexOf('<w:p>'), before.lastIndexOf('<w:p '));
      const para = before.slice(at);
      const ppr = para.indexOf('</w:pPr>');
      const folded = ppr >= 0 ? para.slice(0, ppr) + sect + para.slice(ppr) : para.replace(/^<w:p(?: [^>]*)?>/, (t) => `${t}<w:pPr>${sect}</w:pPr>`);
      out += before.slice(0, at) + folded;
    } else {
      out += before + `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>${sect}</w:pPr></w:p>`;
    }
    pos = m.index + m[0].length;
  }
  return out + xml.slice(pos);
}

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
  let dx = (await zip.file(dp)!.async('string')).replace(/<w:ind w:firstLine="0"\/>/g, '<w:ind w:firstLineChars="0" w:firstLine="0"/>').replace(/<w:ind w:left="(\d+)" w:firstLine="0"\/>/g, '<w:ind w:left="$1" w:firstLineChars="0" w:firstLine="0"/>');
  dx = frameFloats(dx);
  dx = foldSectPr(dx);
  // 脚注号画圈（模板用 quan 包画 ①②…）：Word 的 decimalEnclosedCircle，全文连续编号（模板不按页重编）；每一节的节属性里都写（settings.xml 里那份只是默认）
  dx = dx.replace(/<w:sectPr>([\s\S]*?)(<w:(?:type|pgSz)\b)/g, (_, refs, tag) => `<w:sectPr>${refs}<w:footnotePr><w:numFmt w:val="decimalEnclosedCircle"/></w:footnotePr>${tag}`);
  // 不写 settings 的 updateFields（Word 打开就弹「是否更新该文档中的这些域」）：目录域本来就是 dirty 的，Word 开时静默算；
  // 英文目录的 PAGEREF 域也标 dirty，页码一并算出来；REF 域带着现成的号，不用更新
  dx = dx.replace(/<w:fldSimple w:instr="PAGEREF /g, '<w:fldSimple w:dirty="true" w:instr="PAGEREF ');
  // docx 库给每张图的 docPr 都写 id=1，按出现顺序重编
  let dp2 = 0;
  dx = dx.replace(/<wp:docPr id="\d+"/g, () => `<wp:docPr id="${++dp2}"`);
  // docx 库给每个书签都写 id=1；Word 认得但不合规，按出现顺序重编
  let bm = 0;
  dx = dx.replace(/<w:bookmarkStart w:name="([^"]*)" w:id="\d+"\/>([\s\S]*?)<w:bookmarkEnd w:id="\d+"\/>/g, (_, name, body) => { bm++; return `<w:bookmarkStart w:name="${name}" w:id="${bm}"/>${body}<w:bookmarkEnd w:id="${bm}"/>`; });
  zip.file(dp, dx);
  // settings.xml：字符间距控制。放在 <w:compat> 前面（schema 里 characterSpacingControl 在 compat 之前）
  const sp = 'word/settings.xml';
  let sxml = await zip.file(sp)!.async('string');
  if (!sxml.includes('w:characterSpacingControl')) {
    const tag = `<w:characterSpacingControl w:val="${W.compress ? 'compressPunctuation' : 'doNotCompress'}"/><w:footnotePr><w:numFmt w:val="decimalEnclosedCircle"/></w:footnotePr>`;
    sxml = sxml.includes('<w:compat>') || sxml.includes('<w:compat/>') ? sxml.replace(/<w:compat\b/, tag + '<w:compat') : sxml.replace('</w:settings>', tag + '</w:settings>');
    zip.file(sp, sxml);
  }
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export type { RichDoc };
