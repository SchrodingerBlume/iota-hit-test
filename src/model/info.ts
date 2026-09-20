// 元信息字段的登记表：标签、提示、在哪些档位下才印（不印的字段界面上折起来）。
import type { Info, LocalInfoPage, Settings } from './types';
import type { Section } from './store';
import { t } from '../i18n';

export interface InfoFieldDef {
  key: keyof Info;
  label: string;
  hint?: string;
  /** 对应的 iota-hit 参数名 */
  param: string;
  kind: 'text' | 'textarea' | 'keywords' | 'month';
  /** 多行：题目允许手写换行 \ */
  applies?: (s: Settings) => boolean;
  group: string;
  placeholder?: string;
  /** 不在「论文信息」里填而在别的节填的（关键词跟着摘要） */
  place?: Extract<Section, 'abstract'>;
}

const graduate = (s: Settings) => s.degreeLevel !== 'bachelor';
const final = (s: Settings) => s.stage === 'final';
const practice = (s: Settings) => s.form === 'practice' && s.degreeLevel !== 'bachelor';

export const INFO_FIELDS: InfoFieldDef[] = [
  { key: 'title', label: t("中文题目"), param: 'title', kind: 'textarea', group: t("题目"), hint: t("按 Enter 换行"), placeholder: t("局部多孔质气体静压轴承关键技术的研究") },
  { key: 'titleEn', label: t("英文题目"), param: 'title-en', kind: 'textarea', group: t("题目"), placeholder: 'RESEARCH ON KEY TECHNOLOGIES OF …' },
  { key: 'subtitle', label: t("中文副标题"), param: 'subtitle', kind: 'text', group: t("题目"), hint: t("选填"), applies: final },
  { key: 'subtitleEn', label: t("英文副标题"), param: 'subtitle-en', kind: 'text', group: t("题目"), applies: final },
  { key: 'keywords', label: t("中文关键词"), param: 'keywords', kind: 'keywords', group: t("题目"), place: 'abstract', hint: t("按 Enter 添加关键词"), applies: final },
  { key: 'keywordsEn', label: t("英文关键词"), param: 'keywords-en', kind: 'keywords', group: t("题目"), place: 'abstract', applies: final },

  { key: 'author', label: t("作者"), param: 'author', kind: 'text', group: t("作者与导师") },
  { key: 'authorEn', label: t("作者（英文）"), param: 'author-en', kind: 'text', group: t("作者与导师"), hint: t("留空时，英文内封使用中文姓名"), applies: final },
  { key: 'studentId', label: t("学号"), param: 'student-id', kind: 'text', group: t("作者与导师"), applies: (s) => s.degreeLevel === 'bachelor' || s.stage !== 'final' },
  { key: 'supervisor', label: t("导师"), param: 'supervisor', kind: 'text', group: t("作者与导师"), placeholder: t("×××　教授") },
  { key: 'supervisorEn', label: t("导师（英文）"), param: 'supervisor-en', kind: 'text', group: t("作者与导师"), applies: final, placeholder: 'Prof. ×××' },
  { key: 'coSupervisor', label: t("副导师"), param: 'co-supervisor', kind: 'text', group: t("作者与导师"), hint: t("选填"), applies: (s) => graduate(s) && final(s) },
  { key: 'coSupervisorEn', label: t("副导师（英文）"), param: 'co-supervisor-en', kind: 'text', group: t("作者与导师"), applies: (s) => graduate(s) && final(s) },
  { key: 'industrySupervisor', label: t("行业导师"), param: 'industry-supervisor', kind: 'text', group: t("作者与导师"), hint: t("仅适用于实践成果"), applies: (s) => practice(s) && final(s) },
  { key: 'industrySupervisorEn', label: t("行业导师（英文）"), param: 'industry-supervisor-en', kind: 'text', group: t("作者与导师"), applies: (s) => practice(s) && final(s) },

  { key: 'degreeApplied', label: t("申请学位"), param: 'degree-applied', kind: 'text', group: t("学位与单位"), placeholder: t("工学博士"), applies: (s) => graduate(s) && final(s) },
  { key: 'degreeAppliedEn', label: t("申请学位（英文）"), param: 'degree-applied-en', kind: 'text', group: t("学位与单位"), placeholder: 'Doctor of Engineering', applies: (s) => graduate(s) && final(s) },
  { key: 'speciality', label: t("学科或专业"), param: 'speciality', kind: 'text', group: t("学位与单位"), placeholder: t("机械工程"), hint: t("实践成果中显示为“类别”") },
  { key: 'specialityEn', label: t("学科（英文）"), param: 'speciality-en', kind: 'text', group: t("学位与单位"), placeholder: 'Mechanical Engineering', applies: final },
  { key: 'practiceType', label: t("实践成果类型"), param: 'practice-type', kind: 'text', group: t("学位与单位"), hint: t("例如调研报告、产品设计报告"), placeholder: t("重大装备报告"), applies: practice },
  { key: 'affiliation', label: t("所在单位"), param: 'affiliation', kind: 'text', group: t("学位与单位"), placeholder: t("机电工程学院") },
  { key: 'affiliationEn', label: t("所在单位（英文）"), param: 'affiliation-en', kind: 'text', group: t("学位与单位"), placeholder: 'School of Mechatronics Engineering', applies: final },
  { key: 'defenseDate', label: t("答辩日期"), param: 'defense-date', kind: 'month', group: t("学位与单位"), hint: t("选择答辩年月"), applies: final },
  { key: 'date', label: t("封面日期"), param: 'date', kind: 'month', group: t("学位与单位"), hint: t("留空使用当前日期") },

  { key: 'secrecy', label: t("密级"), param: 'secrecy', kind: 'text', group: t("其他信息"), placeholder: t("公开"), applies: final },
  { key: 'classifiedIndex', label: t("分类号"), param: 'classified-index', kind: 'text', group: t("其他信息"), placeholder: 'TH133.3', applies: (s) => graduate(s) && final(s) },
  { key: 'udc', label: 'U.D.C.', param: 'udc', kind: 'text', group: t("其他信息"), placeholder: '621.8', applies: (s) => graduate(s) && final(s) },
  { key: 'schoolCode', label: t("学校代码"), param: 'school-code', kind: 'text', group: t("其他信息"), placeholder: '10213', applies: (s) => graduate(s) && final(s) },
];

