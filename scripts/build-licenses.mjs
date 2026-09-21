// 生成 public/licenses.txt：随站分发的第三方项目清单、修改声明、各许可证全文与 NOTICE。
// 全文在 scripts/data/licenses/，Typst 包各自的 LICENSE 从 public/packages/*.tar.gz 里取。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lic = (name) => fs.readFileSync(path.join(root, 'scripts', 'data', 'licenses', name), 'utf8').trim();
const pkgVersion = (name) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
const head = (file) => { try { return fs.readFileSync(path.join(root, file), 'utf8').trim().split('\n')[0]; } catch { return ''; } };
const commit = head('vendor/typst-ts-web-compiler/COMMIT').slice(0, 12);
const forkLine = head('vendor/typst-ts-web-compiler/FORK_COMMIT');
const fork = (/typst-with-msword-linebreaks ([0-9a-f]+)/.exec(forkLine) ?? [null, ''])[1].slice(0, 12);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'packages', 'manifest.json'), 'utf8'));

const rule = (s) => s + '\n' + '='.repeat(Math.min(78, [...s].length * 2)) + '\n';
const sub = (s) => '\n' + s + '\n' + '-'.repeat(Math.min(78, [...s].length * 2)) + '\n';

const out = [];
out.push(rule('iota-hit 在线编辑器 · 开源许可与声明'));
out.push(`本站（站名 iota-hit 在线编辑器，站标是自绘的齿轮「HιT」）是纯静态网页，把下列开源软件、字体与 Typst 包
打包随站分发。本页列出它们的版权与许可，并附各许可证全文与原项目的 NOTICE。

【修改声明】
本站的排版引擎不是 Typst 官方发布的版本，而是本站基于 Typst 0.15.1 修改后自行编译的非官方版本：
  · Typst（typst/typst，Apache-2.0）加上 typst-with-msword-linebreaks 这个分支的改动（par(linebreaks: "msword")，
    按 Microsoft Word 的规则断行与排字符网格），提交 ${fork}；
  · 再合并到 Myriad-Dreamin/typst.ts 所钉的 Typst 版本之上（typst.ts 提交 ${commit}），合并时改动了
    crates/typst-layout/src/inline/ 下的 line.rs、linebreak.rs、msword.rs；
  · typst.ts 的 packages/compiler/src/lib.rs 加了字形表接口（glyph_map），供预览区直接编辑用；
  · typst.ts 的 render/svg/patch.mjs 抄了一份进 src/compiler/svgPatch.mjs。
改过的源文件头部都注明了「本文件基于 XX 修改」；补丁本身在仓库的 scripts/wasm-patch/ 里，
改过的源码也随仓库公开。Typst 是 Typst GmbH 的商标；本站与 Typst GmbH、Myriad-Dreamin 及各项目作者无关，
不是它们的官方产品，也不代表它们的立场。

【本站自己的代码】
编辑器本身（src/ 下除上述抄来的文件之外）由本站作者编写，仓库 https://github.com/SchrodingerBlume/iota-hit-test 。
`);

