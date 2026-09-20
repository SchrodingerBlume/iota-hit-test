// 整份工程 → main.typ（以及要一起交给编译器的旁文件）。
// 结构照 iota-hit/template/example.typ：前置 → 主体 → 附录 → 后置。
import type { ThesisDoc, Settings, Info, StyleEntry, OpenrightKey, LayoutDict, LocalInfoPage, TriBool } from '../model/types';
import { INFO_FIELDS, localInfoFields, type InfoFieldDef } from '../model/info';
import { serializeDoc, escapeText, collectImages, collectRefTargets, collectCiteKeys, indexPositions, type PMNode } from './pmToTypst';
import { computeNumbering } from './numbering';
import type { RichDoc } from '../model/types';
import { generateBibtex } from '../bib/bibtex';
import { resolvePage } from '../model/pages';
import { mark, stripMarks, type Segment } from './sourcemap';
import { lengthTypst, ABS_UNITS } from '../model/length';
import type { RichKey } from '../model/store';

export const IOTA_HIT_VERSION = '0.1.0';

export const FONTSET_ARG: Record<string, string> = {
  webapp: 'fontset: presets.webapp + (kaishu: "FandolKai")',
  windows: 'fontset: presets.windows',
  macos: 'fontset: presets.macos',
};

export interface Project {
  main: string;
  /** 旁文件：refs.bib、achievements.bib；图片另走二进制通道 */
  files: Record<string, string>;
  images: string[];
  /** main.typ 里每段文字对应编辑器里的哪儿（预览区直接编辑用） */
  segments: Segment[];
}

const content = (s: string) => `[${escapeText(s.trim())}]`;
/** 元信息字段：内容外面套映射记号，pmFrom/pmTo 记的是在字段值里的偏移 */
const infoContent = (field: string, s: string) => {
  const raw = s.trim();
  return `[${mark('info', 'info', 0, raw.length, escapeText(raw), { attr: field, raw })}]`;
};
const infoMultiline = (field: string, s: string) => {
  const value = s.trim();
  const lines: string[] = [];
  let offset = 0;
  for (const line of value.split(/\r?\n/)) {
    const raw = line.trim();
    const start = offset + line.indexOf(raw);
    offset += line.length + 1;
    if (!raw) continue;
    lines.push(mark('info', 'info', start, start + raw.length, escapeText(raw), { attr: field, raw }));
  }
  return `[${lines.join(' \\ ')}]`;
};

function tri(v: 'auto' | boolean | string): string {
  if (v === 'auto') return 'auto';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return JSON.stringify(v);
}

/** 预览用 Word 式断行（本站 fork 的 par(linebreaks: (mode: "msword"))）；导出的 .typ 不带 */
const msword = (s: Settings) => (s.linebreaker === 'auto' ? 'msword' : s.linebreaker) === 'msword';
/** 断行引擎的字典：预览里由 worker 用 --input linebreaks=… 告诉模板，模板自己按各部件的网格发 set par(linebreaks:)、不再发模拟网格的 tracking */
/** Word 那几个影响断行的开关，解成 fork 的 linebreaks 字典键；auto 都照中文 Word 的默认 */
export function wordLinebreakOptions(s: Settings): { compat: number; compress: boolean; kern: boolean; balance: boolean; adjustRightIndent: boolean; hyphenLimit: number; hyphenateCaps: boolean } {
  const on = (v: TriBool) => v === 'auto' || v === true;
  return {
    compat: s.wordCompat === 'auto' ? 11 : Number(s.wordCompat),
    compress: on(s.wordCompress),
    kern: on(s.wordKern),
    balance: on(s.wordBalanceWidths),
    adjustRightIndent: on(s.wordAdjustRightIndent),
    hyphenLimit: s.hyphenLimit === 'auto' ? 0 : Number(s.hyphenLimit),
    hyphenateCaps: on(s.hyphenateCaps),
  };
}
export function linebreaksInput(s: Settings): string | null {
  if (!msword(s)) return null;
  const o = wordLinebreakOptions(s);
  return JSON.stringify({ mode: 'msword', compat: o.compat, kern: o.kern, 'adjust-right-indent': o.adjustRightIndent, 'balance-widths': o.balance, compress: o.compress, 'consecutive-hyphens': o.hyphenLimit, 'hyphenate-caps': o.hyphenateCaps });
}
/** 预览里走 fork 时表格单元格的那一档（闭标点只压半格不挂出、老模式不按整格）：模板只发原版认得的字典，
 *  这一键站内在单元格上补——读到模板发的那份原样加一键，模板不用认识 fork */
