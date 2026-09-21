// 版式选项及自动档说明。自动档的实际值由 iota-hit 计算；此处仅展示当前解析结果。
import type { Settings, TriBool, Tri, DegreeLevel, Stage, Campus } from './types';
import { t } from '../i18n';

export interface Choice<V = string> {
  value: V;
  label: string;
  hint?: string;
  /** 布尔档也可以不叫「开 / 关」（Word 的单选组照它的叫法），色相照开关走 */
  tone?: 'on' | 'off' | 'accent';
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
    hint: t("开题和中期报告使用校区模板"),
    choices: [
      { value: 'harbin', label: t("哈尔滨（本部）") },
      { value: 'shenzhen', label: t("深圳") },
    ],
  },
  {
    key: 'degreeLevel',
    label: t("学位级别"),
    hint: t("本科、硕士或博士"),
    choices: [
      { value: 'bachelor', label: t("本科") },
      { value: 'master', label: t("硕士") },
      { value: 'doctor', label: t("博士") },
    ],
  },
  {
    key: 'form',
    label: t("成果形式"),
    hint: t("论文、实践成果或毕业设计"),
    choices: [
      { value: 'dissertation', label: t("学位论文") },
      { value: 'practice', label: t("实践成果或毕业设计") },
    ],
  },
  {
    key: 'stage',
    label: t("阶段"),
    hint: t("终稿、开题或中期"),
    choices: [
      { value: 'final', label: t("终稿") },
      { value: 'proposal', label: t("开题报告") },
      { value: 'interim', label: t("中期报告") },
    ],
  },
  {
    key: 'category',
    label: t("学科门类"),
    hint: t("标题编号格式"),
    choices: [
      { value: 'stem', label: t("理工类") },
      { value: 'hass', label: t("人文社科类") },
    ],
  },
  {
    key: 'lang',
    label: t("文档语言"),
    hint: t("用于设置标题、术语、目录、页眉和编号语言。"),
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
  /** auto 不是单一的一档（各段 / 各字体不同）时显示这个字，value 只是主要那一档 */
  mixed?: string;
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
  /** 只关乎某一页的开关放到那一页去（摘要、缩略语、附录、页面设置、论文信息、论文类型），不在论文设置里列 */
  place?: 'abstract' | 'nomenclature' | 'appendix' | 'toc' | 'cover' | 'titlepage' | 'type' | 'body' | 'bibliography';
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
    label: t("双语图表题注"),
    hint: t("中文在上，英文在下"),
    choices: onOff,
    group: t("题注与编号"),
    place: 'body',
    resolve: (s) => {
      if (isReportBody(s)) return { value: false, reason: t("{{v0}}报告仅使用单语题注", { v0: stageName[s.stage] }) };
      return s.degreeLevel === 'doctor'
        ? { value: true, reason: t("博士学位论文的图题表题要求双语") }
        : { value: false, reason: t("{{v0}}仅显示中文题注", { v0: degreeName[s.degreeLevel] }) };
    },
  },
  {
    key: 'captionNumberingByChapter',
    label: t("图表按章编号"),
    hint: t("图 1-1 / 图 1"),
    choices: onOff,
    group: t("题注与编号"),
    place: 'body',
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
    hint: t("公式编号"),
    choices: onOff,
    group: t("题注与编号"),
    place: 'body',
    resolve: (s) => (bodyStage(s) === 'final'
      ? { value: true, reason: t("指南 2.11：公式按章编号") }
      : { value: false, reason: t("报告连续编号 (1)") }),
  },
  {
    key: 'theoremNumberingByChapter',
    label: t("定理按章编号"),
    hint: t("定理、引理、定义等各自计数"),
    choices: onOff,
    group: t("题注与编号"),
    place: 'body',
    resolve: (s) => (bodyStage(s) === 'final'
      ? { value: true, reason: t("与公式一样按章编号（定理1.1）") }
      : { value: false, reason: t("报告只数序号（定理1）") }),
  },
  {
    key: 'equationNumberingFullwidth',
    label: t("公式编号全角括号"),
    hint: t("全角括号 / 半角括号"),
    choices: onOff,
    group: t("题注与编号"),
    place: 'body',
    resolve: () => ({ value: false, reason: t("按范例使用半角括号") }),
  },
  {
    key: 'subcaptionBilingual',
    label: t("分图题双语"),
    hint: t("规范允许分图题仅使用中文。"),
    choices: onOff,
    group: t("题注与编号"),
    place: 'body',
    resolve: () => ({ value: false, reason: t("分图题仅显示中文") }),
  },
  {
    key: 'heading1Pagebreak',
    label: t("一级标题另起一页"),
    hint: t("段前分页"),
    choices: onOff,
    group: t("标题与页面"),
    place: 'body',
    resolve: (s) => (isReportBody(s)
      ? { value: false, reason: t("报告的一级标题按节处理，不自动分页。") }
      : { value: true, reason: t("论文每一章另起一页") }),
  },
  {
    key: 'openright',
    label: t("右翻页"),
    hint: t("奇数页"),
    choices: onOff,
    group: t("标题与页面"),
    resolve: (s) => (s.degreeLevel === 'doctor'
      ? { value: true, mixed: t("只内封"), reason: t("博士论文仅内封从奇数页开始；其他部分连续排版。") }
      : { value: false, reason: t("{{v0}}各部分连续排版", { v0: degreeName[s.degreeLevel] }) }),
  },
  {
    key: 'titleSpread',
    label: t("两字标题分散对齐"),
    hint: t("「摘  要」「绪  论」固定空一个字"),
    choices: onOff,
    group: t("标题与页面"),
    place: 'body',
    resolve: () => ({ value: true, reason: t("两字章名统一分散对齐") }),
  },
  {
    key: 'titleEnXiaoer',
    label: t("封面英文题目用小二号"),
    hint: t("二号 / 小二号"),
    choices: onOff,
    group: t("标题与页面"),
    place: 'cover',
    resolve: () => ({ value: false, mixed: t("按需缩小"), reason: t("按需使用小二号") }),
  },
  {
    key: 'titleEnXiaoerTitlepage',
    label: t("内封英文题目用小二号"),
    hint: t("按需使用小二号"),
    choices: onOff,
    group: t("标题与页面"),
    place: 'titlepage',
    resolve: () => ({ value: false, mixed: t("按需缩小"), reason: t("优先使用二号字；页面无法容纳时改用小二号。") }),
  },
  {
    key: 'enumHanging',
    label: t("编号列表悬挂缩进"),
    hint: t("（1）……"),
    choices: onOff,
    group: t("列表"),
    place: 'body',
    resolve: () => ({ value: false, reason: t("按范例不使用悬挂缩进") }),
  },
  {
    key: 'listHanging',
    label: t("项目符号列表悬挂缩进"),
    hint: t("悬挂缩进"),
    choices: onOff,
    group: t("列表"),
    place: 'body',
    resolve: () => ({ value: true, reason: t("使用悬挂缩进") }),
  },
  {
    key: 'abbreviationLinks',
    label: t("链接缩写和缩略语表"),
    hint: t("将正文中的缩写链接到缩略语表。"),
    choices: onOff,
    group: t("缩略语与列表"),
    place: 'nomenclature',
    resolve: () => ({ value: true, reason: t("默认启用链接") }),
  },
  {
    key: 'abbreviationIndexed',
    label: t("将缩略语收录到索引"),
    hint: t("启用索引页时，同时将缩写收录到索引"),
    choices: onOff,
    group: t("缩略语与列表"),
    place: 'nomenclature',
    resolve: () => ({ value: false, reason: t("默认不登记") }),
  },
  {
    key: 'emDash',
    label: t("破折号字体"),
    hint: t("中文字体 / 西文字体"),
    choices: [
      { value: 'cjk', label: t("中文") },
      { value: 'latin', label: t("西文") },
    ],
    group: t("字体"),
    resolve: (s) => (s.campus === 'shenzhen' && isReport(s)
      ? { value: 'latin', reason: t("深圳校区报告原件使用西文破折号") }
      : { value: 'cjk', reason: t("按原件使用中文破折号") }),
  },
  {
    key: 'fakeBold',
    label: t("模拟中文粗体"),
    hint: t("模拟加粗"),
    choices: onOff,
    group: t("字体"),
    resolve: (s) => (s.fontset === 'windows'
      ? { value: true, reason: t("中易宋体和楷体缺少粗体字形，使用描边模拟加粗。") }
      : s.fontset === 'macos'
        ? { value: false, mixed: t("自动检测字体"), reason: t("按字体") }
        : { value: true, mixed: t("自动检测字体"), reason: t("按字体") }),
  },
  {
    key: 'emphKaishu',
    label: t("倾斜文字使用楷体"),
    hint: t("楷体 / 倾斜"),
    choices: onOff,
    group: t("字体"),
    resolve: () => ({ value: false, reason: t("倾斜") }),
  },
  {
    key: 'bibliographyFull',
    label: t("参考文献列出范围"),
    hint: t("全部登记的条目，或只列正文引用过的"),
    choices: [
      { value: false, label: t("只列引用过的"), tone: 'off' },
      { value: true, label: t("全部条目"), tone: 'on' },
    ],
    group: t("后置"),
    place: 'bibliography',
    resolve: () => ({ value: true, reason: t("登记的条目全部列出（未引用的按登记顺序接在引用过的后面）") }),
  },
  {
    key: 'abstractKeywordsAbove',
    label: t("摘要关键词上方"),
    hint: t("无 / 空一行 / 页底"),
    choices: [
      { value: 'none', label: t("不留空行") },
      { value: 'line', label: t("空一行") },
      { value: 'bottom', label: t("置于页底") },
    ],
    group: t("标题与页面"),
    place: 'abstract',
    resolve: () => ({ value: 'line', reason: t("指南：关键词在正文之后隔一行") }),
  },
  {
    key: 'tocLang',
    label: t("目录语言"),
    hint: t("选择生成中文目录、英文目录或中英文两份目录"),
    choices: [
      { value: 'zh', label: t("仅中文") },
      { value: 'en', label: t("仅英文") },
      { value: 'both', label: t("中英两份") },
    ],
    group: t("标题与页面"),
    place: 'toc',
    resolve: (s) => {
      if (s.lang === 'en') return { value: 'en', reason: t("英文文档仅生成英文目录") };
      return s.degreeLevel === 'doctor' ? { value: 'both', reason: t("博士论文生成中英文两份目录（按范例）") } : { value: 'zh', reason: t("硕士和本科论文仅生成中文目录") };
    },
  },
  {
    key: 'hyphenate',
    label: t("自动断字"),
    hint: t("布局 → 断字 → 自动"),
    choices: onOff,
    group: t("字体"),
    // 暂时不列：fork 的断字与 Word 的对不上；工程 JSON 里写死了的照旧显示（连续断字次数、全大写那两项跟着它）
    applies: (s) => s.hyphenate !== 'auto',
    resolve: () => ({ value: false, reason: t("模板与 Word 默认均不启用自动断字") }),
  },
  {
    key: 'appendixNumbering',
    label: t("附录编号"),
    hint: t("A / I / 1 / 一 / One"),
    choices: [
      { value: 'letters', label: 'A', hint: t("附录A ／ A.1 ／ 图A-1") },
      { value: 'roman', label: 'I', hint: t("附录 I ／ I.1 ／ 图 I-1（指南未规定，格式与字母编号相同）") },
      { value: 'numbers', label: '1', hint: t("附录1 ／ 1.1 ／ 附图1-1（图表加「附」，与正文分开）") },
      { value: 'hanzi', label: t("一"), hint: t("附录一 ／ 一、／（一），人文社科与正文同一套写法") },
      { value: 'words', label: 'One', hint: t("Appendix One ／ 一、／（一），人文社科的英文写法") },
    ],
    group: t("标题与页面"),
    place: 'appendix',
    resolve: (s) => {
      if (s.lang === 'en') return { value: 'letters', reason: t("英文文档统一使用字母编号") };
      if (s.category === 'hass') return { value: 'hanzi', reason: t("人文社科类用汉字") };
      return s.degreeLevel === 'bachelor'
        ? { value: 'numbers', reason: t("本科用数字") }
        : { value: 'letters', reason: t("硕博用字母") };
    },
  },
  {
    key: 'degreeType',
    label: t("学位类别"),
    hint: t("学术学位 / 专业学位"),
    choices: [
      { value: 'academic', label: t("学术") },
      { value: 'professional', label: t("专业") },
      { value: 'none', label: t("不显示") },
    ],
    group: t("标题与页面"),
    place: 'type',
    applies: (s) => s.degreeLevel !== 'bachelor',
    resolve: (s) => (s.form === 'practice'
      ? { value: 'professional', reason: t("实践成果仅适用于专业学位") }
      : { value: 'academic', reason: t("学位论文默认学术学位") }),
  },
];

