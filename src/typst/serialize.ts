// 整份工程 → main.typ（以及要一起交给编译器的旁文件）。
// 结构照 iota-hit/template/example.typ：前置 → 主体 → 附录 → 后置。
import type { ThesisDoc, Settings, Info, StyleEntry, OpenrightKey } from '../model/types';
import { INFO_FIELDS } from '../model/info';
import { serializeDoc, escapeText, collectImages, collectRefTargets, indexPositions } from './pmToTypst';
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

/** 字符网格：预览里模板自己的字距网格关掉（引擎来排）；导出时用户改过的折成模板的 char-pitch */
const msword = (s: Settings) => (s.linebreaker === 'auto' ? 'msword' : s.linebreaker) === 'msword';
/** 预览引擎独有（Typst fork 的 par(linebreaks: "msword")），不进导出的 .typ。
 *  网格按部件动态取：模板把版面记在 state "iota-hit-layout" 里（每个部件各更新一次），
 *  读出字距增量 tracking（= 跨度 − 字号），把模板自己发的 text(tracking:) 清零，
 *  换成引擎的 char-pitch: 1em + tracking。这段规则在 iota-hit 与每个部件的 show 之后各发一次 */
function mswordRule(s: Settings, page?: string): string {
  if (!msword(s)) return '';
  // 紧缩与右缩进照中文 Word 的默认
  const compat = s.wordCompat === 'auto' ? '11' : s.wordCompat;
  // 有自己一格字符网格的页（成果页、研究生声明页）：按模板给页函数算版面的那条路取，与页里排的一致
  const tr = page ? `_layout.layout-for(${JSON.stringify(page)}, auto).docgrid.tracking` : 'if l == none { 0pt } else { l.docgrid.tracking }';
  return `#show: it => context {
  let l = state("iota-hit-layout", none).get()
  let tr = ${tr}
  set text(tracking: 0pt)
  set par(linebreaks: (mode: "msword", compat: ${compat}, char-pitch: if tr == 0pt { auto } else { 1em + tr }, kern: true, adjust-right-indent: true))
  it
}`;
}
function mswordPrelude(s: Settings): string {
  return msword(s) ? mswordRule(s) : `#set par(linebreaks: ${JSON.stringify(s.linebreaker)})`;
}

function settingsArgs(s: Settings): string[] {
  const args: string[] = [];
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
  args.push(FONTSET_ARG[s.fontset ?? 'webapp']);
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
    ['titleSpread', 'title-spread'],
    ['fakeBold', 'fake-bold'],
    ['fakeItalic', 'fake-italic'],
  ];
  for (const [key, param] of bools) {
    const v = s[key];
    if (v !== 'auto') args.push(`${param}: ${tri(v as boolean)}`);
  }
  if (s.emDash !== 'auto') args.push(`em-dash: ${JSON.stringify(s.emDash)}`);
  const styles = stylesArg(s.styles ?? {});
  if (styles) args.push(styles);
  if (s.appendixNumbering !== 'auto') {
    const pattern = { letters: 'A', numbers: '1', hanzi: '一' }[s.appendixNumbering];
    args.push(`appendix-numbering: ${JSON.stringify(pattern)}`);
  }
  return args;
}

