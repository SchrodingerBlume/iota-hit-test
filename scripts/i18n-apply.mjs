// 将 zh.ts 中值不等于键的词条写回 t("…")，然后重新生成词条表。
//   node scripts/i18n-apply.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', 'src');
const pairs = [];
for (const m of fs.readFileSync(path.join(src, 'i18n', 'zh.ts'), 'utf8').matchAll(/^  ("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),$/gm)) { const k = JSON.parse(m[1]), v = JSON.parse(m[2]); if (k !== v) pairs.push([k, v]); }
if (!pairs.length) { console.log('没有润色过的条目'); process.exit(0); }
const vars = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
const bad = pairs.filter(([k, v]) => vars(k) !== vars(v));
if (bad.length) { for (const [k, v] of bad) console.error(`变量对不上，跳过：${k} → ${v}`); }
const ok = pairs.filter((p) => !bad.includes(p));
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) { if (!['data', 'i18n'].includes(e.name)) walk(path.join(d, e.name)); } else if (/\.tsx?$/.test(e.name)) files.push(path.join(d, e.name)); } })(src);
let n = 0;
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8'); const before = s;
  for (const [k, v] of ok) { const from = `(${JSON.stringify(k)}`; const to = `(${JSON.stringify(v)}`; s = s.split(`t${from}`).join(`t${to}`).split(`tx${from}`).join(`tx${to}`).split(`tr${from}`).join(`tr${to}`); }
  if (s !== before) { fs.writeFileSync(f, s); n++; }
}
console.log(`反写 ${ok.length} 条到 ${n} 个文件`);
execFileSync('node', [path.join(here, 'i18n-extract.mjs'), '--write'], { stdio: 'inherit' });