// 表格单元格：断行引擎的 cell 档（闭标点只压半格不挂出、老模式不按整格取整）。
// *挂在 table 上，不挂在 table.cell 上*：show table.cell 把格子包进 context 后，跨行格里 align(horizon) 的东西不再居中
// （答辩决议页竖排的「委／员」「答辩委员会成员」整摞贴到格顶）；包整张表没这个事，格里的段照样吃到这句 set
const MSWORD_CELL = `#show table: it => context { if type(par.linebreaks) == dictionary { set par(linebreaks: par.linebreaks + (cell: true)); it } else { it } }`;
/** 预览里选了 Typst 原版的两种断行：写死在源码里（引擎是 fork 也认） */
function stockPrelude(s: Settings): string {
  return msword(s) ? '' : `#set par(linebreaks: ${JSON.stringify(s.linebreaker)})`;
}

/** 工程 JSON 里的版面字典 → Typst 字典原文：字符串照 Typst 原话（长度、zihao.xxx、"…" 带引号的才是字符串） */
export function typstDict(v: unknown): string {
  if (v === null || v === undefined) return 'none';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.trim() === '' ? 'none' : v.trim();
  if (Array.isArray(v)) return `(${v.map(typstDict).join(', ')}${v.length === 1 ? ',' : ''})`;
  const entries = Object.entries(v as Record<string, unknown>);
  return entries.length ? `(${entries.map(([k, x]) => `${k}: ${typstDict(x)}`).join(', ')})` : '(:)';
}
export const layoutArg = (d: LayoutDict | undefined): string => (d && Object.keys(d).length ? `layout: ${typstDict(d)}` : '');
const localStylesArg = (d: LayoutDict | undefined): string => (d && Object.keys(d).length ? `styles: ${typstDict(d)}` : '');

function settingsArgs(s: Settings): string[] {
  const args: string[] = [];
  if (layoutArg(s.layout?.doc)) args.push(layoutArg(s.layout?.doc));
  args.push(`campus: ${JSON.stringify(s.campus)}`);
  args.push(`degree-level: ${JSON.stringify(s.degreeLevel)}`);
  args.push(`form: ${JSON.stringify(s.form)}`);
  args.push(`stage: ${JSON.stringify(s.stage)}`);
  args.push(`category: ${JSON.stringify(s.category)}`);
  args.push(`lang: ${JSON.stringify(s.lang)}`);
  if (s.degreeLevel !== 'bachelor' && s.degreeType !== 'auto') {
    args.push(`degree-type: ${s.degreeType === 'none' ? 'none' : JSON.stringify(s.degreeType)}`);
  }
  // 字体：站内那一档是 webapp + FandolKai（教育部楷体只有繁体字形）；读了本机字体
  // 就切模板自己的 windows / macos 档，缺的字由模板的回落链接住
  args.push(s.mathFont ? `${FONTSET_ARG[s.fontset ?? 'webapp']} + (math: ${JSON.stringify(s.mathFont)})` : FONTSET_ARG[s.fontset ?? 'webapp']);
  const bools: [keyof Settings, string][] = [
    ['captionBilingual', 'caption-bilingual'],
    ['captionNumberingByChapter', 'caption-numbering-by-chapter'],
    ['equationNumberingByChapter', 'equation-numbering-by-chapter'],
    ['equationNumberingFullwidth', 'equation-numbering-fullwidth'],
    ['subcaptionBilingual', 'subcaption-bilingual'],
    ['heading1Pagebreak', 'heading-1-pagebreak'],
    ['openright', 'openright'],
    ['enumHanging', 'enum-hanging'],
    ['listHanging', 'list-hanging'],
    ['abbreviationLinks', 'abbreviation-links'],
    ['abbreviationIndexed', 'abbreviation-indexed'],
    ['titleSpread', 'two-hanzi'],
    ['fakeBold', 'fake-bold'],
  ];
  for (const [key, param] of bools) {
    const v = s[key];
    if (v !== 'auto') args.push(`${param}: ${tri(v as boolean)}`);
  }
  // 强调：默认像 Word 斜切（模板的 fake-italic: true）；开了「强调排楷体」才走模板自己的 auto（有楷体换楷体）
  args.push(`fake-italic: ${s.emphKaishu === true ? 'auto' : 'true'}`);
  if (s.emDash !== 'auto') args.push(`em-dash: ${JSON.stringify(s.emDash)}`);
  const styles = stylesArg(s.styles ?? {});
  if (styles) args.push(styles);
  if (s.appendixNumbering !== 'auto') {
    const pattern = { letters: 'A', roman: 'I', numbers: '1', hanzi: '一', words: 'One' }[s.appendixNumbering];
    args.push(`appendix-numbering: ${JSON.stringify(pattern)}`);
  }
  return args;
}

