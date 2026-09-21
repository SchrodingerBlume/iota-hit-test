import type { Settings } from '../model/types';

/** 模板按档拼出来的页眉那一行（src/terms/built-in.typ 的 header 桶），只为提示。博士终稿奇数页是本章标题 */
export function headerDefault(s: Settings): { odd: string; even: string } {
  const zh = s.lang !== 'en', bach = s.degreeLevel === 'bachelor', sz = s.campus === 'shenzhen', report = s.stage !== 'final', practice = s.form === 'practice' && !bach;
  const lv = s.degreeLevel;
  const university = zh ? (sz ? (bach ? '哈尔滨工业大学深圳校区' : '哈尔滨工业大学（深圳）') : '哈尔滨工业大学') : (sz ? 'Harbin Institute of Technology, Shenzhen' : 'Harbin Institute of Technology');
  const documentType = zh
    ? (bach ? '本科毕业论文（设计）' : `${lv === 'doctor' ? '博士' : '硕士'}${practice ? '实践成果' : '学位论文'}`)
    : (bach ? "Bachelor's Thesis" : lv === 'doctor' ? (practice ? 'Doctoral Practical Results' : 'Doctoral Dissertation') : (practice ? "Master's Practical Results" : "Master's Thesis"));
  const degree = zh ? { bachelor: '学士学位', master: '硕士学位', doctor: '博士学位' }[lv] : { bachelor: 'Bachelor', master: 'Master', doctor: 'Doctoral' }[lv];
  const stage = zh ? (s.stage === 'proposal' ? '开题报告' : '中期报告') : (s.stage === 'proposal' ? 'Proposal Report' : 'Interim Report');
  const reportTitle = zh
    ? (sz ? (bach ? `毕业论文（设计）${stage}` : `${documentType}${stage}`) : (bach ? `${documentType}${stage}` : `${degree}${stage}`))
    : (sz ? (bach ? `Undergraduate Thesis (Design) ${stage}` : s.stage === 'proposal' ? `${documentType} Proposal` : `Mid-term Report for ${documentType}`) : (s.stage === 'proposal' ? `Thesis Proposal of ${degree} Candidates` : `Interim Report for ${documentType}`));
  if (!report) {
    const line = zh ? university + documentType : `${university} ${documentType}`;
    return { odd: lv === 'doctor' ? (zh ? '本章标题' : 'Chapter title') : line, even: line };
  }
  const line = zh
    ? university + (sz && !bach && s.stage === 'interim' ? stage : reportTitle)
    : (sz && bach ? reportTitle : `${reportTitle}    ${university}`);
  return { odd: line, even: line };
}

// 词条按最专的那一档查（src/axes.typ：正档记 2、按轴累加），光键名会被模板自带的 -doctor-final、
// -interim-shenzhen 这类压住；用户改的字要在他这一篇里生效，键就带上全部的轴、按 axes 的顺序
// （模板 8118927 起覆盖键按「名」认，带哪几根轴都行）
export function axisSuffix(s: Settings): string {
  const seg: string[] = [s.degreeLevel];
  if (s.degreeLevel !== 'bachelor') {
    const dt = s.degreeType === 'auto' ? (s.form === 'practice' ? 'professional' : 'academic') : s.degreeType;
    if (dt !== 'none') seg.push(dt);
  }
  seg.push(s.category, s.form, s.stage, s.campus === 'shenzhen' ? 'shenzhen' : 'harbin');
  return '-' + seg.join('-');
}

/** 这一档模板自己就分奇偶（博士终稿奇数页本章标题、偶数页校名式），「奇偶页不同」默认就勾上 */
export function headerSplit(s: Settings): boolean {
  const d = headerDefault(s);
  return d.odd !== d.even;
}
