// 版式选项的登记表：下拉框的档位、三态开关的两端、auto 映射到什么值。
//
// *auto 的映射规则抄自模板*（iota-hit/src/config/settings.typ 与 lib.typ 的注释），
// 这里只为了在界面上告诉用户「自动档现在等于什么」，真正生效的仍是模板自己算的
// ——我们往 Typst 传的就是 auto，不替它决定。规则变了两边都要改；对拍见 tests。
import type { Settings, TriBool, Tri, DegreeLevel, Stage, Campus } from './types';
import { t } from '../i18n';

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
    label: t("校区"),
    hint: t("深圳校区的开题与中期报告是另发的一套表单；终稿全校一套"),
    choices: [
      { value: 'harbin', label: t("哈尔滨（本部）") },
      { value: 'shenzhen', label: t("深圳") },
    ],
  },
  {
    key: 'degreeLevel',
    label: t("学位级别"),
    hint: t("决定封面字样、内封字段、题注双语、右翻页、附录编号……"),
    choices: [
      { value: 'bachelor', label: t("本科") },
      { value: 'master', label: t("硕士") },
      { value: 'doctor', label: t("博士") },
    ],
  },
  {
    key: 'form',
    label: t("交什么"),
    hint: t("学位论文，还是实践成果（本科叫毕业设计）；实践成果只有专业学位才交"),
    choices: [
      { value: 'dissertation', label: t("学位论文") },
      { value: 'practice', label: t("实践成果 / 毕业设计") },
    ],
  },
  {
    key: 'stage',
    label: t("阶段"),
    hint: t("终稿是那份成果本身；开题与中期是两份表单，摘要、内封、声明这些终稿专有的页自动跳过"),
    choices: [
      { value: 'final', label: t("终稿") },
      { value: 'proposal', label: t("开题报告") },
      { value: 'interim', label: t("中期报告") },
    ],
  },
  {
    key: 'category',
    label: t("学科门类"),
    hint: t("理工类与人文社科类两份指南，版面一字不差，只差正文层次编号（第一章 / 一、）"),
    choices: [
      { value: 'stem', label: t("理工类") },
      { value: 'hass', label: t("人文社科类") },
    ],
  },
  {
    key: 'lang',
    label: t("文档语言"),
    hint: t("一篇一个值：标题、词条、目录份数、页眉、编号全按它走"),
    choices: [
      { value: 'zh', label: t("中文") },
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
  group: string;
}

const isReport = (s: Settings) => s.stage !== 'final';
/** 正文照不照报告排：深圳本科的报告只有首页是表单，正文照终稿排 */
const isReportBody = (s: Settings) => isReport(s) && !(s.campus === 'shenzhen' && s.degreeLevel === 'bachelor');
const bodyStage = (s: Settings): Stage => (isReportBody(s) ? s.stage : 'final');
const degreeName: Record<DegreeLevel, string> = { bachelor: t("本科"), master: t("硕士"), doctor: t("博士") };
const stageName: Record<Stage, string> = { final: t("终稿"), proposal: t("开题"), interim: t("中期") };
const campusName: Record<Campus, string> = { harbin: t("本部"), shenzhen: t("深圳") };

const onOff: Choice<boolean>[] = [
  { value: false, label: t("关") },
  { value: true, label: t("开") },
];

export const SWITCHES: SwitchDef<any>[] = [
  {
    key: 'captionBilingual',
    label: t("图表题注双语"),
    hint: t("中文在上、英文在下。规范只要求博士学位论文的图题表题中英双语"),
    choices: onOff,
    group: t("题注与编号"),
    resolve: (s) => {
      if (isReportBody(s)) return { value: false, reason: t("{{v0}}报告一律单语", { v0: stageName[s.stage] }) };
      return s.degreeLevel === 'doctor'
        ? { value: true, reason: t("博士学位论文的图题表题要求双语") }
        : { value: false, reason: t("{{v0}}只排中文题注", { v0: degreeName[s.degreeLevel] }) };
    },
  },
  {
    key: 'captionNumberingByChapter',
    label: t("图表按章编号"),
    hint: t("「图 1-1」并在章标题处重置，还是全文连续「图 1」"),
    choices: onOff,
    group: t("题注与编号"),
    resolve: (s) => {
      const bySection = (s.campus === 'harbin' && s.degreeLevel === 'bachelor' && s.stage === 'proposal')
        || (s.campus === 'shenzhen' && s.degreeLevel !== 'bachelor' && s.stage === 'interim');
      if (isReportBody(s) && bySection) return { value: true, reason: t("{{v0}}{{v1}}{{v2}}表单按节编号", { v0: campusName[s.campus], v1: degreeName[s.degreeLevel], v2: stageName[s.stage] }) };
      if (bodyStage(s) === 'final') return { value: true, reason: t("论文按章编号（图 1-1）") };
      return { value: false, reason: t("报告没有「章」，连续编号（图 1）") };
    },
  },
  {
    key: 'equationNumberingByChapter',
    label: t("公式按章编号"),
    hint: t("与图表分开：可以「图表按章、公式连续」"),
    choices: onOff,
    group: t("题注与编号"),
    resolve: (s) => (bodyStage(s) === 'final'
      ? { value: true, reason: t("指南 2.11：公式按章编号") }
      : { value: false, reason: t("报告连续编号 (1)") }),
  },
  {
    key: 'equationNumberingFullwidth',
    label: t("公式编号全角括号"),
    hint: t("范例印的是半角；指南叙述写全角，两者矛盾，取印出来的那个"),
    choices: onOff,
    group: t("题注与编号"),
    resolve: () => ({ value: false, reason: t("跟范例：半角括号") }),
  },
  {
    key: 'subcaptionBilingual',
    label: t("分图题双语"),
    hint: t("规范说分图题「可以只用中文书写」"),
    choices: onOff,
    group: t("题注与编号"),
    resolve: () => ({ value: false, reason: t("分图题只排中文") }),
  },
  {
    key: 'heading1Pagebreak',
    label: t("一级标题另起一页"),
    hint: t("Word 里「标题 1」样式上那个「段前分页」的勾"),
    choices: onOff,
    group: t("标题与页面"),
    resolve: (s) => (isReportBody(s)
      ? { value: false, reason: t("报告的一级是节，一节一页会把五千字排成五页") }
      : { value: true, reason: t("论文每一章另起一页") }),
  },
  {
    key: 'openright',
    label: t("右翻页"),
    hint: t("内封、前置、主体、后置各段要不要跳到奇数页"),
    choices: onOff,
    group: t("标题与页面"),
    resolve: (s) => (s.degreeLevel === 'doctor'
      ? { value: true, reason: t("博士只内封右翻，其余各段不跳") }
      : { value: false, reason: t("{{v0}}各段都不跳", { v0: degreeName[s.degreeLevel] }) }),
  },
  {
    key: 'titleSpread',
    label: t("两字标题撑开"),
    hint: t("「摘  要」「绪  论」固定空一个字"),
    choices: onOff,
    group: t("标题与页面"),
    resolve: () => ({ value: true, reason: t("两字章名一律撑开") }),
  },
  {
    key: 'titleEnXiaoer',
    label: t("英文题目用小二号"),
    hint: t("封面与内封的英文题目太长时可强制缩成小二号"),
    choices: onOff,
    group: t("标题与页面"),
    resolve: () => ({ value: false, reason: t("按题目长度自动让步，排不下才缩") }),
  },
  {
    key: 'enumHanging',
    label: t("编号列表续行悬挂"),
    hint: t("Word 范例的「（1）……」是普通段落，续行不悬挂"),
    choices: onOff,
    group: t("缩略语与列表"),
    resolve: () => ({ value: false, reason: t("跟范例：不悬挂") }),
  },
  {
    key: 'listHanging',
    label: t("圆点列表续行悬挂"),
    hint: t("指南没规定圆点列表；关掉就与编号列表一样排成段"),
    choices: onOff,
    group: t("缩略语与列表"),
    resolve: () => ({ value: true, reason: t("原生的悬挂") }),
  },
  {
    key: 'abbreviationLinks',
    label: t("缩写链到缩略语表"),
    hint: t("正文里的缩写点一下跳到表"),
    choices: onOff,
    group: t("缩略语与列表"),
    resolve: () => ({ value: true, reason: t("默认链") }),
  },
  {
    key: 'abbreviationIndexed',
    label: t("缩略语登记进索引"),
    hint: t("开了索引页时，缩写要不要顺带进索引"),
    choices: onOff,
    group: t("缩略语与列表"),
    resolve: () => ({ value: false, reason: t("默认不登记") }),
  },
  {
    key: 'emDash',
    label: t("破折号字体"),
    hint: t("排中文字体「——」中间断一截，排西文字体连成一条"),
    choices: [
      { value: 'cjk', label: t("中文") },
      { value: 'latin', label: t("西文") },
    ],
    group: t("字体"),
    resolve: (s) => (s.campus === 'shenzhen' && isReport(s)
      ? { value: 'latin', reason: t("深圳的报告原件是西文破折号") }
      : { value: 'cjk', reason: t("跟原件：中文破折号") }),
  },
  {
    key: 'fakeBold',
    label: t("中文伪粗"),
    hint: t("字体没有真粗面时描边合成加粗（Word 的做法）"),
    choices: onOff,
    group: t("字体"),
    resolve: (s) => (s.fontset === 'windows'
      ? { value: true, reason: t("中易宋体、楷体没有粗体面，与 Word 一样描边合成") }
      : s.fontset === 'macos'
        ? { value: false, reason: t("问字体：Songti SC 有真粗面就不合成") }
        : { value: true, reason: t("问字体：Noto Serif 有真粗面就不合成，FandolKai 没有就合成") }),
  },
  {
    key: 'fakeItalic',
    label: t("中文伪斜"),
    hint: t("强调用楷体；没楷体才退到斜切宋体"),
    choices: onOff,
    group: t("字体"),
    resolve: (s) => ({ value: false, reason: s.fontset === 'webapp' ? t("本站带了 FandolKai，强调用楷体，不斜切") : t("本机有楷体就用楷体，不斜切") }),
  },
  {
    key: 'abstractKeywordsAbove',
    label: t("摘要关键词上方"),
    hint: t("摘要正文与「关键词」之间：指南说隔一行顶格书写（模板默认，落到页首就收掉）；也可以不空，或把关键词挤到本页最下面（v(1fr)）"),
    choices: [
      { value: 'none', label: t("不空") },
      { value: 'line', label: t("空一行") },
      { value: 'bottom', label: t("置于页底") },
    ],
    group: t("标题与页面"),
    resolve: () => ({ value: 'line', reason: t("指南：关键词在正文之后隔一行") }),
  },
  {
    key: 'hyphenate',
    label: t("西文断字"),
    hint: t("行尾的英文单词按音节断开加连字符（Typst 的 text.hyphenate）。模板默认关——两份范例的 Word 都没开自动断字；两端对齐下西文多时开了更匀"),
    choices: onOff,
    group: t("字体"),
    resolve: () => ({ value: false, reason: t("模板默认不断字（照 Word 的默认）") }),
  },
  {
    key: 'appendixNumbering',
    label: t("附录编号"),
    hint: t("附录 A / 附录 1 / 附录一"),
    choices: [
      { value: 'letters', label: 'A' },
      { value: 'numbers', label: '1' },
      { value: 'hanzi', label: t("一") },
    ],
    group: t("标题与页面"),
    resolve: (s) => {
      if (s.lang === 'en') return { value: 'letters', reason: t("英文档一律字母") };
      if (s.category === 'hass') return { value: 'hanzi', reason: t("人文社科类用汉字") };
      return s.degreeLevel === 'bachelor'
        ? { value: 'numbers', reason: t("本科用数字") }
        : { value: 'letters', reason: t("硕博用字母") };
    },
  },
  {
    key: 'degreeType',
    label: t("学位类别"),
    hint: t("封面第二行「（学术学位论文）／（专业学位论文）」；实践成果只有专业学位才交"),
    choices: [
      { value: 'academic', label: t("学术") },
      { value: 'professional', label: t("专业") },
      { value: 'none', label: t("不印") },
    ],
    group: t("标题与页面"),
    applies: (s) => s.degreeLevel !== 'bachelor',
    resolve: (s) => (s.form === 'practice'
      ? { value: 'professional', reason: t("实践成果只有专业学位才交") }
      : { value: 'academic', reason: t("学位论文默认学术学位") }),
  },
];

export function resolveSwitch<V>(def: SwitchDef<any>, s: Settings): { effective: V; auto: Resolved<V>; isAuto: boolean } {
  const raw = s[def.key] as Tri<V>;
  const auto = def.resolve(s) as Resolved<V>;
  return raw === 'auto' ? { effective: auto.value, auto, isAuto: true } : { effective: raw as V, auto, isAuto: false };
}

export const SWITCH_GROUPS = [t("题注与编号"), t("标题与页面"), t("缩略语与列表"), t("字体")] as const;

export const defaultSettings = (): Settings => ({
  styles: {},
  fontset: 'webapp',
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
  listHanging: 'auto',
  abbreviationLinks: 'auto',
  abbreviationIndexed: 'auto',
  titleSpread: 'auto',
  fakeBold: 'auto',
  fakeItalic: 'auto',
  hyphenate: 'auto',
  abstractKeywordsAbove: 'auto',
  emDash: 'auto',
  appendixNumbering: 'auto',
  titleEnXiaoer: 'auto',
});

export type { TriBool };
