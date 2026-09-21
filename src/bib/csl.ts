// CSL JSON（Zotero 导出 / Web API 给的那种）折成编辑器的条目。类型与字段的对应照
// omni-gb7714 的 src/parse/csl-map.typ（排版包自己读 CSL JSON 时就是这么折的），键名
// 落到编辑器表单认的那几个（journal / address / year …，见 schema.ts）
import type { BibEntry } from './bibtex';
import { newEntryId, suggestKey } from './bibtex';

export interface CslName { family?: string; given?: string; literal?: string; 'non-dropping-particle'?: string; 'dropping-particle'?: string; suffix?: string }
export interface CslDate { 'date-parts'?: (string | number)[][]; literal?: string; raw?: string }
export type CslItem = Record<string, unknown> & { id?: string | number; type?: string };

const TYPE_MAP: Record<string, string> = {
  'article-journal': 'article', 'article-magazine': 'article', 'article-newspaper': 'newspaper', article: 'article', review: 'article', 'review-book': 'article',
  book: 'book', chapter: 'inbook', 'paper-conference': 'inproceedings', thesis: 'thesis', report: 'report', patent: 'patent',
  webpage: 'online', post: 'online', 'post-weblog': 'online', dataset: 'dataset', software: 'software', standard: 'standard',
  manuscript: 'archive', entry: 'inreference', 'entry-dictionary': 'inreference', 'entry-encyclopedia': 'inreference', map: 'map',
  legislation: 'legislation', bill: 'legislation', personal_communication: 'letter', figure: 'image', graphic: 'image',
  motion_picture: 'video', broadcast: 'video', song: 'music', pamphlet: 'booklet', periodical: 'periodical', collection: 'archive',
};
const BOOKTITLE_TYPES = new Set(['incollection', 'inproceedings', 'inbook', 'inreference', 'map']);
const LANG: Record<string, string> = {
  en: 'english', 'en-us': 'english', 'en-gb': 'english', zh: 'chinese', 'zh-cn': 'chinese', 'zh-tw': 'chinese', 'zh-hans': 'chinese', 'zh-hant': 'chinese',
  fr: 'french', 'fr-fr': 'french', de: 'german', 'de-de': 'german', ja: 'japanese', ko: 'korean', ru: 'russian', es: 'spanish', it: 'italian', pt: 'portuguese', nl: 'dutch', la: 'latin',
};
const NAME_ROLES: [string, string][] = [['author', 'author'], ['editor', 'editor'], ['translator', 'translator'], ['container-author', 'bookauthor'], ['collection-editor', 'editor']];
const TEXT: [string, string][] = [['title', 'title'], ['publisher', 'publisher'], ['publisher-place', 'address'], ['collection-title', 'series'], ['genre', 'type'], ['event-title', 'eventtitle'], ['event', 'eventtitle'], ['scale', 'scale'], ['dimensions', 'dimensions'], ['volume', 'volume'], ['edition', 'edition'], ['version', 'version'], ['page', 'pages'], ['DOI', 'doi'], ['URL', 'url'], ['ISBN', 'isbn'], ['ISSN', 'issn']];

// 折成 NFC：Zotero 里常有分解式的 ñ / ü（n + 组合符），banshi 按字素数码点会炸
const str = (v: unknown) => (v == null ? '' : String(v).normalize('NFC').trim());
const CJK = /[\u3400-\u9fff]/;
const stripHtml = (s: string) => s.replace(/<\/?[^>]+>/g, '');

function name(n: CslName | string): string {
  if (typeof n === 'string') return n.trim();
  // 机构名整个是一个人：加花括号，免得里面的 and 被当分隔
  if (str(n.literal)) return /\s+and\s+|,/i.test(str(n.literal)) ? `{${str(n.literal)}}` : str(n.literal);
  const family = [str(n['non-dropping-particle'] || n['dropping-particle']), str(n.family)].filter(Boolean).join(' ');
  const given = str(n.given);
  if (!given) return family;
  // 中文名不写逗号：编辑器里就是「张三」一整个
  if (CJK.test(family) && CJK.test(given)) return family + given;
  return `${family}, ${given}${str(n.suffix) ? `, ${str(n.suffix)}` : ''}`;
}

function date(d: unknown): { year: string; full: string } | null {
  if (!d || typeof d !== 'object') return typeof d === 'string' && d.trim() ? { year: d.trim().slice(0, 4), full: d.trim() } : null;
  const parts = (d as CslDate)['date-parts']?.[0];
  if (!parts?.length) { const lit = str((d as CslDate).literal ?? (d as CslDate).raw); return lit ? { year: lit.slice(0, 4), full: lit } : null; }
  const pad = (x: string | number) => String(x).padStart(2, '0');
  const y = String(parts[0]);
  const full = [y, parts[1] && Number(parts[1]) ? pad(parts[1]) : '', parts[2] && Number(parts[2]) ? pad(parts[2]) : ''].filter(Boolean).join('-');
  return { year: y, full };
}

