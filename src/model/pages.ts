// 可选页面排不排：三态（auto / 开 / 关）。auto 照两份指南与范例的说法——
// 谁有这一页、谁没有，写在每一条的 resolve 里；有些页只看有没有内容。
import type { ThesisDoc, Pages, Tri } from './types';
import { t } from '../i18n';

export interface PageDef {
  key: keyof Pages;
  label: string;
  hint: string;
  /** 前置 / 后置 */
  group: string;
  resolve: (doc: ThesisDoc) => { value: boolean; reason: string };
}

const graduate = (d: ThesisDoc) => d.settings.degreeLevel !== 'bachelor';
const final = (d: ThesisDoc) => d.settings.stage === 'final';
const hasBlocks = (r: { content?: any[] } | undefined) => !!r?.content?.some((n: any) => n.type !== 'paragraph' || (n.content ?? []).some((c: any) => c.type !== 'text' || (c.text ?? '').trim()));
const hasIdx = (d: ThesisDoc) => { let found = false; const walk = (n: any) => { if (n?.type === 'idx' && n.attrs?.text) found = true; for (const c of n?.content ?? []) walk(c); }; [d.body, d.appendix, d.conclusion].forEach(walk); return found; };

export const PAGE_DEFS: PageDef[] = [
  // ── 前置 ──
  { key: 'cover', group: t("前置"), label: t("封面"), hint: t("终稿使用论文封面；开题和中期文档使用报告首页。"), resolve: () => ({ value: true, reason: t("所有文档均包含封面或报告首页") }) },
  { key: 'titlepage', group: t("前置"), label: t("内封（中英文）"), hint: t("规范 2.2"), resolve: (d) => (final(d) ? { value: true, reason: t("终稿必须包含") } : { value: false, reason: t("报告不包含内封") }) },
  { key: 'abstract', group: t("前置"), label: t("摘要（中英文）"), hint: t("规范 2.3；报告不生成摘要页。"), resolve: (d) => (final(d) && (hasBlocks(d.abstractZh) || hasBlocks(d.abstractEn)) ? { value: true, reason: t("已填写摘要") } : { value: false, reason: final(d) ? t("摘要为空") : t("报告不包含摘要页") }) },
  { key: 'symbolsPage', group: t("前置"), label: t("物理量名称及符号表"), hint: t("规范 2.4"), resolve: (d) => (final(d) && d.symbols.some((s) => s.symbol.trim()) ? { value: true, reason: t("已添加符号") } : { value: false, reason: final(d) ? t("尚未添加符号") : t("报告不包含此页") }) },
  { key: 'abbreviationsPage', group: t("前置"), label: t("缩略语表"), hint: t("首次出现时自动展开"), resolve: (d) => (final(d) && d.abbreviations.some((a) => a.key.trim()) ? { value: true, reason: t("已登记缩略语") } : { value: false, reason: final(d) ? t("尚未登记缩略语") : t("报告不包含此页") }) },
  { key: 'nomenclatureMerged', group: t("前置"), label: t("符号与缩略语合成一页"), hint: t("合并或分页"), resolve: () => ({ value: true, reason: t("本文符号及缩写") }) },
  { key: 'tableOfContents', group: t("前置"), label: t("目录"), hint: t("规范 2.5：正文前必有目录"), resolve: () => ({ value: true, reason: t("规范要求") }) },
  { key: 'listOfFigures', group: t("前置"), label: t("插图索引"), hint: t("规范未列出此项"), resolve: () => ({ value: false, reason: t("规范未作要求") }) },
  { key: 'listOfTables', group: t("前置"), label: t("表格索引"), hint: t("规范未列出此项"), resolve: () => ({ value: false, reason: t("规范未作要求") }) },
  { key: 'listOfEquations', group: t("前置"), label: t("公式索引"), hint: t("规范未列出此项"), resolve: () => ({ value: false, reason: t("规范未作要求") }) },
  // ── 后置 ──
  { key: 'declarations', group: t("后置"), label: t("原创性声明与使用权限"), hint: t("指南 1.7"), resolve: (d) => (final(d) ? { value: true, reason: t("终稿必须包含") } : { value: false, reason: t("报告不包含此页") }) },
  { key: 'appendix', group: t("后置"), label: t("附录"), hint: t("“附录”部分有内容时生成"), resolve: (d) => (hasBlocks(d.appendix) ? { value: true, reason: t("附录里有内容") } : { value: false, reason: t("附录为空") }) },
  { key: 'achievements', group: t("后置"), label: t("攻读学位期间取得的成果"), hint: t("规范 1.6"), resolve: (d) => (final(d) && d.achievementEntries.length ? { value: true, reason: t("终稿且登记了成果") } : { value: false, reason: final(d) ? t("尚未登记成果") : t("报告不包含此页") }) },
  { key: 'defense', group: t("后置"), label: t("评阅人、答辩委员会与决议"), hint: t("新版研究生和博士范例包含此页，本科范例不包含。"), resolve: (d) => (final(d) && graduate(d) ? { value: true, reason: t("研究生终稿包含此页") } : { value: false, reason: graduate(d) ? t("报告不包含此页") : t("本科论文不包含此页") }) },
  { key: 'index', group: t("后置"), label: t("索引"), hint: t("规范 2.18：可选，置于论文之后"), resolve: (d) => (final(d) && hasIdx(d) ? { value: true, reason: t("正文包含索引项") } : { value: false, reason: t("可选；正文尚未标记索引项") }) },
  { key: 'resume', group: t("后置"), label: t("个人简历"), hint: t("研究生规范 2.19"), resolve: (d) => (final(d) && d.settings.degreeLevel === 'doctor' ? { value: true, reason: t("博士论文包含此项") } : { value: false, reason: d.settings.degreeLevel === 'master' ? t("全日制硕士论文不包含此项；非全日制请手动启用。") : d.settings.degreeLevel === 'bachelor' ? t("本科论文不包含此项") : t("报告不包含此页") }) },
];

export function resolvePage(doc: ThesisDoc, key: keyof Pages): { value: boolean; auto: { value: boolean; reason: string }; isAuto: boolean } {
  const raw = doc.pages[key] as Tri<boolean> | undefined;
  const def = PAGE_DEFS.find((p) => p.key === key)!;
  const auto = def.resolve(doc);
  if (raw === 'auto' || raw === undefined) return { value: auto.value, auto, isAuto: true };
  return { value: !!raw, auto, isAuto: false };
}
