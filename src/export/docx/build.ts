// 从编辑器的 JSON 直接生成 Word 文档（docx 库），样式照学校范例：页面设置、文档网格、各级标题、题注、目录
// 的每个数都取自模板 iota-hit 的 config/layout.typ 与 config/styles.typ（那里是从范例 .docx 逐个量出来的）。
// 不经过 Typst；编号用 numbering.ts 算，参考文献用 GB/T 7714 的 CSL 排。封面 / 内封 / 声明页这些表单页第二阶段再做。
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TabStopType, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle,
  FootnoteReferenceRun, TableOfContents, PageBreak, PageNumber, Header, Footer, NumberFormat, CommentRangeStart, CommentRangeEnd, CommentReference,
  ImportedXmlComponent, LineRuleType, DocumentGridType, ExternalHyperlink, VerticalAlign, type ParagraphChild, type ISectionOptions,
} from 'docx';
import { convertLatexToMathMl } from 'mathlive/ssr';
import type { ThesisDoc, Settings, RichDoc, Comment } from '../../model/types';
import type { PMNode } from '../../typst/pmToTypst';
import { labelOf } from '../../typst/pmToTypst';
import { computeNumbering, type NumberInfo } from '../../typst/numbering';
import { resolvePage } from '../../model/pages';
import { parseLines } from '../../editor/extensions/algorithm';
import { imageBytes, imageDimensions } from '../../editor/imageCache';
import { mathmlToOmml } from './omml';
import { formatBibliography } from './bib';
import { renderTypstMath, type MathImage } from './typstMath';
import type { BibEntry } from '../../bib/bibtex';

// ── 尺寸：Word 的单位 ─────────────────────────────────────────────
const PT = 20;                 // 缇
const HALF = 2;                // 半磅（字号）
const cm = (v: number) => Math.round(v / 2.54 * 1440);
const ZIHAO = { erhao: 22, xiaoer: 18, sanhao: 16, xiaosan: 15, sihao: 14, xiaosi: 12, wuhao: 10.5, xiaowu: 9 };
const FONT = { zh: 'SimSun', hei: 'SimHei', kai: 'KaiTi', en: 'Times New Roman', mono: 'Courier New' };
const fonts = (zh = FONT.zh, en = FONT.en) => ({ ascii: en, hAnsi: en, eastAsia: zh, cs: en });
const A4 = { width: 11906, height: 16838 };

interface Layout { margin: { top: number; right: number; bottom: number; left: number; header: number; footer: number }; grid?: { linePitch: number; charSpace?: number }; line: number; firstLine: number; header: boolean; footer: boolean }
/** 页面设置：终稿一份，报告按校区 / 学位（config/layout.typ 那张表） */
function layoutOf(s: Settings): Layout {
  const report = s.stage !== 'final';
  if (!report) return { margin: { top: cm(3.8), right: cm(3), bottom: cm(3), left: cm(3), header: cm(3), footer: cm(2.3) }, grid: { linePitch: 391, charSpace: 1861 }, line: 391, firstLine: 498, header: true, footer: true };
  if (s.campus === 'shenzhen' && s.degreeLevel !== 'bachelor') {
    if (s.stage === 'proposal') return { margin: { top: cm(3.2), right: cm(2.8), bottom: cm(3), left: cm(3), header: cm(3), footer: cm(2.3) }, grid: { linePitch: 391, charSpace: 2661 }, line: 391, firstLine: 506, header: true, footer: true };
    return { margin: { top: cm(2.5), right: cm(2.5), bottom: cm(2.3), left: cm(2.5), header: cm(1.8), footer: cm(2.3) }, grid: { linePitch: 312 }, line: 240, firstLine: 480, header: true, footer: true };
  }
  if (s.degreeLevel === 'bachelor') return { margin: { top: cm(2.3), right: cm(2.3), bottom: cm(2.3), left: cm(2.3), header: 0, footer: 0 }, line: 240, firstLine: 480, header: false, footer: false };
  return { margin: { top: cm(2.5), right: cm(2.5), bottom: cm(2.5), left: cm(2.5), header: cm(1.5), footer: cm(2.3) }, grid: { linePitch: 312 }, line: 240, firstLine: 480, header: false, footer: true };
}
const DOC_TYPE = { bachelor: "本科毕业论文（设计）", master: "硕士学位论文", doctor: "博士学位论文" } as const;