/** 一条 CSL JSON → 条目；key 没给的话按作者年份造（taken 里避重） */
export function cslToEntry(item: CslItem, taken: Set<string>, key?: string): BibEntry {
  let type = TYPE_MAP[str(item.type).toLowerCase()] ?? 'misc';
  if ((item.archive || item.archive_location) && ['booklet', 'misc', 'image', 'video', 'music'].includes(type)) type = 'archive';
  // Zotero 的预印本导出成 article + genre「Preprint」，编号在 number / archive_location
  if (str(item.type) === 'article' && (/preprint/i.test(str(item.genre)) || /arxiv|rxiv|ssrn|preprint|research square/i.test(str(item.publisher) + str(item.number)))) type = 'preprint';
  const f: Record<string, string> = {};
  for (const [c, b] of TEXT) { const v = str(item[c]); if (v && !f[b]) f[b] = stripHtml(v); }
  if (type === 'preprint') { if (/preprint/i.test(f.type ?? '')) delete f.type; f.eprinttype = str(item.publisher) || str(item.archive); delete f.publisher; const n = str(item.number) || str(item.archive_location); if (n) f.eprint = n.replace(/^arxiv:\s*/i, ''); }
  const container = stripHtml(str(item['container-title']));
  if (container) f[BOOKTITLE_TYPES.has(type) ? 'booktitle' : type === 'online' ? 'organization' : 'journal'] = container;
  if (type === 'thesis' && f.publisher) { f.school = f.publisher; delete f.publisher; }
  if (type === 'report' && f.publisher) { f.institution = f.publisher; delete f.publisher; }
  const archival = ['archive', 'letter', 'legislation'].includes(type);
  if (archival) { if (str(item.archive)) f.institution ??= str(item.archive); if (str(item['archive-place'])) f.address ??= str(item['archive-place']); if (str(item.archive_location)) f.number ??= str(item.archive_location); }
  if (str(item.issue)) f.number = str(item.issue);
  if (str(item.number) && type !== 'preprint') f[['article', 'newspaper'].includes(type) ? 'eid' : 'number'] = str(item.number);
  if (type === 'patent' && str(item.jurisdiction)) f.address = str(item.jurisdiction);
  const lang = str(item.language).toLowerCase();
  if (lang) f.langid = LANG[lang] ?? lang;
  if (str(item.PMID)) { f.eprint = str(item.PMID); f.eprinttype = 'pmid'; }
  for (const [c, b] of NAME_ROLES) {
    const arr = item[c];
    if (Array.isArray(arr) && arr.length && !f[b]) { const s = arr.map(name).filter(Boolean).join(' and '); if (s) f[b] = s; }
  }
  const issued = date(item.issued ?? item.submitted);
  if (issued) { f.year = issued.year; if (issued.full.length > 4) f.date = issued.full; }
  const accessed = date(item.accessed);
  if (accessed) f.urldate = accessed.full;
  const ev = date(item['event-date']);
  if (ev) f.eventdate = ev.full;
  const note = str(item.note);
  if (note) f.note = note;
  const e: BibEntry = { id: newEntryId(), key: key ?? '', type, fields: f };
  if (!e.key) e.key = suggestKey(e, taken);
  return e;
}

/** Zotero 的 CSL JSON 里 id 是 URI（…/items/ABCD1234）或纯 key；带 citation-key 的（Better BibTeX、Zotero 7 的引用键字段）优先当引用键 */
export function cslKeyOf(item: CslItem): { zotero?: string; citeKey?: string } {
  const id = str(item.id);
  const m = id.match(/(?:^|\/)([A-Z0-9]{8})$/);
  const citeKey = str(item['citation-key']) || str(item.note).match(/(?:^|\n)\s*Citation Key:\s*(\S+)/i)?.[1];
  return { zotero: m?.[1], citeKey: citeKey || undefined };
}

export function parseCslJson(text: string): CslItem[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [data];
  return arr.filter((x: unknown) => x && typeof x === 'object');
}

/** 并进现有条目：先按来源（zotero:键）对，再按引用键对；对上的换类型与字段、留 id / 引用键 / 分组，没对上的追加 */
export function mergeEntries(existing: BibEntry[], incoming: BibEntry[], group?: string): { entries: BibEntry[]; added: number; updated: number } {
  const out = [...existing];
  const bySource = new Map(existing.filter((e) => e.source).map((e) => [e.source!, e]));
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const taken = new Set(existing.map((e) => e.key));
  let added = 0, updated = 0;
  for (const n of incoming) {
    const old = (n.source && bySource.get(n.source)) || (!n.source && byKey.get(n.key)) || undefined;
    if (old) {
      out[out.indexOf(old)] = { ...old, type: n.type, fields: n.fields, source: n.source ?? old.source, group: old.group ?? group };
      updated++;
      continue;
    }
    const e = { ...n, group: n.group ?? group };
    if (taken.has(e.key)) e.key = suggestKey(e, taken);
    taken.add(e.key);
    out.push(e);
    added++;
  }
  return { entries: out, added, updated };
}

/** 一批 CSL JSON → 条目（文件导入用）：引用键优先用条目自带的 */
export function entriesFromCsl(items: CslItem[], taken: Set<string>): BibEntry[] {
  const seen = new Set(taken);
  return items.map((it) => {
    const { zotero, citeKey } = cslKeyOf(it);
    const e = cslToEntry(it, seen, citeKey && !seen.has(citeKey) ? citeKey : undefined);
    seen.add(e.key);
    if (zotero) e.source = `zotero:${zotero}`;
    return e;
  });
}
