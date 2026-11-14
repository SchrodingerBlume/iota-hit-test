# iota4web

iota4web 是 [iota-hit](../iota-hit) 的浏览器端论文编辑器，面向习惯 Microsoft Word 的哈尔滨工业大学师生。编辑器提供富文本输入、页面视图、论文设置、引文与书目、批注以及 PDF、Typst、Word 导出；用户无需直接编辑 Typst 源码。

项目是纯静态网页。Typst 编译器在浏览器的 WebAssembly 环境中运行，文档、图片和本机字体均保存在当前浏览器内，不上传服务器。

## 主要功能

- Word 风格的功能区：开始、插入、引用、审阅、表格工具、图片工具和视图。
- 富文本与 Markdown 两种编辑方式，支持标题、列表、表格、图片、公式、定理环境、算法、代码、脚注、交叉引用和索引词。
- 可直接在页面视图中放置光标、选择文字和编辑内容；编辑区与预览区共用同一选区。
- 论文、版式和页面设置由 iota-hit 模板统一计算，自动档保留模板的默认规则。
- 结构化管理参考文献和成果，支持 BibTeX 导入、导出与分组。
- 批注随工程文件保存，可用于师生之间的离线审阅。
- 导出 PDF、Typst 源文件和 Word 文档（`.docx`）。
- 支持内置开源字体，也可读取 Windows 或 macOS 本机字体。

## 编辑与预览

左侧编辑区基于 TipTap 和 ProseMirror。编辑内容会转换为 iota-hit 可识别的 Typst 标记，再由 typst.ts 编译并渲染为 SVG 页面。

输入时采用三级更新策略：

1. 纯文本段落先生成局部预览，缩短按键到画面更新的等待时间。
2. 长文档优先重新编译当前章；光标进入其他章节时会预先编译该章。
3. 停止输入后重新编译全文，校准页码、目录和交叉引用。

连续输入时，预览按固定节奏更新。长文档使用两个编译线程：前台处理段落和当前章，后台重排全文。全文结果返回时，渲染器会保留当前章中较新的结果，避免预览回退。

渲染器只替换发生变化的页面，并按视口挂载页面内容，避免长文档的完整 SVG 反复参与浏览器布局。

页面视图支持直接编辑、触控板捏合缩放、`⌘` + 滚轮缩放、单页和多页显示。目录、页眉和页脚属于自动生成内容，不能在预览中直接修改。

## 文档功能

### 标题与样式

论文使用章、节、条、款四级标题；开题报告和中期报告从节级开始。右键单击正文或标题可打开段落与样式设置。修改标题样式会作用于文档中同级的全部标题，与 Word 的“修改样式”语义一致。

### 公式

LaTeX 公式使用 MathLive 可视化编辑，Typst 公式使用源码与实时预览。行间公式、行内公式和“式中”符号说明均可插入；LaTeX 公式在 Word 导出中优先转换为原生 Office 数学公式。

### 表格与图片

表格支持自动调整、表头、合并单元格、列宽、行高和对齐设置，也可从制表符文本、CSV 或 Markdown 插入。图片支持题注、英文题注、分图、宽度、位置和跨页设置。

### R 绘图

「插入 → R 绘图」可以直接写 base R、grid 或 ggplot2 绘图代码。点击「运行预览」后插入，也可点击「后台生成，继续编辑」退出窗口：原位置会出现带动画的占位图，生成结束后自动替换，期间可以继续输入。选中已有图可点「编辑 R 图」修改代码。无需手动打开或关闭 R 图形设备；支持上传数据文件，在 R 中从 `/data/文件名` 读取。画布尺寸使用厘米、字号使用 pt，并提供固定随机种子。

字号默认「自动（五号优先）」：先以五号 `10.5pt` 测量并排图；检测到可见标签重叠或裁切时，依次尝试小五 `9pt`、六号 `7.5pt`，每次重新测量和运行 R，不在生成结果上直接替换字号。达到六号仍有冲突会保留提示，供用户或 Agent 调整标签和布局。检测基于已绘制文字的包围框，不保证识别所有图形遮挡或复杂自定义节点。用户在窗口指定 pt，或在 R 中显式指定 `gpar(fontsize=...)`、`element_text(size=...)`、主题 `base_size`、文字 geom 的字号时，保留 R 的原始有效字号，不取整。旧图沿用原来的手动字号模式。