// ── 样式表 ─────────────────────────────────────────────────────────
function styles(s: Settings, L: Layout) {
  const lines = (n: number) => Math.round(n * L.line);
  const isReport = s.stage !== 'final' && !(s.campus === 'shenzhen' && s.degreeLevel === 'bachelor');
  const hass = s.category === 'hass';
  // 报告的一级是节（小三），论文的一级是章（小二居中）
  const h1 = isReport
    ? { run: { size: ZIHAO.xiaosan * HALF, font: fonts(FONT.hei) }, paragraph: { spacing: { before: lines(0.5), after: lines(0.5), line: 300, lineRule: LineRuleType.AUTO } } }
    : { run: { size: ZIHAO.xiaoer * HALF, font: fonts(FONT.hei) }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: lines(1), after: lines(0.8), line: 300, lineRule: LineRuleType.AUTO } } };
  const sub = (size: number, gap: boolean) => ({ run: { size: size * HALF, font: fonts(FONT.hei) }, paragraph: { spacing: { before: gap ? lines(0.5) : 0, after: gap ? lines(0.5) : 0, line: 300, lineRule: LineRuleType.AUTO } } });
  const toc = (level: number) => ({ id: `TOC${level}`, name: `toc ${level}`, basedOn: 'Normal', next: 'Normal', run: { size: ZIHAO.xiaosi * HALF, font: fonts(level === 1 ? FONT.hei : FONT.zh) }, paragraph: { indent: { left: (level - 1) * 12 * PT, firstLine: 0 }, spacing: hass ? { line: 23 * PT, lineRule: LineRuleType.EXACT } : { line: s.degreeLevel === 'bachelor' ? 300 : 288, lineRule: LineRuleType.AUTO } } });
  return {
    default: { document: { run: { size: ZIHAO.xiaosi * HALF, font: fonts() }, paragraph: { spacing: { line: 300, lineRule: LineRuleType.AUTO }, alignment: AlignmentType.JUSTIFIED } } },
    paragraphStyles: [
      { id: 'Normal', name: 'Normal', run: { size: ZIHAO.xiaosi * HALF, font: fonts() }, paragraph: { indent: { firstLine: L.firstLine }, spacing: { line: 300, lineRule: LineRuleType.AUTO }, alignment: AlignmentType.JUSTIFIED } },
      { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, ...h1, paragraph: { ...h1.paragraph, indent: { firstLine: 0 }, outlineLevel: 0, keepNext: true } },
      { id: 'Heading2', name: 'heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, ...sub(isReport ? ZIHAO.sihao : ZIHAO.xiaosan, true), paragraph: { ...sub(ZIHAO.xiaosan, true).paragraph, indent: { firstLine: 0 }, outlineLevel: 1, keepNext: true, alignment: AlignmentType.LEFT } },
      { id: 'Heading3', name: 'heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, ...sub(isReport ? ZIHAO.xiaosi : ZIHAO.sihao, true), paragraph: { ...sub(ZIHAO.sihao, true).paragraph, indent: { firstLine: 0 }, outlineLevel: 2, keepNext: true, alignment: AlignmentType.LEFT } },
      { id: 'Heading4', name: 'heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, ...sub(ZIHAO.xiaosi, false), paragraph: { ...sub(ZIHAO.xiaosi, false).paragraph, indent: { firstLine: 0 }, outlineLevel: 3, keepNext: true, alignment: AlignmentType.LEFT } },
      { id: 'Caption', name: 'caption', basedOn: 'Normal', next: 'Normal', run: { size: ZIHAO.wuhao * HALF }, paragraph: { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { line: 300, lineRule: LineRuleType.AUTO }, keepNext: true } },
      { id: 'TableText', name: 'Table Text', basedOn: 'Normal', run: { size: ZIHAO.wuhao * HALF }, paragraph: { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { line: 240, lineRule: LineRuleType.AUTO } } },
      { id: 'Code', name: 'Code', basedOn: 'Normal', run: { size: ZIHAO.wuhao * HALF, font: fonts(FONT.mono, FONT.mono) }, paragraph: { indent: { firstLine: 0 }, spacing: { line: 240, lineRule: LineRuleType.AUTO }, alignment: AlignmentType.LEFT } },
      { id: 'Reference', name: 'Reference', basedOn: 'Normal', run: { size: ZIHAO.wuhao * HALF }, paragraph: { indent: { firstLine: 0, left: 24 * PT, hanging: 24 * PT }, spacing: { line: 300, lineRule: LineRuleType.AUTO } } },
      { id: 'FootnoteText', name: 'footnote text', basedOn: 'Normal', run: { size: ZIHAO.xiaowu * HALF }, paragraph: { indent: { firstLine: 0 }, spacing: { line: 240, lineRule: LineRuleType.AUTO } } },
      { id: 'Header', name: 'header', basedOn: 'Normal', run: { size: ZIHAO.xiaowu * HALF }, paragraph: { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { line: 240, lineRule: LineRuleType.AUTO } } },
      { id: 'Footer', name: 'footer', basedOn: 'Normal', run: { size: ZIHAO.xiaowu * HALF }, paragraph: { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { line: 240, lineRule: LineRuleType.AUTO } } },
      { id: 'Abstract', name: 'Abstract Title', basedOn: 'Heading1', next: 'Normal', paragraph: { outlineLevel: 0 } },
      toc(1), toc(2), toc(3), toc(4),
    ],
  };
}

// ── 上下文 ─────────────────────────────────────────────────────────
interface Ctx {
  doc: ThesisDoc; s: Settings; L: Layout;
  nums: Map<string, NumberInfo>;
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

function mathXml(src: string, mode: string, ctx?: Ctx, display = false, number = ''): ParagraphChild | null {
  try {
    if (mode === 'typst') {
      const img = ctx?.typstMath.get(`${display ? 'D' : 'I'}${src}`);
      return img ? new ImageRun({ type: 'png', data: img.data, transformation: { width: img.width, height: img.height } }) : null;
    }
    const mml = convertLatexToMathMl(src);
    if (!mml) return null;
    // fromXmlString 返回的是一个没名字的文档节点，真正的 m:oMath / m:oMathPara 是它的第一个孩子
    return (ImportedXmlComponent.fromXmlString(mathmlToOmml(mml, { display, number })) as any).root[0] as ParagraphChild;
  } catch { return null; }
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
function inline(ctx: Ctx, nodes: PMNode[] = [], base: { size?: number; font?: string } = {}): ParagraphChild[] {
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
        // 强调：汉字排楷体（指南与模板的做法），西文斜体
        const run = new TextRun({
          text: n.text ?? '', bold: has('bold') || undefined, italics: has('italic') || undefined, underline: has('underline') ? {} : undefined, strike: has('strike') || undefined,
          superScript: has('superscript') || undefined, subScript: has('subscript') || undefined,
          font: has('code') ? fonts(FONT.mono, FONT.mono) : has('italic') ? fonts(FONT.kai) : base.font ? fonts(base.font) : undefined, size: base.size,
        });
        push(link ? new ExternalHyperlink({ link: String(link.attrs?.href ?? ''), children: [run] }) : run);
        break;
      }
      case 'hardBreak': push(new TextRun({ break: 1 })); break;
      case 'mathInline': { const m = mathXml(String(n.attrs?.src ?? ''), String(n.attrs?.mode ?? 'latex'), ctx); push(m ?? new TextRun({ text: String(n.attrs?.src ?? ''), italics: true })); break; }
      case 'ref': { const t = ctx.nums.get(String(n.attrs?.target ?? '')); push(new TextRun({ text: t ? tidy(t.ref) : '??', size: base.size })); break; }
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
        push(new TextRun({ text: first ? (ctx.s.lang === 'en' ? `${a!.longEn || a!.long} (${short})` : `${a!.long}（${short}）`) : short, size: base.size }));
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
type Block = Paragraph | Table;
const centered = (children: ParagraphChild[], extra: object = {}) => new Paragraph({ alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, children, ...extra });
const captionPara = (ctx: Ctx, num: string, title: PMNode[] | string, en?: string) => {
  const kids = typeof title === 'string' ? [new TextRun({ text: title })] : inline(ctx, title);
  const out = [new Paragraph({ style: 'Caption', children: [new TextRun({ text: num ? `${num}  ` : '' }), ...kids] })];
  if (en && ctx.s.lang !== 'en') out.push(new Paragraph({ style: 'Caption', children: [new TextRun({ text: en })] }));
  return out;
};
const numOf = (ctx: Ctx, n: PMNode, prefix: string) => tidy(ctx.nums.get(labelOf(n.attrs, prefix))?.number ?? '');

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
  if (subs.length) {
    const cols = Math.max(1, Math.min(4, Number(n.attrs?.columns) || 2));
    const rows: TableRow[] = [];
    const letter = (i: number) => 'abcdefghijklmnopqrstuvwxyz'[i] ?? String(i + 1);
    for (let r = 0; r < subs.length; r += cols) {
      const cells = subs.slice(r, r + cols).map((s, k) => new TableCell({ borders: NO_BORDERS, verticalAlign: VerticalAlign.BOTTOM, children: [centered([image(ctx, s.image, cmOf(s.width, 6))].filter((x): x is ParagraphChild => !!x)), new Paragraph({ style: 'Caption', children: [new TextRun({ text: `(${letter(r + k)}) ${s.caption ?? ''}` })] })] }));
      while (cells.length < cols) cells.push(new TableCell({ borders: NO_BORDERS, children: [new Paragraph('')] }));
      rows.push(new TableRow({ children: cells }));
    }
    return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, alignment: AlignmentType.CENTER }), ...captionPara(ctx, num, String(n.attrs?.caption ?? ''), String(n.attrs?.captionEn ?? ''))];
  }
  const img = image(ctx, String(n.attrs?.image ?? ''), cmOf(n.attrs?.width, 8));
  return [centered(img ? [img] : [new TextRun({ text: `[图 ${n.attrs?.image ?? ''}]` })], { keepNext: true, spacing: { before: ctx.L.line } }), ...captionPara(ctx, num, String(n.attrs?.caption ?? ''), String(n.attrs?.captionEn ?? ''))];
}

