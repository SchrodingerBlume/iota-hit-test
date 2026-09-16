# iota4web

[iota-hit](../iota-hit)（哈尔滨工业大学学位论文模板，hithesis 的 Typst 复刻）的在线编辑器。
纯静态网页：Typst 编译器以 wasm 跑在浏览器里，没有服务器，工程与图片只存在本机浏览器的 IndexedDB。

- 左侧富文本编辑（TipTap / ProseMirror），用户不接触 Typst 源码；底层把每一种节点翻成模板认得的写法
- 右侧实时预览（typst.ts 渲染成 SVG）：停手 0.13 秒就重排；编译走增量服务，渲染只补丁变了的页（按 data-tid 复用没变的 `<g>`），十几页的文档主线程每次只花几毫秒；重排落地时挪了位置的文字块从旧位置滑过去、新块淡入；导出 PDF 一键
- 论文设置搬进了功能区（照 Word 的设计 / 布局选项卡）：「论文」页是校区、学位级别、交什么、阶段、学科门类、文档语言六根轴的下拉框与字体方案（本机字体读取开对话框），「版式」页是模板的三态选项，「页面」页是前置 / 后置每一页排不排；三态项是菜单按钮，按钮上直接写着 Auto→开 这种当前值。左栏只剩内容与数据录入（元信息、摘要、正文、文献……）
- 模板里那些默认为 `auto` 的布尔选项走三态开关：`关 · A · 开`，自动档时滑块居中印 A、向映射到的那一端延伸一段影子，下面一行写明「自动 → 开 · 为什么」
- 字体默认用模板的 `presets.webapp + (kaishu: "FandolKai")`，全部开源、随站分发；首次进站下载约 120 MB（wasm 30 MB + 字体 90 MB），之后存进 Cache API 离线可用
- 项目管理：多个项目各自存在浏览器里，新建时起名、选学位/阶段/校区，空白或样例起头；打开、重命名、复制、删除
- 参考文献与成果页像 Zotero 那样逐字段填，可按分组归档（编辑器与引用选择器都按组列；导出 / 导入 .bib 时分组写在 JabRef 同款的 `groups` 字段，编译用的那份不带）：14 类条目（字段照 omni-gb7714 手册 §4.3）加 iota 成果页自造的 `@project` / `@award`；.bib 照样导入、导出，也能直接改源码
- 圆角只有一套记号（`--r-xs / --r-s / --r-m / --r-l / --r-pill`，见 app.css 顶部），全站统一调用，Fluent 主题的 borderRadius 也钉成同一组数
- 功能区用微软自家的 Fluent UI React v9（MIT，Word 网页版同一套设计语言）搭：选项卡、按钮、下拉、弹出面板、提示都是它的，品牌色按 #166183 生成 16 档色阶，明暗跟站内主题；顶栏并进功能区那一行（左边品牌与「文件」菜单：项目管理、新建、保存 / 导入工程、导出 PDF / Typst；右边状态、导出、主题）；功能区横贯左右、分组与手感照 Word（开始 / 插入 / 引用 / 表格工具 / 视图；大按钮图标在上、小按钮三个一摞、组名在底下；双击选项卡或点右端 ^ 收起，收起后点选项卡临时展开（同样把内容推下去，按完命令自动收），展开时可点「固定」；样式库带预览格子——按档给：论文是 章 / 节 / 条 / 款，开题、中期报告没有「章」、第一级就是节（1 / 1.1 / 1.1.1），款底下的「项」是「（1）」接排的段落写法，对应编号列表；插表格拖格子选大小；符号库；查找 / 替换（⌘F / ⌘H，命中高亮）；格式刷；光标进表格自动切「表格工具」页）：命令作用于当前编辑器——最近聚焦的那份富文本，或预览里正在编辑的那份；在预览里选中再按加粗照样生效，按完焦点回到预览。预览里编辑时左侧画影子光标 / 选区，两边永远指着同一处
- 布局照 Overleaf：左栏可收起，编辑 / 预览之间拖分隔条调比例，「编辑 / 分栏 / 预览」三种模式（在「视图」页），预览栏带错误计数；编辑区字号可调（只影响显示）
- 编辑区像一页文档：标题「编号 + 中文名」一行、英文名一行小字；图表公式默认只显示成品样子，悬停 / 选中才浮出工具条；选中文字弹气泡菜单
- **预览区可以直接编辑，操作逻辑照 Word**：点哪儿光标落哪儿，拖动选一段、双击选词、三击选段，直接打字（中文输入法照常）、退格、回车分段、方向键上下左右、Home / End，⌘B / I / U、⌘Z，复制粘贴；工具栏对预览里的选区同样生效。点公式、引用这类原子节点是选中，双击展开编辑；点题注、脚注文字、封面上的题目作者，对应的输入框打开、光标落到那个字。光标就是左侧编辑器的选区，两边永远一致；预览未重排前新敲的字先暂印在光标处、删掉的字当场遮掉，重排落地后暂印的字与真字形交叉淡出。退格 / 删除按字素（Alt 按词、⌘ 到行首行尾），段首段尾、贴着公式引用时并段删节点交给 ProseMirror 的键位表。目录条目与页眉页脚是回声，不在那儿改
- 公式可视化编辑：LaTeX 档是所见即所得的（MathLive）——公式本身就是编辑区，打 `/` 成分式、`^` 上标、`alpha` 变 α，Tab 跳到下一个空位，可看源码、可开屏幕键盘；Typst 档是源码 + 实时预览（页面里的 wasm 引擎编成小片段直接出 SVG，与正文同一套字体）；符号面板（结构 / 矩阵 / 希腊 / 运算 / 箭头 / 修饰）两档通用
- 公式底下的「式中　x——…」（模板的 `#eqdenote`）：一行一个符号，符号用 LaTeX / Typst，引导词可关（手动拆段时后半段用）
- 编辑器里直接显示章节、图、表、公式的编号，按模板的「按章编号」开关（含自动档映射）算；交叉引用也显示成「图 2-1」「式 (2-1)」
- 所有「auto / 值」型选项用同一种分段控件：Auto 段直接写出映射值，开绿、关红、自动橙；前置（封面、内封、摘要、符号表、缩略语表、目录、三种索引）与后置（声明、附录、成果、答辩、索引、简历）每一页排不排都是三态，自动档照指南与范例（简历「除全日制硕士生外均增列」、答辩页「研究生范例新增」……）
- 符号与缩略语页：符号表 / 缩略语表各自排不排、合并一页、次序、只列用过的、列头、说明列起点、小标题样式；缩略语条目可设印成什么、复数、是否进索引
- 关键词标签式录入，拖动（或 ⌥ + ← / →）换顺序；段落可单独设不缩进（`#par(first-line-indent: 0pt)`）；左栏可收起而编辑区不受影响
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
等 typst.ts 发了基于 0.15.1 的正式版，把 `package.json` 里两个 `file:./vendor/…` 改回 npm 版本即可——
但编译器那颗还带一个自己的小补丁（`scripts/wasm-patch/compiler-glyph-map.patch`，构建脚本自动打）：
给 `TypstCompileWorld` 加了 `glyph_map()`，把排版结果里每个字形的页码、位置、它在 `main.typ` 里的
字符区间，以及它是哪个字（首个码点、占几个字）列成一张表。预览区直接编辑靠它：序列化时给每段文字打上
记号（`src/typst/sourcemap.ts`），字形 → 所在的那段原文 → 按字对齐 → 编辑器里的 ProseMirror 位置。
按字对齐而不直接信源码偏移，是因为模板的 `show regex` 会把文本元素切片，切片后的偏移从 0 重新数，
混排了英文、数字的段落一过第一个英文词就全错。目录条目（按 introspection 标签认）与页眉页脚
（按页边距带认）标成回声，不当编辑入口。

