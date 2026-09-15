# iota4web

[iota-hit](../iota-hit)（哈尔滨工业大学学位论文模板，hithesis 的 Typst 复刻）的在线编辑器。
纯静态网页：Typst 编译器以 wasm 跑在浏览器里，没有服务器，工程与图片只存在本机浏览器的 IndexedDB。

- 左侧富文本编辑（TipTap / ProseMirror），用户不接触 Typst 源码；底层把每一种节点翻成模板认得的写法
- 右侧实时预览（typst.ts 渲染成 SVG），改一处 0.5 秒左右重排一次，导出 PDF 一键
- 校区、学位级别、交什么、阶段、学科门类、文档语言六根轴走下拉框
- 模板里那些默认为 `auto` 的布尔选项走三态开关：`关 · A · 开`，自动档时滑块居中印 A、向映射到的那一端延伸一段影子，下面一行写明「自动 → 开 · 为什么」
- 字体默认用模板的 `presets.webapp + (kaishu: "FandolKai")`，全部开源、随站分发；首次进站下载约 120 MB（wasm 30 MB + 字体 90 MB），之后存进 Cache API 离线可用
- 项目管理：多个项目各自存在浏览器里，新建时起名、选学位/阶段/校区，空白或样例起头；打开、重命名、复制、删除
- 参考文献与成果页像 Zotero 那样逐字段填，可按分组归档（编辑器与引用选择器都按组列；导出 / 导入 .bib 时分组写在 JabRef 同款的 `groups` 字段，编译用的那份不带）：14 类条目（字段照 omni-gb7714 手册 §4.3）加 iota 成果页自造的 `@project` / `@award`；.bib 照样导入、导出，也能直接改源码
- 布局照 Overleaf：左栏可收起，编辑 / 预览之间拖分隔条调比例，「编辑 / 分栏 / 预览」三种模式，预览栏带错误计数；编辑区字号可调（只影响显示）
- 编辑区像一页文档：标题「编号 + 中文名」一行、英文名一行小字；图表公式默认只显示成品样子，悬停 / 选中才浮出工具条；选中文字弹气泡菜单；预览里双击一段字，左侧定位到对应位置
- 公式可视化编辑：符号面板（结构 / 矩阵 / 希腊 / 运算 / 箭头 / 修饰，□ 占位、Tab 跳格）+ 实时预览——LaTeX 走 KaTeX，Typst 数学由页面里的 wasm 引擎编成小片段直接出 SVG
- 编辑器里直接显示章节、图、表、公式的编号，按模板的「按章编号」开关（含自动档映射）算；交叉引用也显示成「图 2-1」「式 (2-1)」
- 三态开关：开绿、关红、自动橙
- 预览一页一张纸带页码，触控板捏合 / ⌘ + 滚轮缩放，光标底下那一点不动
- 也能用**本机字体**切到模板的 `windows` / `macos` 档（模板全部标定常数按中易字体量的）：Chrome / Edge 桌面版一键读（Local Font Access API，授权一次以后自动读），别的浏览器选字体文件；字节只进页面里的 wasm，不上传，选的文件存 IndexedDB

模板本身（`../iota-hit`）**一个字都没改**，原样打成 `@local/iota-hit:0.1.0` 的包随站分发。

## 目录

```
public/
  fonts/        字体（不进 git，npm run fonts 拉；manifest.json 记大小与 typst.ts 的 font info）
  packages/     iota-hit 与它的全部依赖包，tar.gz（npm run packages 从本机 typst 缓存打；进 git）
  sample/       样例工程用的一张图
vendor/
  typst-ts-web-compiler/   typst.ts 主分支自建的编译器 wasm（Typst 0.15.1）
  typst-ts-renderer/       同一提交的渲染器 wasm；COMMIT 文件记提交号
scripts/
  bundle-packages.mjs      收集依赖闭包 → public/packages
  fetch-fonts.sh           从 Noto / CTAN / GUST 拉字体
  font-manifest.mjs        生成 public/fonts/manifest.json
  build-wasm.sh            重建 vendor/ 里的两颗 wasm
  test-compile.mjs         在 Node 里用同一颗 wasm 编一份样张（排查模板问题用）
src/
  model/        工程的数据模型、选项登记表（下拉框 / 三态开关 / auto 映射）、多项目持久化
  bib/          BibTeX 解析与生成、条目类型与字段表
  typst/        ProseMirror JSON → Typst；整份工程 → main.typ
  editor/       TipTap 扩展：带英文名的标题、插图、带题注的表、公式、引用、缩略语、脚注……
  compiler/     编译 worker（wasm + 字体 + 包）、主线程客户端、SVG 渲染
  ui/           界面
```

## 本机字体

「论文设置 → 字体方案」三档：站内开源字体（默认）、本机字体 Windows 档、本机字体 macOS 档。
后两档按模板 `presets.windows` / `presets.macos` 的家族名找字（SimSun / SimHei / KaiTi / FangSong /
Times New Roman / Arial / Consolas / Cambria Math；Songti SC / Heiti SC / Kaiti SC / STFangsong / Menlo /
STIX Two Math），再加封面校名用的楷体_GB2312、报告落款的隶书、深圳本科表单的华文新魏。