const NO_BORDERS = { top: { style: BorderStyle.NIL, size: 0 }, bottom: { style: BorderStyle.NIL, size: 0 }, left: { style: BorderStyle.NIL, size: 0 }, right: { style: BorderStyle.NIL, size: 0 } } as const;

/** 三线表：顶线 1.5pt、表头下 1pt、底线 1.5pt */
function tableFigure(ctx: Ctx, n: PMNode): Block[] {
  const table = (n.content ?? []).find((c) => c.type === 'table');
  const rows = (table?.content ?? []).filter((r) => r.type === 'tableRow');
  const num = numOf(ctx, n, 'tab');
  const nil = { style: BorderStyle.NIL, size: 0 };
  const line = (pt: number) => ({ style: BorderStyle.SINGLE, size: pt * 8 });
  const trs = rows.map((r, ri) => new TableRow({
    tableHeader: ri === 0,
    children: (r.content ?? []).map((c) => new TableCell({
      columnSpan: Number(c.attrs?.colspan) > 1 ? Number(c.attrs?.colspan) : undefined, rowSpan: Number(c.attrs?.rowspan) > 1 ? Number(c.attrs?.rowspan) : undefined,
      borders: { top: ri === 0 ? line(1.5) : nil, bottom: ri === rows.length - 1 ? line(1.5) : ri === 0 ? line(1) : nil, left: nil, right: nil },
      verticalAlign: VerticalAlign.CENTER,
      children: (c.content ?? []).map((p) => new Paragraph({ style: 'TableText', alignment: c.attrs?.align === 'left' ? AlignmentType.LEFT : c.attrs?.align === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER, children: inline(ctx, p.content, { size: ZIHAO.wuhao * HALF }) })),
    })),
  }));
  return [...captionPara(ctx, num, String(n.attrs?.caption ?? ''), String(n.attrs?.captionEn ?? '')), new Table({ rows: trs, width: { size: 100, type: WidthType.PERCENTAGE }, alignment: AlignmentType.CENTER })];
}

