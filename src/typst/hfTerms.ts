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

// 页眉那一行的词条只认模板自带的那几个键（overrides 里的键得是表里有的、或表里某键再加档），
// 所以覆盖就是把模板会选中的那一条整个换掉：按 src/axes.typ 的专度（正档 2、反档 1）挑出
// 这一篇会用的键。偶数页只有终稿有自己的一条，报告的偶数页跟奇数页
const HEADER_KEYS: Record<'zh' | 'en', string[]> = {
  zh: ['odd-final', 'odd-doctor-final', 'odd-not-final', 'odd-interim-shenzhen', 'odd-bachelor-interim-shenzhen', 'even-final'],
  en: ['odd-final', 'odd-doctor-final', 'odd-not-final', 'odd-bachelor-not-final-shenzhen', 'even-final'],
};
const AXES: [string, string[]][] = [['degree-level', ['bachelor', 'master', 'doctor']], ['degree-type', ['academic', 'professional']], ['category', ['stem', 'hass']], ['form', ['dissertation', 'practice']], ['stage', ['final', 'proposal', 'interim']], ['campus', ['harbin', 'shenzhen']]];
export function headerKeys(s: Settings): { odd: string; even: string | null } {
  const v: Record<string, string> = { 'degree-level': s.degreeLevel, category: s.category, form: s.form, stage: s.stage, campus: s.campus === 'shenzhen' ? 'shenzhen' : 'harbin' };
  if (s.degreeLevel !== 'bachelor') { const dt = s.degreeType === 'auto' ? (s.form === 'practice' ? 'professional' : 'academic') : s.degreeType; if (dt !== 'none') v['degree-type'] = dt; }
  const axisOf = (seg: string) => AXES.find(([, vs]) => vs.includes(seg))?.[0];
  const score = (key: string): number => {
    const parts = key.split('-').slice(1);
    let n = 0;
    for (let i = 0; i < parts.length; i++) {
      const neg = parts[i] === 'not';
      const seg = neg ? parts[++i] : parts[i];
      const axis = axisOf(seg)!;
      if (neg ? v[axis] === seg : v[axis] !== seg) return -1;
      n += neg ? 1 : 2;
    }
    return n;
  };
  const pick = (parity: string) => HEADER_KEYS[s.lang === 'en' ? 'en' : 'zh'].filter((k) => k.startsWith(parity + '-')).map((k) => [k, score(k)] as const).filter(([, n]) => n >= 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { odd: pick('odd')!, even: pick('even') };
}

/** 这一档模板自己就分奇偶（博士终稿奇数页本章标题、偶数页校名式），「奇偶页不同」默认就勾上 */
export function headerSplit(s: Settings): boolean {
  const d = headerDefault(s);
  return !!headerKeys(s).even && d.odd !== d.even;
}
