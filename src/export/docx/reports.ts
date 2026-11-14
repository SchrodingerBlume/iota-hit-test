import { Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, BorderStyle, HeightRule, WidthType, TableLayoutType, LineRuleType, TabStopType, type ParagraphChild } from 'docx';
import type { ThesisDoc, Settings, Info } from '../../model/types';
import { wordPage, gapTwips, tw, type Style, type Facts, type PageSetup } from './template';
import { fonts, fontsFor, NO_BORDERS, FONT } from './units';
import data from './report-data.json';

interface ReportStyle extends Style { weight?: string | number; fill?: string }
interface Profile {
  labels: Record<string, string>;
  review: Record<string, string>;
  cover: Record<string, unknown>;
  instructions: {
    title: string; layout: unknown;
    profile: { body: ReportStyle; title: ReportStyle; section: ReportStyle; before: number; gap: number; 'body-left': number };
    blocks: { kind: string; text?: string; format?: ReportStyle; lang?: string; shenzhen?: boolean }[];
    source: { id: string; lang: string; translated?: boolean }[];
  };
}
export const REPORT_TEMPLATE = data.template;
export const isDoctorInterimForm = (s: Settings) => s.campus === 'shenzhen' && s.degreeLevel === 'doctor' && s.stage === 'interim';
export function reportProfile(s: Settings): Profile {
  return (data.profiles as unknown as Record<string, Profile>)[[s.campus, s.degreeLevel, s.stage, s.lang, s.form].join('/')];
}
const lines = (text: string, size: number, bold = false, asian = FONT.zh, extra: { color?: string; italics?: boolean; characterSpacing?: number } = {}): ParagraphChild[] => text.split('\n').flatMap((t, i) => [ ...(i ? [new TextRun({ break: 1 })] : []), new TextRun({ text: t, size: size * 2, bold, font: fontsFor(t, asian), ...extra }) ]);
const blank = (height: number) => new Paragraph({ style: 'NoGrid', spacing: { before: 0, after: 0, line: tw(height), lineRule: LineRuleType.EXACT }, run: { size: 2 }, children: [] });
const month = (value: string, en = false) => {
  const m = /^(\d{4})-(\d{2})/.exec(value);
  if (!m) return '';
  return en ? `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m[2]) - 1]}, ${m[1]}` : `${m[1]}年${Number(m[2])}月`;
};
const valueOf = (doc: ThesisDoc, key: keyof Info) => String(doc.localInfo?.cover?.[key] || doc.info[key] || '');
const rules = { top: { style: BorderStyle.SINGLE, size: 8 }, bottom: { style: BorderStyle.SINGLE, size: 8 }, left: { style: BorderStyle.SINGLE, size: 8 }, right: { style: BorderStyle.SINGLE, size: 8 } } as const;

