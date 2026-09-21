import { createServer } from 'vite';
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
const { toMarkdown, fromMarkdown } = await server.ssrLoadModule('/src/editor/markdown.ts');
const T = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const doc = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 1, en: 'Introduction', label: 'sec:intro', numbered: true }, content: [T('绪论')] },
  { type: 'heading', attrs: { level: 2, en: '', label: '', numbered: false }, content: [T('不编号的节')] },
  { type: 'paragraph', content: [T('普通'), T('加粗', [{ type: 'bold' }]), T('斜', [{ type: 'italic' }]), T('删', [{ type: 'strike' }]), T('码 `x`', [{ type: 'code' }]), T('下划', [{ type: 'underline' }]), T('2', [{ type: 'subscript' }]), T('n', [{ type: 'superscript' }]), T('高亮', [{ type: 'highlight', attrs: { color: '#ffff00' } }]), T('红', [{ type: 'textColor', attrs: { color: '#ff0000' } }]), T('黑体', [{ type: 'fontFamily', attrs: { role: 'heiti' } }]), T('三号', [{ type: 'fontSize', attrs: { size: 'sanhao' } }]), T('链', [{ type: 'link', attrs: { href: 'https://a.b/c?d=1' } }])] },
  { type: 'paragraph', attrs: { noIndent: true }, content: [T('公式'), { type: 'mathInline', attrs: { src: 'x_1^2', mode: 'latex' } }, T('与'), { type: 'mathInline', attrs: { src: 'eta^2', mode: 'typst' } }, T('，引'), { type: 'cite', attrs: { keys: 'a1,b2' } }, { type: 'cite', attrs: { keys: 'c3', form: 'prose', supplement: 'p. 15' } }, T('，见'), { type: 'ref', attrs: { target: 'fig:x' } }, T('和'), { type: 'ref', attrs: { target: 'thm:t1' } }, T('，缩略语'), { type: 'abbr', attrs: { key: 'FEM' } }, T('，脚注'), { type: 'footnote', attrs: { text: '注 [a] 文' } }, T('，索引'), { type: 'idx', attrs: { text: '关键词' } }, T('，空'), { type: 'ccwd', attrs: { n: 2 } }, T('格'), { type: 'hardBreak' }, T('换行后')] },
  { type: 'figure', attrs: { image: 'a.png', width: 10, caption: '一张图', captionEn: 'A figure', label: 'fig:x', placement: 'none', breakable: 'auto', subs: '[]', columns: 2, subMode: 'under', notes: JSON.stringify([{ lead: '', text: '图注一条' }, { lead: '资料来源', text: '文献' }]) } },
  { type: 'figure', attrs: { image: 'a.png', width: 8, caption: '总题', captionEn: 'Total', label: 'fig:sub', placement: 'none', breakable: 'auto', subs: JSON.stringify([{ image: 'a.png', width: 6, caption: '子一', captionEn: 'Sub 1' }, { image: 'b.png', width: '', caption: '子二', captionEn: '' }]), columns: 0, subMode: 'under', subLabel: 'tl', subLabelFill: 'white' } },
  { type: 'equation', attrs: { src: 'E = mc^2', mode: 'latex', numbered: true, label: 'eq:e' } },
  { type: 'equation', attrs: { src: 'a + b', mode: 'typst', numbered: false, label: '' } },
  { type: 'eqdenote', attrs: { rows: JSON.stringify([{ symbol: 'E', mode: 'latex', meaning: '能量' }, { symbol: 'm', mode: 'typst', meaning: '质量：kg' }]), lead: 'auto' } },
  { type: 'tableFigure', attrs: { caption: '一张表', captionEn: 'A table', label: 'tab:t', fit: 'window', colWidth: 2.5, placement: 'none', breakable: 'auto', notes: JSON.stringify([{ lead: '无', text: '表注不带引导词' }]) }, content: [{ type: 'table', content: [
    { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { align: 'center' }, content: [{ type: 'paragraph', content: [T('甲')] }] }, { type: 'tableHeader', attrs: { align: null }, content: [{ type: 'paragraph', content: [T('乙')] }] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', attrs: { align: 'center' }, content: [{ type: 'paragraph', content: [T('第一行'), { type: 'hardBreak' }, T('第二行')] }] }, { type: 'tableCell', attrs: { align: null }, content: [{ type: 'paragraph', content: [T('a | b')] }] }] },
  ] }] },
  { type: 'codeBlock', attrs: { language: 'python' }, content: [T('print(1)')] },
  { type: 'codeFigure', attrs: { caption: '清单', captionEn: 'Listing', label: 'lst:l' }, content: [{ type: 'codeBlock', attrs: { language: 'c' }, content: [T('int x;\nreturn x;')] }] },
  { type: 'algorithm', attrs: { caption: '算法', captionEn: 'Algo', label: 'alg:a', io: JSON.stringify(['输入：数据 D', '输出：模型 M']), lines: JSON.stringify([{ text: '初始化', level: 0 }, { text: 'for 每个样本', level: 0 }, { text: '更新参数', level: 1 }, { text: '返回 M', level: 0 }]) } },
  { type: 'theorem', attrs: { kind: 'lemma', note: 'Euler', label: 'thm:t1' }, content: [{ type: 'paragraph', content: [T('设 '), { type: 'mathInline', attrs: { src: 'n>1', mode: 'latex' } }] }, { type: 'equation', attrs: { src: 'x=1', mode: 'latex', numbered: true, label: '' } }] },
  { type: 'theorem', attrs: { kind: 'proof', note: '', label: '' }, content: [{ type: 'paragraph', content: [T('显然。')] }] },
  { type: 'pageBreak' },
  { type: 'blockquote', content: [{ type: 'paragraph', content: [T('引文')] }] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [T('一')] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [T('二')] }] }] },
  { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [T('三')] }] }] },
  { type: 'horizontalRule' },
] };
const md = toMarkdown(doc);
console.log(md); console.log('────');
const back = fromMarkdown(md, true);
console.log('types:', back.content.map((n) => n.type).join(' '));
const strip = (n) => JSON.parse(JSON.stringify(n, (k, v) => (k === 'uid' ? undefined : v)));
const DEF = { heading: { en: '', label: '', numbered: true, openright: 'auto', spread: 'auto' }, paragraph: { noIndent: false }, figure: { width: 8, caption: '', captionEn: '', label: '', placement: 'none', breakable: 'auto', subs: '[]', columns: 2, subMode: 'under', subLabel: 'none', subLabelFill: 'black', notes: '[]' }, equation: { mode: 'latex', numbered: true, label: '' }, tableFigure: { caption: '', captionEn: '', label: '', placement: 'none', breakable: 'auto', fit: 'content', colWidth: 2.5, cols: null, notes: '[]' }, theorem: { note: '', label: '' }, eqdenote: { lead: 'auto' }, codeFigure: { caption: '', captionEn: '', label: '' }, algorithm: { caption: '', captionEn: '', label: '' }, orderedList: { start: 1 }, tableCell: { align: null }, tableHeader: { align: null } };
const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o;
const norm = (n) => { const x = strip(n); const walk = (o) => { if (o && typeof o === 'object') { if (o.type && DEF[o.type]) o.attrs = { ...DEF[o.type], ...(o.attrs ?? {}) }; if (o.attrs) { for (const k of Object.keys(o.attrs)) if (o.attrs[k] === undefined || o.attrs[k] === null || o.attrs[k] === '') delete o.attrs[k]; if (o.attrs) o.attrs = Object.fromEntries(Object.keys(o.attrs).sort().map((k) => [k, o.attrs[k]])); if (!Object.keys(o.attrs).length) delete o.attrs; } for (const v of Object.values(o)) walk(v); } }; walk(x); return sortKeys(x); };
let fails = 0;
doc.content.forEach((n, i) => { const a = JSON.stringify(norm(n)), b = JSON.stringify(norm(back.content[i] ?? null)); if (a !== b) { fails++; console.log(`✗ #${i} ${n.type}\n  want ${a}\n  got  ${b}`); } });
console.log(fails ? `${fails} 处不一致` : `全部 ${doc.content.length} 块回环一致`);
// 二次回环也得稳
const md2 = toMarkdown(back); if (md2 !== md) { const A = md.split('\n'), B = md2.split('\n'); A.forEach((l, i) => { if (l !== B[i]) console.log(`二次序列化第 ${i + 1} 行不同：\n  ${l}\n  ${B[i]}`); }); } else console.log('二次序列化一致');
await server.close();
