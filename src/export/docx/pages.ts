// 表单页：封面、中英文内封照校方 Word 范例的段落序列抄（见下），答辩决议、声明按模板排出来的 PDF 逐行量的位置放
import { Paragraph, TextRun, AlignmentType, LineRuleType, Table, TableRow, TableCell, WidthType, BorderStyle, VerticalAlign, PageBreak, HeightRule, TableLayoutType, Tab, TabStopType, type ParagraphChild } from 'docx';
import type { ThesisDoc, Info, DefensePerson } from '../../model/types';
import { SWITCHES, resolveSwitch } from '../../model/options';
import { PT, HALF, ZIHAO, FONT, fonts, fontsFor, hasCJK } from './units';

const DOC_TYPE = { bachelor: "本科毕业论文（设计）", master: "硕士学位论文", doctor: "博士学位论文" } as const;
const DOC_TYPE_EN = { bachelor: 'Graduation Thesis', master: "Dissertation for the Master's Degree", doctor: "Dissertation for the Doctoral Degree" } as const;

const run = (text: string, size: number, o: { bold?: boolean; zh?: string; en?: string; italics?: boolean } = {}) => new TextRun({ text, size: size * HALF, bold: o.bold, italics: o.italics, font: fontsFor(text, o.zh ?? FONT.zh, o.en ?? FONT.en) });
const month = (iso: string | undefined, lang: 'zh' | 'en') => {
  const m = /^(\d{4})-(\d{2})/.exec(iso || '') ?? (() => { const d = new Date(); return ['', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0')]; })();
  const y = m[1], mo = Number(m[2]);
  // 范例里年月之间没有空格（Word 自己在汉字与数字之间留一小段），Typst 那边是模板用空格模拟的
  if (lang === 'zh') return `${y}年${mo}月`;
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mo - 1]}, ${y}`;
};
const pick = (doc: ThesisDoc, page: 'cover' | 'titlepage', k: keyof Info): string => { const v = doc.localInfo?.[page]?.[k]; const base = doc.info[k]; return String((v as string) || (base as string) || ''); };
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
/** 一段在 Word 里会折成几行：按版心宽（磅）贪心折，西文按词、中文按字；量宽用 canvas（西文 Times 本机都有，中文没有的按一字一格） */
let ctx2d: CanvasRenderingContext2D | null = null;
export function measure(t: string, size: number, bold: boolean, latin: string): number {
  if (hasCJK(t)) return [...t].reduce((w, c) => w + (hasCJK(c) ? size : size * 0.5), 0);
  ctx2d ??= document.createElement('canvas').getContext('2d');
  if (!ctx2d) return t.length * size * 0.55;
  ctx2d.font = `${bold ? 'bold ' : ''}${size}pt "${latin}"`;
  return ctx2d.measureText(t).width * 0.75; // px → pt
}
export function wrap(t: string, size: number, width: number, bold = false, latin = FONT.en): string[] {
  const units = hasCJK(t) ? [...t] : t.split(/(?<= )/);
  const out: string[] = []; let cur = '';
  for (const u of units) {
    if (cur && measure(cur + u, size, bold, latin) > width) { out.push(cur.trim()); cur = u; } else cur += u;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [''];
}

// ── 封面与内封：照校方 Word 范例的段落序列抄 ──
// 范例（Desktop/iota-对比/修正版docx/博士范例-修正.docx、本科范例-修正.docx）每一行的字号、加粗、字体、对齐、
// 段距、贴不贴网格都照录；范例里说明文字（「↑（宋体小2号字加粗）」那些）占的行留成同字号的空段，版式才一模一样。
// 封面、内封各自一节（分节符折在上一页最后一段里），页与页之间不另起只有分页符的空段——那会在新页顶上多出一行。
interface Line {
  t?: string;
  /** 字号（半磅）：空段也要给，段落标记的字号决定空行多高 */
  sz: number;
  b?: boolean;
  zh?: string;
  jc?: (typeof AlignmentType)[keyof typeof AlignmentType];
  /** 段前（缇）、行距（缇；exact 钉死，否则倍数） */
  before?: number;
  line?: number;
  exact?: boolean;
  /** 贴文档网格（范例里 snapToGrid 没写 0 的那些） */
  grid?: boolean;
  right?: boolean;
  firstLine?: number;
  /** 右边顶到版心右缘的那一截（制表位） */
  tab?: string;
  width?: number;
  /** 段落标记按西文字体算行高（模板 enter() 没给 font 的那种：Times 的 1.15 倍，不是宋体的 1.296875） */
  latinMark?: boolean;
  left?: number;
}
const E = (sz: number, extra: Partial<Line> = {}): Line => ({ sz, ...extra });
const C = (t: string, sz: number, extra: Partial<Line> = {}): Line => ({ t, sz, jc: AlignmentType.CENTER, ...extra });
function linePara(l: Line): Paragraph {
  const kids: ParagraphChild[] = [];
  if (l.t) l.t.split('\n').forEach((piece, i) => { if (i) kids.push(new TextRun({ break: 1 })); kids.push(run(piece, l.sz / HALF, { bold: l.b, zh: l.zh })); });
  if (l.tab) kids.push(new TextRun({ children: [new Tab()] }), run(l.tab, l.sz / HALF, { bold: l.b, zh: l.zh }));
  return new Paragraph({
    tabStops: l.tab ? [{ type: TabStopType.RIGHT, position: l.width ?? 0 }] : undefined,
    style: l.grid ? 'Grid' : 'NoGrid',
    alignment: l.jc ?? (l.right ? AlignmentType.RIGHT : AlignmentType.BOTH),
    indent: { firstLine: l.firstLine ?? 0, left: l.left },
    spacing: { before: l.before ?? 0, after: 0, line: l.line ?? 240, lineRule: l.exact ? LineRuleType.EXACT : LineRuleType.AUTO },
    // 段落标记：空段的高按标记的西文字体（ascii / hAnsi）算，hint 不管用——要按宋体的 1.296875 倍算（模板 enter(font: "songti")）
    // 就把 ascii / hAnsi 也写成宋体（范例第 15 段那样）；模板 enter() 没给 font 的按 Times 的 1.15 倍
    run: { size: l.sz, font: l.latinMark ? fonts(l.zh ?? FONT.zh, FONT.en) : { ascii: l.zh ?? FONT.zh, hAnsi: l.zh ?? FONT.zh, eastAsia: l.zh ?? FONT.zh, cs: l.zh ?? FONT.zh, hint: 'eastAsia' } },
    children: kids,
  });
}

// ── 模板 cover.typ / titlepage.typ 的排法照搬：banshi 的 Word 行高模型（中文字体 1.296875 倍、Times 1.15 倍，
// 贴网格时整数个网格行）算出每一段的高，按模板同一套搜索定空行数与英文题目字号，再把同一串段落发给 Word ──
const CJK = { single: 1.296875, ascent: 1.008 }, LATIN = { single: 1.15, ascent: 0.93261 };
const ASCENT_CONST = 0.082;
/** 封面 / 内封的版面：A4、上 3.8cm 余 3cm、网格 19.75pt、字符网格 12.4543pt（模板 part-layouts） */
const COVER = { top: 3.8 / 2.54 * 72, textW: 15 / 2.54 * 72, textH: 22.9 / 2.54 * 72, pitch: 19.75, tracking: 12.4543 - 12 };
/** 基线间距 / 行盒高（倍数行距）：贴网格时整数个网格行 */
const gapOf = (k: number, size: number, latin: boolean, snap = false) => { const coef = latin ? LATIN.single : CJK.single; return snap ? Math.max(k * COVER.pitch, Math.ceil(coef * size / COVER.pitch) * COVER.pitch) : k * coef * size; };
const lineOf = (k: number, size: number, latin: boolean, snap = false) => Math.max(gapOf(k, size, latin, snap), (latin ? LATIN.single : CJK.single) * size);
const ascentOf = (size: number, latin: boolean, k = 1, snap = false) => (latin ? LATIN.ascent : CJK.ascent) * size + ASCENT_CONST + (snap ? (gapOf(k, size, latin, true) - (latin ? LATIN.single : CJK.single) * size) / 2 : 0);
/** 一段折成几行：字符网格开着，汉字每字加一份增量、西文每字半份 */
function linesOf(text: string, size: number, bold: boolean, latin = false): number {
  return text.split('\n').reduce((n, t) => n + Math.max(1, wrapTracked(t, size, bold, latin).length), 0);
}
function wrapTracked(t: string, size: number, bold: boolean, latin: boolean): string[] {
  const units = hasCJK(t) ? [...t] : t.split(/(?<= )/);
  const w = (u: string) => measure(u, size, bold, latin ? FONT.en : FONT.zh) + [...u].length * (hasCJK(u) ? COVER.tracking : COVER.tracking / 2);
  const out: string[] = []; let cur = '', cw = 0;
  for (const u of units) { const uw = w(u); if (cur && cw + uw > COVER.textW) { out.push(cur.trim()); cur = u; cw = uw; } else { cur += u; cw += uw; } }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [''];
}

/** 封面（模板 cover.typ）：校名的基线钉在范例的位置，作者行按范例的比例落在英文题目与校名之间，
 *  空行数（英文题目下、作者下、校名上）与英文题目字号（二号放不下再小二）照模板的打分搜出来 */
export function coverPage(doc: ThesisDoc, _top: number): Paragraph[] {
  const s = doc.settings;
  const grad = s.degreeLevel !== 'bachelor';
  const title = lines(pick(doc, 'cover', 'title')).join('\n');
  const subtitle = pick(doc, 'cover', 'subtitle');
  const titleEn = lines(pick(doc, 'cover', 'titleEn')).join(' ') + (pick(doc, 'cover', 'subtitleEn') ? `: ${pick(doc, 'cover', 'subtitleEn')}` : '');
  const kind = s.degreeType === 'professional' || (s.degreeType === 'auto' && s.form === 'practice') ? '专业' : '学术';
  const XS = ZIHAO.xiaosi, XE = ZIHAO.xiaoer, ER = ZIHAO.erhao, XY = ZIHAO.xiaoyi;
  const cjkBlank = gapOf(1, XS, false), latinBlank = gapOf(1, XS, true);
  // 英文题目以上那一块的高：squeeze 0/1/2 逐级去掉题目下的两个空行
  const uptoEn = (enSize: number, squeeze: number, zh = title, sub = subtitle, en = titleEn) =>
    3 * latinBlank + lineOf(1, XY, false) + 2 * cjkBlank + (grad ? lineOf(1, XE, false) + 2 * cjkBlank : 0)
    + 12 + linesOf(zh, ER, true) * lineOf(1, ER, false, true) + (squeeze < 2 ? cjkBlank : 0) + (squeeze < 1 ? cjkBlank : 0)
    + (sub ? linesOf(`——${sub}`, XE, true) * lineOf(1, XE, false) : 0)
    + 12 + linesOf(en, enSize, true, true) * lineOf(1.25, enSize, true);
  const aboveH = (relax: number) => (relax < 2 ? gapOf(relax === 0 ? 1.25 : 1, ER, false) : 0);
  const belowH = (relax: number) => (relax < 3 ? gapOf(relax === 0 ? 1.25 : 1, XE, true) : 0);
  const authorH = lineOf(1, XE, false), instAscent = ascentOf(XE, false, 1.35), instH = lineOf(1.35, XE, false) + lineOf(1, XE, false);
  const at = (upto: number, above: number, below: number, before: number, relax: number) => {
    const enBottom = COVER.top + upto;
    const authorTop = enBottom + above * cjkBlank + aboveH(relax);
    const instBase = authorTop + authorH + below * cjkBlank + belowH(relax) + before * latinBlank + instAscent;
    const span = instBase - instAscent - enBottom;
    return { inst: instBase, ratio: (authorTop + authorH / 2 - enBottom) / span, span, total: instBase - instAscent - COVER.top + instH };
  };
  const sampleUpto = uptoEn(XE, 0, '局部多孔质气体静压轴承关键技术的研究', '', 'RESEARCH ON KEY TECHNOLOGIES OF PARTIAL POROUS EXTERNALLY PRESSURIZED GAS BEARING');
  const target = at(sampleUpto, 2, 2, 6, 0).inst, refRatio = at(0, 2, 2, 6, 0).ratio;
  const xiaoer = resolveSwitch<boolean>(SWITCHES.find((d) => d.key === 'titleEnXiaoer')!, s).effective;
  const sizes = s.titleEnXiaoer === 'auto' ? [ER, XE] : [xiaoer ? XE : ER];
  const best = (upto: number, relax: number) => {
    let key: number[] | null = null, got: number[] | null = null;
    for (let a = 0; a < 7; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 13; c++) {
      const r = at(upto, a, b, c, relax);
      if (r.total > COVER.textH) continue;
      const score = 3 * Math.abs(r.inst - target) + Math.abs(r.ratio - refRatio) * r.span;
      const rank = [score, Math.abs(a - 2) + Math.abs(b - 2) + Math.abs(c - 6)];
      if (!key || rank[0] < key[0] || (rank[0] === key[0] && rank[1] < key[1])) { key = rank; got = [a, b, c, score]; }
    }
    return got;
  };
  let sizeIndex = -1, base: number[] | null = null;
  for (let i = 0; i < sizes.length && sizeIndex < 0; i++) { const g = best(uptoEn(sizes[i], 0), 0); if (g) { sizeIndex = i; base = g; } }
  if (sizeIndex < 0) sizeIndex = sizes.length - 1;
  const enSize = sizes[sizeIndex];
  let chosen: number[] | null = base && base[3] <= 10 ? [0, base[0], base[1], base[2], 0] : null;
  if (!chosen) {
    const rungs = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [2, 3]];
    let bestScore = Infinity;
    rungs.forEach(([sq, rl]) => { const g = best(uptoEn(enSize, sq), rl); if (g && g[3] < bestScore) { bestScore = g[3]; chosen = [sq, g[0], g[1], g[2], rl]; } });
  }
  const [squeeze, above, below, before, relax] = chosen ?? [2, 0, 0, 0, 3];
  const seq: Line[] = [
    E(24, { latinMark: true }), E(24, { latinMark: true }), E(24, { latinMark: true }),
    C(DOC_TYPE[s.degreeLevel], XY * 2, { b: true }),
    E(24, { jc: AlignmentType.CENTER }), E(24, { jc: AlignmentType.CENTER }),
    ...(grad ? [C(`（${kind}学位论文）`, XE * 2, { b: true }), E(24, { jc: AlignmentType.CENTER }), E(24, { jc: AlignmentType.CENTER })] : []),
    C(title, ER * 2, { zh: FONT.hei, before: 240, grid: true }),
    ...(squeeze < 2 ? [E(24, { jc: AlignmentType.CENTER })] : []), ...(squeeze < 1 ? [E(24, { jc: AlignmentType.CENTER })] : []),
    ...(subtitle ? [C(`——${subtitle}`, XE * 2, { zh: FONT.hei, left: 4 * XE * PT })] : []),
    C(titleEn, enSize * 2, { b: true, before: 240, line: 300 }),
    ...Array.from({ length: above }, () => E(24, { jc: AlignmentType.CENTER })),
    ...(relax < 2 ? [E(ER * 2, { jc: AlignmentType.CENTER, line: relax === 0 ? 300 : 240 })] : []),
    C(pick(doc, 'cover', 'author'), XE * 2, { b: true }),
    ...Array.from({ length: below }, () => E(24, { jc: AlignmentType.CENTER })),
    ...(relax < 3 ? [E(XE * 2, { jc: AlignmentType.CENTER, line: relax === 0 ? 300 : 240, latinMark: true })] : []),
    ...Array.from({ length: before }, () => E(24, { latinMark: true })),
    C('哈尔滨工业大学', XE * 2, { b: true, zh: FONT.kai, line: 324 }),
    C(month(pick(doc, 'cover', 'date'), 'zh'), XE * 2, { b: true }),
  ];
  return seq.map(linePara);
}

const NO_B = { top: { style: BorderStyle.NIL, size: 0 }, bottom: { style: BorderStyle.NIL, size: 0 }, left: { style: BorderStyle.NIL, size: 0 }, right: { style: BorderStyle.NIL, size: 0 } } as const;
/** 内封（中文）：分类号那两行、文档类型、题目、三行 39 磅的空行、信息表 */
export function titlepageZh(doc: ThesisDoc, width: number): (Paragraph | Table)[] {
  const s = doc.settings;
  const grad = s.degreeLevel !== 'bachelor';
  const title = lines(pick(doc, 'titlepage', 'title')).concat(pick(doc, 'titlepage', 'subtitle') ? [pick(doc, 'titlepage', 'subtitle')] : []).join('\n');
  // 头两行照模板 head-line：左边那截靠左、右边那截顶到版心右缘（grid 1fr / 1fr），第二行 1.25 倍行距；
  // 下面两个空段贴网格、再三个按西文算的贴网格空段（模板 masthead）
  const head: Line[] = grad ? [
    { t: `国内图书分类号：${pick(doc, 'titlepage', 'classifiedIndex')}`, tab: `学校代码：${pick(doc, 'titlepage', 'schoolCode')}`, width, sz: 24, jc: AlignmentType.LEFT },
    { t: `国际图书分类号：${pick(doc, 'titlepage', 'udc')}`, tab: `密级：${pick(doc, 'titlepage', 'secrecy') || '公开'}`, width, sz: 24, jc: AlignmentType.LEFT, line: 300 },
    E(24, { grid: true }), E(24, { line: 300 }), E(24, { grid: true, latinMark: true }), E(24, { grid: true, latinMark: true }), E(24, { grid: true, latinMark: true }),
  ] : [
    // 模板的本科内封头一行：☑毕业论文　☐毕业设计 …… 密级：公开（范例只有右边那截，左边勾选框是模板加的）
    { t: `${s.form === 'practice' ? '☐' : '☑'}毕业论文  ${s.form === 'practice' ? '☑' : '☐'}毕业设计`, tab: `密级：${pick(doc, 'titlepage', 'secrecy') || '公开'}`, width, sz: 24, grid: true, jc: AlignmentType.LEFT },
    E(24, { jc: AlignmentType.CENTER }), E(24, { grid: true, latinMark: true }), E(24, { grid: true, latinMark: true }),
  ];
  // 题目与表之间的 39 磅空行：模板从 3 个起，整页放不下就减（题目折成两行时减到 2）
  const XS = ZIHAO.xiaosi, XE = ZIHAO.xiaoer, ER = ZIHAO.erhao;
  const rowsN = (grad ? 7 : 7) + (doc.info.coSupervisor ? 1 : 0) + (s.form === 'practice' && doc.info.industrySupervisor ? 1 : 0);
  const mastheadH = grad ? lineOf(1, XS, false) + lineOf(1.25, XS, false) + gapOf(1, XS, false, true) + gapOf(1.25, XS, false) + 3 * lineOf(1, XS, true, true) : lineOf(1, XS, false, true) + lineOf(1, XS, false) + 2 * lineOf(1, XS, true, true);
  const headH = lineOf(1, XE, false) + gapOf(1, XS, false, true) + gapOf(1.25, XS, false) + linesOf(title, ER, true) * lineOf(1, ER, false, true) + 2 * gapOf(1, XS, false, true);
  const tableH = rowsN * gapOf(1.5, ZIHAO.sihao, false, true);
  let blanks = 3;
  while (blanks > 0 && mastheadH + headH + blanks * 39 + tableH > COVER.textH) blanks--;
  const seq: Line[] = [
    ...head,
    C(DOC_TYPE[s.degreeLevel], 36, { b: true }),
    E(24, { jc: AlignmentType.CENTER, grid: true }), E(24, { jc: AlignmentType.CENTER, line: 300 }),
    C(title, 44, { zh: FONT.hei, grid: true }),
    E(24, { jc: AlignmentType.CENTER, grid: true }), E(24, { jc: AlignmentType.CENTER, grid: true }),
    ...Array.from({ length: blanks }, () => E(44, { jc: AlignmentType.CENTER, line: 780, exact: true, grid: true })),
  ];
  const rows: [string, string][] = grad ? [
    [s.degreeLevel === 'doctor' ? '博士研究生' : '硕士研究生', pick(doc, 'titlepage', 'author')],
    ['导师', pick(doc, 'titlepage', 'supervisor')],
    ...(doc.info.coSupervisor ? [['副导师', doc.info.coSupervisor] as [string, string]] : []),
    ...(s.form === 'practice' && doc.info.industrySupervisor ? [['行业导师', doc.info.industrySupervisor] as [string, string]] : []),
    ['申请学位', pick(doc, 'titlepage', 'degreeApplied')],
    [s.form === 'practice' ? '类别' : '学科', s.form === 'practice' ? pick(doc, 'titlepage', 'practiceType') : pick(doc, 'titlepage', 'speciality')],
    ['所在单位', pick(doc, 'titlepage', 'affiliation')],
    ['答辩日期', month(doc.info.defenseDate || pick(doc, 'titlepage', 'date'), 'zh')],
    ['授予学位单位', '哈尔滨工业大学'],
  ] : [
    ['本科生', pick(doc, 'titlepage', 'author')],
    ['学号', doc.info.studentId],
    ['指导教师', pick(doc, 'titlepage', 'supervisor')],
    ['专业', pick(doc, 'titlepage', 'speciality')],
    ['学院', pick(doc, 'titlepage', 'affiliation')],
    ['答辩日期', month(doc.info.defenseDate || pick(doc, 'titlepage', 'date'), 'zh')],
    ['学校', '哈尔滨工业大学'],
  ];
  // 范例的表：三列 1806 / 301 / 2951 缇，行高 540 缇，标签黑体四号分散对齐，冒号与值宋体四号，行距 1.5 倍，格子无边距
  const cell = (children: ParagraphChild[], width: number, jc: (typeof AlignmentType)[keyof typeof AlignmentType]) => new TableCell({ borders: NO_B, width: { size: width, type: WidthType.DXA }, margins: { left: 0, right: 0, top: 0, bottom: 0 }, children: [new Paragraph({ style: 'Grid', alignment: jc, indent: { firstLine: 0 }, spacing: { before: 0, after: 0, line: 360, lineRule: LineRuleType.AUTO }, children })] });
  const trs = rows.map(([l, v]) => new TableRow({ cantSplit: true, height: { value: 540, rule: HeightRule.ATLEAST }, children: [cell([run(l, ZIHAO.sihao, { zh: FONT.hei })], 1806, AlignmentType.DISTRIBUTE), cell([run('：', ZIHAO.sihao)], 301, AlignmentType.LEFT), cell([run(v, ZIHAO.sihao)], 2951, AlignmentType.LEFT)] }));
  return [...seq.map(linePara), new Table({ rows: trs, layout: TableLayoutType.FIXED, alignment: AlignmentType.CENTER, width: { size: 0, type: WidthType.AUTO }, columnWidths: [1806, 301, 2951], borders: { ...NO_B, insideHorizontal: NO_B.top, insideVertical: NO_B.top }, margins: { left: 0, right: 0 } }), linePara(E(24, { grid: true }))];
}

/** 英文内封（硕博）：分类号两行、Dissertation for …、英文题目、两列信息表（标签黑体加粗、值 Times） */
export function titlepageEn(doc: ThesisDoc, _top: number): (Paragraph | Table)[] {
  const s = doc.settings;
  const titleEn = lines(pick(doc, 'titlepage', 'titleEn')).join(' ') + (pick(doc, 'titlepage', 'subtitleEn') ? `: ${pick(doc, 'titlepage', 'subtitleEn')}` : '');
  const XS = ZIHAO.xiaosi, XE = ZIHAO.xiaoer, ER = ZIHAO.erhao;
  // 模板 titlepage-en：三处空行（头下 3、题目上 1、表上 2）按 give-up 的顺序减、不够再往表上加，
  // 目标是表的顶落在范例（小二题目、不减）的位置；二号放不下再小二
  const giveUp = (n: number) => { const rest = Math.max(0, n - 2); return { afterHead: Math.max(0, 3 - Math.max(0, rest - 1)), beforeTitle: Math.max(0, 1 - rest), beforeTable: Math.max(0, 2 - n) }; };
  const note = gapOf(1, XS, false), blankSnap = (size: number) => lineOf(1, size, true, true);
  const upto = (size: number, adjust: number, title = titleEn) => { const b = giveUp(adjust); return 2 * blankSnap(XS) + b.afterHead * blankSnap(XS) + blankSnap(XE) + 2 * note + b.beforeTitle * blankSnap(XE) + linesOf(title, size, true, true) * lineOf(1.25, size, true) + 2 * note + b.beforeTable * blankSnap(ER); };
  const rows: [string, string][] = [
    ['Candidate', pick(doc, 'titlepage', 'authorEn') || pick(doc, 'titlepage', 'author')],
    ['Supervisor', doc.info.supervisorEn || pick(doc, 'titlepage', 'supervisor')],
    ...(doc.info.coSupervisorEn || doc.info.coSupervisor ? [['Associate Supervisor', doc.info.coSupervisorEn || doc.info.coSupervisor] as [string, string]] : []),
    ['Academic Degree Applied for', doc.info.degreeAppliedEn || pick(doc, 'titlepage', 'degreeApplied')],
    [s.form === 'practice' ? 'Category' : 'Speciality', s.form === 'practice' ? pick(doc, 'titlepage', 'practiceType') : (doc.info.specialityEn || pick(doc, 'titlepage', 'speciality'))],
    ['Affiliation', doc.info.affiliationEn || pick(doc, 'titlepage', 'affiliation')],
    ['Date of Defence', month(doc.info.defenseDate || pick(doc, 'titlepage', 'date'), 'en')],
    ['Degree-Conferring-Institution', 'Harbin Institute of Technology'],
  ];
  // 范例的表：两列 4262 / 4406 缇，标签行距 22 磅钉死、值同（折行的那几行 18 磅）
  const cell = (children: ParagraphChild[], width: number, line: number) => new TableCell({ borders: NO_B, width: { size: width, type: WidthType.DXA }, children: [new Paragraph({ style: 'Normal', alignment: AlignmentType.LEFT, indent: { firstLine: 0 }, spacing: { before: 0, after: 0, line, lineRule: LineRuleType.EXACT }, children })] });
  const longRow = (v: string) => wrap(v, ZIHAO.sihao, 4406 / PT - 10.8).length > 1;
  const trs = rows.map(([l, v]) => new TableRow({ children: [cell([run(l, ZIHAO.sihao, { bold: true, zh: FONT.hei }), run('：', ZIHAO.sihao, { bold: true, zh: FONT.hei })], 4262, 440), cell([run(v, ZIHAO.sihao)], 4406, longRow(v) ? 360 : 440)] }));
  const tail = rows.reduce((h, [, v]) => h + (longRow(v) ? 2 * 18 : 22), 0) + gapOf(1, XS, true) + note;
  const tableTop = upto(XE, 0, 'RESEARCH ON KEY TECHNOLOGIES OF PARTIAL POROUS EXTERNALLY PRESSURIZED GAS BEARING');
  const xiaoer = resolveSwitch<boolean>(SWITCHES.find((d) => d.key === 'titleEnXiaoerTitlepage')!, s).effective;
  const sizes = s.titleEnXiaoerTitlepage === 'auto' ? [ER, XE] : [xiaoer ? XE : ER];
  let pick2: [number, number] | null = null;
  for (const size of sizes) {
    let best: [number, number] | null = null;
    for (let adjust = -8; adjust <= 6; adjust++) { const h = upto(size, adjust); if (h + tail > COVER.textH) continue; const off = Math.abs(h - tableTop); if (!best || off < best[0]) best = [off, adjust]; }
    if (best) { pick2 = [size, best[1]]; break; }
  }
  const [enSize, adjust] = pick2 ?? [sizes[sizes.length - 1], 6];
  const b = giveUp(adjust);
  const seq: Line[] = [
    { t: `Classified Index: ${pick(doc, 'titlepage', 'classifiedIndex')}`, sz: 24, grid: true, latinMark: true, jc: AlignmentType.LEFT },
    { t: `U.D.C: ${pick(doc, 'titlepage', 'udc')}`, sz: 24, grid: true, latinMark: true, jc: AlignmentType.LEFT },
    ...Array.from({ length: b.afterHead }, () => E(24, { grid: true, latinMark: true })),
    C(DOC_TYPE_EN[s.degreeLevel], XE * 2, { grid: true, latinMark: true }),
    E(24, { jc: AlignmentType.CENTER }), E(24, { jc: AlignmentType.CENTER }),
    ...Array.from({ length: b.beforeTitle }, () => E(XE * 2, { jc: AlignmentType.CENTER, grid: true, latinMark: true })),
    C(titleEn, enSize * 2, { b: true, line: 300 }),
    E(24, { jc: AlignmentType.CENTER }), E(24, { jc: AlignmentType.CENTER }),
    ...Array.from({ length: b.beforeTable }, () => E(ER * 2, { jc: AlignmentType.CENTER, grid: true, latinMark: true })),
  ];
  return [...seq.map(linePara), new Table({ rows: trs, layout: TableLayoutType.FIXED, alignment: AlignmentType.CENTER, width: { size: 0, type: WidthType.AUTO }, columnWidths: [4262, 4406], borders: { ...NO_B, insideHorizontal: NO_B.top, insideVertical: NO_B.top } }), linePara(E(24, { jc: AlignmentType.CENTER, latinMark: true })), linePara(E(24, { jc: AlignmentType.CENTER }))];
}

type BlockLike = Paragraph | Table | { readonly newPage: true };
export function defensePage(doc: ThesisDoc, title: BlockLike[]): BlockLike[] {
  const d = doc.defense;
  const cols = [33.75, 42.55, 56.70, 106.30, 92.15, 104.55].map((w) => Math.round(w * PT));
  const border = { style: BorderStyle.SINGLE, size: 4 };
  const B = { top: border, bottom: border, left: border, right: border };
  const cellP = (t: string, bold = false) => new Paragraph({ alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { line: 240, lineRule: LineRuleType.AUTO }, children: t ? [run(t, ZIHAO.xiaosi, { bold })] : [] });
  const cell = (t: string, o: { bold?: boolean; span?: number; rows?: number; width?: number; vert?: boolean; children?: Paragraph[]; top?: boolean } = {}) =>
    new TableCell({ borders: B, width: o.width !== undefined ? { size: o.width, type: WidthType.DXA } : undefined, columnSpan: o.span, rowSpan: o.rows, verticalAlign: o.top ? VerticalAlign.TOP : VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 1 * PT, right: 1 * PT }, children: o.children ?? (o.vert ? [...t].map((c) => cellP(c, o.bold)) : [cellP(t, o.bold)]) });
  const person = (p?: DefensePerson) => [cell(p?.name ?? ''), cell(p?.title ?? ''), cell(p?.affiliation ?? ''), cell(p?.discipline ?? '')];
  const pad = <T,>(list: T[], n: number): (T | undefined)[] => [...list, ...Array(Math.max(0, n - list.length)).fill(undefined)];
  const rowH = Math.round(21.72 * PT);
  const row = (cells: TableCell[], h = rowH) => new TableRow({ height: { value: h, rule: 'atLeast' as any }, children: cells });
  const rows: TableRow[] = [];
  const reviewers = pad(d.reviewers.filter((p) => p.name || p.title || p.affiliation), 2);
  rows.push(row([cell('评阅人\n（根据实际人数填写）', { span: 2, rows: reviewers.length + 1, bold: true, children: [cellP('评阅人', true), cellP('（根据实际人数填写）', true)] }), cell('姓名', { bold: true }), cell('职称（是否博导）', { bold: true }), cell('工作单位', { bold: true }), cell('所在学科', { bold: true })]));
  for (const p of reviewers) rows.push(row(person(p)));
  const chair = pad(d.chair.filter((p) => p.name), 1), members = pad(d.members.filter((p) => p.name), 6), secretary = pad(d.secretary.filter((p) => p.name), 1);
  const total = chair.length + members.length + secretary.length;
  rows.push(row([cell('答辩委员会成员', { rows: total + 1, bold: true, vert: true }), cell('职务', { bold: true }), cell('姓名', { bold: true }), cell('职称（是否博导）', { bold: true }), cell('工作单位', { bold: true }), cell('所在学科', { bold: true })]));
  // 「委员」两个字上下拉开（模板：委、空、员），别的块一行就横着
  const label = (t: string, n: number) => (n >= 3 && [...t].length === 2 ? { children: [cellP(t[0], true), cellP(''), cellP(t[1], true)] } : {});
  const block = (label2: string, list: (DefensePerson | undefined)[]) => list.forEach((p, i) => rows.push(row([...(i === 0 ? [cell(label2, { rows: list.length, bold: true, ...label(label2, list.length) })] : []), ...person(p)])));
  block('主席', chair); block('委员', members); block('秘书', secretary);
  const resolution: Paragraph[] = [new Paragraph({ alignment: AlignmentType.LEFT, indent: { firstLine: 0 }, children: [run(`答辩委员会决议（对论文的评语及是否建议授予${doc.settings.degreeLevel === 'doctor' ? '博士' : '硕士'}学位等）：`, ZIHAO.xiaosi, { bold: true })] })];
  const text = (n: any): string => (n?.content ?? []).map((c: any) => (c.type === 'text' ? c.text ?? '' : c.type === 'paragraph' ? text(c) + '\n' : text(c))).join('');
  for (const line of text(d.resolution).split('\n').filter((l) => l.trim())) resolution.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 24 * PT }, children: [run(line, ZIHAO.xiaosi)] }));
  rows.push(row([cell('', { span: 6, children: resolution, top: true })], Math.round(293.76 * PT)));
  const table = new Table({ rows, width: { size: cols.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: cols, alignment: AlignmentType.CENTER, layout: 'fixed' as any });
  return [...title, table];
}

/** 原创性声明与使用权限：正文固定，题目从论文信息取 */
export function declarationsPage(doc: ThesisDoc, title: BlockLike[], subTitle: (t: string) => Paragraph): BlockLike[] {
  const body = (t: string) => new Paragraph({ style: 'Normal', children: [new TextRun({ text: t })] });
  const sig = (who: string, before = 1) => new Paragraph({ alignment: AlignmentType.LEFT, indent: { left: 96 * PT, firstLine: 0 }, spacing: { before: before * 19.5 * PT }, children: [new TextRun({ text: `${who}签名：` }), new TextRun({ text: '\t日期：\t年\t月\t日' })], tabStops: [{ type: 'left' as any, position: 5200 }, { type: 'left' as any, position: 6600 }, { type: 'left' as any, position: 7400 }, { type: 'left' as any, position: 8000 }] });
  // 《》那一格照声明页的设置：留白手写就空着，另填的用另填的
  const o = doc.declarationsOptions ?? { title: 'auto', customTitle: '' };
  const t = o.title === 'blank' ? '\u3000'.repeat(8) : o.title === 'custom' && o.customTitle.trim() ? o.customTitle.trim() : doc.info.title.split('\n').join('');
  return [
    ...title,
    subTitle('学位论文原创性声明'),
    body(`本人郑重声明：此处所提交的学位论文《${t}》，是本人在导师指导下，在哈尔滨工业大学攻读学位期间独立进行学术研究工作或专业实践工作所取得的成果，且学位论文中除已标注引用文献、资料的部分外不包含他人完成或已发表的成果。对本学位论文的学术研究工作或专业实践工作做出重要贡献的个人和集体，均已在文中以明确方式注明；对使用 AI 工具的情况均已在文中以明确方式标注。`),
    sig('作者'),
    subTitle('学位论文使用权限'),
    body('学位论文是研究生在哈尔滨工业大学攻读学位期间完成的成果，知识产权归属哈尔滨工业大学。学位论文的使用权限如下：'),
    body('（1）学校可以采用影印、缩印或其他复制手段保存研究生上交的学位论文，并向国家图书馆报送学位论文；（2）学校可以将学位论文部分或全部内容编入有关数据库进行检索和提供相应阅览服务；（3）研究生毕业后发表与此学位论文内容相关的学术论文和其他成果时，应征得导师同意，且第一署名单位为哈尔滨工业大学。'),
    body('保密论文在保密期内遵守有关保密规定，解密后适用于此使用权限规定。'),
    body('本人知悉学位论文的使用权限，并将遵守有关规定。'),
    sig('作者', 2),
    sig('导师'),
  ];
}

export const pageBreak = () => new Paragraph({ children: [new PageBreak()] });
