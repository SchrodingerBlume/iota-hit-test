// Word 的单位与本站用的几套字号 / 字体名，build.ts 与表单页共用
import { BorderStyle } from 'docx';

export const PT = 20;                 // 缇
export const HALF = 2;                // 半磅（字号）
export const cm = (v: number) => Math.round(v / 2.54 * 1440);
export const ZIHAO = { yihao: 26, xiaoyi: 24, erhao: 22, xiaoer: 18, sanhao: 16, xiaosan: 15, sihao: 14, xiaosi: 12, wuhao: 10.5, xiaowu: 9 };
export const FONT = { zh: 'SimSun', hei: 'SimHei', kai: 'KaiTi', en: 'Times New Roman', mono: 'Courier New' };
export const fonts = (zh = FONT.zh, en = FONT.en) => ({ ascii: en, hAnsi: en, eastAsia: zh, cs: en });
/** 中文段里的省略号、破折号、间隔号、°、× 这些「两可」的字符，Word 按 hAnsi 排就成了西文字体；
 *  中文 Word 文档的 run 都带 hint="eastAsia"，让它们跟中文字体走。含中文或这些字符的 run 才加 */
export const AMBIGUOUS = /[\u2013\u2014\u2026\u00b7\u00d7\u00f7\u00b0\u2030\u2103\u25cb\u25a1\u25b3\u2605\u2606\u201c\u201d\u2018\u2019\u3000-\u303f\uff00-\uffef]/;
export const fontsFor = (text: string, zh = FONT.zh, en = FONT.en) => (hasCJK(text) || AMBIGUOUS.test(text) ? { ...fonts(zh, en), hint: 'eastAsia' } : fonts(zh, en));
export const A4 = { width: 11906, height: 16838 };
export const NO_BORDERS = { top: { style: BorderStyle.NIL, size: 0 }, bottom: { style: BorderStyle.NIL, size: 0 }, left: { style: BorderStyle.NIL, size: 0 }, right: { style: BorderStyle.NIL, size: 0 } } as const;
export const hasCJK = (s: string) => /[　-鿿＀-￯]/.test(s);
