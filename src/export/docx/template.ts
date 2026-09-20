// 查询 iota-hit 的样式与页面参数，并映射为 Word 样式表和节属性。
import type { ThesisDoc, Settings } from '../../model/types';
import { IOTA_HIT_VERSION, iotaHitShow, layoutArg, typstDict } from '../../typst/serialize';
import { queryTypst } from '../../compiler/client';
import { wordLinebreakOptions } from '../../typst/serialize';

export type Lines = { lines: number };
export type Chars = { chars: number };
export type LineSpacing = number | 'single' | 'double' | 'auto' | { exactly?: number; 'at-least'?: number };
/** 一条样式 = 字体对话框 + 段落对话框，长度一律已折成磅（探针里 length.pt()） */
export interface Style {
  'asian-font'?: string; 'latin-font'?: string;
  size?: number; bold?: boolean; 'latin-bold'?: boolean; tracking?: number;
  'line-spacing'?: LineSpacing;
  above?: Lines | number; below?: Lines | number; gap?: number | 'auto';
  'first-line-indent'?: Chars | number; 'hanging-indent'?: Chars | number; 'left-indent'?: Chars | number;
  align?: string; 'snap-to-grid'?: boolean; justify?: boolean; 'page-break-before'?: boolean; sticky?: boolean; breakable?: boolean;
  inset?: { x?: number; y?: number; left?: number; right?: number; top?: number; bottom?: number } | number;
  stroke?: Record<string, number | null> | number;
}
export interface HeaderFooter { shown: 'auto' | boolean; 'from-edge': number; style: Style; border: { style: 'single' | 'thin-thick-small-gap'; thickness: number; 'from-text': number } | null }
/** banshi 的 page-setup 记录（页面设置对话框折好的那份） */
export interface PageSetup {
  'paper-width': number; 'paper-height': number;
  margin: { top: number; bottom: number; left: number; right: number };
  docgrid: { 'line-pitch': number; 'char-pitch': number; tracking: number; grid: boolean; 'line-unit': number };
  'font-size': number; header: HeaderFooter; footer: HeaderFooter;
  inputs: { grid?: string | null };
}
export interface Facts {
  styles: Record<string, Style> & { figure: { image: Style; table: Style; caption: Style } };
  /** 字体角色 → Windows 上的家族名（模板 presets.windows） */
  fonts: Record<string, string>;
  layout: { doc: PageSetup; front: PageSetup; main: PageSetup; back: PageSetup };
  pages: Record<string, PageSetup>;
}

const FRONT_PAGES = ['cover', 'titlepage', 'abstract', 'toc', 'nomenclature'];
const BACK_PAGES = ['achievements', 'declarations', 'declarations-graduate', 'index'];

/** 探针文档：设定照原样发给模板，各部件的版面用模板公开的 layout-of 读（用户页级的局部字典也交给它并） */
export function probeSource(doc: ThesisDoc): string {
  const s = doc.settings;
  const pages = s.layout?.pages ?? {};
  const pageOf = (k: string) => { const d = pages[k]; return `${JSON.stringify(k)}: layout-of(${JSON.stringify(k)}${d && Object.keys(d).length ? `, local: ${typstDict(d)}` : ''})`; };
  const matter = (fn: string, k: 'frontmatter' | 'mainmatter' | 'backmatter') => { const a = layoutArg(s.layout?.[k]); return a ? `#show: ${fn}.with(${a})` : `#show: ${fn}`; };
  return `#import "@local/iota-hit:${IOTA_HIT_VERSION}": *
${iotaHitShow(doc, true)}
#let plain(v) = if type(v) == length { if v.em == 0 { v.pt() } else { (abs: v.abs.pt(), em: v.em) } } else if type(v) == dictionary { v.pairs().map(((k, x)) => (k, plain(x))).to-dict() } else if type(v) == array { v.map(plain) } else { v }
#let facts = state("docx-facts", (:))
#let probe(name, v) = facts.update(d => d + ((name): plain(v)))
#context probe("doc", current-layout())
${matter('frontmatter', 'frontmatter')}
#context probe("front", (styles: state("banshi-styles").final(), fonts: presets.windows, layout: current-layout(), pages: (${FRONT_PAGES.map(pageOf).join(', ')})))
${matter('mainmatter', 'mainmatter')}
= 章
#context probe("main", current-layout())
${matter('backmatter', 'backmatter')}
#context probe("back", (layout: current-layout(), pages: (${BACK_PAGES.map(pageOf).join(', ')})))
#context [#metadata(facts.final()) <docx-facts>]
`;
}

