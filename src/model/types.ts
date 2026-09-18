// 论文工程的数据模型。整份工程就是这一个 JSON：存 localStorage / IndexedDB，
// 也是「保存工程」下载下来的那个文件；图片二进制单独放 IndexedDB。
//
// 富文本一律存 ProseMirror 的 JSON（TipTap 的 editor.getJSON()），
// 转 Typst 在 src/typst/serialize.ts 与 src/editor/toTypst.ts 做。

import type { BibEntry } from '../bib/bibtex';
export type { BibEntry };

export type Tri<T> = 'auto' | T;
export type TriBool = Tri<boolean>;

export type Campus = 'harbin' | 'shenzhen';
export type DegreeLevel = 'bachelor' | 'master' | 'doctor';
export type DegreeType = 'academic' | 'professional';
export type Form = 'dissertation' | 'practice';
export type Stage = 'final' | 'proposal' | 'interim';
export type Category = 'stem' | 'hass';
export type Lang = 'zh' | 'en';

/** 富文本文档（ProseMirror JSON） */
export type RichDoc = { type: 'doc'; content?: any[] };

export type Fontset = 'webapp' | 'windows' | 'macos';

/** 模板样式表（iota-hit(styles:)）里一条能改的项：Word 的「修改样式」对话框。缺省 = 用模板的数 */
export interface StyleEntry {
  /** 中文字体角色：songti / heiti / kaishu / fangsong / lishu / xinwei */
  fontZh?: string;
  /** 字号：zihao 键名（xiaosi）、磅数，或带单位的绝对长度（"12pt" / "0.4cm"） */
  size?: string | number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  /** 行距：倍数，或固定值（磅数或带单位的长度） */
  lineSpacing?: number | { exactly: number | string };
  /** 段前 / 段后：数 = 行；字符串 = 带单位的长度（"6pt" / "1em"）或 "0.5行" */
  above?: number | string;
  below?: number | string;
  /** 字符间距：磅数或带单位的绝对长度 */
  tracking?: number | string;
}
export type StyleKey = 'body' | 'chapter' | 'section' | 'subsection' | 'subsubsection' | 'toc';

export interface Settings {
  /** 样式表的局部覆盖，键与模板 styles: 同名；空 = 全按模板 */
  styles: Partial<Record<StyleKey, StyleEntry>>;
  /** 字体方案：站内开源字体（webapp 档 + FandolKai），或本机字体走模板的 windows / macos 档 */
  fontset: Fontset;
  campus: Campus;
  degreeLevel: DegreeLevel;
  /** 学术／专业学位。auto 按 form 定；本科不印这一行 */
  degreeType: Tri<DegreeType | 'none'>;
  form: Form;
  stage: Stage;
  category: Category;
  lang: Lang;
  /** 以下都是模板里的三态开关，auto ＝ 交给模板按档位映射 */
  captionBilingual: TriBool;
  captionNumberingByChapter: TriBool;
  equationNumberingByChapter: TriBool;
  equationNumberingFullwidth: TriBool;
  subcaptionBilingual: TriBool;
  heading1Pagebreak: TriBool;
  openright: TriBool;
  enumHanging: TriBool;
  listHanging: TriBool;
  abbreviationLinks: TriBool;
  abbreviationIndexed: TriBool;
  titleSpread: TriBool;
  fakeBold: TriBool;
  fakeItalic: TriBool;
  /** 西文断字（Typst text.hyphenate）；auto ＝ 模板关着（Word 默认不断字） */
  hyphenate: TriBool;
  /** 摘要正文与关键词之间：auto ＝ 空一行（指南），none ＝ 不空，bottom ＝ 关键词挤到页底（v(1fr)） */
  abstractKeywordsAbove: Tri<'none' | 'line' | 'bottom'>;
  emDash: Tri<'cjk' | 'latin'>;
  appendixNumbering: Tri<'letters' | 'roman' | 'numbers' | 'hanzi'>;
  /** 目录出哪几份：auto ＝ 模板按学位（博士中英两份、硕本只中文；英文档只英文） */
  tocLang: Tri<'zh' | 'en' | 'both'>;
  /** 英文题目强制小二号（封面与内封的 title-en-xiaoer） */
  titleEnXiaoer: TriBool;
  /** 预览的断行引擎：Word 式（本站 fork，只进预览）或 Typst 原版的两种 */
  linebreaker: Tri<'msword' | 'optimized' | 'simple'>;
  /** Word 式断行按哪一版 Word 的规则；紧缩、右缩进按中文 Word 默认写死 */
  wordCompat: Tri<'11' | '12' | '14' | '15'>;
  /**
   * 版面（Word「页面设置」：页边距、文档网格、页眉页脚）的局部改写。界面上不开，只从工程 JSON 里改：
   * 键与模板 layout: 字典同名（margin、char-pitch、line-pitch、base-size、header、footer…），值照 Typst 原话写
   * （"12.71pt"、"zihao.xiaosi"、{"top": "3cm", "rest": "2.5cm"}）。doc 文档级；frontmatter / mainmatter / backmatter
   * 段级；pages 按页：cover、titlepage、abstract、toc、listOfFigures、listOfTables、listOfEquations、nomenclature、
   * achievements、declarations、index；chapters 按正文章号（"1"），只认 char-pitch 与 base-size（模板没有章级版面，
   * 站内把它折成这一章的字距）。
   */
  layout?: LayoutOverrides;
}
export type LayoutDict = Record<string, unknown>;
export interface LayoutOverrides {
  doc?: LayoutDict;
  frontmatter?: LayoutDict;
  mainmatter?: LayoutDict;
  backmatter?: LayoutDict;
  pages?: Record<string, LayoutDict>;
  chapters?: Record<string, LayoutDict>;
}