右键一段 / 一条标题（编辑区或预览区）弹块级菜单：级别、编号、章的另起页与两字撑开（模板的
`#chapter(numbering:, openright:, spread:)`），以及「修改样式」——改的是模板样式表里这一级那一条
（`iota-hit(styles: (chapter: (align: left, …)))`），全篇同级一起变，与 Word 的「修改样式」同义；模板
刻意不给单条标题开字体口子（局部 `styles` 只接表格），这里也不越过它。图 / 表选中后有「图片工具」
「表格工具」页：浮动交给 Typst 的 `figure(placement:)`，跨页在局部套一层
`show figure.where(kind: …): set block(breakable:)`（模板默认图不拆、表可拆）。

插入页里：链接（⌘K，`#link`）；伪代码走模板的 lovelace 那一路（一行一条，Tab 缩进，题注「算法 1-1」，
可引用；lovelace 与 algorithmic 两个包里挑了列表式的 lovelace，逐行编辑天然对得上）；代码清单是带题注的
代码块（`#figure(```…```)`，框与行号照模板的 `raw-style`，不另设）；插图可以加分图（`figure.subs`），分图题
排在分图之下（`#subfigure`）或跟在图题之下连排（`#subs`），每行几张可选；插入表格有 Word 那样的对话框
（表格尺寸、“自动调整”操作、为新表格记住此尺寸）与「从文本 / Markdown 插入」。符号面板是 Typst 的整张
符号表（codex 的 `sym.txt`，1200 多个）配 unicode-math 的 LaTeX 命令，`src/data/symbols.json` 记着字 ↔
`sym.名` ↔ `\命令` 的对照，以后导出 LaTeX / Typst 按表换写法（`scripts/build-symbols.mjs` 生成）。

