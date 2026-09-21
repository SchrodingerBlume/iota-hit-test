// 学校的写作指南原文给 Agent 查：按文档的校区 / 层次 / 成果形式 / 类别挑一份，目录进系统提示，条目按需读。
// 正文在 public/guides/<key>.txt（学校发的 .doc 用 textutil 转的纯文本，去掉了目录与域代码），首次用时取、之后留在内存
import type { Settings } from '../model/types';

export interface GuideDef { key: string; title: string }
export const GUIDES: GuideDef[] = [
  { key: 'g-stem', title: '哈尔滨工业大学研究生学位论文写作指南（理工类）（2025 年 3 月）' },
  { key: 'g-hss', title: '哈尔滨工业大学研究生学位论文写作指南（人文社科类）（2025 年 3 月）' },
  { key: 'p-stem', title: '哈尔滨工业大学研究生实践成果写作指南（理工类）（2025 年 3 月）' },
  { key: 'p-hss', title: '哈尔滨工业大学研究生实践成果写作指南（人文社科类）（2025 年 3 月）' },
  { key: 'b-stem', title: '哈尔滨工业大学本科毕业论文（设计）写作指南（理工类）' },
  { key: 'b-hss', title: '哈尔滨工业大学本科毕业论文（设计）写作指南（人文社科类）' },
  { key: 'sz-b-stem', title: '哈尔滨工业大学（深圳）本科毕业论文（设计）写作指南（理工类）' },
  { key: 'sz-b-hss', title: '哈尔滨工业大学（深圳）本科毕业论文（设计）写作指南（人文社科类）' },
  { key: 'sz-b-en', title: 'HIT Shenzhen Undergraduate Thesis (Design) Writing Guide (Science and Engineering)' },
];

export function guideFor(s: Settings): string {
  const hss = s.category === 'hass';
  if (s.degreeLevel === 'bachelor') {
    if (s.campus === 'shenzhen') return s.lang === 'en' && !hss ? 'sz-b-en' : hss ? 'sz-b-hss' : 'sz-b-stem';
    return hss ? 'b-hss' : 'b-stem';
  }
  const practice = s.form === 'practice';
  return `${practice ? 'p' : 'g'}-${hss ? 'hss' : 'stem'}`;
}

export interface Section { num: string; title: string; level: number; line: number }
export interface Guide { key: string; title: string; lines: string[]; sections: Section[] }
const cache = new Map<string, Promise<Guide>>();
const CN = '[一二三四五六七八九十]+';
const short = (t: string) => t.length <= 40 && !/[。；，：]$/.test(t);
function parse(lines: string[]): Section[] {
  const out: Section[] = [];
  lines.forEach((raw, i) => {
    const s = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^(\d+(?:\.\d+){0,3})\s+(\S.*)$/.exec(s)) && short(m[2]) && !/^\d+\.\d+\.\d+\.\d+/.test(m[1])) out.push({ num: m[1], title: m[2], level: m[1].split('.').length, line: i });
    else if ((m = new RegExp(`^(${CN})、(\\S.*)$`).exec(s)) && short(m[2])) out.push({ num: m[1], title: m[2], level: 1, line: i });
    else if ((m = new RegExp(`^（(${CN})）(\\S.*)$`).exec(s)) && short(m[2])) out.push({ num: `（${m[1]}）`, title: m[2], level: 2, line: i });
    else if ((m = /^(\d+)\.\s*(\S.*)$/.exec(s)) && short(m[2]) && out.length && out[out.length - 1].level >= 2 && !/^\d/.test(m[2])) out.push({ num: `${m[1]}.`, title: m[2], level: 3, line: i });
  });
  // 正文前的目录页也长得像标题：同一个号出现两次留后一次
  const last = new Map<string, number>();
  out.forEach((s, i) => last.set(`${s.level}:${s.num}`, i));
  return out.filter((s, i) => last.get(`${s.level}:${s.num}`) === i);
}
export function loadGuide(key: string): Promise<Guide> {
  const def = GUIDES.find((g) => g.key === key) ?? GUIDES[0];
  let p = cache.get(def.key);
  if (!p) {
    p = fetch(new URL(`guides/${def.key}.txt`, document.baseURI).href).then(async (r) => {
      if (!r.ok) throw new Error(`指南文件没取到（http ${r.status}）`);
      const lines = (await r.text()).split('\n');
      return { key: def.key, title: def.title, lines, sections: parse(lines) };
    });
    cache.set(def.key, p);
    p.catch(() => cache.delete(def.key));
  }
  return p;
}

export const guideToc = (g: Guide, maxLevel = 2) => g.sections.filter((s) => s.level <= maxLevel).map((s) => `${s.num} ${s.title}`).join('；');
const sectionEnd = (g: Guide, i: number) => { const s = g.sections[i]; for (let j = i + 1; j < g.sections.length; j++) if (g.sections[j].level <= s.level) return g.sections[j].line; return g.lines.length; };
export function guideSection(g: Guide, num: string): string | null {
  const want = num.trim().replace(/[()]/g, (c) => (c === '(' ? '（' : '）')).replace(/\.$/, '');
  const i = g.sections.findIndex((s) => s.num.replace(/\.$/, '') === want || `${s.num} ${s.title}` === want || s.title === want);
  if (i < 0) return null;
  return g.lines.slice(g.sections[i].line, sectionEnd(g, i)).join('\n').trim();
}
export function guideSearch(g: Guide, q: string, limit = 12): string {
  const words = q.split(/[\s，,、；;]+/).filter(Boolean);
  if (!words.length) return '';
  const hits: string[] = [];
  let cur = '';
  for (let i = 0; i < g.lines.length && hits.length < limit; i++) {
    const sec = g.sections.find((s) => s.line === i);
    if (sec) cur = `${sec.num} ${sec.title}`;
    const ln = g.lines[i].trim();
    if (ln && words.every((w) => ln.includes(w))) hits.push(`【${cur || '前言'}】${ln}`);
  }
  return hits.join('\n');
}
