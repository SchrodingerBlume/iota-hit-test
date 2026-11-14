# 随站分发的第三方内容

给访客看的整页在站上 `licenses.txt`（`npm run licenses` 由 scripts/build-licenses.mjs 生成：项目清单、修改声明、各许可证全文、Typst 的 NOTICE、各 Typst 包自己的 LICENSE；全文存 scripts/data/licenses/）。
本站的排版引擎是基于 Typst 修改的非官方版本，改过的源文件头部都注明「本文件基于 XX 修改」（typst.ts 的 lib.rs、合并的 line.rs / linebreak.rs / msword.rs、src/compiler/svgPatch.mjs）；Typst 是 Typst GmbH 的商标，站名与站标不用它。

| 内容 | 许可 | 来源 |
| --- | --- | --- |
| iota-hit 模板（`public/packages/local-iota-hit-*.tar.gz`） | LPPL-1.3c | 本机 `../iota-hit`，原样打包 |
| webR 0.6.1 / R 的 Wasm 运行时（`public/rplot/webr/`） | GPL-3.0-or-later / MIT，详见 `public/rplot/WEBR-LICENSE.md` | github.com/r-wasm/webr，固定版本原样分发 |
| cetzDevice 0.5.3.1（`public/rplot/library.data`） | GPL-3.0-or-later | github.com/SchrodingerBlume/cetzDevice，源码提交 cd8cdd701dd209757aceca22a3564a760c5b09a8；源码归档随站分发，浏览器字体测量适配见 `src/rplot/adapter.R` |
| ggplot2、ggrepel 与 R 包依赖（同一 Wasm 库内） | 各包许可，清单及声明见 `public/rplot/PACKAGES.json` / `THIRD-PARTY.txt` | repo.r-wasm.org 的 Wasm 构建；随站保留包内版权和许可文件 |
| omni-gb7714（`local-omni-gb7714-*.tar.gz`） | Apache-2.0 | 本机 typst local 包 |
| 其余 `@preview/*` 包（glossy、lovelace、algorithmic、quan、auto-pinyin、zhconv、auto-bihua、glotter、jurlstify、mitex、valkyrie） | 各自的许可，见各包 `typst.toml` / LICENSE | packages.typst.org |
| Fluent UI React v9（`@fluentui/react-components`、`@fluentui/react-icons`） | MIT | github.com/microsoft/fluentui — 功能区的组件与图标 |
| CodeMirror 6、R legacy mode 及其依赖 | MIT | codemirror.net；完整版权与许可随 `public/licenses.txt` 分发 |
| R languageserver 与可选 Wasm 包（`public/rplot/language/`） | 各包许可及 copyleft 依赖源码随站提供，见同目录 `THIRD-PARTY.txt` / `PACKAGES.json` | github.com/REditorSupport/languageserver / repo.r-wasm.org；原始二进制 SHA256 固定；浏览器 transport 与任务适配见 `src/rplot/language-service.R` |
| i18next | MIT | github.com/i18next/i18next — 界面文字层（`src/i18n`） |
| docx | MIT | github.com/dolanmiu/docx — 导出 Word 文档 |
| citation-js（含 citeproc-js） | MIT；citeproc-js CPAL-1.0 / AGPL-3.0 双许可 | citation.js.org — 导出 Word 时按 GB/T 7714 排参考文献 |
| CSL 样式 `scripts/data/chinese-gb7714-2015-numeric.csl`、区域文件 `locales-zh-CN.xml` | CC BY-SA 3.0 | github.com/citation-style-language/styles、/locales |
| `src/compiler/svgPatch.mjs`（typst.ts 的增量 SVG 补丁算法，包没导出，抄了一份） | Apache-2.0 | github.com/Myriad-Dreamin/typst.ts |
| typst.ts 编译器 / 渲染器 wasm（`vendor/`） | Apache-2.0 | github.com/Myriad-Dreamin/typst.ts 主分支自建，提交号见 `vendor/*/COMMIT` |
| Typst | Apache-2.0 | 编进 wasm 里，0.15.1 |
| typst-with-msword-linebreaks（Typst 的 Word 式断行 fork） | Apache-2.0 | 本机 `~/typst-with-msword-linebreaks`，合并补丁 `scripts/wasm-patch/typst-msword.patch` |
| Noto Serif CJK SC、Noto Sans CJK SC | SIL Open Font License 1.1 | github.com/notofonts/noto-cjk |
| FandolKai | GPL-3.0-or-later with font exception | CTAN fonts/fandol |
| TeX Gyre Termes、TeX Gyre Heros、TeX Gyre Termes Math | GUST Font License | GUST e-foundry / CTAN |
| DejaVu Sans Mono | DejaVu Fonts License（Bitstream Vera 派生） | typst-assets |

字体文件不进仓库，`scripts/fetch-fonts.sh` 从上述来源现拉。

## 符号表（scripts/data/）

- `codex-sym.txt`：来自 Typst 的 [codex](https://github.com/typst/codex) 包 0.3.0（Apache-2.0），Typst 的 `sym` 模块就是从它生成的。
- `unicode-math-table.tex`：来自 LaTeX 的 [unicode-math](https://ctan.org/pkg/unicode-math) 宏包（LPPL 1.3c），只用于生成每个符号的 LaTeX 命令名。

两者由 `scripts/build-symbols.mjs` 合成 `src/data/symbols.json`。

## 批注

- [@sereneinserenade/tiptap-comment-extension](https://github.com/sereneinserenade/tiptap-comment-extension)（MIT）：正文里圈出批注范围的 TipTap 标记。