/** 样式表覆盖 → iota-hit(styles: (chapter: (align: left, …), …))；空项不发 */
export function styleEntryArgs(e: StyleEntry): string[] {
  const out: string[] = [];
  // 模板 2a2a53b 起照 Word 字体对话框的两格叫 asian-font / latin-font（工程 JSON 里的键名 fontZh 不动）
  if (e.fontZh) out.push(`asian-font: ${JSON.stringify(e.fontZh)}`);
  const abs = (v: unknown, fb: string) => lengthTypst(v, 'pt', fb, ABS_UNITS);
  if (e.size !== undefined && e.size !== '') out.push(`size: ${typeof e.size === 'string' && /^[a-z]+$/.test(e.size) ? `zihao.${e.size}` : abs(e.size, '12pt')}`);
  if (e.bold !== undefined) out.push(`bold: ${e.bold}`);
  if (e.align) out.push(`align: ${e.align}`);
  if (e.lineSpacing !== undefined) out.push(`line-spacing: ${typeof e.lineSpacing === 'number' ? e.lineSpacing : `(exactly: ${abs(e.lineSpacing.exactly, '20pt')})`}`);
  const gap = (v: unknown) => lengthTypst(v, 'lines', '(lines: 0.5)', ['cm', 'mm', 'in', 'pt', 'em', 'lines']);
  if (e.above !== undefined) out.push(`above: ${gap(e.above)}`);
  if (e.below !== undefined) out.push(`below: ${gap(e.below)}`);
  if (e.tracking !== undefined) out.push(`tracking: ${abs(e.tracking, '0pt')}`);
  return out;
}
function stylesArg(styles: Settings['styles']): string {
  const entries = Object.entries(styles).flatMap(([k, e]) => { const a = styleEntryArgs(e ?? {}); if (!a.length) return []; return k === 'toc' ? ['toc-1', 'toc-2', 'toc-3', 'toc-4'].map((t) => [t, a] as const) : [[k, a] as const]; });
  if (!entries.length) return '';
  return `styles: (\n    ${entries.map(([k, a]) => `${k}: (${a.join(', ')})`).join(',\n    ')},\n  )`;
}

/** 一个元信息参数 `param: 值`，空的不发（返回 null）。attr 记进映射记号：预览里点到这个字就跳到 data-info 是它的输入框 */
function infoArg(f: InfoFieldDef, v: string | string[] | undefined, attr: string): string | null {
  if (f.kind === 'keywords') {
    const list = ((v as string[] | undefined) ?? []).map((k) => k.trim()).filter(Boolean);
    return list.length ? `${f.param}: (${list.map((k, i) => `[${mark('info', 'info', i, i + 1, escapeText(k), { attr, raw: k })}]`).join(', ')},)` : null;
  }
  const str = String(v ?? '').trim();
  if (!str) return null;
  // 模板收 "YYYY-MM" 字符串，自己按语言排成「2026 年 6 月」/「June, 2026」
  if (f.kind === 'month' && /^\d{4}-\d{2}$/.test(str)) return `${f.param}: "${mark('info', 'info', 0, str.length, str, { attr, raw: str })}"`;
  return `${f.param}: ${f.kind === 'textarea' ? infoMultiline(attr, str) : infoContent(attr, str)}`;
}
const present = (xs: (string | null)[]): string[] => xs.filter((x): x is string => x !== null);

function infoArgs(info: Info, s: Settings): string[] {
  return present(INFO_FIELDS.filter((f) => !f.applies || f.applies(s)).map((f) => infoArg(f, info[f.key], f.key)));
}
/** 封面、内封只改这一页的那几项：#cover(title: …)。记号的 attr 带页名，点到跳回那一页的输入框 */
function localInfoArgs(doc: ThesisDoc, page: LocalInfoPage): string[] {
  const local = doc.localInfo?.[page];
  if (!local) return [];
  return present(localInfoFields(page, doc.settings).map((f) => infoArg(f, local[f.key], `${page}.${f.key}`)));
}

function abbrDictOf(abbrs: ThesisDoc['abbreviations']): string {
  const q = (v: string) => JSON.stringify(v.trim());
  return abbrs.length
    ? `(${abbrs.map((a) => {
        const parts = [`long: ${q(a.long)}`];
        if (a.longEn?.trim()) parts.push(`long-en: ${q(a.longEn)}`);
        if (a.short?.trim()) parts.push(`short: ${q(a.short)}`);
        if (a.plural?.trim()) parts.push(`plural: ${q(a.plural)}`);
        if (a.indexed !== undefined) parts.push(`indexed: ${a.indexed}`);
        return `${q(a.key)}: (${parts.join(', ')})`;
      }).join(', ')},)`
    : '(:)';
}