/** 深圳研究生首页与博士中期信息表，字段及变体参数来自打包模板。 */
export function graduateReportCover(doc: ThesisDoc, F: Facts): (Paragraph | Table)[] {
  const profile = reportProfile(doc.settings), en = doc.settings.lang === 'en';
  const label = profile.labels;
  const heading = (text: string, size: number, height?: number) => new Paragraph({ style: 'NoGrid', alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: tw(height ?? size * 1.3), lineRule: LineRuleType.EXACT }, children: lines(text, size, true, FONT.kaiGb) });
  if (isDoctorInterimForm(doc.settings)) {
    const names = ['author', 'enrollment', 'title', 'specialty', 'date', 'supervisor'];
    const values = [`${doc.info.studentId}\t${valueOf(doc, 'author')}`, '', valueOf(doc, 'title'), valueOf(doc, 'speciality'), month(valueOf(doc, 'date'), en), valueOf(doc, 'supervisor')];
    const widths = [170.05, 212.6];
    const rows = names.map((key, i) => new TableRow({ height: { value: tw(34), rule: HeightRule.ATLEAST }, cantSplit: true, children: [label[key] ?? key, values[i]].map((text, col) => new TableCell({ width: { size: tw(widths[col]), type: WidthType.DXA }, margins: { top: 0, bottom: 0, left: 10, right: 10 }, verticalAlign: 'center', borders: { ...NO_BORDERS, bottom: rules.bottom }, children: [new Paragraph({ style: 'NoGrid', tabStops: [{ type: TabStopType.LEFT, position: tw(99.2) }], indent: { firstLine: 0, left: tw(i === 0 && col === 0 ? 4 : 1) }, spacing: { before: 0, after: 0, line: 330, lineRule: LineRuleType.EXACT }, children: lines(text, 14, col === 0) })] })) }));
    return [blank(91.7), heading(label.university, 22, 34), heading(label['document-type'], 22, 25.5), blank(113.85), new Table({ indent: { size: tw(93.6), type: WidthType.DXA }, width: { size: tw(widths[0] + widths[1]), type: WidthType.DXA }, columnWidths: widths.map(tw), layout: TableLayoutType.FIXED, borders: { ...NO_BORDERS, insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top }, rows })];
  }
  const spec = { ...profile.cover, ...(en && typeof profile.cover.en === 'object' ? profile.cover.en as Record<string, unknown> : {}) };
  const size = Number(spec['title-size'] ?? 22), indent = Number(spec['field-indent'] ?? 63);
  const spacing = spec['field-spacing'] as number | { exactly: number } | undefined;
  const fieldLine = typeof spacing === 'object' ? { line: tw(spacing.exactly), lineRule: LineRuleType.EXACT } : { line: Math.round((spacing ?? 1.75) * 240), lineRule: LineRuleType.AUTO };
  const title = valueOf(doc, en && valueOf(doc, 'titleEn') ? 'titleEn' : 'title');
  const out: (Paragraph | Table)[] = [blank(doc.settings.stage === 'proposal' && doc.settings.degreeLevel === 'master' ? 47.25 : 36), heading(label.university, 18), blank(18), heading(label['document-type'], size), blank(18)];
  const titleLines = Math.max(Number(spec['minimum-title-lines'] ?? 1), title.split('\n').length);
  out.push(new Paragraph({ style: 'NoGrid', alignment: AlignmentType.LEFT, spacing: { before: 0, after: 0, line: tw(23.4), lineRule: LineRuleType.AT_LEAST }, children: lines(`${en ? 'Title: ' : '题 目：'}${title}`, 18, true) }));
  out.push(blank(Math.max(12, (titleLines - title.split('\n').length + 1) * 20.7)));
  const fields: [string, string][] = [['affiliation', valueOf(doc, 'affiliation')], ['specialty', valueOf(doc, 'speciality')], ['supervisor', valueOf(doc, 'supervisor')], ['author', valueOf(doc, 'author')], ['student-id', doc.info.studentId], ['date', month(valueOf(doc, 'date'), en)]];
  const page = F.pages.cover ?? F.layout.front;
  const total = Math.min(Number(spec['field-cells'] ?? 20.5) * 16, page['paper-width'] - page.margin.left - page.margin.right - indent);
  const labelWidth = Math.min(6 * 16, total * 0.45);
  const rows = fields.map(([key, value], i) => new TableRow({ cantSplit: true, children: [new TableCell({ width: { size: tw(labelWidth), type: WidthType.DXA }, borders: NO_BORDERS, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: [new Paragraph({ style: 'NoGrid', spacing: { ...fieldLine, before: i === 0 ? tw(Number(spec['field-first-above'] ?? 0)) : 0, after: 0 }, children: lines(key === 'date' && !en ? `${label.stage ?? (doc.settings.stage === 'proposal' ? '开题报告' : '中期报告')}${label[key] ?? ''}` : label[key] ?? key, 16, true) })] }), new TableCell({ width: { size: tw(total - labelWidth), type: WidthType.DXA }, borders: NO_BORDERS, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: [new Paragraph({ style: 'NoGrid', alignment: AlignmentType.CENTER, spacing: { ...fieldLine, before: i === 0 ? tw(Number(spec['field-first-above'] ?? 0)) : 0, after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4 } }, children: lines(value || ' ', 16) })] })] }));
  out.push(new Table({ indent: { size: tw(indent), type: WidthType.DXA }, columnWidths: [tw(labelWidth), tw(total - labelWidth)], width: { size: tw(total), type: WidthType.DXA }, layout: TableLayoutType.FIXED, rows, borders: { ...NO_BORDERS, insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top } }));
  out.push(blank(48), heading(label.seal ?? (en ? 'Graduate School' : '研究生院制'), 16));
  if (spec['seal-month']) out.push(heading(month(valueOf(doc, 'date'), en), 16));
  return out;
}

