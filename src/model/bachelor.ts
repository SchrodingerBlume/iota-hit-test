import type { Settings, Lang } from './types';
import { t } from '../i18n';
import data from './bachelor-terms.json';

export const BACHELOR_TERM_TEMPLATE = data.template;
export const BACHELOR_TERM_PATCHES = data.patches;
export const BACHELOR_TITLE_SLOT = data.titleSlot;
export const comprehensiveBachelor = (s: Settings) => s.degreeLevel === 'bachelor' && s.bachelorDocumentType === 'comprehensive';
/** 只替换文种用语，保留“本科生毕业后”等正常表述。 */
export const bachelorText = (s: Settings, value: string) => comprehensiveBachelor(s) ? value.replace(/毕业(?=论文|设计)/g, '综合') : value;

export function formLabel(s: Settings, form: Settings['form']): string {
  if (s.degreeLevel !== 'bachelor') return form === 'practice' ? t('实践成果') : t('学位论文');
  if (comprehensiveBachelor(s)) return form === 'practice' ? t('综合设计') : t('综合论文');
  return form === 'practice' ? t('毕业设计') : t('毕业论文');
}

interface Term { text: string; titleSlot: boolean }
export function bachelorTerm(s: Settings, key: string, title = '', lang: Lang = 'zh'): string | undefined {
  const explicit = s.overrides?.[`${key}-${lang}`] ?? (s.lang === lang ? s.overrides?.[key] : undefined);
  if (typeof explicit === 'string') return explicit;
  const term = (data.terms[lang] as Record<string, Term>)[key];
  if (!term) return;
  const text = bachelorText(s, term.text);
  return term.titleSlot ? text.split(BACHELOR_TITLE_SLOT).join(title) : text;
}

/** 由模板原始词条生成覆盖，综合仅改变本科文种，不增加模板轴。 */
export function bachelorTermOverrides(s: Settings): Record<string, Term> {
  if (!comprehensiveBachelor(s)) return {};
  const out: Record<string, Term> = {};
  for (const lang of ['zh', 'en'] as const) {
    for (const [key, value] of Object.entries(data.terms[lang]) as [string, Term][]) {
      const text = bachelorText(s, value.text);
      if (text !== value.text) out[`${key}-${lang}`] = { ...value, text };
    }
    if (s.stage !== 'final' && s.campus === 'shenzhen') {
      const original = (data.covers as Record<string, string>)[[s.campus, s.stage, lang, s.form].join('/')];
      if (original && bachelorText(s, original) !== original) out[`cover-document-type-bachelor-shenzhen-${lang}`] = { text: bachelorText(s, original), titleSlot: false };
    }
  }
  return out;
}
