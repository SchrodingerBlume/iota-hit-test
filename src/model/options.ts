// 版式选项的登记表：下拉框的档位、三态开关的两端、auto 映射到什么值。
//
// *auto 的映射规则抄自模板*（iota-hit/src/config/settings.typ 与 lib.typ 的注释），
// 这里只为了在界面上告诉用户「自动档现在等于什么」，真正生效的仍是模板自己算的
// ——我们往 Typst 传的就是 auto，不替它决定。规则变了两边都要改；对拍见 tests。
import type { Settings, TriBool, Tri, DegreeLevel, Stage, Campus } from './types';

export interface Choice<V = string> {
  value: V;
  label: string;
  hint?: string;
}

/** 下拉框（轴）：值不可能是 auto，模板对它们都有默认档但语义上必须选一个 */
export interface AxisDef<K extends keyof Settings = keyof Settings> {
  key: K;
  label: string;
  hint: string;
  choices: Choice[];
  /** 这一根轴在当前档位下有没有意义（本科不分学术／专业） */
  applies?: (s: Settings) => boolean;
}

export const AXES: AxisDef[] = [
  {
    key: 'campus',
    label: '校区',
    hint: '深圳校区的开题与中期报告是另发的一套表单；终稿全校一套',
    choices: [
      { value: 'harbin', label: '哈尔滨（本部）' },
      { value: 'shenzhen', label: '深圳' },
    ],
  },
  {
    key: 'degreeLevel',
    label: '学位级别',
    hint: '决定封面字样、内封字段、题注双语、右翻页、附录编号……',
    choices: [
      { value: 'bachelor', label: '本科' },
      { value: 'master', label: '硕士' },
      { value: 'doctor', label: '博士' },
    ],
  },
  {
    key: 'form',
    label: '交什么',
    hint: '学位论文，还是实践成果（本科叫毕业设计）；实践成果只有专业学位才交',
    choices: [
      { value: 'dissertation', label: '学位论文' },
      { value: 'practice', label: '实践成果 / 毕业设计' },
    ],
  },
  {
    key: 'stage',
    label: '阶段',
    hint: '终稿是那份成果本身；开题与中期是两份表单，摘要、内封、声明这些终稿专有的页自动跳过',
    choices: [
      { value: 'final', label: '终稿' },
      { value: 'proposal', label: '开题报告' },
      { value: 'interim', label: '中期报告' },
    ],
  },
  {
    key: 'category',
    label: '学科门类',
    hint: '理工类与人文社科类两份指南，版面一字不差，只差正文层次编号（第一章 / 一、）',
    choices: [
      { value: 'stem', label: '理工类' },
      { value: 'hass', label: '人文社科类' },
    ],
  },
  {
    key: 'lang',
    label: '文档语言',
    hint: '一篇一个值：标题、词条、目录份数、页眉、编号全按它走',
    choices: [
      { value: 'zh', label: '中文' },
      { value: 'en', label: 'English' },
    ],
  },
];

// ── 三态开关 ──────────────────────────────────────────────────────

export interface Resolved<V> {
  value: V;
  /** 一句话说清楚为什么 auto 落在这一档 */
  reason: string;
}

export interface SwitchDef<V extends string | boolean = boolean> {
  key: keyof Settings;
  label: string;
  hint: string;
  /** 两端（或多端）的档位；布尔开关就是 false / true */
  choices: Choice<any>[];
  resolve: (s: Settings) => Resolved<V>;
  applies?: (s: Settings) => boolean;
  group: '题注与编号' | '标题与页面' | '缩略语与列表' | '字体';
}

const isReport = (s: Settings) => s.stage !== 'final';
/** 正文照不照报告排：深圳本科的报告只有首页是表单，正文照终稿排 */
const isReportBody = (s: Settings) => isReport(s) && !(s.campus === 'shenzhen' && s.degreeLevel === 'bachelor');
const bodyStage = (s: Settings): Stage => (isReportBody(s) ? s.stage : 'final');
const degreeName: Record<DegreeLevel, string> = { bachelor: '本科', master: '硕士', doctor: '博士' };
const stageName: Record<Stage, string> = { final: '终稿', proposal: '开题', interim: '中期' };
const campusName: Record<Campus, string> = { harbin: '本部', shenzhen: '深圳' };