function nomenclature(doc: ThesisDoc, openright = ''): string {
  const abbrs = doc.abbreviations.filter((a) => a.key.trim());
  const symbols = doc.symbols.filter((s) => s.symbol.trim());
  const o = doc.nomenclatureOptions ?? { sort: 'auto', usedOnly: 'auto', header: 'auto', hangingIndent: '', form: 'auto' };
  if (!abbrs.length && !symbols.length) return '';
  const abbrDict = abbrDictOf(abbrs);
  // 符号：Typst 数学直接 $…$，LaTeX 走 mitex 的 #mi
  const term = (s: { symbol: string; mode?: string }) => {
    const src = s.symbol.trim();
    if (s.mode !== 'typst') { let f = '`'; while (src.includes(f)) f += '`'; return `#mi(${f}${src}${f})`; }
    return `$${src}$`;
  };
  const symbolLines = symbols.map((s) => `  / ${term(s)}: ${escapeText(s.meaning.trim())}`).join('\n');
  // 版式参数：两张表共用的
  const shared: string[] = [];
  if (o.header !== 'auto') shared.push(`header: ${o.header === 'on'}`);
  if (o.hangingIndent && Number(o.hangingIndent) > 0) shared.push(`hanging-indent: ${Number(o.hangingIndent)}cm`);
  const abbrOpts = [...shared];
  if (o.sort === 'declared') abbrOpts.push('sort: false');
  if (o.usedOnly === 'all') abbrOpts.push('used-only: false');
  const withOpts = (base: string[]) => (base.length ? ', ' + base.join(', ') : '');

  const inFinal = doc.settings.stage === 'final';
  const wantSymbols = inFinal && resolvePage(doc, 'symbolsPage').value && symbols.length > 0;
  const wantAbbrs = inFinal && resolvePage(doc, 'abbreviationsPage').value && abbrs.length > 0;
  const parts: string[] = [];
  if (wantSymbols && wantAbbrs && resolvePage(doc, 'nomenclatureMerged').value) {
    // 合并页：一页两段。与两张单页互斥，模板两个都写会报错
    const opts = [...abbrOpts];
    if (o.form !== 'auto') opts.push(`form: ${JSON.stringify(o.form)}`);
    if (openright) opts.push(openright);
    return `#nomenclature(\n  abbreviations: ${abbrDict}${withOpts(opts)},\n)[\n${symbolLines}\n]`;
  }
  if (wantSymbols) parts.push(`#list-of-symbols(${[...shared, ...(openright ? [openright] : [])].join(', ')})[\n${symbolLines}\n]`);
  if (wantAbbrs) parts.push(`#list-of-abbreviations(${abbrDict}${withOpts([...abbrOpts, ...(openright ? [openright] : [])])})`);
  // 不印缩略语表（关了、或报告档里模板本来就跳过）：只声明条目，正文里的缩写照常首次展开
  else if (abbrs.length) parts.push(`#list-of-abbreviations(${abbrDict}, form: none, shown: true)`);
  return parts.join('\n\n');
}

function defense(doc: ThesisDoc, knownLabels: Set<string>, openright = ''): string {
  if (!resolvePage(doc, 'defense').value) return '';
  const d = doc.defense;
  const person = (p: { name: string; title: string; affiliation: string; discipline: string }) =>
    `(name: ${content(p.name)}, title: ${content(p.title)}, affiliation: ${content(p.affiliation)}, discipline: ${content(p.discipline)})`;
  const list = (ps: typeof d.reviewers) => {
    const kept = ps.filter((p) => p.name.trim() || p.title.trim() || p.affiliation.trim());
    return kept.length ? `(\n    ${kept.map(person).join(',\n    ')},\n  )` : '()';
  };
  const resolution = serializeDoc(d.resolution, { headings: false, knownLabels });
  return `#defense(
${openright ? `  ${openright},\n` : ''}  reviewers: ${list(d.reviewers)},
  chair: ${list(d.chair)},
  members: ${list(d.members)},
  secretary: ${list(d.secretary)},
  resolution: [
${indent(resolution, 4)}
  ],
)`;
}

const indent = (s: string, n: number) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

