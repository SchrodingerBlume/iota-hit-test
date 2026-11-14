// 正文引用和书目复用模板；成果列表仍使用 citation-js 的 CSL 样式（许可见 licenses.txt）。
import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-csl';
import csl from '../../../scripts/data/chinese-gb7714-2015-numeric.csl?raw';
import zhCN from '../../../scripts/data/locales-zh-CN.xml?raw';
import { generateBibtex } from '../../bib/bibtex';
import type { BibEntry } from '../../bib/bibtex';
import type { ThesisDoc } from '../../model/types';
import { escapeText } from '../../typst/pmToTypst';
import { queryTypst } from '../../compiler/client';

export interface WordCitation { keys: string[]; supplement?: string; form?: string }
export const citationId = (c: WordCitation) => JSON.stringify([c.keys, c.supplement ?? '', c.form && c.form !== 'auto' ? c.form : 'normal']);
export interface WordBibliography {
  entries: { key: string; text: string }[];
  citations: Record<string, string>;
  notes: Record<string, string[]>;
  note: boolean;
  superscript: boolean;
  hyperlinks: boolean; backRef: boolean; titleLinks: boolean; authorDate: boolean;
}
export function bibliographyProbeSource(doc: ThesisDoc, citations: WordCitation[], config: string): string {
  const known = new Set(doc.references.map(e => e.key));
  const note = /(?:\(|,)\s*(?:"note"|note):\s*"(?:foot|end)"/.test(config);
  const calls = citations.map((c, i) => {
    const keys = c.keys.filter(k => known.has(k));
    if (!keys.length) return '';
    const args = [...keys.map(k => `label(${JSON.stringify(k)})`), 'note: none', ...(c.supplement ? [`supplement: [${escapeText(c.supplement)}]`] : []), ...(c.form && !['auto', 'normal'].includes(c.form) ? [`form: ${JSON.stringify(c.form)}`] : [])];
    return `#block(word-capture("cite-${i}", _gb.cite(${args.join(', ')})))`;
  });
  return `#import "@local/omni-gb7714:0.1.0" as _gb
#set text(font: "TeX Gyre Termes", lang: ${JSON.stringify(doc.settings.lang)})
#let word-config = ${config}
#show: _gb.gb7714.with(..(word-config + (cite-completion: false, note: none)))
#let word-capture(id, body) = {
  show text: it => [#metadata((word-capture: id, text: it.text))#it]
  body
}
${calls.join('\n')}
#word-capture("references", _gb.bibliography(${JSON.stringify(generateBibtex(doc.references))}${doc.settings.bibliographyFull === false ? '' : ', full: true'}, title: none, number-placement: "inline"))
${note ? citations.flatMap((c, i) => c.keys.filter(k => known.has(k)).map((key, j) => `#block(word-capture("note-${i}-${j}", _gb.cite(label(${JSON.stringify(key)}), form: "full", note: none${c.supplement ? `, supplement: [${escapeText(c.supplement)}]` : ''})))`)).join('\n') : ''}
#context {
  let c = state("gb7714-config", (:)).get()
  let s = c.at("style", default: "numeric")
  if type(s) == dictionary { s = s.cite }
  let bib-style = c.at("style", default: "numeric")
  if type(bib-style) == dictionary { bib-style = bib-style.bib }
  [#metadata((events: query(metadata).filter(m => type(m.value) == dictionary and ("word-capture" in m.value or m.value.at("kind", default: none) == "gb7714-bib")).map(m => m.value), note: word-config.at("note", default: none), superscript: c.at("cite-form", default: auto) == "super" or (c.at("cite-form", default: auto) == auto and s == "numeric"), hyperlinks: c.at("hyperlink", default: true), backRef: c.at("back-ref", default: false), titleLinks: c.at("hyperlink-title", default: false), authorDate: bib-style == "author-date")) <word-bib-facts>]
}
`;
}

export async function queryBibliography(doc: ThesisDoc, citations: WordCitation[], config: string): Promise<WordBibliography> {
  const empty: WordBibliography = { entries: [], citations: {}, notes: {}, note: false, superscript: true, hyperlinks: false, backRef: false, titleLinks: false, authorDate: false };
  if (!doc.references.length) return empty;
  const r = await queryTypst(bibliographyProbeSource(doc, citations, config), '<word-bib-facts>');
  if (r.error || !Array.isArray(r.result) || !r.result[0]) throw new Error(r.error || '模板没有交回 Word 引用与书目');
  const f = r.result[0] as { events: { 'word-capture'?: string; text?: string; kind?: string; lbl?: string }[]; note: string | null; superscript: boolean; hyperlinks: boolean; backRef: boolean; titleLinks: boolean; authorDate: boolean };
  if (f.note === 'end') throw new Error('Word 导出暂不支持尾注，请使用脚注制或行内引用');
  const texts: Record<string, string> = {};
  const entries: WordBibliography['entries'] = [];
  const keys = doc.references.map(e => e.key).sort((a, b) => b.length - a.length);
  let entry: WordBibliography['entries'][number] | undefined;
  for (const e of f.events) {
    if (e.kind === 'gb7714-bib') {
      const key = keys.find(k => e.lbl?.endsWith(`\uE14D\uEB76\uE4E1${k}`));
      if (key) { entry = { key, text: '' }; entries.push(entry); }
      continue;
    }
    if (!e['word-capture'] || !e.text || /[\uE000-\uF8FF]/.test(e.text)) continue;
    const value = e.text.replace(/[\u200B\u2060\u00AD]/g, '');
    if (e['word-capture'] === 'references') { if (entry) entry.text += value; }
    else texts[e['word-capture']] = (texts[e['word-capture']] ?? '') + value;
  }
  return {
    entries: entries.map(e => ({ ...e, text: e.text.trim() })),
    citations: Object.fromEntries(citations.map((c, i) => [citationId(c), texts[`cite-${i}`] || '[?]'])),
    notes: Object.fromEntries(citations.map((c, i) => [citationId(c), c.keys.filter(k => keys.includes(k)).map((_key, j) => (texts[`note-${i}-${j}`] ?? '').trim())])),
    note: f.note === 'foot', superscript: f.superscript,
    hyperlinks: f.hyperlinks, backRef: f.backRef, titleLinks: f.titleLinks, authorDate: f.authorDate,
  };
}

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
