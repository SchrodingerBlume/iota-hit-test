// 元信息字段的登记表：标签、提示、在哪些档位下才印（不印的字段界面上折起来）。
import type { Info, Settings } from './types';

export interface InfoFieldDef {
  key: keyof Info;
  label: string;
  hint?: string;
  /** 对应的 iota-hit 参数名 */
  param: string;
  kind: 'text' | 'textarea' | 'keywords' | 'month';
  /** 多行：题目允许手写换行 \ */
  applies?: (s: Settings) => boolean;
  group: '题目' | '作者与导师' | '学位与单位' | '内封杂项';
  placeholder?: string;
}

const graduate = (s: Settings) => s.degreeLevel !== 'bachelor';
const final = (s: Settings) => s.stage === 'final';
const practice = (s: Settings) => s.form === 'practice' && s.degreeLevel !== 'bachelor';

export const INFO_FIELDS: InfoFieldDef[] = [
  { key: 'title', label: '中文题目', param: 'title', kind: 'textarea', group: '题目', hint: '换行处直接回车，封面与报告首页会照此断行', placeholder: '局部多孔质气体静压轴承关键技术的研究' },
  { key: 'titleEn', label: '英文题目', param: 'title-en', kind: 'textarea', group: '题目', placeholder: 'RESEARCH ON KEY TECHNOLOGIES OF …' },
  { key: 'subtitle', label: '中文副题目', param: 'subtitle', kind: 'text', group: '题目', hint: '题目内容层次很多、难以简化时才有；留空不排', applies: final },
  { key: 'subtitleEn', label: '英文副题目', param: 'subtitle-en', kind: 'text', group: '题目', applies: final },
  { key: 'keywords', label: '中文关键词', param: 'keywords', kind: 'keywords', group: '题目', hint: '回车或分号分隔', applies: final },
  { key: 'keywordsEn', label: '英文关键词', param: 'keywords-en', kind: 'keywords', group: '题目', applies: final },

  { key: 'author', label: '作者', param: 'author', kind: 'text', group: '作者与导师' },
  { key: 'authorEn', label: '作者（英文）', param: 'author-en', kind: 'text', group: '作者与导师', hint: '留空则内封英文页用中文名', applies: final },
  { key: 'studentId', label: '学号', param: 'student-id', kind: 'text', group: '作者与导师', applies: (s) => s.degreeLevel === 'bachelor' || s.stage !== 'final' },
  { key: 'supervisor', label: '导师', param: 'supervisor', kind: 'text', group: '作者与导师', placeholder: '×××　教授' },
  { key: 'supervisorEn', label: '导师（英文）', param: 'supervisor-en', kind: 'text', group: '作者与导师', applies: final, placeholder: 'Prof. ×××' },
  { key: 'coSupervisor', label: '副导师', param: 'co-supervisor', kind: 'text', group: '作者与导师', hint: '无副导师不列此项，留空即可', applies: (s) => graduate(s) && final(s) },
  { key: 'coSupervisorEn', label: '副导师（英文）', param: 'co-supervisor-en', kind: 'text', group: '作者与导师', applies: (s) => graduate(s) && final(s) },
  { key: 'industrySupervisor', label: '行业导师', param: 'industry-supervisor', kind: 'text', group: '作者与导师', hint: '实践成果才有', applies: (s) => practice(s) && final(s) },
  { key: 'industrySupervisorEn', label: '行业导师（英文）', param: 'industry-supervisor-en', kind: 'text', group: '作者与导师', applies: (s) => practice(s) && final(s) },

  { key: 'degreeApplied', label: '申请学位', param: 'degree-applied', kind: 'text', group: '学位与单位', placeholder: '工学博士', applies: (s) => graduate(s) && final(s) },
  { key: 'degreeAppliedEn', label: '申请学位（英文）', param: 'degree-applied-en', kind: 'text', group: '学位与单位', placeholder: 'Doctor of Engineering', applies: (s) => graduate(s) && final(s) },
  { key: 'speciality', label: '学科 / 专业', param: 'speciality', kind: 'text', group: '学位与单位', placeholder: '机械工程', hint: '实践成果这一格印「类别」' },
  { key: 'specialityEn', label: '学科（英文）', param: 'speciality-en', kind: 'text', group: '学位与单位', placeholder: 'Mechanical Engineering', applies: final },
  { key: 'practiceType', label: '实践成果类型', param: 'practice-type', kind: 'text', group: '学位与单位', hint: '封面括号里那一截：调研报告、产品设计报告、重大装备报告……', placeholder: '重大装备报告', applies: practice },
  { key: 'affiliation', label: '所在单位', param: 'affiliation', kind: 'text', group: '学位与单位', placeholder: '机电工程学院' },
  { key: 'affiliationEn', label: '所在单位（英文）', param: 'affiliation-en', kind: 'text', group: '学位与单位', placeholder: 'School of Mechatronics Engineering', applies: final },
  { key: 'defenseDate', label: '答辩日期', param: 'defense-date', kind: 'month', group: '学位与单位', hint: '年-月，内封「答辩日期」那一格', applies: final },
  { key: 'date', label: '封面日期', param: 'date', kind: 'month', group: '学位与单位', hint: '封面落款的年月；留空取编译当天' },

  { key: 'secrecy', label: '密级', param: 'secrecy', kind: 'text', group: '内封杂项', placeholder: '公开', applies: final },
  { key: 'classifiedIndex', label: '分类号', param: 'classified-index', kind: 'text', group: '内封杂项', placeholder: 'TH133.3', applies: (s) => graduate(s) && final(s) },
  { key: 'udc', label: 'U.D.C.', param: 'udc', kind: 'text', group: '内封杂项', placeholder: '621.8', applies: (s) => graduate(s) && final(s) },
  { key: 'schoolCode', label: '学校代码', param: 'school-code', kind: 'text', group: '内封杂项', placeholder: '10213', applies: (s) => graduate(s) && final(s) },
];

export const INFO_GROUPS = ['题目', '作者与导师', '学位与单位', '内封杂项'] as const;

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