export async function queryFacts(doc: ThesisDoc): Promise<Facts> {
  const r = await queryTypst(probeSource(doc), '<docx-facts>');
  if (r.error || !Array.isArray(r.result) || !r.result.length) throw new Error(r.error || '模板没有交回样式表');
  const f = r.result[0] as { doc: PageSetup; front: { styles: Facts['styles']; fonts: Facts['fonts']; layout: PageSetup; pages: Facts['pages'] }; main: PageSetup; back: { layout: PageSetup; pages: Facts['pages'] } };
  return { styles: f.front.styles, fonts: f.front.fonts, layout: { doc: f.doc, front: f.front.layout, main: f.main, back: f.back.layout }, pages: { ...f.front.pages, ...f.back.pages } };
}

// ── 单位 ────────────────────────────────────────────────────────────
export const tw = (pt: number) => Math.round(pt * 20);
/** 「几行」折成缇时往下截（Word 写进范例的 0.8 行 = 312.8 → 312） */
const twFloor = (pt: number) => Math.floor(pt * 20 + 1e-6);
export const isLines = (v: unknown): v is Lines => !!v && typeof v === 'object' && 'lines' in (v as object);
export const isChars = (v: unknown): v is Chars => !!v && typeof v === 'object' && 'chars' in (v as object);
/** 将段前/段后行数换算为缇；启用网格时使用行跨度，否则使用字号。 */
export const gapTwips = (v: Lines | number | undefined, P: PageSetup): number => (v === undefined ? 0 : isLines(v) ? twFloor(v.lines * P.docgrid['line-unit']) : tw(v));
export const asianOf = (st: Style) => st['asian-font'];
export const latinOf = (st: Style) => st['latin-font'];
/** 页眉 / 页脚显不显示：auto 按模板的规矩——论文显示，报告不显示（src/layout/matter.typ 的 header-footer） */
export const shown = (hf: HeaderFooter, s: Settings) => (hf.shown === 'auto' ? s.stage === 'final' : hf.shown);
/** 目录条目行距写 auto 的按学科与学位（模板 src/styles/presets.typ 的 toc-line-spacing-auto，那一支模板没公开） */
export const tocLineSpacing = (s: Settings): LineSpacing => (s.category === 'hass' ? { exactly: 23 } : s.degreeLevel === 'bachelor' ? 1.25 : 1.2);