function equation(ctx: Ctx, n: PMNode): Block[] {
  const num = n.attrs?.numbered === false ? '' : tidy(ctx.nums.get(labelOf(n.attrs, 'eq'))?.number ?? '');
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
      cell([new Paragraph({ indent: { firstLine: 0 }, alignment: AlignmentType.RIGHT, children: num ? [new TextRun({ text: num })] : [] })], 10),
    ] })] })];
  }
  return [new Paragraph({
    indent: { firstLine: 0 }, alignment: AlignmentType.LEFT,
    tabStops: [{ type: TabStopType.CENTER, position: mid }, { type: TabStopType.RIGHT, position: ctx.textWidth }],
    children: [new TextRun({ text: '\t' }), m ?? new TextRun({ text: String(n.attrs?.src ?? ''), italics: true }), ...(num ? [new TextRun({ text: `\t${num}` })] : [])],
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
  io.filter((t) => t.trim()).forEach((t, i) => body.push(new Paragraph({ style: 'Code', border: i === 0 ? top : undefined, children: [new TextRun({ text: t.trim(), font: fonts() })] })));
  lines.forEach((l, i) => body.push(new Paragraph({ style: 'Code', border: i === lines.length - 1 ? bottom : i === 0 && !io.length ? top : undefined, indent: { left: (l.level ?? 0) * 2 * 12 * PT, firstLine: 0 }, children: [new TextRun({ text: `${i + 1}: ${l.text.trim()}`, font: fonts() })] })));
  return [...captionPara(ctx, num, String(n.attrs?.caption ?? '')), ...body];
}

function heading(ctx: Ctx, n: PMNode, part: 'body' | 'appendix'): Paragraph {
  const level = Math.max(1, Math.min(4, Number(n.attrs?.level ?? 1)));
  const info = n.attrs?.numbered === false ? undefined : ctx.nums.get(labelOf(n.attrs, 'sec'));
  const num = info ? tidy(info.number) : '';
  const en = ctx.s.lang === 'en' ? String(n.attrs?.en ?? '') : '';
  const kids = en ? [new TextRun({ text: en })] : inline(ctx, n.content);
  const pageBreak = level === 1 && part === 'body' && !(ctx.s.stage !== 'final' && !(ctx.s.campus === 'shenzhen' && ctx.s.degreeLevel === 'bachelor')) && ctx.s.heading1Pagebreak !== false;
  return new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][level - 1], pageBreakBefore: pageBreak, children: [...(num ? [new TextRun({ text: `${num}  ` })] : []), ...kids] });
}

