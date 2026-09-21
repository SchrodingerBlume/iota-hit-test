# iota4web

iota4web 是 [iota-hit](../iota-hit) 的浏览器端论文编辑器，面向习惯 Microsoft Word 的哈尔滨工业大学师生。编辑器提供富文本输入、页面视图、论文设置、引文与书目、批注以及 PDF、Typst、Word 导出；用户无需直接编辑 Typst 源码。

项目是纯静态网页。Typst 编译器在浏览器的 WebAssembly 环境中运行，文档、图片和本机字体均保存在当前浏览器内，不上传服务器。

## 主要功能

- Word 风格的功能区：开始、插入、引用、审阅、表格工具、图片工具和视图。
- 富文本与 Markdown 两种编辑方式，支持标题、列表、表格、图片、公式、算法、代码、脚注、交叉引用和索引词。
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
2. 长文档优先重新编译当前章，保持连续编辑流畅；光标进入新的一章时先预热编译一次。
3. 停止输入后重新编译全文，校准页码、目录和交叉引用。

编译与渲染按节流而非防抖调度：连续输入时也按固定节奏更新，短文档每次按键都能反映到预览。长文档使用两个编译线程：前台线程只处理段落级和章级编译，后台线程负责全文重排（与 Word 的后台分页类似），因此全文重排不会阻塞输入；全文结果返回时若当前章已有更新的编译结果，会按新的页码重新拼接，不会回退到旧内容。

渲染器只替换发生变化的页面，并按视口挂载页面内容，避免长文档的完整 SVG 反复参与浏览器布局。

页面视图支持直接编辑、触控板捏合缩放、`⌘` + 滚轮缩放、单页和多页显示。目录、页眉和页脚属于自动生成内容，不能在预览中直接修改。

## 文档功能

### 标题与样式

论文使用章、节、条、款四级标题；开题报告和中期报告从节级开始。右键单击正文或标题可打开段落与样式设置。修改标题样式会作用于文档中同级的全部标题，与 Word 的“修改样式”语义一致。

### 公式

LaTeX 公式使用 MathLive 可视化编辑，Typst 公式使用源码与实时预览。行间公式、行内公式和“式中”符号说明均可插入；LaTeX 公式在 Word 导出中优先转换为原生 Office 数学公式。

### 表格与图片

表格支持自动调整、表头、合并单元格、列宽、行高和对齐设置，也可从制表符文本、CSV 或 Markdown 插入。图片支持题注、英文题注、分图、宽度、位置和跨页设置。

### 引文与书目

参考文献按字段录入，可按分组整理。BibTeX 导入时，同一引用键的条目会更新，其余条目追加；导出时使用 JabRef 兼容的 `groups` 字段保存分组。编译和 Word 导出均按 GB/T 7714 处理参考文献。

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

三种方案的数学字体默认都是随站分发的 TeX Gyre Termes Math；要换 Cambria Math、STIX Two Math 这类本机字体，先在字体设置里读取本机数学字体，再从列表中选择。

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
- 脚注、批注、表格、分图、算法和代码清单
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
npm run test:projects
npm run test:compile
npm run build
```

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

## 许可

编辑器代码采用 MIT 许可证，iota-hit 模板采用 LPPL-1.3c。第三方软件、字体、Typst 包和修改声明见 [LICENSES.md](LICENSES.md) 以及站内生成的 `licenses.txt`。

Typst 是 Typst GmbH 的商标；本项目与 Typst GmbH、typst.ts 及其他第三方项目作者无隶属关系。
