// Fluent UI（微软自家的 React 组件库，Word 网页版同一套设计语言）的主题：品牌色用 hiTouyingBeamer 的
// #166183，按 Fluent 的 16 档色阶生成；明暗跟站内主题走。
import { createLightTheme, createDarkTheme, type BrandVariants, type Theme } from '@fluentui/react-components';

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  const f = (p: number, q: number, t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const c = (t: number) => Math.round(f(p, q, t) * 255).toString(16).padStart(2, '0');
  return `#${c(h + 1 / 3)}${c(h)}${c(h - 1 / 3)}`;
}

/** 从一个主色生成 Fluent 的 16 档品牌色阶（80 档 = 主色本身） */
export function brandRamp(hex: string): BrandVariants {
  const [h, s] = hexToHsl(hex);
  const keys = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160] as const;
  const L = [0.05, 0.09, 0.13, 0.17, 0.21, 0.25, 0.28, 0.30, 0.36, 0.43, 0.51, 0.60, 0.70, 0.80, 0.89, 0.95];
  const out: Record<number, string> = {};
  keys.forEach((k, i) => { out[k] = hslToHex(h, Math.min(1, s * (i > 8 ? 0.85 : 1)), L[i]); });
  return out as unknown as BrandVariants;
}

const brand = brandRamp('#166183');
/** 与 app.css 里 --r-xs / --r-s / --r-m / --r-l 同一组数：Fluent 的按钮、输入框走 Medium，弹层走 Large */
const radii = { borderRadiusNone: '0', borderRadiusSmall: '2px', borderRadiusMedium: '4px', borderRadiusLarge: '8px', borderRadiusXLarge: '12px', borderRadiusCircular: '999px' } as const;
const font = { fontFamilyBase: 'var(--sans)' } as const;
export const fluentLight: Theme = { ...createLightTheme(brand), ...radii, ...font };
export const fluentDark: Theme = { ...createDarkTheme(brand), ...radii, ...font };