// ── 样式字典 → styles.xml ─────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export function rPr(st: Style, F: Facts, zh: boolean, o: { kern?: number } = {}): string {
  const asian = asianOf(st) ? F.fonts[asianOf(st)!] : undefined;
  const latin = latinOf(st) ? F.fonts[latinOf(st)!] : undefined;
  const fonts = asian || latin || zh
    ? `<w:rFonts${latin ? ` w:ascii="${esc(latin)}" w:hAnsi="${esc(latin)}" w:cs="${esc(latin)}"` : ''}${asian ? ` w:eastAsia="${esc(asian)}"` : ''}${zh ? ' w:hint="eastAsia"' : ''}/>`
    : '';
  const parts = [
    fonts,
    st.bold ? '<w:b/><w:bCs/>' : '',
    // 字符间距 w:spacing 的单位实测是 1/10 磅，不是规范说的缇（banshi/src/units.typ 的 run-spacing；范例章标题 −0.4 磅写着 −4）
    st.tracking !== undefined ? `<w:spacing w:val="${Math.round(st.tracking * 10)}"/>` : '',
    o.kern !== undefined ? `<w:kern w:val="${o.kern}"/>` : '',
    st.size !== undefined ? `<w:sz w:val="${Math.round(st.size * 2)}"/><w:szCs w:val="${Math.round(st.size * 2)}"/>` : '',
  ].join('');
  return parts ? `<w:rPr>${parts}</w:rPr>` : '';
}
export function lineAttrs(v: LineSpacing | undefined): string {
  if (v === undefined || v === 'auto') return '';
  if (typeof v === 'number') return ` w:line="${Math.round(v * 240)}" w:lineRule="auto"`;
  if (v === 'single') return ' w:line="240" w:lineRule="auto"';
  if (v === 'double') return ' w:line="480" w:lineRule="auto"';
  if (v.exactly !== undefined) return ` w:line="${tw(v.exactly)}" w:lineRule="exact"`;
  if (v['at-least'] !== undefined) return ` w:line="${tw(v['at-least'])}" w:lineRule="atLeast"`;
  return '';
}
function gapAttrs(which: 'before' | 'after', v: Lines | number | undefined, P: PageSetup): string {
  if (v === undefined) return '';
  return isLines(v) ? ` w:${which}Lines="${Math.round(v.lines * 100)}" w:${which}="${gapTwips(v, P)}"` : ` w:${which}="${tw(v)}"`;
}
/** 缩进：几个字的按 Word 的 *Chars 写，磅数照折（字宽 = 这一条的字号 + 字符网格的增量，范例 2 字 = 498 缇） */
function indAttrs(st: Style, charW: number): string {
  const one = (key: 'first-line-indent' | 'hanging-indent' | 'left-indent', attr: 'firstLine' | 'hanging' | 'left') => {
    const v = st[key];
    if (v === undefined) return '';
    return isChars(v) ? ` w:${attr}Chars="${Math.round(v.chars * 100)}" w:${attr}="${tw(v.chars * charW)}"` : ` w:${attr}="${tw(v)}"`;
  };
  return one('left-indent', 'left') + one('first-line-indent', 'firstLine') + one('hanging-indent', 'hanging');
}
const JC: Record<string, string> = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right' };
/** 段落对话框 → w:pPr。段前分页不写：另起一页在组节时做成「分页符 + 连续分节符」（build.ts 的 pushParts） */
export function pPr(st: Style, P: PageSetup, o: { outline?: number; lead?: string; lineSpacing?: LineSpacing; align?: string } = {}): string {
  const charW = (st.size ?? P['font-size']) + P.docgrid.tracking;
  const sp = gapAttrs('before', st.above, P) + gapAttrs('after', st.below, P) + lineAttrs(o.lineSpacing ?? st['line-spacing']);
  const ind = indAttrs(st, charW);
  const align = o.align ?? st.align;
  const jc = align ? JC[align] : st.justify ? 'both' : st.justify === false ? 'left' : undefined;
  const parts = [
    st.sticky ? '<w:keepNext/>' : '',
    st.breakable === false ? '<w:keepLines/>' : '',
    o.lead ?? '',
    st['snap-to-grid'] === false ? '<w:snapToGrid w:val="0"/>' : st['snap-to-grid'] === true ? '<w:snapToGrid/>' : '',
    sp ? `<w:spacing${sp}/>` : '',
    ind ? `<w:ind${ind}/>` : '',
    jc ? `<w:jc w:val="${jc}"/>` : '',
    o.outline !== undefined ? `<w:outlineLvl w:val="${o.outline}"/>` : '',
  ].join('');
  return parts ? `<w:pPr>${parts}</w:pPr>` : '';
}
export function styleXml(id: string, name: string, o: { type?: 'paragraph' | 'character'; basedOn?: string; next?: string; pPr?: string; rPr?: string; isDefault?: boolean; link?: string }): string {
  return `<w:style w:type="${o.type ?? 'paragraph'}"${o.isDefault ? ' w:default="1"' : ''} w:styleId="${id}"><w:name w:val="${esc(name)}"/>${o.basedOn ? `<w:basedOn w:val="${o.basedOn}"/>` : ''}${o.next ? `<w:next w:val="${o.next}"/>` : ''}${o.link ? `<w:link w:val="${o.link}"/>` : ''}<w:qFormat/>${o.pPr ?? ''}${o.rPr ?? ''}</w:style>`;
}
/** 页眉那一段的下边框（Word「边框和底纹」：线型、磅数 → 1/8 磅、距文字磅） */
export const borderXml = (b: HeaderFooter['border']) => (b ? `<w:pBdr><w:bottom w:val="${b.style === 'thin-thick-small-gap' ? 'thinThickSmallGap' : 'single'}" w:sz="${Math.round(b.thickness * 8)}" w:space="${Math.round(b['from-text'])}" w:color="auto"/></w:pBdr>` : '');