/** 预览用的隐形段落标记：空回车段每段一个 ¶，只在站内预览编译（sys.inputs.preview）时真的排字 */
const PREVIEW_PRELUDE = `// 站内预览用：空回车段上各放一个隐形的 ¶，预览里点空行才有落点。只在 sys.inputs.preview 下排字，
// 正式排版（PDF）里这一句退化成 #enter(n)，与模板原样一致
// 预览里每个空段是一个与 enter(1) 同高的块、¶ 放在块里，跨页时随块折到下一页
#let blanks(indent: true, ..marks) = {
  if "preview" in sys.inputs {
    context {
      let h = measure(enter(1)).height
      let ind = par.first-line-indent
      let dx = if not indent { 0pt } else if type(ind) == dictionary { ind.amount } else { ind }
      for m in marks.pos() { block(height: h, above: 0pt, below: 0pt, place(dx: dx, text(fill: rgb(0, 0, 0, 0), m))) }
    }
  } else {
    enter(marks.pos().len())
  }
}
#let blank-item(m) = if "preview" in sys.inputs { text(fill: rgb(0, 0, 0, 0), m) }`;

/** 只编正文的一章（长文档打字时用）：chapter 是一级标题的序号（1 起），page 是这一章首页在上次整编里的页码（正文计数） */
export interface Focus { chapter: number; page?: number }

const PARA_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'fontFamily', 'fontSize', 'textColor']);
/** 打字即时回显只认纯文字段：正文里的普通段落，里面只有文字与字符级格式（引用、脚注、公式、缩略语都不行——编号在片段里取不到） */
export function paraEligible(node: PMNode | undefined | null): boolean {
  if (!node || node.type !== 'paragraph') return false;
  return (node.content ?? []).every((c) => c.type === 'text' && (c.marks ?? []).every((m) => PARA_MARKS.has(m.type)));
}

/** 只编正文里的一段：模板前言 + 这一章的版面改写 + 这一段，纸就是模板的纸，段从版心顶上排起。
 *  live 给的是编辑器里此刻的那一段（工程 JSON 要停 100 ms 才回灌，等不起）与它在文档里的位置 */
export function serializePara(doc: ThesisDoc, index: number, live?: { node: PMNode; pos: number }): Project {
  const s = doc.settings;
  const parts: string[] = [];
  const nodes = doc.body.content ?? [];
  const chapter = chapterRanges(doc.body).findIndex((r) => index >= r.from && index < r.to) + 1;
  parts.push(`#import "@local/iota-hit:${IOTA_HIT_VERSION}": *`);
  parts.push(PREVIEW_PRELUDE);
  parts.push(iotaHitShow(doc));
  if (stockPrelude(s)) parts.push(stockPrelude(s));
  if (s.hyphenate === true) parts.push('#set text(hyphenate: true)');
  else if (s.hyphenate === false) parts.push('#set text(hyphenate: false)');
  const mm = [layoutArg(s.layout?.mainmatter)].filter(Boolean);
  parts.push(mm.length ? `#show: mainmatter.with(${mm.join(', ')})` : '#show: mainmatter');
  const one: RichDoc = { type: 'doc', content: [live ? live.node as any : nodes[index]] };
  const posOf = live ? indexPositions(one as any, live.pos) : indexPositions(doc.body as any);
  parts.push(chapterWrap(chapter ? s.layout?.chapters?.[String(chapter)] : undefined, chapter ? s.localStyles?.chapters?.[String(chapter)] : undefined,
    serializeDoc(one as any, { headings: false, headingBase: 1, knownLabels: new Set(), refText: new Map(), preview: true, map: { key: 'body', posOf } })));
  const { text: main, segments } = stripMarks(parts.join('\n\n') + '\n');
  return { main, files: {}, images: [], segments };
}

/** 正文按一级标题切成章：每章的节点下标区间 [from, to) */
export function chapterRanges(body: RichDoc): { from: number; to: number }[] {
  const nodes = body.content ?? [];
  const starts: number[] = [];
  nodes.forEach((n, i) => { if (n.type === 'heading' && (n.attrs?.level ?? 1) === 1) starts.push(i); });
  if (!starts.length) return nodes.length ? [{ from: 0, to: nodes.length }] : [];
  return starts.map((a, k) => ({ from: k === 0 ? 0 : a, to: starts[k + 1] ?? nodes.length }));
}

/** `#show: iota-hit.with(…)` 那一句：设定与元信息。导出 Word 问模板要样式表的那份小文档也用它 */
export function iotaHitShow(doc: ThesisDoc, plain = false): string {
  const line = `#show: iota-hit.with(\n  ${[...settingsArgs(doc.settings), ...infoArgs(doc.info, doc.settings)].join(',\n  ')},\n)`;
  return plain ? stripMarks(line).text : line;
}