export interface Info {
  title: string;
  titleEn: string;
  subtitle: string;
  subtitleEn: string;
  author: string;
  authorEn: string;
  studentId: string;
  supervisor: string;
  supervisorEn: string;
  coSupervisor: string;
  coSupervisorEn: string;
  industrySupervisor: string;
  industrySupervisorEn: string;
  degreeApplied: string;
  degreeAppliedEn: string;
  speciality: string;
  specialityEn: string;
  practiceType: string;
  affiliation: string;
  affiliationEn: string;
  defenseDate: string;
  defenseDateEn: string;
  /** 封面落款年月，YYYY-MM */
  date: string;
  keywords: string[];
  keywordsEn: string[];
  secrecy: string;
  classifiedIndex: string;
  udc: string;
  schoolCode: string;
}

export interface Abbreviation {
  /** 正文里 @key 用的键 */
  key: string;
  long: string;
  longEn: string;
  /** 印出来的缩写；空 = 与 key 相同 */
  short?: string;
  /** 复数形式；空 = short + s */
  plural?: string;
  /** 这一条要不要登记进索引（覆盖文档级开关） */
  indexed?: boolean;
}

/** 符号表 / 缩略语表的排法（iota-hit 的 list-of-symbols / list-of-abbreviations / nomenclature 参数） */
export interface NomenclatureOptions {
  /** 缩略语按字母序（auto）还是照声明顺序 */
  sort: 'auto' | 'alpha' | 'declared';
  /** 只列正文用过的（auto）还是全列 */
  usedOnly: 'auto' | 'used' | 'all';
  /** 印不印列头：auto = 跟模板（不印） */
  header: 'auto' | 'on' | 'off';
  /** 说明列从哪里起（cm）；空 = 按内容自动 */
  hangingIndent: string;
  /** 合并页的形态：小标题照成果页 / 照声明页 / 不印小标题 */
  form: 'auto' | 'achievements' | 'declarations' | 'no-subheadings';
}

export interface SymbolEntry {
  /** 数学写法：Typst（`eta`）或 LaTeX（`\\eta`），按 mode 分 */
  symbol: string;
  mode?: 'typst' | 'latex';
  meaning: string;
}

export interface DefensePerson {
  name: string;
  title: string;
  affiliation: string;
  discipline: string;
}

export interface Defense {
  enabled: boolean;
  reviewers: DefensePerson[];
  chair: DefensePerson;
  members: DefensePerson[];
  secretary: DefensePerson;
  resolution: RichDoc;
}

export interface Pages {
  /** 可选页面排不排：auto 照指南与范例（见 src/model/pages.ts）；终稿专有的页在报告档里模板自己会跳过 */
  cover: Tri<boolean>;
  titlepage: Tri<boolean>;
  abstract: Tri<boolean>;
  tableOfContents: Tri<boolean>;
  declarations: Tri<boolean>;
  index: Tri<boolean>;
  resume: Tri<boolean>;
  achievements: Tri<boolean>;
  defense: Tri<boolean>;
  listOfFigures: Tri<boolean>;
  listOfTables: Tri<boolean>;
  listOfEquations: Tri<boolean>;
  /** 旧字段（v3 前的总开关），读入时拆成 symbolsPage / abbreviationsPage */
  nomenclature?: boolean;
  symbolsPage: Tri<boolean>;
  abbreviationsPage: Tri<boolean>;
  nomenclatureMerged: Tri<boolean>;
  appendix: Tri<boolean>;
}

export interface ImageAsset {
  /** 文件名（在 Typst 里引用的路径 images/<name>） */
  name: string;
  mime: string;
  /** 像素尺寸，插图时算默认宽度用 */
  width?: number;
  height?: number;
}

/** 批注：正文里的 comment 标记圈范围，本体在这里；随工程文件走 */
export interface Comment {
  id: string;
  /** 哪份富文本 */
  key: 'abstractZh' | 'abstractEn' | 'body' | 'conclusion' | 'appendix' | 'acknowledgement' | 'resume';
  author: string;
  text: string;
  createdAt: string;
  resolved?: boolean;
  replies?: { author: string; text: string; createdAt: string }[];
}

export interface ThesisDoc {
  /** 未转换完成的 Markdown 也随文档保存，避免切换章节丢失输入。 */
  sourceDrafts?: Record<string, string>;
  version: 1;
  id: string;
  /** 项目名（项目管理界面里起的） */
  name: string;
  updatedAt: string;
  settings: Settings;
  info: Info;
  abstractZh: RichDoc;
  abstractEn: RichDoc;
  abbreviations: Abbreviation[];
  symbols: SymbolEntry[];
  nomenclatureOptions: NomenclatureOptions;
  body: RichDoc;
  conclusion: RichDoc;
  /** 参考文献：结构化条目是真身，编译时生成 BibTeX */
  references: BibEntry[];
  /** 旧版工程留下的 BibTeX 原文，读入时解析进 references 后清空 */
  bibliography: string;
  appendix: RichDoc;
  achievementEntries: BibEntry[];
  achievements: string;
  defense: Defense;
  acknowledgement: RichDoc;
  resume: RichDoc;
  pages: Pages;
  images: ImageAsset[];
  comments?: Comment[];
  /** 各部件从右手页起：auto 跟随所在部分（模板按学位定） */
  openright?: Partial<Record<OpenrightKey, TriBool>>;
}
export type OpenrightKey = 'frontmatter' | 'mainmatter' | 'abstract' | 'nomenclature' | 'tableOfContents' | 'listOfFigures' | 'listOfTables' | 'listOfEquations' | 'conclusion' | 'achievements' | 'defense' | 'declarations' | 'index' | 'acknowledgement' | 'resume';

export const emptyDoc = (): RichDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });
