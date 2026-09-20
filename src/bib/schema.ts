import { t as tx } from '../i18n';
// 条目类型与字段表。类型与字段名照 omni-gb7714 手册 §4.3（GB/T 7714—2025 的 14 类），
// 成果页另有 iota-hit 自造的 @project / @award（见 iota-hit/src/pages/achievements.typ）。
// required 只是界面上标个星，omni 自己会按「有则必备」处理缺项。

export type FieldKind = 'names' | 'text' | 'date' | 'pages' | 'url' | 'long';

export interface FieldDef {
  key: string;
  label: string;
  kind?: FieldKind;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}

export interface TypeDef {
  type: string;
  label: string;
  /** 文献类型标识 */
  mark: string;
  fields: FieldDef[];
  /** 别名类型也归到这一档展示 */
  aliases?: string[];
}

const F = {
  author: { key: 'author', label: tx("作者"), kind: 'names' as const, required: true, hint: tx("每行一位作者；西文姓名按“姓, 名”输入") },
  authorOpt: { key: 'author', label: tx("作者"), kind: 'names' as const, hint: tx("每行一人") },
  title: { key: 'title', label: tx("题名"), required: true },
  subtitle: { key: 'subtitle', label: tx("其他题名信息"), hint: tx("副题名将显示为“题名: 副题名”") },
  year: { key: 'year', label: tx("年"), required: true, placeholder: '2024' },
  date: { key: 'date', label: tx("日期"), kind: 'date' as const, placeholder: '2024-05-09', hint: tx("报告、专利和网页应输入完整日期") },
  address: { key: 'address', label: tx("出版地"), placeholder: tx("北京") },
  publisher: { key: 'publisher', label: tx("出版者"), placeholder: tx("科学出版社") },
  pages: { key: 'pages', label: tx("页码"), kind: 'pages' as const, placeholder: '12-34' },
  doi: { key: 'doi', label: 'DOI', placeholder: '10.1038/nature13308' },
  url: { key: 'url', label: 'URL', kind: 'url' as const },
  urldate: { key: 'urldate', label: tx("引用日期"), kind: 'date' as const, placeholder: '2025-05-06', hint: tx("网页必须填写；其他电子资源可选") },
  edition: { key: 'edition', label: tx("版本"), placeholder: tx("2 / 修订版") },
  langid: { key: 'langid', label: tx("语种"), hint: tx("自动检测") },
  note: { key: 'note', label: tx("备注"), kind: 'long' as const },
};

