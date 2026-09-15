// 可选页面排不排：三态（auto / 开 / 关）。auto 照两份指南与范例的说法——
// 谁有这一页、谁没有，写在每一条的 resolve 里；有些页只看有没有内容。
import type { ThesisDoc, Pages, Tri } from './types';

export interface PageDef {
  key: keyof Pages;
  label: string;
  hint: string;
  resolve: (doc: ThesisDoc) => { value: boolean; reason: string };
}

const graduate = (d: ThesisDoc) => d.settings.degreeLevel !== 'bachelor';
const final = (d: ThesisDoc) => d.settings.stage === 'final';
const hasBlocks = (r: { content?: any[] } | undefined) => !!r?.content?.some((n: any) => n.type !== 'paragraph' || (n.content ?? []).some((c: any) => c.type !== 'text' || (c.text ?? '').trim()));
const hasIdx = (d: ThesisDoc) => { let found = false; const walk = (n: any) => { if (n?.type === 'idx' && n.attrs?.text) found = true; for (const c of n?.content ?? []) walk(c); }; [d.body, d.appendix, d.conclusion].forEach(walk); return found; };

export const PAGE_DEFS: PageDef[] = [
  { key: 'declarations', label: '原创性声明与使用权限', hint: '指南 1.7：正文是规范给死的，作者与导师签名', resolve: (d) => (final(d) ? { value: true, reason: '终稿必有' } : { value: false, reason: '报告没有这一页' }) },
  { key: 'symbolsPage', label: '物理量名称及符号表', hint: '规范 2.4：可略，采用国家标准规定符号者可略去', resolve: (d) => (final(d) && d.symbols.some((s) => s.symbol.trim()) ? { value: true, reason: '填了符号就排' } : { value: false, reason: final(d) ? '一个符号都没填' : '报告没有这一页' }) },
  { key: 'abbreviationsPage', label: '缩略语表', hint: 'hithesis 加的一页；不排也照常在正文里首次展开', resolve: (d) => (final(d) && d.abbreviations.some((a) => a.key.trim()) ? { value: true, reason: '登记了缩略语就排' } : { value: false, reason: final(d) ? '一条缩略语都没登记' : '报告没有这一页' }) },
  { key: 'nomenclatureMerged', label: '符号与缩略语合成一页', hint: '两张都排时：一页「符号及缩略语」两段，还是各印一页', resolve: () => ({ value: true, reason: 'hithesis 手册：不少论文只列一张「本文符号及缩写」' }) },
  { key: 'listOfFigures', label: '插图索引', hint: '规范里没有这一项', resolve: () => ({ value: false, reason: '规范没要求' }) },
  { key: 'listOfTables', label: '表格索引', hint: '规范里没有这一项', resolve: () => ({ value: false, reason: '规范没要求' }) },
  { key: 'listOfEquations', label: '公式索引', hint: '规范里没有这一项', resolve: () => ({ value: false, reason: '规范没要求' }) },
  { key: 'appendix', label: '附录', hint: '「附录」一节里写了内容才排', resolve: (d) => (hasBlocks(d.appendix) ? { value: true, reason: '附录里有内容' } : { value: false, reason: '附录是空的' }) },
  { key: 'achievements', label: '攻读学位期间取得的成果', hint: '本科指南 1.6 / 研究生规范 1.6 都要求列', resolve: (d) => (final(d) && d.achievementEntries.length ? { value: true, reason: '终稿且登记了成果' } : { value: false, reason: final(d) ? '还没登记成果' : '报告没有这一页' }) },
  { key: 'defense', label: '评阅人、答辩委员会与决议', hint: '新版研究生范例新增的一页，博士范例也有；本科没有', resolve: (d) => (final(d) && graduate(d) ? { value: true, reason: '研究生终稿有这一页' } : { value: false, reason: graduate(d) ? '报告没有这一页' : '本科没有这一页' }) },
  { key: 'index', label: '索引', hint: '规范 2.18：可选，置于论文之后', resolve: (d) => (final(d) && hasIdx(d) ? { value: true, reason: '正文里标了索引词' } : { value: false, reason: '可选；正文里没标索引词' }) },
  { key: 'resume', label: '个人简历', hint: '研究生规范 2.19：除全日制硕士生外，其余学生均增列；本科指南没有', resolve: (d) => (final(d) && d.settings.degreeLevel === 'doctor' ? { value: true, reason: '博士增列此项' } : { value: false, reason: d.settings.degreeLevel === 'master' ? '全日制硕士不列（非全日制请手动打开）' : d.settings.degreeLevel === 'bachelor' ? '本科没有这一项' : '报告没有这一页' }) },
];

export function resolvePage(doc: ThesisDoc, key: keyof Pages): { value: boolean; auto: { value: boolean; reason: string }; isAuto: boolean } {
  const raw = doc.pages[key] as Tri<boolean> | undefined;
  const def = PAGE_DEFS.find((p) => p.key === key)!;
  const auto = def.resolve(doc);
  if (raw === 'auto' || raw === undefined) return { value: auto.value, auto, isAuto: true };
  return { value: !!raw, auto, isAuto: false };
}