Agent 的系统提示要求：字能排下就优先五号，先调整图宽、标签换行/旋转、刻度、图例、分面或 ggrepel；没有用户明确要求时省略工具的 `pointsize`，不要写死常见小字号绕过自动模式。应按论文最终图宽生成，插入后整体缩放仍会改变物理字号；在绘图窗口修改画布尺寸并重新运行，才会按新尺寸重排。

自动模式也会抑制 base R 的 `par(mfrow/mfcol)`、`layout()` 对 `cex` 的隐式缩小；显式传入的 `cex` 保留。手动 pt 是基础字号，R 代码明确设置的相对倍率与单独字号仍按 R 语义生效。

R 输入区使用 CodeMirror，内置语法高亮、行号、缩进、括号匹配和基础补全。可点击「下载并启用 R LSP」从本站按需下载 `languageserver` 及其 Wasm 依赖，并缓存到浏览器；未启用时不下载这些包。语言服务运行在独立 webR worker 中，提供真实 R 补全、悬停函数签名和 lintr 诊断，不执行正在编辑的绘图代码，也不要求本机安装 R。它使用 languageserver 的 JSON-RPC handler，浏览器适配替换 stdio/子进程调度；桌面动态帮助和外部程序不启用。关闭 LSP 不影响基础代码编辑和绘图，下载进度沿用 R 包进度组件。

R 在浏览器的 webR 0.6.1 Wasm worker 中运行，`cetzDevice 0.5.3.1` 将绘图操作转成 CeTZ 0.5.3。文字由站内 Typst/Wasm 批量精确测量，正文和 PDF 中保留矢量图；编辑区和 Word 导出使用从同一份 CeTZ 生成的 PNG。R 代码、数据文件和生成结果随工程保存，重新打开无需重跑 R 就能显示图。

内部 CeTZ 源码作为 `rplots/<内容哈希>.typ` 旁文件自动提供给编译器，导出 Typst 工程时也会带上；用户界面不显示这些内部文件。Agent 可以调用 `r_plot` 工具直接绘图并插入，返回的图还会提供给支持看图的模型检查。

R 引擎、cetzDevice、ggplot2、ggrepel 及依赖随站分发。首次正文排版完成后，界面空闲时会在后台自动下载并预热；右下角和绘图窗口显示实际组件数、下载量与初始化状态。组件按版本缓存，不需要本机 R、服务器或跨源隔离头。代码引用额外 R 包时，从现成的 `repo.r-wasm.org` 仓库递归下载其 Wasm 依赖，显示包名、下载量和解包阶段，并缓存安装包；没有 Wasm 构建的包会说明失败原因。每张插图限一页，多面板可用 `par(mfrow=...)` 或 `patchwork`。

后台结果按节点 ID 回填，不会移动正在输入的光标；删除占位图后不会重新插入。切到另一个工程时保留结果，回到原工程再回填。失败或取消后可以重试；刷新网页会停止尚未完成的任务，但代码、数据和占位状态仍会保存，可手动继续生成。运行超时或取消会终止 R worker，下一次自动重启。图内文字独立恢复原版 Typst 的字距和段落设置，正文的 Word 兼容排版设置不再影响绘图区。

右下角后台提示可用「收起后台提示」缩成 R 小图标，点击小图标恢复进度详情；收起不会停止下载或绘图，并会记住收起状态。

### 引文与书目

参考文献按字段录入，可按分组整理。BibTeX 导入时，同一引用键的条目会更新，其余条目追加；导出时使用 JabRef 兼容的 `groups` 字段保存分组。编译和 Word 导出均按 GB/T 7714 处理参考文献。

### 文献 PDF 资料库

左侧「资料 → 资料库」或功能区「引用 → 资料库」管理真实 PDF 文件。Zotero 导入窗口默认勾选「同时下载 PDF 到资料库」，会查找文献的 PDF 附件、下载原文并按页提取文字，保留与文献引用键的关联。重复导入跳过未变化的文件，个人文库与群组文库分别识别；部分附件失败不会撤销已导入的文献。

云端下载要求 PDF 已同步至 Zotero Storage，API 密钥有对应文库及文件读取权限。仅在本机或 WebDAV 的附件不能从该云端接口取得，可用「添加 PDF」上传并关联文献。资料库支持原文预览、全文检索、按页看提取文字、下载、移除，以及将关联条目加入当前论文参考文献。

