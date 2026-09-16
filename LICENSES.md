# 随站分发的第三方内容

| 内容 | 许可 | 来源 |
| --- | --- | --- |
| iota-hit 模板（`public/packages/local-iota-hit-*.tar.gz`） | LPPL-1.3c | 本机 `../iota-hit`，原样打包 |
| omni-gb7714（`local-omni-gb7714-*.tar.gz`） | Apache-2.0 | 本机 typst local 包 |
| 其余 `@preview/*` 包（glossy、lovelace、algorithmic、quan、auto-pinyin、zhconv、auto-bihua、glotter、jurlstify、mitex、valkyrie） | 各自的许可，见各包 `typst.toml` / LICENSE | packages.typst.org |
| Fluent UI React v9（`@fluentui/react-components`、`@fluentui/react-icons`） | MIT | github.com/microsoft/fluentui — 功能区的组件与图标 |
| `src/compiler/svgPatch.mjs`（typst.ts 的增量 SVG 补丁算法，包没导出，抄了一份） | Apache-2.0 | github.com/Myriad-Dreamin/typst.ts |
| typst.ts 编译器 / 渲染器 wasm（`vendor/`） | Apache-2.0 | github.com/Myriad-Dreamin/typst.ts 主分支自建，提交号见 `vendor/*/COMMIT` |
| Typst | Apache-2.0 | 编进 wasm 里，0.15.1 |
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