function blocks(ctx: Ctx, nodes: PMNode[] = [], part: 'body' | 'appendix' | 'other', depth = 0): Block[] {
  const out: Block[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'paragraph': out.push(new Paragraph({ style: 'Normal', indent: n.attrs?.noIndent || depth ? { firstLine: 0, left: depth ? depth * 24 * PT : undefined } : undefined, children: inline(ctx, n.content) })); break;
      case 'heading': out.push(heading(ctx, n, part === 'appendix' ? 'appendix' : 'body')); break;
      case 'figure': out.push(...figure(ctx, n)); break;
      case 'tableFigure': out.push(...tableFigure(ctx, n)); break;
      case 'equation': out.push(...equation(ctx, n)); break;
      case 'codeBlock': out.push(...codeLines(ctx, n)); break;
      case 'codeFigure': { const code = (n.content ?? []).find((c) => c.type === 'codeBlock'); out.push(...captionPara(ctx, numOf(ctx, n, 'lst'), String(n.attrs?.caption ?? '')), ...(code ? codeLines(ctx, code) : [])); break; }
      case 'algorithm': out.push(...algorithm(ctx, n)); break;
      case 'bulletList': case 'orderedList': {
        (n.content ?? []).forEach((item, idx) => {
          const [first, ...rest] = item.content ?? [];
          const marker = n.type === 'orderedList' ? `（${(Number(n.attrs?.start) || 1) + idx}）` : '• ';
          if (first) out.push(new Paragraph({ style: 'Normal', indent: { firstLine: ctx.L.firstLine, left: depth * 24 * PT }, children: [new TextRun({ text: marker }), ...inline(ctx, first.type === 'paragraph' ? first.content : [first])] }));
          out.push(...blocks(ctx, rest, part, depth + 1));
        });
        break;
      }
      case 'blockquote': out.push(...blocks(ctx, n.content, part, depth + 1)); break;
      case 'horizontalRule': out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6 } }, children: [] })); break;
      case 'pageBreak': out.push(new Paragraph({ children: [new PageBreak()] })); break;
      default: if (n.content) out.push(...blocks(ctx, n.content, part, depth));
    }
  }
  return out;
}