export function serializeProject(doc: ThesisDoc, { preview = false, focus }: { preview?: boolean; focus?: Focus } = {}): Project {
  if (focus) return serializeFocus(doc, focus);
  const s = doc.settings;
  const files: Record<string, string> = {};
  const parts: string[] = [];
  // 正文与附录里所有能被引用的标签（取消编号的公式不在内）
  const knownLabels = new Set<string>([...collectRefTargets(doc.body), ...collectRefTargets(doc.appendix)].map((r) => r.label));

  parts.push(`#import "@local/iota-hit:${IOTA_HIT_VERSION}": *\n// LaTeX 公式走 mitex 转成 Typst（包已随站内打包）\n#import "@preview/mitex:0.2.7": mitex, mi`);
  if (preview) parts.push(PREVIEW_PRELUDE);
  parts.push(iotaHitShow(doc));
  if (preview && stockPrelude(s)) parts.push(stockPrelude(s));
  if (preview && msword(s)) parts.push(MSWORD_CELL);
  // 西文断字：模板在 show 规则里 set text(hyphenate: false)，之后再 set 一句就压回来（模板自己这么说明的）
  if (s.hyphenate === true) parts.push('// 西文断字：模板默认关，这里打开\n#set text(hyphenate: true)');
  else if (s.hyphenate === false) parts.push('#set text(hyphenate: false)');

  // ── 前置 ──
  const or = (k: OpenrightKey): string => { const v = doc.openright?.[k]; return v === true || v === false ? `openright: ${v}` : ''; };
  const orLead = (k: OpenrightKey): string => (or(k) ? `${or(k)}, ` : '');
  const withArgs = (fn: string, ...xs: string[]) => { const a = xs.filter(Boolean); return a.length ? `#show: ${fn}.with(${a.join(', ')})` : `#show: ${fn}`; };
  const pageLayout = (k: string) => layoutArg(s.layout?.pages?.[k]);
  parts.push(withArgs('frontmatter', or('frontmatter'), layoutArg(s.layout?.frontmatter)));
  // 封面、内封、目录与清单这几页预览里退回原版断行（layout: (linebreaks: none)）：封面内封的空行、字段表按模板自己的网格模拟
  // 量高落位，在 msword 段落里量会漂；清单条目的悬挂宽是模板 measure 编号量出来的，同一个坑（章名左缘 133.05 → 135.73 → 140.64）。
  // 这几页条目短、不折行，用模板自己的网格模拟与原版一字不差
  const stockLayout = (k: string) => layoutArg(preview && msword(s) ? { ...(s.layout?.pages?.[k] ?? {}), linebreaks: 'none' } : s.layout?.pages?.[k]);
  const covers = (['cover', 'titlepage'] as const).filter((k) => resolvePage(doc, k).value);
  for (const k of covers) {
    const xiaoer = k === 'cover' ? s.titleEnXiaoer : s.titleEnXiaoerTitlepage;
    parts.push(`#${k}(${[xiaoer !== 'auto' ? `title-en-xiaoer: ${tri(xiaoer)}` : '', ...localInfoArgs(doc, k), stockLayout(k)].filter(Boolean).join(', ')})`);
  }

  const rich = (key: RichKey, opts: { headings: boolean; headingBase?: number }) => serializeDoc(doc[key], { ...opts, knownLabels, preview, map: { key, posOf: indexPositions(doc[key] as any) } });
  const abstractZh = rich('abstractZh', { headings: false });
  const abstractEn = rich('abstractEn', { headings: false });
  if (resolvePage(doc, 'abstract').value && (abstractZh.trim() || abstractEn.trim())) {
    // 关键词上方：模板 keywords-above——none 不空、v(1fr) 挤到页底、auto 空一行（默认，不写）
    const ka = s.abstractKeywordsAbove === 'none' ? ', keywords-above: none' : s.abstractKeywordsAbove === 'bottom' ? ', keywords-above: v(1fr)' : '';
    parts.push(`#abstract(en: [\n${indent(abstractEn, 2)}\n]${ka}${or('abstract') ? `, ${or('abstract')}` : ''}${pageLayout('abstract') ? `, ${pageLayout('abstract')}` : ''}${localStylesArg(s.localStyles?.pages?.abstract) ? `, ${localStylesArg(s.localStyles?.pages?.abstract)}` : ''})[\n${indent(abstractZh, 2)}\n]`);
  }

  const nomen = nomenclature(doc, or('nomenclature'));
  if (nomen) parts.push(nomen);

  // 目录出哪几份：模板 lang: auto 按学位（博士两份）；lang 只收一种语言，要两份就各出一次（模板按语言计次，不算重复）
  if (resolvePage(doc, 'tableOfContents').value) {
    const langs = s.tocLang === 'auto' ? [''] : s.tocLang === 'both' ? ['lang: "zh"', 'lang: "en"'] : [`lang: "${s.tocLang}"`];
    for (const l of langs) parts.push(`#table-of-contents(${[or('tableOfContents'), l, stockLayout('toc')].filter(Boolean).join(', ')})`);
  }
  if (resolvePage(doc, 'listOfFigures').value) parts.push(`#list-of-figures(${[or('listOfFigures'), stockLayout('listOfFigures')].filter(Boolean).join(', ')})`);
  if (resolvePage(doc, 'listOfTables').value) parts.push(`#list-of-tables(${[or('listOfTables'), stockLayout('listOfTables')].filter(Boolean).join(', ')})`);
  if (resolvePage(doc, 'listOfEquations').value) parts.push(`#list-of-equations(${[or('listOfEquations'), stockLayout('listOfEquations')].filter(Boolean).join(', ')})`);

  // ── 主体 ──
  parts.push(withArgs('mainmatter', or('mainmatter'), layoutArg(s.layout?.mainmatter)));
  const body = bodyByChapters(doc, s, (r) => serializeDoc({ type: 'doc', content: (doc.body.content ?? []).slice(r.from, r.to) } as any, { headings: true, headingBase: 1, knownLabels, preview, map: { key: 'body', posOf: indexPositions(doc.body as any) } }));
  parts.push(body || '= 绪论');

  const conclusion = rich('conclusion', { headings: false });
  if (conclusion.trim()) parts.push(`#conclusion${or('conclusion') ? `(${or('conclusion')})` : ''}[\n${indent(conclusion, 2)}\n]`);

  // ── 后置 ──
  const refs = generateBibtex(doc.references ?? []);
  if (refs.trim()) {
    files['refs.bib'] = refs;
    parts.push('#bibliography(read("refs.bib"), full: true)');
  }

  const appendix = rich('appendix', { headings: true, headingBase: 1 });
  if (resolvePage(doc, 'appendix').value && appendix.trim()) {
    parts.push(`#appendix[\n${indent(appendix, 2)}\n]`);
  }
  if (layoutArg(s.layout?.backmatter)) parts.push(`#show: backmatter.with(${layoutArg(s.layout?.backmatter)})`);

  const ach = generateBibtex(doc.achievementEntries ?? []);
  if (resolvePage(doc, 'achievements').value && ach.trim()) {
    files['achievements.bib'] = ach;
    parts.push(`#achievements(${orLead('achievements')}${pageLayout('achievements') ? `${pageLayout('achievements')}, ` : ''}read("achievements.bib"))`);
    }

  const def = defense(doc, knownLabels, or('defense'));
  if (def) parts.push(def);

  if (resolvePage(doc, 'declarations').value) {
    parts.push(`#declarations(${[or('declarations'), pageLayout('declarations')].filter(Boolean).join(', ')})`);
    }
  if (resolvePage(doc, 'index').value) parts.push(`#index(${[or('index'), pageLayout('index')].filter(Boolean).join(', ')})`);

  const ack = rich('acknowledgement', { headings: false });
  if (ack.trim()) parts.push(`#acknowledgement${or('acknowledgement') ? `(${or('acknowledgement')})` : ''}[\n${indent(ack, 2)}\n]`);

  const resume = rich('resume', { headings: false });
  if (resolvePage(doc, 'resume').value && resume.trim()) parts.push(`#resume${or('resume') ? `(${or('resume')})` : ''}[\n${indent(resume, 2)}\n]`);

  const images = new Set<string>();
  for (const d of [doc.body, doc.appendix, doc.conclusion, doc.abstractZh, doc.abstractEn, doc.acknowledgement, doc.resume]) {
    for (const i of collectImages(d)) images.add(i);
  }

  const { text: main, segments } = stripMarks(parts.join('\n\n') + '\n');
  return { main, files, images: [...images], segments };
}

