// Word 的单位与本站用的几套字号 / 字体名，build.ts 与表单页共用
import { BorderStyle } from 'docx';

export const PT = 20;                 // 缇
export const HALF = 2;                // 半磅（字号）
export const cm = (v: number) => Math.round(v / 2.54 * 1440);
export const ZIHAO = { yihao: 26, xiaoyi: 24, erhao: 22, xiaoer: 18, sanhao: 16, xiaosan: 15, sihao: 14, xiaosi: 12, wuhao: 10.5, xiaowu: 9 };
export const FONT = { zh: 'SimSun', hei: 'SimHei', kai: 'KaiTi', en: 'Times New Roman', mono: 'Courier New' };
export const fonts = (zh = FONT.zh, en = FONT.en) => ({ ascii: en, hAnsi: en, eastAsia: zh, cs: en });
export const A4 = { width: 11906, height: 16838 };
export const NO_BORDERS = { top: { style: BorderStyle.NIL, size: 0 }, bottom: { style: BorderStyle.NIL, size: 0 }, left: { style: BorderStyle.NIL, size: 0 }, right: { style: BorderStyle.NIL, size: 0 } } as const;
export const hasCJK = (s: string) => /[　-鿿＀-￯]/.test(s);
