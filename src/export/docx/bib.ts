// 参考文献按 GB/T 7714-2015（顺序编码）排成文字：citation-js + CSL 样式（CC BY-SA 3.0，见 licenses.txt）
import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-csl';
import csl from '../../../scripts/data/chinese-gb7714-2015-numeric.csl?raw';
import zhCN from '../../../scripts/data/locales-zh-CN.xml?raw';
import { generateBibtex } from '../../bib/bibtex';
import type { BibEntry } from '../../bib/bibtex';

let ready = false;
function init() {
  if (ready) return;
  const cfg = plugins.config.get('@csl') as any;
  cfg.styles.add('gb7714', csl);
  cfg.locales.add('zh-CN', zhCN);
  ready = true;
}

/** 按给定顺序（首次引用序）排成一条条文字，「[1] 」那个号已经在里面 */
export function formatBibliography(entries: BibEntry[], lang: 'zh' | 'en' = 'zh'): string[] {
  init();
  if (!entries.length) return [];
  const cite = new Cite(generateBibtex(entries), { forceType: '@bibtex/text' });
  const text: string = cite.format('bibliography', { format: 'text', template: 'gb7714', lang: lang === 'en' ? 'en-US' : 'zh-CN' });
  return text.split(/\n(?=\[\d+\])/).map((s) => s.trim()).filter(Boolean);
}
