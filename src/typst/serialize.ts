// 整份工程 → main.typ（以及要一起交给编译器的旁文件）。
// 结构照 iota-hit/template/example.typ：前置 → 主体 → 附录 → 后置。
import type { ThesisDoc, Settings, Info } from '../model/types';
import { INFO_FIELDS } from '../model/info';
import { serializeDoc, escapeText, collectImages } from './pmToTypst';
import { generateBibtex } from '../bib/bibtex';

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
}

const content = (s: string) => `[${escapeText(s.trim())}]`;
/** 多行题目：手写换行变成 \ */
const multiline = (s: string) => `[${s.trim().split(/\r?\n/).map((l) => escapeText(l.trim())).filter(Boolean).join(' \\ ')}]`;

function tri(v: 'auto' | boolean | string): string {
  if (v === 'auto') return 'auto';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return JSON.stringify(v);
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
  if (s.appendixNumbering !== 'auto') {
    const pattern = { letters: 'A', numbers: '1', hanzi: '一' }[s.appendixNumbering];
    args.push(`appendix-numbering: ${JSON.stringify(pattern)}`);
  }
  return args;
}

function infoArgs(info: Info, s: Settings): string[] {
  const args: string[] = [];
  for (const f of INFO_FIELDS) {
    if (f.applies && !f.applies(s)) continue;
    const v = info[f.key];
    if (f.kind === 'keywords') {
      const list = (v as string[]).map((k) => k.trim()).filter(Boolean);
      if (list.length) args.push(`${f.param}: (${list.map(content).join(', ')},)`);
      continue;
    }
    const str = String(v ?? '').trim();
    if (!str) continue;
    if (f.kind === 'month') {
      // 模板收 "YYYY-MM" 字符串，自己按语言排成「2026 年 6 月」/「June, 2026」
      if (/^\d{4}-\d{2}$/.test(str)) args.push(`${f.param}: ${JSON.stringify(str)}`);
      else args.push(`${f.param}: ${content(str)}`);
      continue;
    }
    args.push(`${f.param}: ${f.kind === 'textarea' ? multiline(str) : content(str)}`);
  }
  return args;
}

function nomenclature(doc: ThesisDoc): string {
  const abbrs = doc.abbreviations.filter((a) => a.key.trim());
  const symbols = doc.symbols.filter((s) => s.symbol.trim());
  if (!abbrs.length && !symbols.length) return '';
  const abbrDict = abbrs.length
    ? `(${abbrs.map((a) => `${JSON.stringify(a.key.trim())}: (long: ${JSON.stringify(a.long.trim())}${a.longEn.trim() ? `, long-en: ${JSON.stringify(a.longEn.trim())}` : ''})`).join(', ')},)`
    : '(:)';
  // 报告档里这一页被模板跳过、或用户关了这一页：只声明条目不印表（form: none），
  // 正文里的缩写照常首次展开
  if (!doc.pages.nomenclature || doc.settings.stage !== 'final') {
    return abbrs.length ? `#list-of-abbreviations(${abbrDict}, form: none, shown: true)` : '';
  }
  // 符号：Typst 数学直接 $…$，LaTeX 走 mitex 的 #mi
  const term = (s: { symbol: string; mode?: string }) => {
    const src = s.symbol.trim();
    if (s.mode === 'latex') { let f = '`'; while (src.includes(f)) f += '`'; return `#mi(${f}${src}${f})`; }
    return `$${src}$`;
  };
  const symbolLines = symbols.map((s) => `  / ${term(s)}: ${escapeText(s.meaning.trim())}`).join('\n');
  if (!symbols.length) return `#list-of-abbreviations(${abbrDict})`;
  if (!abbrs.length) return `#list-of-symbols[\n${symbolLines}\n]`;
  // 合并页与两张单页互斥：模板两个都写会报错
  if (doc.pages.nomenclatureMerged !== false) return `#nomenclature(\n  abbreviations: ${abbrDict},\n)[\n${symbolLines}\n]`;
  return `#list-of-symbols[\n${symbolLines}\n]\n\n#list-of-abbreviations(${abbrDict})`;
}