export const INFO_GROUPS = [t("题目"), t("作者与导师"), t("学位与单位"), t("其他信息")] as const;

/** 封面、内封上能只改这一页的字段：模板 #cover / #titlepage 收的那几个参数。报告首页只收题目 */
const LOCAL_INFO: Record<LocalInfoPage, (keyof Info)[]> = {
  cover: ['title', 'titleEn', 'subtitle', 'subtitleEn', 'author', 'date', 'practiceType'],
  titlepage: ['title', 'titleEn', 'subtitle', 'subtitleEn', 'secrecy', 'classifiedIndex', 'udc', 'schoolCode'],
};
export function localInfoFields(page: LocalInfoPage, s: Settings): InfoFieldDef[] {
  const keys: (keyof Info)[] = page === 'cover' && s.stage !== 'final' ? ['title'] : LOCAL_INFO[page];
  return INFO_FIELDS.filter((f) => keys.includes(f.key) && (!f.applies || f.applies(s)));
}

/** 预览里点到某个元信息字要切到哪一节。attr 是输入框的 data-info：只改这一页的带页名（cover.title） */
export function sectionOfInfo(attr: string): Section {
  const dot = attr.indexOf('.');
  if (dot > 0) return attr.slice(0, dot) as LocalInfoPage;
  return INFO_FIELDS.find((f) => f.key === attr)?.place ?? 'info';
}

export const defaultInfo = (): Info => ({
  title: '',
  titleEn: '',
  subtitle: '',
  subtitleEn: '',
  author: '',
  authorEn: '',
  studentId: '',
  supervisor: '',
  supervisorEn: '',
  coSupervisor: '',
  coSupervisorEn: '',
  industrySupervisor: '',
  industrySupervisorEn: '',
  degreeApplied: '',
  degreeAppliedEn: '',
  speciality: '',
  specialityEn: '',
  practiceType: '',
  affiliation: '',
  affiliationEn: '',
  defenseDate: '',
  defenseDateEn: '',
  date: '',
  keywords: [],
  keywordsEn: [],
  secrecy: '',
  classifiedIndex: '',
  udc: '',
  schoolCode: '',
});
