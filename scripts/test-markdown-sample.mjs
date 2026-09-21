import { createServer } from 'vite';
globalThis.window = { setTimeout, clearTimeout, addEventListener() {} };
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
const { toMarkdown, fromMarkdown } = await server.ssrLoadModule('/src/editor/markdown.ts');
const { sampleDoc } = await server.ssrLoadModule('/src/model/sample.ts');
const { defaultSettings } = await server.ssrLoadModule('/src/model/options.ts');
const d = sampleDoc(defaultSettings());
let bad = 0, total = 0, opaque = 0;
for (const key of ['body', 'appendix', 'abstractZh', 'conclusion']) {
  const md = toMarkdown(d[key]);
  opaque += (md.match(/```iota-node|<!--iota-/g) ?? []).length;
  const back = fromMarkdown(md, key === 'body' || key === 'appendix');
  const DEF = { heading: { en: '', label: '', numbered: true, openright: 'auto', spread: 'auto' }, paragraph: { noIndent: false }, figure: { width: 8, caption: '', captionEn: '', label: '', placement: 'none', breakable: 'auto', subs: '[]', columns: 2, subMode: 'under' }, equation: { mode: 'latex', numbered: true, label: '' }, tableFigure: { caption: '', captionEn: '', label: '', placement: 'none', breakable: 'auto', fit: 'content', colWidth: 2.5, cols: null }, theorem: { note: '', label: '' }, eqdenote: { lead: 'auto' }, codeFigure: { caption: '', captionEn: '', label: '' }, algorithm: { caption: '', captionEn: '', label: '' }, orderedList: { start: 1 }, tableCell: { align: null }, tableHeader: { align: null } };
  const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o;
  const strip = (o) => { const x = JSON.parse(JSON.stringify(o, (k, v) => (k === 'uid' ? undefined : v))); const walk = (q) => { if (q && typeof q === 'object') { if (q.type && DEF[q.type]) q.attrs = { ...DEF[q.type], ...(q.attrs ?? {}) }; if (q.attrs) for (const k of Object.keys(q.attrs)) if (q.attrs[k] == null || q.attrs[k] === '') delete q.attrs[k]; for (const v of Object.values(q)) walk(v); } }; walk(x); return sortKeys(x); };
  d[key].content.forEach((n, i) => { total++; const a = JSON.stringify(strip(n)), b = JSON.stringify(strip(back.content[i])); if (a !== b) { bad++; if (bad <= 4) { console.log(`${key} #${i} ${n.type}`); const A = a, B = b ?? ""; let k = 0; while (k < A.length && A[k] === B[k]) k++; console.log("  差异处：", A.slice(Math.max(0, k - 120), k + 120)); console.log("  →      ", B.slice(Math.max(0, k - 120), k + 120)); } } });
}
console.log(`样例：${total} 块，${bad} 块不一致，${opaque} 处不透明写法`);
await server.close();