/** 正文按章序列化；工程 JSON 里给了某章的版面就交给模板的 new-layout / restore-layout（网格、页边距、页眉页脚都收；
 *  #chapter(layout:) 那一档模板说要删，不用它） */
function bodyByChapters(doc: ThesisDoc, s: Settings, ser: (r: { from: number; to: number }) => string): string {
  const chapters = s.layout?.chapters ?? {};
  const styles = s.localStyles?.chapters ?? {};
  const ranges = chapterRanges(doc.body);
  if (!ranges.length || (!Object.keys(chapters).length && !Object.keys(styles).length)) return ser({ from: 0, to: (doc.body.content ?? []).length });
  return ranges.map((r, k) => chapterWrap(chapters[String(k + 1)], styles[String(k + 1)], ser(r))).join('\n\n');
}
/** 只编一章时尾巴（文献表）那几页的纸宽，渲染端靠它认出来 */
export const FOCUS_TAIL_WIDTH = 500;
export function chapterWrap(d: LayoutDict | undefined, st: LayoutDict | undefined, body: string): string {
  if (st && Object.keys(st).length) body = `#show: new-styles.with(${typstDict(st)})\n${body}\n#show: restore-styles`;
  return d && Object.keys(d).length ? `#show: new-layout.with(${typstDict(d)})\n${body}\n#show: restore-layout` : body;
}