// 预览引擎：本站的 wasm 是 Typst 0.15.1 + Word 式断行（par(linebreaks: "msword")）。
// 这一组只在预览里生效；导出的 .typ 只把字符网格折成模板的 layout: (char-pitch: …)，原版 Typst 照编
SWITCHES.push({
  key: 'linebreaker',
  label: t("断行引擎"),
  hint: t("Word 式 / Typst 最优 / Typst 逐行"),
  choices: [
    { value: 'msword', label: t("Word 式") },
    { value: 'optimized', label: t("Typst 最优") },
    { value: 'simple', label: t("Typst 逐行") },
  ],
  group: t("排版引擎"),
  resolve: () => ({ value: 'msword', reason: t("使用 Word 式断行，与学校范例保持一致") }),
}, {
  key: 'wordCompat',
  label: t("兼容模式"),
  hint: t("Word 2013–365 / Word 2003–2010"),
  choices: [
    { value: '11', label: 'Word 2003' },
    { value: '12', label: 'Word 2007' },
    { value: '14', label: 'Word 2010' },
    { value: '15', label: 'Word 2013-2021' },
  ],
  group: t("排版引擎"),
  applies: (s) => (s.linebreaker === 'auto' ? 'msword' : s.linebreaker) === 'msword',
  resolve: () => ({ value: '11', reason: t("学校范例采用 Word 2003 的 .doc 格式") }),
}, {
  key: 'wordCompress',
  label: t("字符间距控制"),
  hint: t("只压缩标点符号 / 不压缩"),
  choices: [
    { value: false, label: t("不压缩"), tone: 'off' },
    { value: true, label: t("只压缩标点符号"), tone: 'on' },
  ],
  group: t("排版引擎"),
  applies: (s) => (s.linebreaker === 'auto' ? 'msword' : s.linebreaker) === 'msword',
  resolve: () => ({ value: true, reason: t("中文 Word 默认使用“只压缩标点符号”") }),
}, {
  key: 'wordKern',
  label: t("为字体调整字间距"),
  hint: t("字体 → 高级"),
  choices: onOff,
  group: t("排版引擎"),
  applies: (s) => (s.linebreaker === 'auto' ? 'msword' : s.linebreaker) === 'msword',
  resolve: () => ({ value: true, reason: t("中文 Word 的默认样式已启用此项") }),
}, {
  key: 'wordBalanceWidths',
  label: t("平衡 SBCS 字符和 DBCS 字符"),
  hint: t("兼容性选项"),
  choices: onOff,
  group: t("排版引擎"),
  applies: (s) => (s.linebreaker === 'auto' ? 'msword' : s.linebreaker) === 'msword',
  resolve: () => ({ value: true, reason: t("中文 Word 新建文档默认启用此项") }),
}, {
  key: 'wordAdjustRightIndent',
  label: t("定义文档网格时自动调整右缩进"),
  hint: t("段落 → 中文版式"),
  choices: onOff,
  group: t("排版引擎"),
  applies: (s) => (s.linebreaker === 'auto' ? 'msword' : s.linebreaker) === 'msword' && (s.wordCompat === 'auto' || s.wordCompat !== '15'),
  resolve: () => ({ value: true, reason: t("Word 段落的默认") }),
}, {
  key: 'hyphenLimit',
  label: t("连续断字次数限为"),
  hint: t("不限或指定次数"),
  choices: [
    { value: '0', label: t("不限") },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
  ],
  group: t("排版引擎"),
  applies: (s) => s.hyphenate === true,
  resolve: () => ({ value: '0', reason: t("Word 默认不限制") }),
}, {
  key: 'hyphenateCaps',
  label: t("单词的字母全部大写时断字"),
  hint: t("断字选项"),
  choices: onOff,
  group: t("排版引擎"),
  applies: (s) => s.hyphenate === true,
  resolve: () => ({ value: true, reason: t("Word 默认允许") }),
});

export function resolveSwitch<V>(def: SwitchDef<any>, s: Settings): { effective: V; auto: Resolved<V>; isAuto: boolean } {
  const raw = s[def.key] as Tri<V>;
  const auto = def.resolve(s) as Resolved<V>;
  return raw === 'auto' ? { effective: auto.value, auto, isAuto: true } : { effective: raw as V, auto, isAuto: false };
}

export const SWITCH_GROUPS = [t("题注与编号"), t("标题与页面"), t("列表"), t("字体"), t("排版引擎")] as const;

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
  theoremNumberingByChapter: 'auto',
  bibliographyFull: 'auto',
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
  emphKaishu: 'auto',
  hyphenate: 'auto',
  abstractKeywordsAbove: 'auto',
  emDash: 'auto',
  appendixNumbering: 'auto',
  tocLang: 'auto',
  titleEnXiaoer: 'auto',
  titleEnXiaoerTitlepage: 'auto',
  linebreaker: 'auto',
  wordCompat: 'auto',
  wordCompress: 'auto',
  wordKern: 'auto',
  wordBalanceWidths: 'auto',
  wordAdjustRightIndent: 'auto',
  hyphenLimit: 'auto',
  hyphenateCaps: 'auto',
});

export type { TriBool };
