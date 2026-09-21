// 表单页：封面、中英文内封照校方 Word 范例的段落序列抄（见下），答辩决议、声明按模板排出来的 PDF 逐行量的位置放
import { Paragraph, TextRun, AlignmentType, LineRuleType, Table, TableRow, TableCell, WidthType, BorderStyle, VerticalAlign, PageBreak, HeightRule, TableLayoutType, Tab, TabStopType, type ParagraphChild } from 'docx';
import type { ThesisDoc, Info, DefensePerson } from '../../model/types';
import { PT, HALF, ZIHAO, FONT, fontsFor, hasCJK } from './units';

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
function measure(t: string, size: number, bold: boolean, latin: string): number {
  if (hasCJK(t)) return [...t].reduce((w, c) => w + (hasCJK(c) ? size : size * 0.5), 0);
  ctx2d ??= document.createElement('canvas').getContext('2d');
  if (!ctx2d) return t.length * size * 0.55;
  ctx2d.font = `${bold ? 'bold ' : ''}${size}pt "${latin}"`;
  return ctx2d.measureText(t).width * 0.75; // px → pt
}
function wrap(t: string, size: number, width: number, bold = false, latin = FONT.en): string[] {
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
}
const E = (sz: number, extra: Partial<Line> = {}): Line => ({ sz, ...extra });
const C = (t: string, sz: number, extra: Partial<Line> = {}): Line => ({ t, sz, jc: AlignmentType.CENTER, ...extra });
function linePara(l: Line): Paragraph {
  const kids: ParagraphChild[] = [];
  if (l.t) l.t.split('\n').forEach((piece, i) => { if (i) kids.push(new TextRun({ break: 1 })); kids.push(run(piece, l.sz / HALF, { bold: l.b, zh: l.zh })); });
  if (l.tab) kids.push(new TextRun({ children: [new Tab()] }), run(l.tab, l.sz / HALF, { bold: l.b, zh: l.zh }));
  return new Paragraph({
    tabStops: l.tab ? [{ type: TabStopType.RIGHT, position: l.width ?? 0 }] : undefined,
    style: l.grid ? 'Normal' : 'NoGrid',
    alignment: l.jc ?? (l.right ? AlignmentType.RIGHT : AlignmentType.BOTH),
    indent: { firstLine: l.firstLine ?? 0 },
    spacing: { before: l.before ?? 0, after: 0, line: l.line ?? 240, lineRule: l.exact ? LineRuleType.EXACT : LineRuleType.AUTO },
    run: { size: l.sz },
    children: kids,
  });
}

/** 封面：三个空行、文档类型、（学术学位论文）、中英文题目、姓名、校名、年月 */
export function coverPage(doc: ThesisDoc, _top: number): Paragraph[] {
  const s = doc.settings;
  const grad = s.degreeLevel !== 'bachelor';
  const title = lines(pick(doc, 'cover', 'title')).concat(pick(doc, 'cover', 'subtitle') ? [pick(doc, 'cover', 'subtitle')] : []).join('\n');
  const titleEn = lines(pick(doc, 'cover', 'titleEn')).concat(pick(doc, 'cover', 'subtitleEn') ? [`: ${pick(doc, 'cover', 'subtitleEn')}`] : []).join('\n');
  const enSize = s.titleEnXiaoer === true ? 36 : 44;
  const kind = s.degreeType === 'professional' || (s.degreeType === 'auto' && s.form === 'practice') ? '专业' : '学术';
  const seq: Line[] = [
    E(24), E(24), E(24),
    C(DOC_TYPE[s.degreeLevel], 48, { b: true }),
    E(24, { jc: AlignmentType.CENTER }), E(24, { jc: AlignmentType.CENTER }),
    ...(grad ? [C(`（${kind}学位论文）`, 36, { b: true }), E(24, { jc: AlignmentType.CENTER }), E(24, { jc: AlignmentType.CENTER })] : []),
    C(title, 44, { zh: FONT.hei, before: 240, grid: true }),
    E(24, { jc: AlignmentType.CENTER }), E(44, { jc: AlignmentType.CENTER }),
    C(titleEn, enSize === 44 ? 36 : 36, { b: true, before: 240, line: 300 }),
    E(24, { jc: AlignmentType.CENTER }), E(44, { jc: AlignmentType.CENTER }), E(44, { jc: AlignmentType.CENTER, line: 300 }),
    C(pick(doc, 'cover', 'author'), 36, { b: true }),
    E(24, { jc: AlignmentType.CENTER }), E(44, { jc: AlignmentType.CENTER }), E(36, { line: 300 }),
    E(24), E(24), E(24), E(24), E(24), E(24),
    C('哈尔滨工业大学', 36, { b: true, zh: FONT.kai, line: 324 }),
    C(month(pick(doc, 'cover', 'date'), 'zh'), 36, { b: true }),
    E(24, { jc: AlignmentType.CENTER }),
  ];
  return seq.map(linePara);
}