out.push(rule('一、所用项目'));
const rows = [
  ['Typst', '0.15.1', 'Typst GmbH 及贡献者', 'Apache-2.0', 'https://github.com/typst/typst', '有修改（见上）'],
  ['typst-with-msword-linebreaks', fork, '同 Typst', 'Apache-2.0', '本机分支，Typst 的派生', '有修改（合并）'],
  ['typst.ts（编译器 / 渲染器 wasm 与 JS 胶水）', `${pkgVersion('@myriaddreamin/typst.ts')} / 提交 ${commit}`, 'Myriad Dreamin', 'Apache-2.0', 'https://github.com/Myriad-Dreamin/typst.ts', '有修改（lib.rs、patch.mjs）'],
  ['iota-hit（哈工大学位论文 Typst 模板）', `${manifest.iotaHit}（${manifest.iotaHitCommit ?? ''}）`, '模板作者', 'LPPL-1.3c', '本机 ../iota-hit，原样打包', '无'],
  ['React', pkgVersion('react'), 'Meta Platforms, Inc.', 'MIT', 'https://react.dev', '无'],
  ['Fluent UI React v9', pkgVersion('@fluentui/react-components'), 'Microsoft Corporation', 'MIT', 'https://github.com/microsoft/fluentui', '无'],
  ['Tiptap', pkgVersion('@tiptap/core'), 'Tiptap GmbH', 'MIT', 'https://tiptap.dev', '无'],
  ['tiptap-comment-extension', pkgVersion('@sereneinserenade/tiptap-comment-extension'), 'Jeet Mandaliya', 'MIT', 'https://github.com/sereneinserenade/tiptap-comment-extension', '无'],
  ['MathLive', pkgVersion('mathlive'), 'Arno Gourdol', 'MIT', 'https://cortexjs.io/mathlive', '无'],
  ['marked', pkgVersion('marked'), 'Christopher Jeffrey 及贡献者', 'MIT', 'https://marked.js.org', '无'],
  ['i18next', pkgVersion('i18next'), 'i18next', 'MIT', 'https://www.i18next.com', '无'],
  ['zustand', pkgVersion('zustand'), 'Paul Henschel', 'MIT', 'https://github.com/pmndrs/zustand', '无'],
  ['zhconv（简繁转换，zhconv-rs 编成的 wasm，第一次用才加载）', pkgVersion('zhconv'), 'Hung-I Wang（Gowee）', 'MIT / Apache-2.0 双许可；内含 MediaWiki 转换表（GPL-2.0-or-later）与 OpenCC 词典（Apache-2.0）', 'https://github.com/Gowee/zhconv-rs', '无'],
  ['@anthropic-ai/sdk（Agent 面板接 Anthropic 接口，第一次用才加载）', pkgVersion('@anthropic-ai/sdk'), 'Anthropic', 'MIT', 'https://github.com/anthropics/anthropic-sdk-typescript', '无'],
  ['pdfjs-dist（Agent 面板读 PDF 附件的文字，第一次用才加载）', pkgVersion('pdfjs-dist'), 'Mozilla', 'Apache-2.0', 'https://github.com/mozilla/pdf.js', '无'],
  ['docx（生成 Word 文档）', pkgVersion('docx'), 'Dolan Miu', 'MIT', 'https://github.com/dolanmiu/docx', '无'],
  ['citation-js（core、plugin-bibtex、plugin-csl，含 citeproc-js）', pkgVersion('@citation-js/core'), 'Lars Willighagen 等；citeproc-js: Frank Bennett', 'MIT；citeproc-js: CPAL-1.0 / AGPL-3.0 双许可（本站按 CPAL 使用）', 'https://citation.js.org', '无'],
  ['CSL 样式 china-national-standard-gb-t-7714-2015-numeric 与 zh-CN 区域文件', '', 'Citation Style Language 项目贡献者', 'CC BY-SA 3.0', 'https://github.com/citation-style-language/styles', '无（随站分发，见 scripts/data/）'],
  ['Noto Serif CJK SC、Noto Sans CJK SC', '', 'Google / Adobe', 'SIL Open Font License 1.1', 'https://github.com/notofonts/noto-cjk', '无'],
  ['FandolKai', '', 'Fandol team（Clerk Ma、Jie Su）', 'GPL-3.0 + 字体例外', 'CTAN fonts/fandol', '无'],
  ['TeX Gyre Termes、TeX Gyre Heros、TeX Gyre Termes Math', '', 'GUST e-foundry（B. Jackowski、J. M. Nowacki 等）', 'GUST Font License', 'https://www.gust.org.pl/projects/e-foundry', '无'],
  ['DejaVu Sans Mono', '', 'Bitstream, Inc.；DejaVu 的改动属公有领域', 'DejaVu Fonts License（Bitstream Vera 派生）', 'https://dejavu-fonts.github.io', '无'],
  ['Typst 符号表（codex sym.txt，用于符号面板）', '0.3.0', 'Typst GmbH', 'Apache-2.0', 'https://github.com/typst/codex', '转成 JSON'],
  ['unicode-math-table.tex（LaTeX 命令映射）', '', 'Will Robertson', 'LPPL-1.3c', 'CTAN macros/unicodetex/latex/unicode-math', '转成 JSON'],
];
for (const p of manifest.packages) if (p.namespace === 'preview' || p.name === 'omni-gb7714') rows.push([`@${p.namespace}/${p.name}`, p.version, '各自作者', '见「三」', p.namespace === 'preview' ? 'https://typst.app/universe' : '本机 typst local 包', '原样打包']);
for (const [name, ver, who, l, src, mod] of rows) {
  out.push(`· ${name}${ver ? ` ${ver}` : ''}\n    版权：${who}\n    许可：${l}\n    来源：${src}\n    修改：${mod}\n`);
}

out.push(rule('二、许可证全文与 NOTICE'));
out.push(sub('Apache License 2.0（Typst、typst.ts、codex、omni-gb7714）'));
out.push(lic('Apache-2.0.txt') + '\n');
out.push(sub('Typst 的 NOTICE（原文）'));
out.push(lic('typst-NOTICE.txt') + '\n');
out.push(sub('MIT License（各项目的版权声明）'));
for (const f of ['MIT-react.txt', 'MIT-fluentui.txt', 'MIT-tiptap.txt', 'MIT-tiptap-comment-extension.txt', 'MIT-mathlive.txt', 'MIT-marked.txt', 'MIT-i18next.txt', 'MIT-zustand.txt']) out.push(`[${f.replace(/^MIT-|\.txt$/g, '')}]\n${lic(f)}\n`);
out.push(sub('citeproc-js 的许可声明（CPAL-1.0 或 AGPL，本站按 CPAL 使用；导出 Word 时的参考文献由它按 CSL 排版）'));
out.push(lic('citeproc-LICENSE.txt') + '\n');
out.push(`本站按 CPAL 第 14 条的要求作署名：参考文献排版功能由 citeproc-js 提供（Frank Bennett，https://github.com/Juris-M/citeproc-js）。\n`);
out.push(sub('Common Public Attribution License 1.0'));
out.push(lic('CPAL-1.0.txt') + '\n');
out.push(sub('SIL Open Font License 1.1（Noto CJK）'));
out.push(lic('OFL-1.1.txt') + '\n');
out.push(sub('GNU General Public License 3.0 + 字体例外（FandolKai）'));
out.push(`Fandol 字体的 README 写明：These fonts's licensing is GPL + GPL font exception。字体例外的原文：
As a special exception, if you create a document which uses this font, and embed this font or unaltered
portions of this font into the document, this font does not by itself cause the resulting document to be
covered by the GNU General Public License. This exception does not however invalidate any other reasons
why the document might be covered by the GNU General Public License.\n`);
out.push(lic('GPL-3.0.txt') + '\n');
out.push(sub('GUST Font License（TeX Gyre）'));
out.push(lic('GUST-FONT-LICENSE.txt') + '\n');
out.push(sub('DejaVu Fonts License（含 Bitstream Vera 许可）'));
out.push(lic('DejaVu-LICENSE.txt') + '\n');
out.push(sub('LaTeX Project Public License 1.3c（iota-hit、unicode-math）'));
out.push(lic('LPPL-1.3c.txt') + '\n');

out.push(rule('三、随站分发的 Typst 包各自的 LICENSE'));
for (const p of manifest.packages) {
  const file = path.join(root, 'public', 'packages', p.file);
  const list = execFileSync('tar', ['tzf', file], { encoding: 'utf8' }).split('\n');
  const entry = list.find((e) => /(^|\/)(LICENSE|LICENCE|COPYING)[^/]*$/i.test(e));
  out.push(sub(`@${p.namespace}/${p.name} ${p.version}`));
  out.push(entry ? execFileSync('tar', ['xzOf', file, entry], { encoding: 'utf8' }).trim() + '\n' : `（包里没有 LICENSE 文件；typst.toml 写的许可：${p.name === 'iota-hit' ? 'LPPL-1.3c' : '见 typst.app/universe'}）\n`);
}

fs.writeFileSync(path.join(root, 'public', 'licenses.txt'), out.join('\n'));
console.log(`public/licenses.txt ${(fs.statSync(path.join(root, 'public', 'licenses.txt')).size / 1024).toFixed(0)} KB`);