const onOff: Choice<boolean>[] = [
  { value: false, label: '关' },
  { value: true, label: '开' },
];

export const SWITCHES: SwitchDef<any>[] = [
  {
    key: 'captionBilingual',
    label: '图表题注双语',
    hint: '中文在上、英文在下。规范只要求博士学位论文的图题表题中英双语',
    choices: onOff,
    group: '题注与编号',
    resolve: (s) => {
      if (isReportBody(s)) return { value: false, reason: `${stageName[s.stage]}报告一律单语` };
      return s.degreeLevel === 'doctor'
        ? { value: true, reason: '博士学位论文的图题表题要求双语' }
        : { value: false, reason: `${degreeName[s.degreeLevel]}只排中文题注` };
    },
  },
  {
    key: 'captionNumberingByChapter',
    label: '图表按章编号',
    hint: '「图 1-1」并在章标题处重置，还是全文连续「图 1」',
    choices: onOff,
    group: '题注与编号',
    resolve: (s) => {
      const bySection = (s.campus === 'harbin' && s.degreeLevel === 'bachelor' && s.stage === 'proposal')
        || (s.campus === 'shenzhen' && s.degreeLevel !== 'bachelor' && s.stage === 'interim');
      if (isReportBody(s) && bySection) return { value: true, reason: `${campusName[s.campus]}${degreeName[s.degreeLevel]}${stageName[s.stage]}表单按节编号` };
      if (bodyStage(s) === 'final') return { value: true, reason: '论文按章编号（图 1-1）' };
      return { value: false, reason: '报告没有「章」，连续编号（图 1）' };
    },
  },
  {
    key: 'equationNumberingByChapter',
    label: '公式按章编号',
    hint: '与图表分开：可以「图表按章、公式连续」',
    choices: onOff,
    group: '题注与编号',
    resolve: (s) => (bodyStage(s) === 'final'
      ? { value: true, reason: '指南 2.11：公式按章编号' }
      : { value: false, reason: '报告连续编号 (1)' }),
  },
  {
    key: 'equationNumberingFullwidth',
    label: '公式编号全角括号',
    hint: '范例印的是半角；指南叙述写全角，两者矛盾，取印出来的那个',
    choices: onOff,
    group: '题注与编号',
    resolve: () => ({ value: false, reason: '跟范例：半角括号' }),
  },
  {
    key: 'subcaptionBilingual',
    label: '分图题双语',
    hint: '规范说分图题「可以只用中文书写」',
    choices: onOff,
    group: '题注与编号',
    resolve: () => ({ value: false, reason: '分图题只排中文' }),
  },
  {
    key: 'heading1Pagebreak',
    label: '一级标题另起一页',
    hint: 'Word 里「标题 1」样式上那个「段前分页」的勾',
    choices: onOff,
    group: '标题与页面',
    resolve: (s) => (isReportBody(s)
      ? { value: false, reason: '报告的一级是节，一节一页会把五千字排成五页' }
      : { value: true, reason: '论文每一章另起一页' }),
  },
  {
    key: 'openright',
    label: '右翻页',
    hint: '内封、前置、主体、后置各段要不要跳到奇数页',
    choices: onOff,
    group: '标题与页面',
    resolve: (s) => (s.degreeLevel === 'doctor'
      ? { value: true, reason: '博士只内封右翻，其余各段不跳' }
      : { value: false, reason: `${degreeName[s.degreeLevel]}各段都不跳` }),
  },
  {
    key: 'titleSpread',
    label: '两字标题撑开',
    hint: '「摘  要」「绪  论」固定空一个字',
    choices: onOff,
    group: '标题与页面',
    resolve: () => ({ value: true, reason: '两字章名一律撑开' }),
  },
  {
    key: 'titleEnXiaoer',
    label: '英文题目用小二号',
    hint: '封面与内封的英文题目太长时可强制缩成小二号',
    choices: onOff,
    group: '标题与页面',
    resolve: () => ({ value: false, reason: '按题目长度自动让步，排不下才缩' }),
  },
  {
    key: 'enumHanging',
    label: '编号列表续行悬挂',
    hint: 'Word 范例的「（1）……」是普通段落，续行不悬挂',
    choices: onOff,
    group: '缩略语与列表',
    resolve: () => ({ value: false, reason: '跟范例：不悬挂' }),
  },
  {
    key: 'abbreviationLinks',
    label: '缩写链到缩略语表',
    hint: '正文里的缩写点一下跳到表',
    choices: onOff,
    group: '缩略语与列表',
    resolve: () => ({ value: true, reason: '默认链' }),
  },
  {
    key: 'abbreviationIndexed',
    label: '缩略语登记进索引',
    hint: '开了索引页时，缩写要不要顺带进索引',
    choices: onOff,
    group: '缩略语与列表',
    resolve: () => ({ value: false, reason: '默认不登记' }),
  },
  {
    key: 'emDash',
    label: '破折号字体',
    hint: '排中文字体「——」中间断一截，排西文字体连成一条',
    choices: [
      { value: 'cjk', label: '中文' },
      { value: 'latin', label: '西文' },
    ],
    group: '字体',
    resolve: (s) => (s.campus === 'shenzhen' && isReport(s)
      ? { value: 'latin', reason: '深圳的报告原件是西文破折号' }
      : { value: 'cjk', reason: '跟原件：中文破折号' }),
  },
  {
    key: 'fakeBold',
    label: '中文伪粗',
    hint: '字体没有真粗面时描边合成加粗（Word 的做法）',
    choices: onOff,
    group: '字体',
    resolve: () => ({ value: true, reason: '问字体：宋体（Noto Serif）有真粗面就不合成，楷体没有就合成' }),
  },
  {
    key: 'fakeItalic',
    label: '中文伪斜',
    hint: '强调用楷体；没楷体才退到斜切宋体',
    choices: onOff,
    group: '字体',
    resolve: () => ({ value: false, reason: '本站带了 FandolKai，强调用楷体，不斜切' }),
  },
  {
    key: 'appendixNumbering',
    label: '附录编号',
    hint: '附录 A / 附录 1 / 附录一',
    choices: [
      { value: 'letters', label: 'A' },
      { value: 'numbers', label: '1' },
      { value: 'hanzi', label: '一' },
    ],
    group: '标题与页面',
    resolve: (s) => {
      if (s.lang === 'en') return { value: 'letters', reason: '英文档一律字母' };
      if (s.category === 'hass') return { value: 'hanzi', reason: '人文社科类用汉字' };
      return s.degreeLevel === 'bachelor'
        ? { value: 'numbers', reason: '本科用数字' }
        : { value: 'letters', reason: '硕博用字母' };
    },
  },
  {
    key: 'degreeType',
    label: '学位类别',
    hint: '封面第二行「（学术学位论文）／（专业学位论文）」；实践成果只有专业学位才交',
    choices: [
      { value: 'academic', label: '学术' },
      { value: 'professional', label: '专业' },
      { value: 'none', label: '不印' },
    ],
    group: '标题与页面',
    applies: (s) => s.degreeLevel !== 'bachelor',
    resolve: (s) => (s.form === 'practice'
      ? { value: 'professional', reason: '实践成果只有专业学位才交' }
      : { value: 'academic', reason: '学位论文默认学术学位' }),
  },
];