const NO_B = { top: { style: BorderStyle.NIL, size: 0 }, bottom: { style: BorderStyle.NIL, size: 0 }, left: { style: BorderStyle.NIL, size: 0 }, right: { style: BorderStyle.NIL, size: 0 } } as const;
/** 内封（中文）：分类号那两行、文档类型、题目、三行 39 磅的空行、信息表 */
export function titlepageZh(doc: ThesisDoc, width: number): (Paragraph | Table)[] {
  const s = doc.settings;
  const grad = s.degreeLevel !== 'bachelor';
  const title = lines(pick(doc, 'titlepage', 'title')).concat(pick(doc, 'titlepage', 'subtitle') ? [pick(doc, 'titlepage', 'subtitle')] : []).join('\n');
  const gap = '                ';
  const head: Line[] = grad ? [
    { t: `国内图书分类号：${pick(doc, 'titlepage', 'classifiedIndex')}${gap}学校代码：${pick(doc, 'titlepage', 'schoolCode')}`, sz: 24, jc: AlignmentType.CENTER },
    { t: `国际图书分类号：${pick(doc, 'titlepage', 'udc')}${gap}密级：${pick(doc, 'titlepage', 'secrecy') || '公开'}`, sz: 24, line: 300 },
    E(24, { grid: true }), E(44, { line: 300 }), E(24, { grid: true }), E(24, { grid: true }), E(24, { grid: true }),
  ] : [
    // 模板的本科内封头一行：☑毕业论文　☐毕业设计 …… 密级：公开（范例只有右边那截，左边勾选框是模板加的）
    { t: `${s.form === 'practice' ? '☐' : '☑'}毕业论文  ${s.form === 'practice' ? '☑' : '☐'}毕业设计`, tab: `密级：${pick(doc, 'titlepage', 'secrecy') || '公开'}`, width, sz: 24, grid: true, jc: AlignmentType.LEFT },
    E(24, { jc: AlignmentType.CENTER }), E(24, { grid: true }), E(24, { grid: true }),
  ];
  const seq: Line[] = [
    ...head,
    C(DOC_TYPE[s.degreeLevel], 36, { b: true }),
    E(24, { jc: AlignmentType.CENTER, grid: true }), E(44, { jc: AlignmentType.CENTER, line: 300 }),
    C(title, 44, { zh: FONT.hei, grid: true }),
    E(24, { jc: AlignmentType.CENTER, grid: true }), E(44, { jc: AlignmentType.CENTER, grid: true }),
    E(44, { jc: AlignmentType.CENTER, line: 780, exact: true, grid: true }), E(44, { jc: AlignmentType.CENTER, line: 780, exact: true, grid: true }), E(grad ? 24 : 44, { jc: AlignmentType.CENTER, line: 780, exact: true, grid: true }),
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
  const cell = (children: ParagraphChild[], width: number, jc: (typeof AlignmentType)[keyof typeof AlignmentType]) => new TableCell({ borders: NO_B, width: { size: width, type: WidthType.DXA }, margins: { left: 0, right: 0, top: 0, bottom: 0 }, children: [new Paragraph({ style: 'Normal', alignment: jc, indent: { firstLine: 0 }, spacing: { before: 0, after: 0, line: 360, lineRule: LineRuleType.AUTO }, children })] });
  const trs = rows.map(([l, v]) => new TableRow({ cantSplit: true, height: { value: 540, rule: HeightRule.ATLEAST }, children: [cell([run(l, ZIHAO.sihao, { zh: FONT.hei })], 1806, AlignmentType.DISTRIBUTE), cell([run('：', ZIHAO.sihao)], 301, AlignmentType.LEFT), cell([run(v, ZIHAO.sihao)], 2951, AlignmentType.LEFT)] }));
  return [...seq.map(linePara), new Table({ rows: trs, layout: TableLayoutType.FIXED, alignment: AlignmentType.CENTER, width: { size: 0, type: WidthType.AUTO }, columnWidths: [1806, 301, 2951], borders: { ...NO_B, insideHorizontal: NO_B.top, insideVertical: NO_B.top }, margins: { left: 0, right: 0 } }), linePara(E(24, { grid: true }))];
}

/** 英文内封（硕博）：分类号两行、Dissertation for …、英文题目、两列信息表（标签黑体加粗、值 Times） */
export function titlepageEn(doc: ThesisDoc, _top: number): (Paragraph | Table)[] {
  const s = doc.settings;
  const titleEn = lines(pick(doc, 'titlepage', 'titleEn')).concat(pick(doc, 'titlepage', 'subtitleEn') ? [`: ${pick(doc, 'titlepage', 'subtitleEn')}`] : []).join('\n');
  const seq: Line[] = [
    { t: `Classified Index: ${pick(doc, 'titlepage', 'classifiedIndex')}`, sz: 24, grid: true },
    { t: `U.D.C: ${pick(doc, 'titlepage', 'udc')}`, sz: 24, grid: true },
    E(24, { grid: true }), E(24, { grid: true }), E(24, { grid: true }),
    C(DOC_TYPE_EN[s.degreeLevel], 36, { grid: true }),
    E(24, { jc: AlignmentType.CENTER }), E(44, { jc: AlignmentType.CENTER }), E(36, { jc: AlignmentType.CENTER, grid: true }),
    C(titleEn, 36, { b: true, line: 300 }),
    E(24, { jc: AlignmentType.CENTER }), E(44, { jc: AlignmentType.CENTER }),
    E(44, { jc: AlignmentType.CENTER, grid: true }), E(44, { jc: AlignmentType.CENTER, grid: true }),
  ];
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
  // 范例的表：两列 4262 / 4406 缇，标签行距 22 磅钉死、值同（长的那两行 18 磅）
  const cell = (children: ParagraphChild[], width: number, line: number) => new TableCell({ borders: NO_B, width: { size: width, type: WidthType.DXA }, children: [new Paragraph({ style: 'Normal', alignment: AlignmentType.LEFT, indent: { firstLine: 0 }, spacing: { before: 0, after: 0, line, lineRule: LineRuleType.EXACT }, children })] });
  const trs = rows.map(([l, v]) => { const long = wrap(v, ZIHAO.sihao, 4406 / PT - 10.8).length > 1; return new TableRow({ children: [cell([run(l, ZIHAO.sihao, { bold: true, zh: FONT.hei }), run('：', ZIHAO.sihao, { bold: true, zh: FONT.hei })], 4262, 440), cell([run(v, ZIHAO.sihao)], 4406, long ? 360 : 440)] }); });
  return [...seq.map(linePara), new Table({ rows: trs, layout: TableLayoutType.FIXED, alignment: AlignmentType.CENTER, width: { size: 0, type: WidthType.AUTO }, columnWidths: [4262, 4406], borders: { ...NO_B, insideHorizontal: NO_B.top, insideVertical: NO_B.top } }), linePara(E(24, { jc: AlignmentType.CENTER })), linePara(E(24, { jc: AlignmentType.CENTER }))];
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
