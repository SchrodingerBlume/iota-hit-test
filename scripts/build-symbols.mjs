// 符号库：Typst 的符号表（codex 包的 sym.txt，Typst 自己的 sym 模块就是从它生成的）与 LaTeX 的
// unicode-math 对照表合成一张 JSON——每个符号的字、Typst 名（sym.alpha）、LaTeX 命令（\alpha）、
// 类别。编辑器的符号面板从这里取；正文里存的是字本身，导出 Typst / LaTeX 时按表换写法。
//
//   node scripts/build-symbols.mjs   →  src/data/symbols.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const symTxt = fs.readFileSync(path.join(root, 'scripts/data/codex-sym.txt'), 'utf8');
const umTex = fs.readFileSync(path.join(root, 'scripts/data/unicode-math-table.tex'), 'utf8');

// LaTeX：\UnicodeMathSymbol{"0003C}{\less}{\mathrel}{less-than sign}
const latex = new Map();
for (const m of umTex.matchAll(/\\UnicodeMathSymbol\{"([0-9A-F]+)\}\{\\([A-Za-z]+)\s*\}\{\\(math[a-z]+)\}\{([^}]*)\}/g)) {
  const cp = parseInt(m[1], 16);
  if (!latex.has(cp)) latex.set(cp, { cmd: `\\${m[2]}`, cls: m[3], desc: m[4] });
}

// Typst：`// 类别.` 分组；`name char`；缩进的 `.variant char` 挂在上一个名下
const out = [];
let category = '';
let base = '';
const unescape = (s) => s.replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
for (const raw of symTxt.split('\n')) {
  const line = raw.replace(/\s+$/, '');
  if (!line) continue;
  const cm = /^\/\/\s*(.+?)\.?\s*$/.exec(line);
  if (cm) { category = cm[1]; continue; }
  const m = /^(\s*)(\.?[A-Za-z0-9.]+)(?:\s+(.+))?$/.exec(line);
  if (!m) continue;
  const [, indent, token, value] = m;
  if (!indent) base = token;
  const name = token.startsWith('.') ? base + token : token;
  if (!value) continue; // 只有变体的名（paren）
  const ch = unescape(value.trim());
  if ([...ch].length !== 1) continue; // 只要单个码点的符号（表里偶有带说明的行）
  const cp = ch.codePointAt(0);
  const lx = ch.length <= 2 && [...ch].length === 1 ? latex.get(cp) : undefined;
  // unicode-math 把希腊字母叫 \mupalpha（正体）；日常 LaTeX 写 \alpha，导出时更认这个
  const cmd = lx ? lx.cmd.replace(/^\\mup([A-Za-z]+)$/, '\\$1') : undefined;
  out.push({ n: name, c: ch, ...(lx ? { l: cmd, cls: lx.cls.replace(/^math/, '') } : {}), k: category });
}
fs.writeFileSync(path.join(root, 'src/data/symbols.json'), JSON.stringify(out));
console.log(`${out.length} symbols, ${out.filter((s) => s.l).length} with LaTeX; categories: ${[...new Set(out.map((s) => s.k))].join(' / ')}`);
