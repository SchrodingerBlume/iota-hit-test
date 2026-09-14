// 论文工程的数据模型。整份工程就是这一个 JSON：存 localStorage / IndexedDB，
// 也是「保存工程」下载下来的那个文件；图片二进制单独放 IndexedDB。
//
// 富文本一律存 ProseMirror 的 JSON（TipTap 的 editor.getJSON()），
// 转 Typst 在 src/typst/serialize.ts 与 src/editor/toTypst.ts 做。

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

export interface Settings {
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
  abbreviationLinks: TriBool;
  abbreviationIndexed: TriBool;
  titleSpread: TriBool;
  fakeBold: TriBool;
  fakeItalic: TriBool;
  emDash: Tri<'cjk' | 'latin'>;
  appendixNumbering: Tri<'letters' | 'numbers'>;
  /** 英文题目强制小二号（封面与内封的 title-en-xiaoer） */
  titleEnXiaoer: TriBool;
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
  key: string;
  long: string;
  longEn: string;
}

export interface SymbolEntry {
  /** Typst 数学写法，如 `p`、`eta`、`Delta P` */
  symbol: string;
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
  /** 可选页面的开关。终稿专有的页在报告档里模板自己会跳过 */
  declarations: boolean;
  index: boolean;
  resume: boolean;
  achievements: boolean;
  defense: boolean;
  listOfFigures: boolean;
  listOfTables: boolean;
  listOfEquations: boolean;
  nomenclature: boolean;
  appendix: boolean;
}

export interface ImageAsset {
  /** 文件名（在 Typst 里引用的路径 images/<name>） */
  name: string;
  mime: string;
  /** 像素尺寸，插图时算默认宽度用 */
  width?: number;
  height?: number;
}

export interface ThesisDoc {
  version: 1;
  id: string;
  updatedAt: string;
  settings: Settings;
  info: Info;
  abstractZh: RichDoc;
  abstractEn: RichDoc;
  abbreviations: Abbreviation[];
  symbols: SymbolEntry[];
  body: RichDoc;
  conclusion: RichDoc;
  /** BibTeX 原文 */
  bibliography: string;
  appendix: RichDoc;
  achievements: string;
  defense: Defense;
  acknowledgement: RichDoc;
  resume: RichDoc;
  pages: Pages;
  images: ImageAsset[];
}

export const emptyDoc = (): RichDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });
