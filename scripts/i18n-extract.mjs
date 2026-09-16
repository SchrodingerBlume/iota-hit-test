// 把 src 里的中文界面文字换成 t("原文")，原文收进 src/i18n/zh.ts；已润色的值保留
//   node scripts/i18n-extract.mjs          只统计，跳过的写到 scripts/i18n-skipped.txt
//   node scripts/i18n-extract.mjs --write  改代码、重写 zh.ts
// 用 ts5（typescript@5）的 API：typescript@7 没有 JS 端的编译器 API
import ts from 'ts5';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const WRITE = process.argv.includes('--write');
const HAN = /[一-鿿]/;
const SKIP_DIRS = new Set(['data', 'i18n', 'typst']);
const SKIP_ATTRS = new Set(['className', 'key', 'id', 'htmlFor', 'href', 'src', 'type', 'name', 'role', 'style', 'lang', 'data-testid']);
const SKIP_CALLS = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'split', 'replace', 'test', 'match', 'log', 'warn', 'error', 'debug', 'getItem', 'setItem', 'removeItem', 'querySelector', 'querySelectorAll', 'getAttribute', 'setAttribute', 'localeCompare']);
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(d, e.name)); } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') && e.name !== 'sample.ts') files.push(path.join(d, e.name)); } })(ROOT);

const dict = new Map(); // key -> first file
const skipped = [];
let nEdits = 0, nFiles = 0;

function skipReason(node) {
  const p = node.parent;
  if (!p) return 'noparent';
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportTypeNode(p) || ts.isExternalModuleReference(p)) return 'import';
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p)) && p.name === node) return 'propname';
  if (ts.isLiteralTypeNode(p) || ts.isEnumMember(p) || ts.isComputedPropertyName(p) || ts.isElementAccessExpression(p) || ts.isCaseClause(p)) return 'type/case/index';
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return 'equality';
  if (ts.isJsxAttribute(p) && SKIP_ATTRS.has(p.name.getText())) return 'attr:' + p.name.getText();
  if (ts.isCallExpression(p) && p.arguments.includes(node)) {
    const c = p.expression;
    if (ts.isPropertyAccessExpression(c) && SKIP_CALLS.has(c.name.text)) return 'call:' + c.name.text;
    if (ts.isIdentifier(c) && (c.text === 't' || c.text === 'tx')) return 'already';
  }
  if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'RegExp') return 'regexp';
  if (ts.isTaggedTemplateExpression(p)) return 'tagged';
  return null;
}

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let hasT = false, hasTx = false;
  const cands = []; // { start, end, build(render) }
  const rel = file.replace(ROOT + '/', '');
  const key = (s) => { if (!dict.has(s)) dict.set(s, rel); return s; };
  const lit = (s) => JSON.stringify(s);
  function visit(node) {
    if (ts.isIdentifier(node)) { if (node.text === 't') hasT = true; if (node.text === 'tx') hasTx = true; }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && HAN.test(node.text)) {
      const r = skipReason(node);
      if (r) skipped.push(`${rel}: [${r}] ${node.text.slice(0, 60)}`);
      else cands.push({ start: node.getStart(sf), end: node.getEnd(), build: (T) => (ts.isJsxAttribute(node.parent) ? `{${T}(${lit(key(node.text))})}` : `${T}(${lit(key(node.text))})`) });
    } else if (ts.isTemplateExpression(node) && (HAN.test(node.head.text) || node.templateSpans.some((s) => HAN.test(s.literal.text)))) {
      const r = skipReason(node);
      if (r) skipped.push(`${rel}: [${r}] ${node.getText(sf).slice(0, 60)}`);
      else cands.push({ start: node.getStart(sf), end: node.getEnd(), build: (T, render) => {
        const names = new Set(); let k = node.head.text; const vars = [];
        node.templateSpans.forEach((s, i) => {
          const e = s.expression; let name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : `v${i}`;
          if (!/^[A-Za-z_]\w*$/.test(name) || names.has(name)) name = `v${i}`; names.add(name);
          vars.push(`${name}: ${render(e.getStart(sf), e.getEnd())}`); k += `{{${name}}}` + s.literal.text;
        });
        return `${T}(${lit(key(k))}, { ${vars.join(', ')} })`;
      } });
    } else if (ts.isJsxText(node) && HAN.test(node.text)) {
      const raw = node.text; const lines = raw.split(/\r?\n/); const out = [];
      lines.forEach((l, i) => { if (i > 0) l = l.replace(/^\s+/, ''); if (i < lines.length - 1) l = l.replace(/\s+$/, ''); if (l) out.push(l); });
      const text = out.join(' ');
      const core = text.trim();
      cands.push({ start: node.getStart(sf), end: node.getEnd(), build: (T) => `${/^\s/.test(text) ? "{' '}" : ''}{${T}(${lit(key(core))})}${/\s$/.test(text) ? "{' '}" : ''}` });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!cands.length) continue;
  const T = hasT ? (hasTx ? 'tr' : 'tx') : 't';
  cands.sort((a, b) => a.start - b.start);
  function render(a, b) {
    let s = src.slice(a, b);
    const inner = cands.filter((c) => c.start >= a && c.end <= b && !(c.start === a && c.end === b));
    const top = inner.filter((c) => !inner.some((o) => o !== c && o.start <= c.start && o.end >= c.end));
    for (const c of top.sort((x, y) => y.start - x.start)) s = s.slice(0, c.start - a) + c.build(T, render) + s.slice(c.end - a);
    return s;
  }
  nEdits += cands.length; nFiles++;
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const relImp = path.relative(path.dirname(file), path.join(ROOT, 'i18n')).replace(/\\/g, '/');
  const line = `import { ${T === 't' ? 't' : `t as ${T}`} } from '${relImp.startsWith('.') ? relImp : './' + relImp}';`;
  const cut = imports.length ? imports[imports.length - 1].getEnd() : 0;
  const out = imports.length ? render(0, cut) + '\n' + line + render(cut, src.length) : line + '\n' + render(0, src.length);
  if (WRITE) fs.writeFileSync(file, out);
}
// 词典：按首次出现的文件分组
const byFile = new Map();
for (const [k, f] of dict) (byFile.get(f) ?? byFile.set(f, []).get(f)).push(k);
const old = new Map();
try { for (const m of fs.readFileSync(path.join(ROOT, 'i18n', 'zh.ts'), 'utf8').matchAll(/^  ("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),$/gm)) old.set(JSON.parse(m[1]), JSON.parse(m[2])); } catch { /* 还没有 */ }
let z = `// 全站界面文字。左边是代码里的原文（别改），改右边的值界面就变；{{name}} 是代入的变量，照抄\n// 生成自 scripts/i18n-extract.mjs；新增文字直接在代码里写 t("…")，再在这里补一行\nconst zh: Record<string, string> = {\n`;
for (const [f, keys] of byFile) { z += `  // ── ${f}\n`; for (const k of keys) z += `  ${JSON.stringify(k)}: ${JSON.stringify(old.get(k) ?? k)},\n`; }
z += '};\nexport default zh;\n';
if (WRITE) fs.writeFileSync(path.join(ROOT, 'i18n', 'zh.ts'), z);
console.log(`files ${nFiles}, edits ${nEdits}, keys ${dict.size}, skipped ${skipped.length}`);
fs.writeFileSync(path.join(ROOT, '..', 'scripts', 'i18n-skipped.txt'), skipped.join('\n'));