export function reportInstructions(doc: ThesisDoc, F: Facts): { L: PageSetup; blocks: (Paragraph | Table)[] } | null {
  const instruction = reportProfile(doc.settings)?.instructions;
  if (!instruction?.blocks.length) return null;
  const L = F.pages.instructions ?? wordPage(instruction.layout), spec = instruction.profile, f = F.fonts;
  const p = (text: string, style: ReportStyle) => {
    const spacing = style['line-spacing'] ?? 1;
    const line = typeof spacing === 'number' ? { line: Math.round(spacing * 240), lineRule: LineRuleType.AUTO } : typeof spacing === 'object' ? { line: tw(spacing.exactly ?? spacing['at-least'] ?? 12), lineRule: spacing.exactly !== undefined ? LineRuleType.EXACT : LineRuleType.AT_LEAST } : { line: spacing === 'double' ? 480 : 240, lineRule: LineRuleType.AUTO };
    const asian = f[style['asian-font'] ?? 'songti'] ?? FONT.zh;
    return new Paragraph({ style: 'NoGrid', keepNext: style.sticky, alignment: style.align === 'center' ? AlignmentType.CENTER : style.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT, indent: { firstLine: typeof style['first-line-indent'] === 'number' ? tw(style['first-line-indent']) : 0, left: tw((typeof style['left-indent'] === 'number' ? style['left-indent'] : 0) + spec['body-left']) }, spacing: { ...line, before: gapTwips(style.above, L), after: gapTwips(style.below, L) }, run: { font: fonts(asian, f.serif), size: (style.size ?? 12) * 2, bold: style.bold ?? (style.weight === 'bold'), color: style.fill?.replace(/^#/, '') }, children: lines(text, style.size ?? 12, style.bold ?? style.weight === 'bold', asian, { color: style.fill?.replace(/^#/, ''), characterSpacing: style.tracking === undefined ? undefined : tw(style.tracking) }) });
  };
  const out: (Paragraph | Table)[] = [blank(spec.before), p(instruction.title, spec.title), blank(spec.gap)];
  if (instruction.source[0]?.translated) out.push(p('English translation of the Chinese template. Source units are retained (characters, not converted to words); bibliographic examples retain their original text.', { ...spec.body, size: 9, 'line-spacing': { exactly: 12 }, fill: '666666' }));
  for (const block of instruction.blocks) {
    if (block.kind !== 'levels') { out.push(p(block.text ?? '', { ...spec.body, ...(block.kind === 'section' ? spec.section : block.format) })); continue; }
    const en = block.lang === 'en';
    const rows = [[en ? 'Name' : '层次名称', en ? 'Example' : '示例', en ? 'Illustration' : '说明'], [en ? 'Section' : '节', '1 □□……□', en ? 'Write the number flush left and start the text in a new paragraph.' : block.shenzhen ? '题序顶格书写，与标题间空1个半角字符，阐述内容另起一段' : '题序顶格书写，阐述内容另起一段'], [en ? 'Article' : '条', '1.1 □□……□', ''], [en ? 'Item' : '款', '1.1.1 □□……□', ''], [en ? 'Sequence Number' : '项', '（1）□□…□', en ? 'Indent the number by four half-width characters and leave four half-width characters before the text.' : '题序空4个半角字符书写，内容空4个半角字符接排']];
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [tw(70), tw(135), tw(L['paper-width'] - L.margin.left - L.margin.right - 205)], rows: rows.map((row, i) => new TableRow({ cantSplit: true, children: row.map((text, col) => new TableCell({ borders: rules, margins: { top: 20, bottom: 20, left: 60, right: 60 }, children: [p(text, { ...spec.body, align: 'center' })] })) })) }));
  }
  return { L, blocks: out };
}

export function interimSection(head: Paragraph, body: (Paragraph | Table)[], index: number, width = 533.7): Table {
  const heights = [[31.35, 309], [35.05, 397], [28.3, 405], [28.3, 325], [28.3, 741]][index] ?? [28.3, 0];
  const cell = (children: (Paragraph | Table)[]) => new TableCell({ borders: rules, margins: { top: 10, bottom: 10, left: 10, right: 10 }, verticalAlign: 'center', children: children.length ? children : [new Paragraph({ children: [] })] });
  return new Table({ width: { size: tw(width), type: WidthType.DXA }, indent: { size: -10, type: WidthType.DXA }, columnWidths: [tw(width)], layout: TableLayoutType.FIXED, rows: [new TableRow({ tableHeader: true, cantSplit: true, height: { value: tw(heights[0]), rule: HeightRule.ATLEAST }, children: [cell([head])] }), new TableRow({ height: { value: tw(heights[1]), rule: HeightRule.ATLEAST }, children: [cell(body)] })] });
}

/** 导师意见、检查组评议与签字表；留白单元格在 Word 中仍可直接填写。 */
export function interimReview(doc: ThesisDoc, resolution: (Paragraph | Table)[]): (Paragraph | Table)[][] {
  const t = reportProfile(doc.settings).review, en = doc.settings.lang === 'en';
  const label = (key: string, fallback: string) => t[key] || fallback;
  const p = (text: string, small = false) => new Paragraph({ style: 'NoGrid', indent: { firstLine: 0 }, spacing: { before: 0, after: 0, line: tw(small ? 12.75 : 14.25), lineRule: LineRuleType.EXACT }, children: lines(text, small ? 11 : 12) });
  const cell = (children: (Paragraph | Table)[], span?: number) => new TableCell({ columnSpan: span, borders: NO_BORDERS, margins: { top: 10, bottom: 10, left: 10, right: 10 }, children: children.length ? children : [p('')] });
  const row = (children: (Paragraph | Table)[], height: number, cantSplit = true) => new TableRow({ cantSplit, height: { value: tw(height), rule: HeightRule.ATLEAST }, children: [cell(children)] });
  const frame = (rows: TableRow[]) => new Table({ width: { size: tw(533.7), type: WidthType.DXA }, columnWidths: [tw(533.7)], layout: TableLayoutType.FIXED, borders: { ...rules, insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top }, rows });
  const supervisor = frame([
    row([p(label('supervisor-opinion', en ? 'Supervisor’s Opinion' : '导师意见'))], 28.3),
    row([p(label('supervisor-hint', en ? 'Please comment on the research progress and achievements.' : '请对研究生的研究工作、进度和取得的成果提出意见。'), true)], 56.6),
    row([], 504, false), row([p(label('completion-question', en ? 'Can the thesis be completed on schedule?' : '能否按期完成论文？'), true)], 30),
    row([p(['on-time', 'delay', 'dismissal'].map(k => `☐ ${label(`completion-${k}`, ({ 'on-time': '按期完成', delay: '延期完成', dismissal: '终止培养' })[k]!)}`).join('    '), true)], 28.3),
    row([], 33), row([p(label('supervisor-signature', en ? 'Supervisor’s signature:' : '导师签字：'), true)], 28.3), row([], 21), row([p(en ? 'Date:' : '年    月    日', true)], 25.5), row([], 25),
  ]);
  const review = frame([
    row([p(label('resolution', en ? 'Review Panel’s Opinion' : '检查组评议意见'))], 28.3), row(resolution, 141.7, false),
    row([p(label('result', en ? 'Assessment result' : '评议结果'))], 28.3),
    ...['pass', 'revise', 'dismissal'].map(k => row([p(`☐ ${label(`result-${k}`, ({ pass: '通过', revise: '修改后通过', dismissal: '不通过' })[k]!)}`)], 28.3)),
    ...Array.from({ length: Math.max(1, doc.defense.chair.length) }, () => [row([p(label('chair-signature', en ? 'Chair’s signature:' : '检查组组长签字：'))], 28.3), row([p(month(doc.info.date, en))], 28.3)]).flat(),
    row([p(label('members-title', en ? 'Review Panel Members' : '检查组成员'))], 28.3),
  ]);
  const people = [...doc.defense.chair, ...doc.defense.members];
  while (people.length < 5) people.push({ name: '', title: '', discipline: '', affiliation: '' });
  const tables: Table[] = [];
  for (let i = 0; i < people.length; i += 5) {
    const selected = people.slice(i, i + 5), widths = [28.4, 136.25, 113.2, 127.9, 127.95];
    const c = (text: string, col: number, rowSpan?: number) => new TableCell({ rowSpan, width: { size: tw(widths[col]), type: WidthType.DXA }, borders: rules, verticalAlign: 'center', margins: { top: 10, bottom: 10, left: 10, right: 10 }, children: [p(text, true)] });
    tables.push(new Table({ width: { size: tw(533.7), type: WidthType.DXA }, columnWidths: widths.map(tw), layout: TableLayoutType.FIXED, rows: [new TableRow({ cantSplit: true, children: [c(label('committee', en ? 'Panel' : '检查组'), 0, selected.length + 1), ...['name', 'title', 'discipline', 'signature'].map((k, j) => c(label(`column-${k}`, ({ name: '姓名', title: '职称', discipline: '学科', signature: '签字' })[k]!), j + 1))] }), ...selected.map(person => new TableRow({ cantSplit: true, height: { value: tw(28.3), rule: HeightRule.ATLEAST }, children: [c(person.name, 1), c(person.title, 2), c(person.discipline, 3), c('', 4)] }))] }));
  }
  return [[supervisor], [review, blank(0.05), ...tables.flatMap((table, i) => i ? [blank(0.05), table] : [table])]];
}
