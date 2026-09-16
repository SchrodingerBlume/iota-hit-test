import { t } from '../i18n';
// Typst 的长度：cm / mm / in / pt / em / %，表格列还能写 fr，段前段后能写「行」。
// 界面上一律收「数 + 单位」的字符串（"8cm"、"12pt"、"2em"、"100%"），光写数就按默认单位；
// 旧工程里存的是纯数（厘米、磅），这里也认。

export type Unit = 'cm' | 'mm' | 'in' | 'pt' | 'em' | '%' | 'fr' | 'lines';
export const ABS_UNITS: Unit[] = ['cm', 'mm', 'in', 'pt'];
export const UNIT_LABEL: Record<Unit, string> = { cm: 'cm', mm: 'mm', in: 'in', pt: 'pt', em: 'em', '%': '%', fr: 'fr', lines: t("行") };

export interface Length { value: number; unit: Unit }

const RE = /^\s*(-?\d+(?:\.\d+)?)\s*(cm|mm|in|pt|em|%|fr|行|lines)?\s*$/i;

/** 解析：数字（按默认单位）或带单位的字符串；认不出返回 null */
export function parseLength(v: unknown, defaultUnit: Unit, allowed: Unit[] = ['cm', 'mm', 'in', 'pt', 'em', '%']): Length | null {
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, unit: defaultUnit } : null;
  if (typeof v !== 'string') return null;
  const m = RE.exec(v);
  if (!m) return null;
  let unit = (m[2] ?? defaultUnit).toLowerCase() as Unit;
  if ((unit as string) === '行') unit = 'lines';
  if (!allowed.includes(unit)) return null;
  return { value: parseFloat(m[1]), unit };
}

/** 排成 Typst 写法；行数排成 (lines: n) */
export function toTypst(l: Length): string {
  const n = Number.isInteger(l.value) ? String(l.value) : String(+l.value.toFixed(3));
  return l.unit === 'lines' ? `(lines: ${n})` : `${n}${l.unit}`;
}
export const formatLength = (l: Length): string => (l.unit === 'lines' ? t("{{value}}行", { value: l.value }) : `${l.value}${l.unit}`);

/** 绝对长度换成屏幕像素（96 dpi）；em / % / fr 换不了，给 null */
export function toPx(l: Length, emPx = 16): number | null {
  switch (l.unit) {
    case 'cm': return l.value * 37.8;
    case 'mm': return l.value * 3.78;
    case 'in': return l.value * 96;
    case 'pt': return l.value * (96 / 72);
    case 'em': return l.value * emPx;
    default: return null;
  }
}

/** 图宽这类：任意长度；数就是厘米 */
export const lengthTypst = (v: unknown, defaultUnit: Unit, fallback: string, allowed?: Unit[]): string => {
  const l = parseLength(v, defaultUnit, allowed);
  return l ? toTypst(l) : fallback;
};