/** 样式表覆盖 → iota-hit(styles: (chapter: (align: left, …), …))；空项不发 */
export function styleEntryArgs(e: StyleEntry): string[] {
  const out: string[] = [];
  if (e.fontZh) out.push(`font-zh: ${JSON.stringify(e.fontZh)}`);
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

function infoArgs(info: Info, s: Settings): string[] {
  const args: string[] = [];
  for (const f of INFO_FIELDS) {
    if (f.applies && !f.applies(s)) continue;
    const v = info[f.key];
    if (f.kind === 'keywords') {
      const list = (v as string[]).map((k) => k.trim()).filter(Boolean);
      if (list.length) args.push(`${f.param}: (${list.map((k, i) => `[${mark('info', 'info', i, i + 1, escapeText(k), { attr: f.key, raw: k })}]`).join(', ')},)`);
      continue;
    }
    const str = String(v ?? '').trim();
    if (!str) continue;
    if (f.kind === 'month') {
      // 模板收 "YYYY-MM" 字符串，自己按语言排成「2026 年 6 月」/「June, 2026」
      if (/^\d{4}-\d{2}$/.test(str)) args.push(`${f.param}: "${mark('info', 'info', 0, str.length, str, { attr: f.key, raw: str })}"`);
      else args.push(`${f.param}: ${infoContent(f.key, str)}`);
      continue;
    }
    args.push(`${f.param}: ${f.kind === 'textarea' ? infoMultiline(f.key, str) : infoContent(f.key, str)}`);
  }
  return args;
}

function nomenclature(doc: ThesisDoc, openright = ''): string {
  const abbrs = doc.abbreviations.filter((a) => a.key.trim());
  const symbols = doc.symbols.filter((s) => s.symbol.trim());
  const o = doc.nomenclatureOptions ?? { sort: 'auto', usedOnly: 'auto', header: 'auto', hangingIndent: '', form: 'auto' };
  if (!abbrs.length && !symbols.length) return '';
  const q = (v: string) => JSON.stringify(v.trim());
  const abbrDict = abbrs.length
    ? `(${abbrs.map((a) => {
        const parts = [`long: ${q(a.long)}`];
        if (a.longEn?.trim()) parts.push(`long-en: ${q(a.longEn)}`);
        if (a.short?.trim()) parts.push(`short: ${q(a.short)}`);
        if (a.plural?.trim()) parts.push(`plural: ${q(a.plural)}`);
        if (a.indexed !== undefined) parts.push(`indexed: ${a.indexed}`);
        return `${q(a.key)}: (${parts.join(', ')})`;
      }).join(', ')},)`
    : '(:)';
  // 符号：Typst 数学直接 $…$，LaTeX 走 mitex 的 #mi
  const term = (s: { symbol: string; mode?: string }) => {
    const src = s.symbol.trim();
    if (s.mode === 'latex') { let f = '`'; while (src.includes(f)) f += '`'; return `#mi(${f}${src}${f})`; }
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
  chair: ${person(d.chair)},
  members: ${list(d.members)},
  secretary: ${person(d.secretary)},
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

export function serializeProject(doc: ThesisDoc, { preview = false }: { preview?: boolean } = {}): Project {
  const s = doc.settings;
  const files: Record<string, string> = {};
  const parts: string[] = [];
  // 正文与附录里所有能被引用的标签（取消编号的公式不在内）
  const knownLabels = new Set<string>([...collectRefTargets(doc.body), ...collectRefTargets(doc.appendix)].map((r) => r.label));

  parts.push(`#import "@local/iota-hit:${IOTA_HIT_VERSION}": *\n// LaTeX 公式走 mitex 转成 Typst（包已随站内打包）\n#import "@preview/mitex:0.2.7": mitex, mi`);
  if (preview) parts.push(PREVIEW_PRELUDE);
  parts.push(`#show: iota-hit.with(\n  ${[...settingsArgs(s), ...infoArgs(doc.info, s)].join(',\n  ')},\n)`);
  if (preview) parts.push(mswordPrelude(s));
  // 西文断字：模板在 show 规则里 set text(hyphenate: false)，之后再 set 一句就压回来（模板自己这么说明的）
  if (s.hyphenate === true) parts.push('// 西文断字：模板默认关，这里打开\n#set text(hyphenate: true)');
  else if (s.hyphenate === false) parts.push('#set text(hyphenate: false)');

  // ── 前置 ──
  const or = (k: OpenrightKey): string => { const v = doc.openright?.[k]; return v === true || v === false ? `openright: ${v}` : ''; };
  const orArgs = (k: OpenrightKey): string => (or(k) ? `(${or(k)})` : '()');
  const orLead = (k: OpenrightKey): string => (or(k) ? `${or(k)}, ` : '');
  parts.push(or('frontmatter') ? `#show: frontmatter.with(${or('frontmatter')})` : '#show: frontmatter');
  if (preview && msword(s)) parts.push(mswordRule(s));
  const coverArgs = s.titleEnXiaoer !== 'auto' ? `title-en-xiaoer: ${tri(s.titleEnXiaoer)}` : '';
  if (resolvePage(doc, 'cover').value) parts.push(`#cover(${coverArgs})`);
  if (resolvePage(doc, 'titlepage').value) parts.push(`#titlepage(${coverArgs})`);

  const rich = (key: RichKey, opts: { headings: boolean; headingBase?: number }) => serializeDoc(doc[key], { ...opts, knownLabels, preview, map: { key, posOf: indexPositions(doc[key] as any) } });
  const abstractZh = rich('abstractZh', { headings: false });
  const abstractEn = rich('abstractEn', { headings: false });
  if (resolvePage(doc, 'abstract').value && (abstractZh.trim() || abstractEn.trim())) {
    // 关键词上方：模板 keywords-above——none 不空、v(1fr) 挤到页底、auto 空一行（默认，不写）
    const ka = s.abstractKeywordsAbove === 'none' ? ', keywords-above: none' : s.abstractKeywordsAbove === 'bottom' ? ', keywords-above: v(1fr)' : '';
    parts.push(`#abstract(en: [\n${indent(abstractEn, 2)}\n]${ka}${or('abstract') ? `, ${or('abstract')}` : ''})[\n${indent(abstractZh, 2)}\n]`);
  }

  const nomen = nomenclature(doc, or('nomenclature'));
  if (nomen) parts.push(nomen);

  if (resolvePage(doc, 'tableOfContents').value) parts.push(`#table-of-contents${orArgs('tableOfContents')}`);
  if (resolvePage(doc, 'listOfFigures').value) parts.push(`#list-of-figures${orArgs('listOfFigures')}`);
  if (resolvePage(doc, 'listOfTables').value) parts.push(`#list-of-tables${orArgs('listOfTables')}`);
  if (resolvePage(doc, 'listOfEquations').value) parts.push(`#list-of-equations${orArgs('listOfEquations')}`);

  // ── 主体 ──
  parts.push(or('mainmatter') ? `#show: mainmatter.with(${or('mainmatter')})` : '#show: mainmatter');
  if (preview && msword(s)) parts.push(mswordRule(s));
  const body = rich('body', { headings: true, headingBase: 1 });
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

  const ach = generateBibtex(doc.achievementEntries ?? []);
  if (resolvePage(doc, 'achievements').value && ach.trim()) {
    files['achievements.bib'] = ach;
    if (preview && msword(s)) parts.push(mswordRule(s, 'achievements'));
    parts.push(`#achievements(${orLead('achievements')}read("achievements.bib"))`);
    if (preview && msword(s)) parts.push(mswordRule(s));
  }

  const def = defense(doc, knownLabels, or('defense'));
  if (def) parts.push(def);

  if (resolvePage(doc, 'declarations').value) {
    if (preview && msword(s)) parts.push(mswordRule(s, s.degreeLevel === 'bachelor' ? 'declarations' : 'declarations-graduate'));
    parts.push(`#declarations${orArgs('declarations')}`);
    if (preview && msword(s)) parts.push(mswordRule(s));
  }
  if (resolvePage(doc, 'index').value) parts.push(`#index${orArgs('index')}`);

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
