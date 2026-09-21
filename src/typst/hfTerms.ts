import type { Settings, HeaderTermKey } from '../model/types';

/** 模板按档给这几个词条的默认字（src/terms/built-in.typ 的 base / cover / header 桶），只为提示；不属于这一档的是 '' */
export function termDefault(s: Settings, key: HeaderTermKey): string {
  const zh = s.lang !== 'en', bach = s.degreeLevel === 'bachelor', sz = s.campus === 'shenzhen', report = s.stage !== 'final', practice = s.form === 'practice' && !bach;
  const lv = s.degreeLevel;
  const university = zh ? (sz ? (bach ? '哈尔滨工业大学深圳校区' : '哈尔滨工业大学（深圳）') : '哈尔滨工业大学') : (sz ? 'Harbin Institute of Technology, Shenzhen' : 'Harbin Institute of Technology');
  const documentType = zh
    ? (bach ? '本科毕业论文（设计）' : `${lv === 'doctor' ? '博士' : '硕士'}${practice ? '实践成果' : '学位论文'}`)
    : (bach ? "Bachelor's Thesis" : lv === 'doctor' ? (practice ? 'Doctoral Practical Results' : 'Doctoral Dissertation') : (practice ? "Master's Practical Results" : "Master's Thesis"));
  const degree = zh ? { bachelor: '学士学位', master: '硕士学位', doctor: '博士学位' }[lv] : { bachelor: 'Bachelor', master: 'Master', doctor: 'Doctoral' }[lv];
  const stage = !report ? '' : zh ? (s.stage === 'proposal' ? '开题报告' : '中期报告') : (s.stage === 'proposal' ? 'Proposal Report' : 'Interim Report');
  const reportTitle = !report ? '' : zh
    ? (sz ? (bach ? `毕业论文（设计）${stage}` : `${documentType}${stage}`) : (bach ? `${documentType}${stage}` : `${degree}${stage}`))
    : (sz ? (bach ? `Undergraduate Thesis (Design) ${stage}` : s.stage === 'proposal' ? `${documentType} Proposal` : `Mid-term Report for ${documentType}`) : (s.stage === 'proposal' ? `Thesis Proposal of ${degree} Candidates` : `Interim Report for ${documentType}`));
  return { 'header-university': university, 'header-document-type': report ? '' : documentType, 'header-degree': degree, 'header-stage': stage, 'header-report-title': reportTitle }[key];
}