资料库单独保存在本机 IndexedDB，跨论文共用，PDF 不嵌入 `.iota.json` 工程文件。AI 通过 `library_list`、`library_search`、`library_read` 按需获取文献清单、命中片段和指定页原文；`library_render` 可将扫描件、图表或公式所在页作为图片交给模型。库中未读取的内容不会整库发送给模型，Zotero 密钥也不提供给模型。文字提取不包含 OCR，扫描件仍保留原 PDF，可按页查看。

### Markdown

Markdown 模式支持 GFM 标题、强调、列表、表格、代码块和链接，并识别以下扩展语法：

- `$…$`：行内公式
- `$$…$$`：行间公式
- `[@key]`：引文
- `@fig:label`：交叉引用
- `^[…]`：脚注
- `![题注](图片名)`：图片

无法用标准 Markdown 表达的属性保存在 `iota-attrs` 注释或 `iota-node` 代码块中，因此两种编辑方式可以往返切换。

## 字体

默认字体方案使用随站分发的开源字体。首次打开时需要下载约 120 MB 的 WebAssembly 与字体资源，随后由 Cache API 缓存，可离线使用。

“论文设置 → 字体方案”提供以下选项：

- 内置字体：Noto CJK、FandolKai、TeX Gyre 和 DejaVu Sans Mono。
- Windows 字体：宋体、黑体、楷体、仿宋、Times New Roman、Arial、Consolas 等。
- macOS 字体：宋体-简、黑体-简、楷体-简、华文仿宋、Menlo 等。

三种方案默认使用随站分发的 TeX Gyre Termes Math。若需使用 Cambria Math 或 STIX Two Math，可先在字体设置中读取本机数学字体，再从列表中选择。

Chromium 浏览器可通过 Local Font Access API 读取系统字体；其他浏览器可选择 `.otf`、`.ttf` 或 `.ttc` 文件。字体数据只交给浏览器内的编译线程，并保存在当前浏览器中。

## Word 兼容排版

预览编译器基于 Typst 0.15.1，并加入 Word 风格的中文断行实现。相关设置使用 Word 简体中文版的术语，包括：

- 兼容模式
- 字符间距控制
- 为字体调整字间距
- 平衡 SBCS 字符和 DBCS 字符
- 定义文档网格时自动调整右缩进
- 自动断字、断字区和连续断字次数

这些设置只影响站内预览；导出的 Typst 源文件仍使用原版 Typst 断行。导出 Word 文档时，对应设置会写入 `.docx` 的兼容性选项、样式和节属性。

预览引擎由 `scripts/wasm-patch/typst-msword.patch`、`compiler-glyph-map.patch` 和 `reflexo-space-kind.patch` 构建。来源提交记录在 `vendor/typst-ts-web-compiler/FORK_COMMIT` 与各 `COMMIT` 文件中。

## Word 导出

Word 文档直接由编辑器数据生成，不经过 Typst 源码转换。导出前会向 iota-hit 查询当前设置对应的样式与页面参数，再映射为 `.docx` 的样式表和节属性。

导出内容包括：

- 正文与一至四级标题样式
- 页边距、文档网格、页眉和页脚
- 目录、题注、交叉引用和书签
- 脚注、批注、表格、分图、定理环境、算法和代码清单
- GB/T 7714 参考文献
- 原生 Office 数学公式或公式图片
- 封面、内封、声明、成果和答辩决议等表单页

首次用 Word 打开导出的文档时，如出现更新域提示，请选择“是”，以生成目录页码和交叉引用结果。

## 工程结构

```text
public/
  fonts/        字体文件与清单
  packages/     iota-hit 及其 Typst 依赖包
  sample/       示例工程资源
vendor/
  typst-ts-web-compiler/   定制编译器
  typst-ts-renderer/       SVG 渲染器
scripts/
  bundle-packages.mjs      打包 Typst 依赖
  fetch-fonts.sh           下载字体
  font-manifest.mjs        生成字体清单
  build-wasm.sh            构建 WebAssembly
  test-compile.mjs         编译测试文档
src/
  bib/          BibTeX 与文献字段模型
  compiler/     编译线程、客户端与 SVG 渲染
  editor/       编辑器扩展和输入规则
  export/docx/  Word 导出
  i18n/         界面文案
  model/        工程数据、设置与持久化
  typst/        文档序列化与编号
  ui/           界面组件
```