export function resolveSwitch<V>(def: SwitchDef<any>, s: Settings): { effective: V; auto: Resolved<V>; isAuto: boolean } {
  const raw = s[def.key] as Tri<V>;
  const auto = def.resolve(s) as Resolved<V>;
  return raw === 'auto' ? { effective: auto.value, auto, isAuto: true } : { effective: raw as V, auto, isAuto: false };
}

export const SWITCH_GROUPS = ['题注与编号', '标题与页面', '缩略语与列表', '字体'] as const;

export const defaultSettings = (): Settings => ({
  campus: 'harbin',
  degreeLevel: 'master',
  degreeType: 'auto',
  form: 'dissertation',
  stage: 'final',
  category: 'stem',
  lang: 'zh',
  captionBilingual: 'auto',
  captionNumberingByChapter: 'auto',
  equationNumberingByChapter: 'auto',
  equationNumberingFullwidth: 'auto',
  subcaptionBilingual: 'auto',
  heading1Pagebreak: 'auto',
  openright: 'auto',
  enumHanging: 'auto',
  abbreviationLinks: 'auto',
  abbreviationIndexed: 'auto',
  titleSpread: 'auto',
  fakeBold: 'auto',
  fakeItalic: 'auto',
  emDash: 'auto',
  appendixNumbering: 'auto',
  titleEnXiaoer: 'auto',
});

export type { TriBool };
