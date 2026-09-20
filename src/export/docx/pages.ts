// 表单页：封面、中文内封、英文内封、答辩决议、声明。位置照模板排出来的 PDF 逐行量的（基线离页顶多少磅），
// 这里用「上一行落在哪、这一行要落在哪」算段前距，行距钉死；字号字体照模板 src/pages/*.typ 的规定
import { Paragraph, TextRun, AlignmentType, LineRuleType, Table, TableRow, TableCell, WidthType, BorderStyle, VerticalAlign, PageBreak, type ParagraphChild } from 'docx';
import type { ThesisDoc, Info, DefensePerson } from '../../model/types';
import { PT, HALF, ZIHAO, FONT, fonts, hasCJK } from './units';

const DOC_TYPE = { bachelor: "本科毕业论文（设计）", master: "硕士学位论文", doctor: "博士学位论文" } as const;
const DOC_TYPE_EN = { bachelor: 'Graduation Thesis', master: "Dissertation for the Master's Degree", doctor: "Dissertation for the Doctoral Degree" } as const;

/** 逐行落位：cursor 记着上一段的底，下一段的段前距 = 目标基线 − 基线在行里的位置 − cursor */
class Flow {
  cursor: number;
  constructor(top: number) { this.cursor = top; }
  /** y：基线离页顶（磅）；size：字号（磅）；行高钉在 1.3 倍字号 */
  at(y: number, size: number, children: ParagraphChild[], extra: Partial<ConstructorParameters<typeof Paragraph>[0] & object> = {}): Paragraph {
    const line = Math.round(size * 1.3);
    const base = (line - size) / 2 + size * 0.86;
    const top = y - base;
    const before = Math.max(0, top - this.cursor);
    this.cursor = top + line;
    return new Paragraph({ alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { before: Math.round(before * PT), after: 0, line: line * PT, lineRule: LineRuleType.EXACT }, ...(extra as object), children });
  }
  /** 一个空段把游标推到 top（磅）：后面接表格这类没有段前距的东西 */
  gapTo(top: number): Paragraph {
    const h = Math.max(1, top - this.cursor);
    this.cursor = top;
    return new Paragraph({ spacing: { before: 0, after: 0, line: Math.round(h * PT), lineRule: LineRuleType.EXACT }, children: [] });
  }
}
const run = (text: string, size: number, o: { bold?: boolean; zh?: string; en?: string; italics?: boolean } = {}) => new TextRun({ text, size: size * HALF, bold: o.bold, italics: o.italics, font: fonts(o.zh ?? FONT.zh, o.en ?? FONT.en) });
const month = (iso: string | undefined, lang: 'zh' | 'en') => {
  const m = /^(\d{4})-(\d{2})/.exec(iso || '') ?? (() => { const d = new Date(); return ['', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0')]; })();
  const y = m[1], mo = Number(m[2]);
  if (lang === 'zh') return `${y} 年 ${mo} 月`;
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
const TEXT_W = 425; // 版心宽（磅）：A4 减左右各 3cm

/** 封面：标签 / （学术学位论文）/ 中文题目 / 英文题目 / 姓名 / 校名 / 年月。基线位置量自模板（磅） */
export function coverPage(doc: ThesisDoc, top: number): Paragraph[] {
  const s = doc.settings;
  const f = new Flow(top);
  const out: Paragraph[] = [];
  const title = lines(pick(doc, 'cover', 'title')), titleEn = lines(pick(doc, 'cover', 'titleEn'));
  const sub = pick(doc, 'cover', 'subtitle'), subEn = pick(doc, 'cover', 'subtitleEn');
  out.push(f.at(177, ZIHAO.xiaoyi, [run(DOC_TYPE[s.degreeLevel], ZIHAO.xiaoyi, { bold: true })]));
  if (s.degreeLevel !== 'bachelor') {
    const kind = s.degreeType === 'professional' ? '专业学位论文' : s.degreeType === 'none' ? '' : s.form === 'practice' ? '专业学位论文' : '学术学位论文';
    if (kind) out.push(f.at(231, ZIHAO.xiaoer, [run(`（${kind}）`, ZIHAO.xiaoer, { bold: true })]));
  }
  let y = 308;
  for (const t of [...title, ...(sub ? [sub] : [])].flatMap((x) => wrap(x, ZIHAO.erhao, TEXT_W))) { out.push(f.at(y, ZIHAO.erhao, [run(t, ZIHAO.erhao, { zh: FONT.hei, bold: !hasCJK(t) })])); y += 36; }
  y = Math.max(y + 38, 381);
  const enSize = s.titleEnXiaoer === true ? ZIHAO.xiaoer : ZIHAO.erhao;
  const enAll = [...titleEn, ...(subEn ? [`: ${subEn}`] : [])].flatMap((x) => wrap(x, enSize, TEXT_W, true));
  for (const t of enAll) { out.push(f.at(y, enSize, [run(t, enSize, { bold: true })])); y += Math.round(enSize * 1.43); }
  out.push(f.at(Math.max(y + 60, 541), ZIHAO.xiaoer, [run(pick(doc, 'cover', 'author') || '□□□', ZIHAO.xiaoer, { bold: true })]));
  out.push(f.at(687, ZIHAO.xiaoer, [run("哈尔滨工业大学", ZIHAO.xiaoer, { bold: true, zh: FONT.kai })]));
  out.push(f.at(718, ZIHAO.xiaoer, [run(month(pick(doc, 'cover', 'date'), 'zh'), ZIHAO.xiaoer, { bold: true })]));
  return out;
}


/** 中文内封 */
export function titlepageZh(doc: ThesisDoc, top: number): (Paragraph | Table)[] {
  const s = doc.settings; const f = new Flow(top);
  const out: (Paragraph | Table)[] = [];
  const corner = (l: string, r: string, y: number) => out.push(f.at(y, ZIHAO.xiaosi, [run(l, ZIHAO.xiaosi), new TextRun({ text: '\t' }), run(r, ZIHAO.xiaosi)], { alignment: AlignmentType.LEFT, tabStops: [{ type: 'right' as any, position: 8500 }] }));
  corner(`国内图书分类号：${pick(doc, 'titlepage', 'classifiedIndex')}`, `学校代码：${pick(doc, 'titlepage', 'schoolCode')}`, 121);
  corner(`国际图书分类号：${pick(doc, 'titlepage', 'udc')}`, `密级：${pick(doc, 'titlepage', 'secrecy') || '公开'}`, 136.5);
  out.push(f.at(262, ZIHAO.xiaoer, [run(DOC_TYPE[s.degreeLevel], ZIHAO.xiaoer, { bold: true })]));
  let y = 334;
  for (const t of [...lines(pick(doc, 'titlepage', 'title')), ...(pick(doc, 'titlepage', 'subtitle') ? [pick(doc, 'titlepage', 'subtitle')] : [])].flatMap((x) => wrap(x, ZIHAO.erhao, TEXT_W))) { out.push(f.at(y, ZIHAO.erhao, [run(t, ZIHAO.erhao, { zh: FONT.hei })])); y += 36; }
  const rows: [string, string][] = [
    [s.degreeLevel === 'doctor' ? '博士研究生' : '硕士研究生', pick(doc, 'titlepage', 'author')],
    ['导师', pick(doc, 'titlepage', 'supervisor')],
    ...(doc.info.coSupervisor ? [['副导师', doc.info.coSupervisor] as [string, string]] : []),
    ['申请学位', pick(doc, 'titlepage', 'degreeApplied')],
    [s.form === 'practice' ? '类别' : '学科', s.form === 'practice' ? pick(doc, 'titlepage', 'practiceType') : pick(doc, 'titlepage', 'speciality')],
    ['所在单位', pick(doc, 'titlepage', 'affiliation')],
    ['答辩日期', month(doc.info.defenseDate || pick(doc, 'titlepage', 'date'), 'zh')],
    ['授予学位单位', '哈尔滨工业大学'],
  ];
  y = Math.max(521, y + 150);
  // 标签一列分散对齐（Word 的做法），值一列靠左；行高钉 29.6 磅
  const cell = (children: Paragraph[], width: number) => new TableCell({ borders: { top: { style: BorderStyle.NIL, size: 0 }, bottom: { style: BorderStyle.NIL, size: 0 }, left: { style: BorderStyle.NIL, size: 0 }, right: { style: BorderStyle.NIL, size: 0 } }, width: { size: width, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children });
  const p = (children: ParagraphChild[], alignment: (typeof AlignmentType)[keyof typeof AlignmentType]) => new Paragraph({ alignment, indent: { firstLine: 0 }, spacing: { before: 0, after: 0, line: Math.round(29.6 * PT), lineRule: LineRuleType.EXACT }, children });
  const trs = rows.map(([l, v]) => new TableRow({ children: [cell([p([run(l, ZIHAO.sihao)], AlignmentType.DISTRIBUTE)], 6 * ZIHAO.sihao * PT), cell([p([run('：', ZIHAO.sihao)], AlignmentType.LEFT)], Math.round(0.9 * ZIHAO.sihao * PT)), cell([p([run(v, ZIHAO.sihao)], AlignmentType.LEFT)], 220 * PT)] }));
  // 表格第一行的基线 ≈ 行顶 + 20（29.6 的行、四号字居中）
  out.push(f.gapTo(y - 20));
  (out as (Paragraph | Table)[]).push(new Table({ rows: trs, alignment: AlignmentType.CENTER, width: { size: (6.9 * ZIHAO.sihao + 220) * PT, type: WidthType.DXA }, columnWidths: [6 * ZIHAO.sihao * PT, Math.round(0.9 * ZIHAO.sihao * PT), 220 * PT], layout: 'fixed' as any }));
  return out;
}

/** 英文内封 */
export function titlepageEn(doc: ThesisDoc, top: number): Paragraph[] {
  const s = doc.settings; const f = new Flow(top);
  const out: Paragraph[] = [];
  out.push(f.at(122, ZIHAO.xiaosi, [run(`Classified Index: ${pick(doc, 'titlepage', 'classifiedIndex')}`, ZIHAO.xiaosi)], { alignment: AlignmentType.LEFT }));
  out.push(f.at(142, ZIHAO.xiaosi, [run(`U.D.C: ${pick(doc, 'titlepage', 'udc')}`, ZIHAO.xiaosi)], { alignment: AlignmentType.LEFT }));
  out.push(f.at(233, ZIHAO.xiaoer, [run(DOC_TYPE_EN[s.degreeLevel], ZIHAO.xiaoer)]));
  const enSize = s.titleEnXiaoerTitlepage === true ? ZIHAO.xiaoer : ZIHAO.erhao;
  let y = 338;
  for (const t of [...lines(pick(doc, 'titlepage', 'titleEn')), ...(pick(doc, 'titlepage', 'subtitleEn') ? [`: ${pick(doc, 'titlepage', 'subtitleEn')}`] : [])].flatMap((x) => wrap(x, enSize, TEXT_W, true))) { out.push(f.at(y, enSize, [run(t, enSize, { bold: true })])); y += Math.round(enSize * 1.43); }
  const rows: [string, string][] = [
    ['Candidate', doc.info.authorEn || pick(doc, 'titlepage', 'author')],
    ['Supervisor', doc.info.supervisorEn || pick(doc, 'titlepage', 'supervisor')],
    ...(doc.info.coSupervisorEn ? [['Associate Supervisor', doc.info.coSupervisorEn] as [string, string]] : []),
    ['Academic Degree Applied for', doc.info.degreeAppliedEn || pick(doc, 'titlepage', 'degreeApplied')],
    ['Speciality', doc.info.specialityEn || pick(doc, 'titlepage', 'speciality')],
    ['Affiliation', doc.info.affiliationEn || pick(doc, 'titlepage', 'affiliation')],
    ['Date of Defence', doc.info.defenseDateEn || month(doc.info.defenseDate || pick(doc, 'titlepage', 'date'), 'en')],
    ['Degree-Conferring-Institution', 'Harbin Institute of Technology'],
  ];
  y = Math.max(540, y + 130);
  for (const [l, v] of rows) { out.push(f.at(y, ZIHAO.xiaosi, [run(`${l}: `, ZIHAO.xiaosi, { bold: true }), new TextRun({ text: '\t' }), run(v, ZIHAO.xiaosi)], { alignment: AlignmentType.LEFT, tabStops: [{ type: 'left' as any, position: 3400 }] })); y += 22; }
  return out;
}

/** 答辩决议：一张六列表——评阅人块、竖排「答辩委员会成员」的委员会块、决议一格；列宽照模板 */
export function defensePage(doc: ThesisDoc, title: Paragraph): (Paragraph | Table)[] {
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
  rows.push(row([cell('评阅人\n（根据实际人数填写）', { span: 2, rows: reviewers.length + 1, bold: true, children: [cellP('评阅人', true), cellP('（根据实际人数填写）')] }), cell('姓名', { bold: true }), cell('职称（是否博导）', { bold: true }), cell('工作单位', { bold: true }), cell('所在学科', { bold: true })]));
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
  return [title, table];
}

/** 原创性声明与使用权限：正文固定，题目从论文信息取 */
export function declarationsPage(doc: ThesisDoc, title: Paragraph, subTitle: (t: string) => Paragraph): Paragraph[] {
  const body = (t: string) => new Paragraph({ style: 'Normal', children: [new TextRun({ text: t })] });
  const sig = (who: string, before = 1) => new Paragraph({ alignment: AlignmentType.LEFT, indent: { left: 96 * PT, firstLine: 0 }, spacing: { before: before * 19.5 * PT }, children: [new TextRun({ text: `${who}签名：` }), new TextRun({ text: '\t日期：\t年\t月\t日' })], tabStops: [{ type: 'left' as any, position: 5200 }, { type: 'left' as any, position: 6600 }, { type: 'left' as any, position: 7400 }, { type: 'left' as any, position: 8000 }] });
  const t = doc.info.title.split('\n').join('');
  return [
    title,
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