function defense(doc: ThesisDoc): string {
  if (!doc.pages.defense) return '';
  const d = doc.defense;
  const person = (p: { name: string; title: string; affiliation: string; discipline: string }) =>
    `(name: ${content(p.name)}, title: ${content(p.title)}, affiliation: ${content(p.affiliation)}, discipline: ${content(p.discipline)})`;
  const list = (ps: typeof d.reviewers) => {
    const kept = ps.filter((p) => p.name.trim() || p.title.trim() || p.affiliation.trim());
    return kept.length ? `(\n    ${kept.map(person).join(',\n    ')},\n  )` : '()';
  };
  const resolution = serializeDoc(d.resolution, { headings: false });
  return `#defense(
  reviewers: ${list(d.reviewers)},
  chair: ${person(d.chair)},
  members: ${list(d.members)},
  secretary: ${person(d.secretary)},
  resolution: [
${indent(resolution, 4)}
  ],
)`;
}

const indent = (s: string, n: number) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

export function serializeProject(doc: ThesisDoc): Project {
  const s = doc.settings;
  const files: Record<string, string> = {};
  const parts: string[] = [];

  parts.push(`#import "@local/iota-hit:${IOTA_HIT_VERSION}": *\n// LaTeX 公式走 mitex 转成 Typst（包已随站内打包）\n#import "@preview/mitex:0.2.7": mitex, mi`);
  parts.push(`#show: iota-hit.with(\n  ${[...settingsArgs(s), ...infoArgs(doc.info, s)].join(',\n  ')},\n)`);

  // ── 前置 ──
  parts.push('#show: frontmatter');
  const coverArgs = s.titleEnXiaoer !== 'auto' ? `title-en-xiaoer: ${tri(s.titleEnXiaoer)}` : '';
  parts.push(`#cover(${coverArgs})`);
  parts.push(`#titlepage(${coverArgs})`);

  const abstractZh = serializeDoc(doc.abstractZh, { headings: false });
  const abstractEn = serializeDoc(doc.abstractEn, { headings: false });
  if (abstractZh.trim() || abstractEn.trim()) {
    parts.push(`#abstract(en: [\n${indent(abstractEn, 2)}\n])[\n${indent(abstractZh, 2)}\n]`);
  }

  const nomen = nomenclature(doc);
  if (nomen) parts.push(nomen);

  parts.push('#table-of-contents()');
  if (doc.pages.listOfFigures) parts.push('#list-of-figures()');
  if (doc.pages.listOfTables) parts.push('#list-of-tables()');
  if (doc.pages.listOfEquations) parts.push('#list-of-equations()');

  // ── 主体 ──
  parts.push('#show: mainmatter');
  const body = serializeDoc(doc.body, { headings: true, headingBase: 1 });
  parts.push(body || '= 绪论');

  const conclusion = serializeDoc(doc.conclusion, { headings: false });
  if (conclusion.trim()) parts.push(`#conclusion[\n${indent(conclusion, 2)}\n]`);

  // ── 后置 ──
  const refs = generateBibtex(doc.references ?? []);
  if (refs.trim()) {
    files['refs.bib'] = refs;
    parts.push('#bibliography(read("refs.bib"), full: true)');
  }

  const appendix = serializeDoc(doc.appendix, { headings: true, headingBase: 1 });
  if (doc.pages.appendix && appendix.trim()) {
    parts.push(`#appendix[\n${indent(appendix, 2)}\n]`);
  }

  const ach = generateBibtex(doc.achievementEntries ?? []);
  if (doc.pages.achievements && ach.trim()) {
    files['achievements.bib'] = ach;
    parts.push('#achievements(read("achievements.bib"))');
  }

  const def = defense(doc);
  if (def) parts.push(def);

  if (doc.pages.declarations) parts.push('#declarations()');
  if (doc.pages.index) parts.push('#index()');

  const ack = serializeDoc(doc.acknowledgement, { headings: false });
  if (ack.trim()) parts.push(`#acknowledgement[\n${indent(ack, 2)}\n]`);

  const resume = serializeDoc(doc.resume, { headings: false });
  if (doc.pages.resume && resume.trim()) parts.push(`#resume[\n${indent(resume, 2)}\n]`);

  const images = new Set<string>();
  for (const d of [doc.body, doc.appendix, doc.conclusion, doc.abstractZh, doc.abstractEn, doc.acknowledgement, doc.resume]) {
    for (const i of collectImages(d)) images.add(i);
  }

  return { main: parts.join('\n\n') + '\n', files, images: [...images] };
}