- Chromium：`window.queryLocalFonts()`，第一次点「读取本机字体」弹授权；授过权之后每次进站自动读，不用再点。
- 其他浏览器：「选择字体文件」，`.otf / .ttf / .ttc` 都行，存进 IndexedDB 下次自动装上。
- 字节只住在编译 worker 里（主线程只留名字与大小），`compiler.setFonts()` 运行时整表重建；卡片上逐角色标出装上没有，缺的由模板回落链接住。

## 为什么要自己编 wasm

npm 上的 `@myriaddreamin/typst-ts-web-compiler@0.8.0-rc3` 编进的是 Typst 0.15.0，
而 iota-hit 的 `typst.toml` 钉着 `compiler = "0.15.1"`，包检查直接拦下。
typst.ts 主分支已经升到 0.15.1，所以 `vendor/` 里的两颗 wasm 是从主分支
（提交号见 `vendor/*/COMMIT`）用 `wasm-pack` 编的，JS 胶水仍用 npm 上的 `@myriaddreamin/typst.ts@0.8.0-rc3`。
等 typst.ts 发了基于 0.15.1 的正式版，把 `package.json` 里两个 `file:./vendor/…` 改回 npm 版本即可。

## 开发

```sh
npm install
npm run fonts        # 首次：拉字体（~90 MB）并生成 manifest
npm run packages     # 模板改了之后：重新打包 iota-hit 及依赖（要本机装着 iota-hit 与 typst 缓存）
npm run dev          # http://localhost:5173
npm run build        # dist/ 就是整站，扔到任何静态托管
npm run test:compile # 不开浏览器，在 Node 里用同一颗 wasm 编一份样张到 test-out.pdf
```

`scripts/bundle-packages.mjs` 默认从 `../iota-hit` 取模板，也可以 `IOTA_HIT=/path/to/iota-hit npm run packages`。
`@preview/*` 依赖从 `~/Library/Caches/typst/packages/preview` 取，本机没有的从 packages.typst.org 下载。

## 部署

`.github/workflows/pages.yml`：push 到 `main` 就构建并发到 GitHub Pages（字体在 CI 里现拉，不进仓库）。
其他静态托管把 `dist/` 整个放上去就行；`vite.config.ts` 的 `base: './'` 让它放在任何子路径下都能跑。

服务器要能正确发 `.wasm`（`application/wasm`）与 `.tar.gz`。有的服务器会把 `.gz` 当 `Content-Encoding: gzip`
透明解压（Vite 开发服务器就是），worker 里检测到裸 tar 会自己再压回去，两种都行。

## 富文本 → Typst 的对应

| 编辑器里 | 生成的 Typst |
| --- | --- |
| H1～H4 标题（英文名；可不编号） | `= 标题#en[English]` … / `#heading(level: n, numbering: none)[…]` |
| 插图（题注、英文题注、宽度、标签） | `#figure(image("images/x.png", width: 7cm), caption: [题#en[Caption]]) <fig:…>` |
| 表（题注、表头行、合并单元格、列宽、行高、单元格对齐） | `#figure(caption: […], table(columns: (4cm, auto, …), rows: (auto, 1.2cm, …), table.header(…), table.cell(align: right + bottom)[…], …)) <tab:…>` |
| 行间公式（LaTeX / Typst；不编号） | `#mitex(\`…\`) <eq:…>` / `$ … $ <eq:…>` / `#[#set math.equation(numbering: none) …]` |
| 行内公式 | `$…$` / `#mi(\`…\`)` |
| 文献引用、交叉引用、缩略语 | `#cite(<key>)` / `#ref(<label>)`（不用 `@key`：Typst 0.15 里 `@key` 会把紧跟的汉字吞进 label） |
| 脚注、索引词、空一格 | `#footnote[…]` / `#idx[…]` / `#ccwd()` |
| 加粗、强调、下划线、上下标、等宽 | `#strong[…]` `#emph[…]` `#underline[…]` `#super[…]` `#sub[…]` `#raw("…")` |
| 空回车段（连续空段落） | `#enter(n)` |
| 列表、代码块、分页 | `- ` / `+ ` / ``` ```lang ``` / `#pagebreak()` |

纯文本里 `* _ \` # $ @ < > [ ] ~ //` 一律转义；段首长得像列表或标题的（`- ` `1. ` `= `）补反斜杠。
「⋯ → 导出 Typst 源码」能把生成的 `main.typ` 与 `.bib` 下载下来，要手工微调时用。

## auto 映射规则从哪来

`src/model/options.ts` 里每个三态开关都带一个 `resolve(settings)`，抄自模板 `src/config/settings.typ`
的默认表与 `lib.typ` 的注释——它只用于在界面上告诉用户「自动档现在等于什么」，
**真正传给 Typst 的仍是 `auto`**，生效的是模板自己算的值。模板改了规则这里要跟着改。

## 许可

编辑器代码 MIT。iota-hit 模板 LPPL-1.3c；随站分发的字体见 `LICENSES.md`。