审阅页：批注（`@sereneinserenade/tiptap-comment-extension` 的标记圈范围，本体存在工程文件里），老师导入、
写批注、再导出，学生导入就看得见；编辑区与预览都加亮，PDF 不印。长度输入统一收 Typst 单位
（cm / mm / in / pt / em / % / fr / 行）。

预览可以每行排 1 / 2 / 3 页（视图页或预览栏），「整页」把一页缩进视口。窄屏（≤ 900px）单栏或上下叠、
左栏变抽屉、底部一条模式切换；横屏仍左右分、矮屏（≤ 520px 高）功能区默认收起；触屏两指捏合缩放。
布局只用 CSS 媒体查询（宽度 / 方向 / 高度）与 `100dvh`，没有引第三方布局库。

空回车段在预览里也能点：预览编译的 `main.typ`（与导出 PDF / 源码用的那份不同）开头多定义一个 `blanks`，
每个空段放一个透明的 ¶（`place`，不占版面），只在 `sys.inputs.preview` 下排字。「显示编辑标记」
（开始 → 段落，或视图页）把 Word 那样的 ¶ 画在覆盖层上，PDF 里没有。

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
| 式中符号注释（引导词 auto / 不印） | `#eqdenote[ / $x$: 说明 ]` / `#eqdenote(lead: none)[…]` |
| 文献引用、交叉引用、缩略语 | `#cite(<key>)` / `#ref(<label>)`（不用 `@key`：Typst 0.15 里 `@key` 会把紧跟的汉字吞进 label） |
| 脚注、索引词、空一格 | `#footnote[…]` / `#idx[…]` / `#ccwd()` |
| 加粗、强调、下划线、上下标、等宽 | `#strong[…]` `#emph[…]` `#underline[…]` `#super[…]` `#sub[…]` `#raw("…")` |
| 空回车段（连续空段落） | `#enter(n)` |
| 列表、代码块、分页 | `- ` / `+ ` / ``` ```lang ``` / `#pagebreak()` |

纯文本里 `* _ \` # $ @ < > [ ] ~ /` 一律转义（一个字对一个转义，源码映射好算）；段首长得像列表或标题的（`- ` `1. ` `= `）补反斜杠。
「⋯ → 导出 Typst 源码」能把生成的 `main.typ` 与 `.bib` 下载下来，要手工微调时用。

## auto 映射规则从哪来

`src/model/options.ts` 里每个三态开关都带一个 `resolve(settings)`，抄自模板 `src/config/settings.typ`
的默认表与 `lib.typ` 的注释——它只用于在界面上告诉用户「自动档现在等于什么」，
**真正传给 Typst 的仍是 `auto`**，生效的是模板自己算的值。模板改了规则这里要跟着改。

## 许可

编辑器代码 MIT。iota-hit 模板 LPPL-1.3c；随站分发的字体见 `LICENSES.md`。