export const TYPES: TypeDef[] = [
  { type: 'article', label: tx("期刊论文"), mark: 'J', fields: [F.author, F.title, F.subtitle, { key: 'journal', label: tx("期刊名"), required: true, placeholder: tx("机械工程学报") }, F.year, { key: 'volume', label: tx("卷"), placeholder: '57' }, { key: 'number', label: tx("期"), placeholder: '1' }, F.pages, F.date, F.doi, F.url, F.urldate, F.langid] },
  { type: 'book', label: tx("图书或专著"), mark: 'M', fields: [F.author, F.title, F.subtitle, { key: 'editor', label: tx("编者"), kind: 'names' }, { key: 'translator', label: tx("译者"), kind: 'names' }, F.edition, F.address, F.publisher, F.year, F.pages, { key: 'isbn', label: 'ISBN' }, F.doi, F.url, F.langid] },
  { type: 'inbook', label: tx("图书析出（章节）"), mark: 'M', aliases: ['incollection'], fields: [F.author, F.title, F.subtitle, { key: 'bookauthor', label: tx("图书作者"), kind: 'names' }, { key: 'editor', label: tx("图书编者"), kind: 'names' }, { key: 'booktitle', label: tx("图书题名"), required: true }, { key: 'volume', label: tx("卷/册") }, F.edition, F.address, F.publisher, F.year, F.pages, F.doi, F.url, F.langid] },
  { type: 'inproceedings', label: tx("会议论文"), mark: 'C', aliases: ['conference'], fields: [F.author, F.title, F.subtitle, { key: 'booktitle', label: tx("会议录或会议名称"), required: true, placeholder: 'Proc. ICMT 2022' }, { key: 'eventtitle', label: tx("会议名称"), hint: tx("GB/T 7714—2025") }, F.year, F.address, F.publisher, F.pages, F.doi, F.url, F.langid] },
  { type: 'proceedings', label: tx("会议录（整本）"), mark: 'C', fields: [{ key: 'editor', label: tx("编者"), kind: 'names' }, F.title, F.subtitle, F.address, F.publisher, F.year, F.url] },
  { type: 'phdthesis', label: tx("学位论文"), mark: 'D', aliases: ['thesis', 'mastersthesis'], fields: [F.author, F.title, F.subtitle, { key: 'school', label: tx("学位授予单位"), required: true, placeholder: tx("哈尔滨工业大学") }, { key: 'address', label: tx("单位所在地"), placeholder: tx("哈尔滨") }, F.year, { key: 'type', label: tx("学位级别"), placeholder: tx("博士 / 硕士"), hint: tx("启用“显示学位级别”后，将显示在 [D] 之后") }, F.pages, F.doi, F.url, F.langid] },
  { type: 'report', label: tx("报告"), mark: 'R', fields: [F.author, F.title, F.subtitle, { key: 'number', label: tx("报告编号"), placeholder: '7178999X-2006BAK04A10/10.2013' }, { key: 'institution', label: tx("发布机构") }, F.date, F.pages, F.url, F.langid] },
  { type: 'standard', label: tx("标准"), mark: 'S', fields: [{ key: 'number', label: tx("标准编号"), required: true, placeholder: 'GB/T 3792—2021' }, F.title, F.authorOpt, F.address, F.publisher, F.year, F.url] },
  { type: 'patent', label: tx("专利"), mark: 'P', fields: [F.author, F.title, { key: 'number', label: tx("专利号"), required: true, placeholder: 'CN200610171314.3' }, { key: 'address', label: tx("专利国"), placeholder: tx("中国"), hint: tx("启用“显示专利国别”后，将显示在成果页中") }, F.date, { key: 'type', label: tx("专利类型"), placeholder: tx("发明专利") }, F.url] },
  { type: 'online', label: tx("网页或电子资源"), mark: 'EB/OL', aliases: ['webpage', 'electronic', 'www'], fields: [F.authorOpt, F.title, { key: 'organization', label: tx("网站或机构") }, F.date, { ...F.urldate, required: true }, { ...F.url, required: true }, F.langid] },
  { type: 'newspaper', label: tx("报纸文章"), mark: 'N', fields: [F.author, F.title, { key: 'journal', label: tx("报纸名"), required: true, placeholder: tx("中国青年报") }, { ...F.date, required: true }, { key: 'number', label: tx("版次"), placeholder: '15' }, F.url] },
  { type: 'archive', label: tx("档案"), mark: 'A', fields: [F.authorOpt, F.title, { key: 'number', label: tx("档号") }, F.address, { key: 'publisher', label: tx("收藏机构") }, F.date, F.pages, F.url] },
  { type: 'map', label: tx("地图"), mark: 'CM', fields: [F.authorOpt, F.title, { key: 'scale', label: tx("比例尺"), placeholder: '1: 25 000' }, { key: 'dimensions', label: tx("尺寸") }, F.edition, F.address, F.publisher, F.year, F.url] },
  { type: 'dataset', label: tx("数据集"), mark: 'DS', fields: [F.author, F.title, { key: 'version', label: tx("版本"), placeholder: 'V1.0' }, { key: 'publisher', label: tx("发布平台") }, F.date, F.urldate, F.url, { key: 'doi', label: 'DOI' }, { key: 'cstr', label: 'CSTR' }] },
  { type: 'preprint', label: tx("预印本"), mark: 'EB/OL', fields: [F.author, F.title, { key: 'eprinttype', label: tx("预印本平台"), placeholder: 'arXiv' }, { key: 'eprint', label: tx("编号"), placeholder: '2401.01234' }, { key: 'version', label: tx("版本") }, F.date, F.urldate, F.url, F.doi] },
  { type: 'software', label: tx("软件"), mark: 'CP', fields: [F.authorOpt, F.title, { key: 'version', label: tx("版本") }, { key: 'publisher', label: tx("发布者") }, F.date, F.url] },
  { type: 'misc', label: tx("其他"), mark: 'Z', fields: [F.authorOpt, F.title, { key: 'howpublished', label: tx("出处") }, F.year, F.url, F.note] },
];

/** 成果页专用的两种自造类型（iota-hit 的 achievements 驱动） */
export const ACHIEVEMENT_TYPES: TypeDef[] = [
  { type: 'project', label: tx("科研项目"), mark: tx("项目"), fields: [F.author, { key: 'title', label: tx("项目名称"), required: true }, { key: 'funder', label: tx("立项来源"), placeholder: tx("国家自然科学基金面上项目") }, { key: 'number', label: tx("课题编号") }, F.year] },
  { type: 'award', label: tx("获奖"), mark: tx("奖"), fields: [F.author, { key: 'title', label: tx("成果名称"), required: true }, { key: 'award', label: tx("奖项"), required: true, placeholder: tx("黑龙江省科学技术二等奖") }, F.year] },
];

/** 成果页每条都能带的注：收录号、影响因子、对应章节 */
export const ANNOTE_FIELD: FieldDef = { key: 'annote', label: tx("附注"), kind: 'long', hint: tx("收录、影响因子、对应章节"), placeholder: tx("（EI 收录号：20211234567；对应第 2 章）") };

export function typeDef(type: string, extra: TypeDef[] = []): TypeDef {
  const all = [...TYPES, ...extra];
  return all.find((t) => t.type === type || t.aliases?.includes(type)) ?? { type, label: type, mark: '?', fields: [F.authorOpt, F.title, F.year, F.note] };
}

/** 成果页选哪些类型 */
export const ACHIEVEMENT_TYPE_KEYS = ['article', 'inproceedings', 'patent', 'project', 'award', 'book', 'software', 'standard', 'report'];