// ── 页 ───────────────────────────────────────────────────────────
const titlePara = (t: string) => new Paragraph({ style: 'Abstract', children: [new TextRun({ text: t })] });
function abstractPages(ctx: Ctx): Block[] {
  const { doc, s } = ctx;
  const out: Block[] = [];
  const zh = doc.abstractZh as PMNode, en = doc.abstractEn as PMNode;
  if (text(zh).trim()) {
    out.push(titlePara('摘\u3000要'), ...blocks(ctx, zh.content, 'other'));
    if (doc.info.keywords?.length) out.push(new Paragraph({ style: 'Normal', indent: { firstLine: 0 }, spacing: { before: ctx.L.line }, children: [new TextRun({ text: "关键词：", bold: true }), new TextRun({ text: doc.info.keywords.join('；') })] }));
  }
  if (text(en).trim()) {
    if (out.length) out.push(new Paragraph({ children: [new PageBreak()] }));
    out.push(titlePara('Abstract'), ...blocks(ctx, en.content, 'other'));
    if (doc.info.keywordsEn?.length) out.push(new Paragraph({ style: 'Normal', indent: { firstLine: 0 }, spacing: { before: ctx.L.line }, children: [new TextRun({ text: 'Keywords: ', bold: true }), new TextRun({ text: doc.info.keywordsEn.join(', ') })] }));
  }
  void s;
  return out;
}

function nomenclature(ctx: Ctx): Block[] {
  const { doc } = ctx;
  const out: Block[] = [];
  const wantSym = resolvePage(doc, 'symbolsPage').value && doc.symbols.length;
  const wantAbbr = resolvePage(doc, 'abbreviationsPage').value && doc.abbreviations.length;
  if (!wantSym && !wantAbbr) return out;
  const row = (a: ParagraphChild[], b: string) => new TableRow({ children: [new TableCell({ borders: NO_BORDERS, width: { size: 30, type: WidthType.PERCENTAGE }, children: [new Paragraph({ indent: { firstLine: 0 }, children: a })] }), new TableCell({ borders: NO_BORDERS, children: [new Paragraph({ indent: { firstLine: 0 }, children: [new TextRun({ text: b })] })] })] });
  if (wantSym) {
    out.push(titlePara("物理量名称及符号表"));
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: doc.symbols.map((e) => row([mathXml(e.symbol, e.mode ?? 'latex', ctx) ?? new TextRun({ text: e.symbol })], e.meaning)) }));
  }
  if (wantAbbr) {
    if (out.length) out.push(new Paragraph({ children: [new PageBreak()] }));
    out.push(titlePara("缩略语表"));
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: doc.abbreviations.map((a) => row([new TextRun({ text: a.short || a.key })], ctx.s.lang === 'en' ? a.longEn || a.long : a.long + (a.longEn ? `（${a.longEn}）` : ''))) }));
  }
  return out;
}

