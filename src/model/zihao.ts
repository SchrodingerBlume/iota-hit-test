// 中文字号表（同 banshi 的 zihao，磅数一样）与行内能换的四个中文字族角色（模板的 #songti[…] 那四个入口）
import { t } from '../i18n';

export const ZIHAO: { key: string; label: string; pt: number }[] = [
  { key: 'chuhao', label: t("初号"), pt: 42 }, { key: 'xiaochu', label: t("小初"), pt: 36 },
  { key: 'yihao', label: t("一号"), pt: 26 }, { key: 'xiaoyi', label: t("小一"), pt: 24 },
  { key: 'erhao', label: t("二号"), pt: 22 }, { key: 'xiaoer', label: t("小二"), pt: 18 },
  { key: 'sanhao', label: t("三号"), pt: 16 }, { key: 'xiaosan', label: t("小三"), pt: 15 },
  { key: 'sihao', label: t("四号"), pt: 14 }, { key: 'xiaosi', label: t("小四"), pt: 12 },
  { key: 'wuhao', label: t("五号"), pt: 10.5 }, { key: 'xiaowu', label: t("小五"), pt: 9 },
  { key: 'liuhao', label: t("六号"), pt: 7.5 }, { key: 'xiaoliu', label: t("小六"), pt: 6.5 },
];

export type FontRole = 'songti' | 'heiti' | 'kaishu' | 'fangsong';
export const INLINE_FONTS: { key: FontRole; label: string }[] = [
  { key: 'songti', label: t("宋体") }, { key: 'heiti', label: t("黑体") }, { key: 'kaishu', label: t("楷体") }, { key: 'fangsong', label: t("仿宋") },
];

/** 各级段落模板默认的字号（写作指南那张表），增大 / 减小字号从这儿起步 */
export const BLOCK_SIZE: Record<string, string> = { paragraph: 'xiaosi', h1: 'xiaoer', h2: 'xiaosan', h3: 'sihao', h4: 'xiaosi' };