/**
 * 只编当前一章：前置页一律不排，章号与页码用 counter 钉在上次整编的位置上，章外的引用印成字面，
 * 文献只带这一章引到的那些。预览专用（断行规则同整编），导出的 .typ 不走这里。
 */
function serializeFocus(doc: ThesisDoc, focus: Focus): Project {
  const s = doc.settings;
  const files: Record<string, string> = {};
  const parts: string[] = [];
  const ranges = chapterRanges(doc.body);
  const r = ranges[focus.chapter - 1] ?? { from: 0, to: (doc.body.content ?? []).length };
  const nodes = (doc.body.content ?? []).slice(r.from, r.to);
  const chapterDoc: RichDoc = { type: 'doc', content: nodes };
  const knownLabels = new Set<string>(collectRefTargets(chapterDoc).map((x) => x.label));
  const refText = new Map<string, string>();
  for (const [label, info] of computeNumbering(doc.body as any, s, 'body')) if (!knownLabels.has(label)) refText.set(label, info.ref);
  for (const [label, info] of computeNumbering(doc.appendix as any, s, 'appendix')) if (!knownLabels.has(label)) refText.set(label, info.ref);

  parts.push(`#import "@local/iota-hit:${IOTA_HIT_VERSION}": *\n#import "@preview/mitex:0.2.7": mitex, mi`);
  parts.push(PREVIEW_PRELUDE);
  parts.push(iotaHitShow(doc));
  if (stockPrelude(s)) parts.push(stockPrelude(s));
  if (msword(s)) parts.push(MSWORD_CELL);
  if (s.hyphenate === true) parts.push('#set text(hyphenate: true)');
  else if (s.hyphenate === false) parts.push('#set text(hyphenate: false)');
  const or = (k: OpenrightKey): string => { const v = doc.openright?.[k]; return v === true || v === false ? `openright: ${v}` : ''; };
  // 缩略语的定义在前置页那一函数里；不印页，只登记
  const abbrs = doc.abbreviations.filter((a) => a.key.trim());
  if (abbrs.length) parts.push(`#list-of-abbreviations(${abbrDictOf(abbrs)}, form: none, shown: true)`);
  const mm = [or('mainmatter'), layoutArg(s.layout?.mainmatter)].filter(Boolean);
  parts.push(mm.length ? `#show: mainmatter.with(${mm.join(', ')})` : '#show: mainmatter');
  // 章号从上一章数起；首页页码钉在上次整编的位置
  parts.push(`#counter(heading).update(${Math.max(0, focus.chapter - 1)})${focus.page && focus.page > 1 ? `\n#counter(page).update(${focus.page})` : ''}`);
  const body = chapterWrap(s.layout?.chapters?.[String(focus.chapter)], s.localStyles?.chapters?.[String(focus.chapter)], serializeDoc(chapterDoc as any, { headings: true, headingBase: 1, knownLabels, refText, preview: true, map: { key: 'body', posOf: indexPositions(doc.body as any) } }));
  parts.push(body || '= 绪论');
  const cited = collectCiteKeys(chapterDoc as any);
  const refs = generateBibtex((doc.references ?? []).filter((e) => cited.has(e.key.trim())));
  // 旁文件也另起名字（worker 给只编一章的文件加 focus- 前缀）
  // 条目表得在（引文要能解析），但那几页不是这一章的：纸张改成一个认得出的宽度，渲染端按宽度剔掉
  if (refs.trim()) { files['refs.bib'] = refs; parts.push(`#set page(width: ${FOCUS_TAIL_WIDTH}pt)\n#bibliography(read("focus-refs.bib"), full: true)`); }
  const { text: main, segments } = stripMarks(parts.join('\n\n') + '\n');
  return { main, files, images: [...collectImages(chapterDoc as any)], segments };
}