function references(ctx: Ctx): Block[] {
  const order = [...ctx.cites.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  const byKey = new Map(ctx.doc.references.map((e) => [e.key, e] as const));
  const entries = order.map((k) => byKey.get(k)).filter((e): e is BibEntry => !!e);
  if (!entries.length) return [];
  let lines: string[] = [];
  try { lines = formatBibliography(entries, ctx.s.lang === 'en' ? 'en' : 'zh'); } catch { lines = entries.map((e, i) => `[${i + 1}] ${e.fields.title ?? e.key}`); }
  return [titlePara("参考文献"), ...lines.map((l) => new Paragraph({ style: 'Reference', children: [new TextRun({ text: l })] }))];
}

function achievements(ctx: Ctx): Block[] {
  const entries = ctx.doc.achievementEntries ?? [];
  if (!resolvePage(ctx.doc, 'achievements').value || !entries.length) return [];
  let lines: string[] = [];
  try { lines = formatBibliography(entries.map((e) => ({ ...e, fields: Object.fromEntries(Object.entries(e.fields).filter(([k]) => k !== 'annote')) })), ctx.s.lang === 'en' ? 'en' : 'zh'); } catch { lines = entries.map((e, i) => `[${i + 1}] ${e.fields.title ?? e.key}`); }
  const degree = ctx.s.degreeLevel === 'doctor' ? "博士" : "硕士";
  return [titlePara(`攻读${degree}学位期间取得创新性成果`), ...lines.map((l, i) => new Paragraph({ style: 'Reference', children: [new TextRun({ text: l + (entries[i]?.fields.annote ? entries[i].fields.annote : '') })] }))];
}

// ── 引用序、图片 ───────────────────────────────────────────────────
function collectCites(ctx: Ctx, docs: PMNode[]) {
  const walk = (n: PMNode) => {
    if (n.type === 'cite') for (const k of String(n.attrs?.keys ?? '').split(/[,，;；\s]+/).filter(Boolean)) if (!ctx.cites.has(k)) ctx.cites.set(k, ctx.cites.size + 1);
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
  const jobs = new Map<string, { src: string; display: boolean }>();
  const walk = (n: PMNode) => {
    if (n.type === 'mathInline' && n.attrs?.mode === 'typst') jobs.set(`I${n.attrs.src}`, { src: String(n.attrs.src), display: false });
    if (n.type === 'equation' && n.attrs?.mode === 'typst') jobs.set(`D${n.attrs.src}`, { src: String(n.attrs.src), display: true });
    for (const c of n.content ?? []) walk(c);
  };
  for (const k of ['abstractZh', 'abstractEn', 'body', 'conclusion', 'appendix', 'acknowledgement', 'resume'] as const) walk(ctx.doc[k] as PMNode);
  for (const e of ctx.doc.symbols) if ((e.mode ?? 'latex') === 'typst') jobs.set(`I${e.symbol}`, { src: e.symbol, display: false });
  for (const [key, j] of jobs) { try { const img = await renderTypstMath(j.src, j.display); if (img) ctx.typstMath.set(key, img); } catch { /* 编不过就退成文字 */ } }
}

// ── 整篇 ─────────────────────────────────────────────────────────
export async function buildDocx(doc: ThesisDoc): Promise<Blob> {
  const s = doc.settings;
  const L = layoutOf(s);
  const nums = new Map<string, NumberInfo>([...computeNumbering(doc.body as PMNode, s, 'body'), ...computeNumbering(doc.appendix as PMNode, s, 'appendix')]);
  const ctx: Ctx = { doc, s, L, nums, cites: new Map(), footnotes: {}, nextFootnote: 1, comments: [], commentIds: new Map(), images: new Map(), abbrSeen: new Set(), textWidth: A4.width - L.margin.left - L.margin.right, typstMath: new Map() };
  collectCites(ctx, [doc.body, doc.conclusion, doc.appendix] as PMNode[]);
  await loadImages(ctx);
  await renderTypstFormulas(ctx);
  (doc.comments ?? []).forEach((c: Comment, i) => {
    ctx.commentIds.set(c.id, i);
    ctx.comments.push({ id: i, author: c.author || "批注", date: new Date(c.createdAt || Date.now()), children: [new Paragraph({ indent: { firstLine: 0 }, children: [new TextRun({ text: c.text })] }), ...(c.replies ?? []).map((r) => new Paragraph({ indent: { firstLine: 0 }, children: [new TextRun({ text: `${r.author}：${r.text}` })] }))] });
  });

  const isReport = s.stage !== 'final';
  const header = L.header ? new Header({ children: [new Paragraph({ style: 'Header', border: { bottom: { style: BorderStyle.THIN_THICK_SMALL_GAP, size: 18, space: 1 } }, children: [new TextRun({ text: `哈尔滨工业大学${DOC_TYPE[s.degreeLevel]}` })] })] }) : undefined;
  const footer = L.footer ? new Footer({ children: [new Paragraph({ style: 'Footer', children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) : undefined;
  const props = (roman: boolean) => ({ page: { size: A4, margin: L.margin, pageNumbers: { start: 1, formatType: roman ? NumberFormat.UPPER_ROMAN : NumberFormat.DECIMAL } }, grid: L.grid ? { type: L.grid.charSpace ? DocumentGridType.LINES_AND_CHARS : DocumentGridType.LINES, linePitch: L.grid.linePitch, charSpace: L.grid.charSpace } : undefined });

  const sections: ISectionOptions[] = [];
  // 前置：摘要、目录、符号表 / 缩略语表（罗马页码）
  const front: Block[] = [];
  if (!isReport) {
    front.push(...abstractPages(ctx));
    if (resolvePage(doc, 'tableOfContents').value) {
      if (front.length) front.push(new Paragraph({ children: [new PageBreak()] }));
      front.push(titlePara('目\u3000录'), new TableOfContents("目录", { hyperlink: true, headingStyleRange: '1-3', stylesWithLevels: [{ styleName: 'Abstract Title', level: 1 }] }) as unknown as Paragraph);
    }
    const nom = nomenclature(ctx);
    if (nom.length) front.push(new Paragraph({ children: [new PageBreak()] }), ...nom);
  }
  if (front.length) sections.push({ properties: props(true), headers: header ? { default: header } : undefined, footers: footer ? { default: footer } : undefined, children: front });

  // 主体与后置（阿拉伯页码）
  const main: Block[] = [...blocks(ctx, (doc.body as PMNode).content, 'body')];
  const conclusion = doc.conclusion as PMNode;
  if (text(conclusion).trim()) main.push(new Paragraph({ children: [new PageBreak()] }), titlePara(isReport ? "结论" : '结\u3000论'), ...blocks(ctx, conclusion.content, 'other'));
  const refs = references(ctx);
  if (refs.length) main.push(new Paragraph({ children: [new PageBreak()] }), ...refs);
  const appendix = doc.appendix as PMNode;
  if (resolvePage(doc, 'appendix').value && text(appendix).trim()) main.push(new Paragraph({ children: [new PageBreak()] }), ...blocks(ctx, appendix.content, 'appendix'));
  const ach = achievements(ctx);
  if (ach.length) main.push(new Paragraph({ children: [new PageBreak()] }), ...ach);
  const ack = doc.acknowledgement as PMNode;
  if (text(ack).trim()) main.push(new Paragraph({ children: [new PageBreak()] }), titlePara('致\u3000谢'), ...blocks(ctx, ack.content, 'other'));
  const resume = doc.resume as PMNode;
  if (resolvePage(doc, 'resume').value && text(resume).trim()) main.push(new Paragraph({ children: [new PageBreak()] }), titlePara("个人简历"), ...blocks(ctx, resume.content, 'other'));
  // 第一章自己带「段前分页」，主体段开头不用再空一页
  if (main[0] instanceof Paragraph && (main[0] as any).properties?.root?.some?.((r: any) => r?.rootKey === 'w:pageBreakBefore')) { /* 首页由分节起 */ }
  sections.push({ properties: props(false), headers: header ? { default: header } : undefined, footers: footer ? { default: footer } : undefined, children: main });

  const document = new Document({
    creator: doc.info.author || 'iota-hit', title: doc.info.title,
    styles: styles(s, L) as any,
    numbering: { config: [] },
    footnotes: ctx.footnotes,
    comments: { children: ctx.comments },
    features: { updateFields: true },
    sections,
  });
  return Packer.toBlob(document);
}

export type { RichDoc };