## 开发

```sh
npm install
npm run fonts
npm run packages
npm run dev
```

常用检查：

```sh
npm run typecheck
npm run test:markdown
npm run test:library
npm run test:r-language
npm run test:projects
npm run test:compile
npm run build
```

R 绘图的浏览器集成回归：

```sh
npx playwright-core install chromium
npm run test:rplot
```

也可用 `CHROME_PATH` 指定已有 Chromium。测试使用真实 R/Wasm、CeTZ 和 Typst/Wasm，覆盖基础绘图、ggplot2/ggrepel、额外包下载与缓存、中文与数学标签、内部 `.typ` 导入、Markdown 往返、保存重开、Word 导出、Agent 插图、用户绘图窗口、后台原位回填、切工程、删除占位、失败重试以及超时恢复。原版字体度量对照另用 `TYPST_STOCK=/path/to/official/typst node scripts/test-rplot-stock.mjs` 运行，需要官方 Typst 0.15.1。

`npm run test:library` 同样需要 Chromium，也支持 `CHROME_PATH`。它以固定 Zotero API 响应驱动真实 PDF.js、IndexedDB、界面和 Agent 工具，验证重定向下载不转发密钥、附件去重、群组隔离、全文/页码读取、原页图片、扫描件、本机上传与刷新重开；不使用个人 Zotero 凭证。

更新 R/Wasm 随站资源时，先运行 `node scripts/vendor-rplot.mjs` 下载固定版本 webR 和 cetzDevice 源码；再手动运行仓库的 `Build cetzDevice for webR` 工作流，下载其 `cetzDevice-0.5.3.1-webR-0.6.1` artifact，执行 `node scripts/install-rplot-artifact.mjs <artifact解压目录>`。交叉编译脚本是 `scripts/build-rplot-wasm.R`，不依赖开发机上的 R/Wasm 工具链。

`node scripts/vendor-r-language.mjs` 更新本站可选包资源，生成 `public/rplot/language/PACKAGES.json`、带内容哈希的原始 Wasm 包、许可清单与 copyleft 依赖的对应源码；需要 curl。语言服务依赖和 patchwork 优先从本站清单安装，其他包再使用上游仓库。普通构建不重新下载这些已固定资源。

`npm run build` 生成可直接部署的 `dist/`。站点使用相对资源路径，可部署在任意子目录。服务器应以 `application/wasm` 提供 `.wasm` 文件，并正确提供 `.tar.gz` 包。

## 界面文案

界面文字集中在 `src/i18n/zh.ts`。新增文字在代码中使用 `t("…")`；执行以下命令可提取并整理词条：

```sh
node scripts/i18n-extract.mjs --write
```

如需批量润色，可修改 `zh.ts` 中词条右侧的值，再执行：

```sh
node scripts/i18n-apply.mjs
```

界面术语以 Microsoft Word 英文和简体中文资源为参照；项目特有概念再采用 iota-hit 与 Typst 的原有名称。

## 数据与备份

工程和图片保存在浏览器的 IndexedDB 中。清除站点数据、切换浏览器或更换设备都会使本地工程不可用，请定期使用“文件 → 下载副本”导出 `.iota.json` 备份。

### 本地历史

「审阅 → 本地历史」默认每 5 分钟为有改动的工程创建快照，也支持手动保存。选择快照后可查看它与当前版本的差异，或恢复整份工程；恢复前会自动创建一份「恢复前」快照。快照经 gzip 压缩后保存在浏览器的 IndexedDB 中，每个工程最多保留 80 份，图片不包含在内。

### Git

「审阅 → Git」用于提交 Typst 源文件、图片和完整工程，并可查看逐行差异或恢复版本。连接 GitHub 后可推送本地提交、拉取远端工程。连接需要仅授权当前仓库 Contents 读写权限的 fine-grained 个人访问令牌；令牌只保存在当前浏览器会话中。此功能不提供分支和暂存区。

## 许可

编辑器代码采用 MIT 许可证，iota-hit 模板采用 LPPL-1.3c。第三方软件、字体、Typst 包和修改声明见 [LICENSES.md](LICENSES.md) 以及站内生成的 `licenses.txt`。

Copyright (c) 2026 SchrodingerBlume（吴俊豪）

Typst 是 Typst GmbH 的商标；本项目与 Typst GmbH、typst.ts 及其他第三方项目作者无隶属关系。