/** 报告的四级整体上移一格（模板 src/heading/heading.typ 的 report-levels） */
export const headingLevels = (s: Settings): string[] => (s.stage !== 'final' ? ['section', 'subsection', 'subsubsection', 'subsubsection'] : ['chapter', 'section', 'subsection', 'subsubsection']);

/** 整张样式表：Normal 是正文那一条，标题 1～4 是四级标题，题注、装图段、表格文字、目录 1～4、页眉页脚都从模板的字典翻 */
export function stylesXml(F: Facts, s: Settings, o: { hangingChars: number }): { docDefaults: string; styles: string[] } {
  const zh = s.lang !== 'en';
  const P = F.layout.doc;
  const S = F.styles;
  const W = wordLinebreakOptions(s);
  const body = S.body;
  const serif = F.fonts.serif, songti = F.fonts[asianOf(body) ?? 'songti'];
  const docDefaults = `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(serif)}" w:eastAsia="${esc(songti)}" w:hAnsi="${esc(serif)}" w:cs="${esc(serif)}"/><w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>`;
  // Normal 样式沿用范例的 widowControl=0，并写入字距调整与网格右缩进设置。
  const normalLead = `<w:widowControl w:val="0"/>${W.adjustRightIndent ? '' : '<w:adjustRightInd w:val="0"/>'}`;
  const styles: string[] = [
    styleXml('Normal', 'Normal', { isDefault: true, pPr: pPr({ ...body, 'latin-font': latinOf(body) ?? 'serif' }, P, { lead: normalLead }), rPr: rPr({ ...body, 'latin-font': latinOf(body) ?? 'serif' }, F, zh, { kern: W.kern ? 2 : undefined }) }),
  ];
  const levels = headingLevels(s);
  levels.forEach((name, i) => {
    const st = S[name];
    styles.push(styleXml(`Heading${i + 1}`, `heading ${i + 1}`, { basedOn: 'Normal', next: 'Normal', pPr: pPr({ ...st, 'first-line-indent': { chars: 0 } }, P, { outline: i }), rPr: rPr(st, F, zh) }));
  });
  // 前置各页的标题（摘要、目录、参考文献……）长得和章标题一样；目录自己的那条不进目录（不给大纲级别）
  const chapter = { ...S.chapter, 'first-line-indent': { chars: 0 } as Chars };
  styles.push(styleXml('Abstract', 'Abstract Title', { basedOn: 'Normal', next: 'Normal', pPr: pPr(chapter, P, { outline: 0 }), rPr: rPr(S.chapter, F, zh) }));
  styles.push(styleXml('FrontTitle', 'Front Title', { basedOn: 'Normal', next: 'Normal', pPr: pPr(chapter, P), rPr: rPr(S.chapter, F, zh) }));
  // 声明页、符号页的小标题：节标题那一条居中（模板 src/pages/declarations.typ、nomenclature.typ 的 _subheading-style 就是节那几个数）
  const sub = { ...S.section, 'first-line-indent': { chars: 0 } as Chars, align: 'center' };
  styles.push(styleXml('SubTitle', 'Sub Title', { basedOn: 'Normal', next: 'Normal', pPr: pPr(sub, P), rPr: rPr(sub, F, zh) }));
  // 图表：装图的那一段（段前 = 图块之上）、题注（图题的段后 = 图块之下）、表题（段前 = 表块之上）、表格里的文字
  const fig = S.figure;
  // 装图段贴网格：Word 把带图的那一行撑到整数个网格行、图在里面居中，模板 src/figure/caption.typ 模拟的正是这一条（探针 docx 量的）
  const image = { ...fig.image, 'first-line-indent': { chars: 0 } as Chars, align: 'center', sticky: true, below: undefined, 'snap-to-grid': true };
  styles.push(styleXml('Figure', 'Figure', { basedOn: 'Normal', next: 'Caption', pPr: pPr(image, P), rPr: rPr(fig.image, F, zh) }));
  // 题注本身不带段前段后；图题（在图下）的段后 = 图块之下，表题（在表上）的段前 = 表块之上——分成三条，
  // 段落上就不必再清零（*Lines 那几个属性从样式继承下来后，段上光写 before=0 压不住）
  const caption = { ...fig.caption, above: undefined, below: undefined };
  styles.push(styleXml('Caption', 'caption', { basedOn: 'Normal', next: 'Normal', pPr: pPr(caption, P), rPr: rPr(fig.caption, F, zh) }));
  styles.push(styleXml('FigureCaption', 'Figure Caption', { basedOn: 'Caption', next: 'Normal', pPr: pPr({ ...caption, below: fig.image.below }, P) }));
  styles.push(styleXml('TableCaption', 'Table Caption', { basedOn: 'Caption', next: 'Normal', pPr: pPr({ ...caption, above: fig.table.above, sticky: true }, P) }));
  const cell = { ...fig.table, above: undefined, below: undefined, inset: undefined, stroke: undefined, align: 'center' };
  styles.push(styleXml('TableText', 'Table Text', { basedOn: 'Normal', pPr: pPr(cell, P), rPr: rPr(cell, F, zh) }));
  // 成果页的组名、合并页（符号及缩略语）的小标题：正文加粗顶格、段前段后 5 磅（模板 src/styles/group-heading.typ，照范例）
  const group = { ...body, bold: true, 'first-line-indent': { chars: 0 } as Chars, above: 5, below: 5, 'snap-to-grid': false };
  styles.push(styleXml('GroupHeading', 'Group Heading', { basedOn: 'Normal', pPr: pPr(group, P), rPr: rPr({ bold: true }, F, zh) }));
  // 代码：正文那一条换等宽字体，字号照 Word 不缩（模板 c0cc718：小四正文里的 Consolas 就是 12）
  const code = { ...body, 'latin-font': 'mono', 'first-line-indent': { chars: 0 } as Chars, justify: false };
  styles.push(styleXml('Code', 'Code', { basedOn: 'Normal', pPr: pPr(code, P), rPr: rPr(code, F, zh) }));
  // 文献条目：正文那一条加悬挂（悬挂几个字按最宽的号算）
  const ref = { ...body, 'first-line-indent': { chars: 0 } as Chars, 'hanging-indent': { chars: o.hangingChars } as Chars };
  styles.push(styleXml('Reference', 'Reference', { basedOn: 'Normal', pPr: pPr(ref, P) }));
  // 页眉页脚：版面里 header.style / footer.style 那两条（小五宋体、单倍、不贴网格），页眉那条带下边框
  const hdr = { ...P.header.style, 'first-line-indent': { chars: 0 } as Chars, align: 'center' };
  styles.push(styleXml('Header', 'header', { basedOn: 'Normal', pPr: pPr(hdr, P, { lead: borderXml(P.header.border) }), rPr: rPr(hdr, F, zh) }));
  const ftr = { ...P.footer.style, 'first-line-indent': { chars: 0 } as Chars, align: 'center' };
  styles.push(styleXml('Footer', 'footer', { basedOn: 'Normal', pPr: pPr(ftr, P, { lead: borderXml(P.footer.border) }), rPr: rPr(ftr, F, zh) }));
  // 脚注文字小五（模板 src/iota-hit.typ：show footnote.entry: set text(size: zihao.xiaowu)），单倍
  const fn = { ...body, size: 9, 'line-spacing': 'single' as const, 'first-line-indent': { chars: 0 } as Chars };
  styles.push(styleXml('FootnoteText', 'footnote text', { basedOn: 'Normal', pPr: pPr(fn, P), rPr: rPr(fn, F, zh) }));
  // 目录四级：每级一条（缩进、字体），行距 auto 的按学科与学位
  for (let i = 1; i <= 4; i++) {
    const st = { ...S[`toc-${i}`], 'first-line-indent': { chars: 0 } as Chars, align: 'left' };
    styles.push(styleXml(`TOC${i}`, `toc ${i}`, { basedOn: 'Normal', next: 'Normal', pPr: pPr(st, P, { lineSpacing: st['line-spacing'] === 'auto' ? tocLineSpacing(s) : st['line-spacing'], lead: `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${tw(P['paper-width'] - P.margin.left - P.margin.right)}"/></w:tabs>` }), rPr: rPr(st, F, zh) }));
  }
  return { docDefaults, styles };
}
