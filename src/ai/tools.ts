// Agent 能对文档做的事。正文类按「部分 + 段号」读写：段号是富文本顶层块的下标（标题也是一块），读回来的
// Markdown 每块前带 <!-- #n --> 标；改动走挂着的编辑器（一笔事务、能撤消），没挂就直接改工程里那份。
// 表和图有自己的工具（单元格能换行、图能从附件来），参考文献 / 成果 / 论文信息 / 缩略语能写，
// 论文设置的开关能改但每次都先弹窗问用户
import type { Editor } from '@tiptap/core';
import { useStore, type RichKey } from '../model/store';
import type { RichDoc, Info, Settings } from '../model/types';
import { AXES, SWITCHES, resolveSwitch } from '../model/options';
import { INFO_FIELDS as INFO_DEFS } from '../model/info';
import { getEditor } from '../editor/registry';
import { toMarkdown, fromMarkdown } from '../editor/markdown';
import { inlineFromMarkdown } from '../editor/tableImport';
import { putImage, safeImageName, imageDimensions } from '../editor/imageCache';
import { useCompileState, queryDoc, userFontBytes } from '../compiler/client';
import { useFontState } from '../fonts/userFonts';
import { useSerializeWarnings } from '../typst/serialize';
import type { Diagnostic } from '../compiler/protocol';
import { humanize, locateDiagnostic } from '../ui/diagnostics';
import { parseBibtex, splitNames, type BibEntry } from '../bib/bibtex';
import { mergeEntries } from '../bib/csl';
import { pdfRender, pdfImages, type Attachment } from './files';
import { webOf, webNativeOf, type AiConfig, type AiSettings } from './config';
import { pyBox, jsBox, type SandboxFile, type SandboxFont } from './sandbox';
import { bridgeRun, bridgeLs, bridgeRead, bridgeWrite, defaultBridge, type BridgeConfig } from './bridge';
import { GUIDES, guideFor, loadGuide, guideToc, guideSection, guideSearch } from './guides';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
/** 要用户点头的改动：面板弹卡片，用户允许了才做 */
export interface Ask { title: string; lines: string[]; reason?: string; head?: string }
export let askUser: (q: Ask) => Promise<boolean> = async () => false;
/** 工具里的分步进度报给面板（等排版、下载 Pyodide、装包……） */
export let report: (text: string) => void = () => {};
export const setReporter = (f: typeof report) => { report = f; };
export const setAskUser = (f: typeof askUser) => { askUser = f; };
/** 这一场对话里用户发过的附件，图片可以直接插成图 */
let attachments: Attachment[] = [];
export const setAttachments = (a: Attachment[]) => { attachments = a; };
/** 工具自己造出来的图片（PDF 里抽的），也算附件，figure_write 认名字；面板拿去显示缩略图 */
export let onDerived: (a: Attachment) => void = () => {};
export const setOnDerived = (f: typeof onDerived) => { onDerived = f; };
export const addDerived = (a: Attachment) => { attachments = [...attachments, a]; onDerived(a); };
export const serverSandboxOn = () => sandboxCtx.server;
export const collectBytes = (files: { name: string; bytes: Uint8Array }[]) => collectOutputs(files);

export const PARTS: { key: RichKey; label: string; headings: boolean }[] = [
  { key: 'abstractZh', label: '中文摘要', headings: false },
  { key: 'abstractEn', label: '英文摘要', headings: false },
  { key: 'body', label: '正文', headings: true },
  { key: 'conclusion', label: '结论', headings: false },
  { key: 'appendix', label: '附录', headings: true },
  { key: 'acknowledgement', label: '致谢', headings: false },
  { key: 'resume', label: '简历', headings: false },
];
const PART_KEYS = PARTS.map((p) => p.key);
const partEnum = { type: 'string', enum: PART_KEYS, description: '哪一部分：abstractZh 中文摘要、abstractEn 英文摘要、body 正文、conclusion 结论、appendix 附录、acknowledgement 致谢、resume 简历' };
// 论文信息的字段表就是编辑器那张（src/model/info.ts）：名、说明、哪一档才有、年月字段
const INFO_FIELDS = () => INFO_DEFS.map((f) => ({ key: f.key as keyof Info, label: f.label, hint: [f.hint, f.placeholder ? `例：${f.placeholder}` : '', f.kind === 'month' ? '格式 YYYY-MM' : f.kind === 'keywords' ? '字符串数组' : f.kind === 'textarea' ? '可多行' : ''].filter(Boolean).join('；'), applies: f.applies }));
const range = { from: { type: 'integer', minimum: 0 }, to: { type: 'integer', minimum: 0 } };
const placement = { type: 'string', enum: ['none', 'auto', 'top', 'bottom'], description: '浮动：none 就地排、不浮动（默认）；auto 让排版引擎放到页顶或页底；top / bottom 指定。浮动块会漂到别的页，写完用 check_order 查一遍编号顺序' };
const place = { part: partEnum, at: { type: 'integer', minimum: 0, description: '插在第几块之前（等于块数就是接在末尾）；给了 replace 就不用' }, replace: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2, description: '[from, to]：换掉这一段块' } };

const WEB_TOOLS: ToolDef[] = [
  { name: 'web_fetch', description: '抓一个网页的正文（转成 Markdown）。用户给了网址、或搜索结果里有要细看的页面时用。', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } },
  { name: 'web_search', description: '联网搜索，返回前几条结果的标题、网址、摘要。查文献、查数据、核对说法时用；引用时要写出处。', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
];
const MEMORY_TOOLS: ToolDef[] = [
  { name: 'memory_read', description: '读用户的长期记忆（跨文档、跨模型的一段话：偏好、口味、常用说法）。系统提示里已经附了一份，通常不用再读。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'memory_write', description: '往长期记忆里记一条（用户明确说「记住」的偏好，或反复出现的要求）。mode=append 追加一行，replace 整段换掉（用来整理、删旧的）。写之前先说一声记什么。', parameters: { type: 'object', properties: { text: { type: 'string' }, mode: { type: 'string', enum: ['append', 'replace'] } }, required: ['text'], additionalProperties: false } },
];
const SANDBOX_TOOLS: ToolDef[] = [
  { name: 'run_python', description: '在浏览器里的 Python 沙盒（Pyodide，Python 3.14）跑一段代码：numpy / pandas / matplotlib / scipy / sympy / scikit-learn 等按 import 自动装，纯 Python 包用 `import micropip; await micropip.install("包名")`。matplotlib 已配好论文的字体（serif = Times New Roman + 宋体，sans-serif = Arial + 黑体，默认 serif），中文标签直接写，不要自己改 font.family 成系统里没有的字体；图用 plt.savefig("/out/名.png", dpi=200, bbox_inches="tight")。对话里的附件在 /data/<文件名>；要交回的文件写到 /out/（matplotlib 用 plt.savefig("/out/名.png", dpi=200)），交回的 PNG 直接能 figure_write 插进论文（image 填文件名）。回 stdout、最后一个表达式的值、交回的文件。变量和装的包在这场对话里一直在。没有网络；首次用要下载十几 MB。', parameters: { type: 'object', properties: { code: { type: 'string' }, timeout: { type: 'integer', description: '秒，默认 120，最多 600' } }, required: ['code'], additionalProperties: false } },
  { name: 'run_js', description: '在 Worker 里跑一段 JavaScript（写成 async 函数体：能 await、能 return 值）。files["文件名"] 是对话里的附件（文本是字符串、二进制是 Uint8Array），emit("名", 字符串或 Uint8Array) 交回文件，console.log 会收回来。没有 DOM；能 fetch 但受跨域限制。', parameters: { type: 'object', properties: { code: { type: 'string' }, timeout: { type: 'integer', description: '秒，默认 60' } }, required: ['code'], additionalProperties: false } },
];
const BRIDGE_TOOLS: ToolDef[] = [
  { name: 'bridge_run', description: '在用户自己的电脑上跑一条命令（经本机桥，限定在用户指定的文件夹里；typst、python、git 等有没有见 bridge_ls 回的说明）。回 stdout / stderr / 退出码。默认每条命令先弹窗请用户允许。', parameters: { type: 'object', properties: { cmd: { type: 'string', description: 'shell 命令（macOS / Linux 是 sh，Windows 是 cmd）' }, cwd: { type: 'string', description: '相对文件夹的路径' }, timeout: { type: 'integer', description: '秒，默认 120' }, stdin: { type: 'string' }, reason: { type: 'string', description: '给用户看的一句话：为什么要跑' } }, required: ['cmd'], additionalProperties: false } },
  { name: 'bridge_ls', description: '列用户电脑上那个文件夹里的文件（经本机桥）。第一次调会顺带回文件夹在哪、机器上有没有 typst / python / git。', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径，默认根' } }, additionalProperties: false } },
  { name: 'bridge_read', description: '读用户电脑上的一个文件（经本机桥）。文本直接回；图片 / PDF 会作为附件收进对话（图能 figure_write，PDF 能 pdf_images / pdf_render）。', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'bridge_write', description: '往用户电脑上写一个文本文件（经本机桥，只能在那个文件夹里）。', parameters: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'], additionalProperties: false } },
];
/** 沙盒开关与本机桥配置由 state 在每轮前塞进来 */
let sandboxCtx: { browser: boolean; server: boolean; bridge: BridgeConfig } = { browser: true, server: false, bridge: defaultBridge() };
export const setSandboxContext = (c: typeof sandboxCtx) => { sandboxCtx = c; };
export const bridgeReady = (b: BridgeConfig) => b.enabled && !!b.url.trim() && !!b.token.trim();
/** 记忆与预设由 state 在每轮前塞进来 */
let memoryCtx: { enabled: boolean; notes: string; write: (notes: string) => Promise<void> } = { enabled: false, notes: '', write: async () => {} };
export const setMemoryContext = (m: typeof memoryCtx) => { memoryCtx = m; };
/** 这一家接口用哪些工具：Anthropic 的联网是服务方自带的（在 agent.ts 里加服务端工具），别家走阅读代理 */
export function toolsFor(c: AiConfig): ToolDef[] {
  const extra = [...(memoryCtx.enabled ? MEMORY_TOOLS : []), ...(sandboxCtx.browser ? SANDBOX_TOOLS : []), ...(bridgeReady(sandboxCtx.bridge) ? BRIDGE_TOOLS : [])];
  const w = webOf(c);
  if (!w.enabled || webNativeOf(c)) return [...TOOLS, ...extra];
  return [...TOOLS, WEB_TOOLS[0], ...(w.searchKey.trim() ? [WEB_TOOLS[1]] : []), ...extra];
}
/** 系统提示 = 固定那段 + 记忆 + 全局预设 + 这篇文档的预设 */
export async function systemPromptFor(s: AiSettings | undefined, docPreset: string): Promise<string> {
  const now = new Date();
  const parts = [SYSTEM_PROMPT, `今天是 ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}（${'日一二三四五六'[now.getDay()]}），用户说「今天 / 这个月 / 明年」按它算。`];
  if (memoryCtx.enabled) parts.push(`用户的长期记忆（跨文档、跨模型，用户明确要你记住的偏好；有新的用 memory_write 记）：\n${memoryCtx.notes.trim() || '（还是空的）'}`);
  try {
    const g = await loadGuide(guideFor(useStore.getState().doc.settings));
    parts.push(`这篇文档适用的学校规范：《${g.title}》。目录：${guideToc(g)}。凡是规范、格式、写法、该不该有某一页的问题，先用 guide 工具读相关条目再答，回答时点出条目号；改文档也照它。`);
  } catch { /* 指南没取到就不提 */ }
  const sb: string[] = [];
  if (sandboxCtx.browser) sb.push('run_python / run_js 在浏览器里跑代码：算数据、画图（存到 /out 的 PNG 直接 figure_write 插进论文）、处理附件（在 /data）；结果要说明来自计算。');
  if (sandboxCtx.server) sb.push('code_execution 是服务方的沙盒：pandas / matplotlib 齐全，产出的文件会作为附件回到对话里。');
  if (bridgeReady(sandboxCtx.bridge)) sb.push('bridge_* 连着用户自己的电脑（限定在一个文件夹里）：能读写那里的文件、跑命令（typst、python、git 看 bridge_ls 回的说明）。跑命令前说清要做什么，破坏性的操作（删文件、覆盖）要先问。');
  if (sb.length) parts.push(`你还能自己动手：\n- ${sb.join('\n- ')}`);
  if (s?.preset.trim()) parts.push(`用户的预设要求：\n${s.preset.trim()}`);
  if (docPreset.trim()) parts.push(`这篇文档的额外要求：\n${docPreset.trim()}`);
  return parts.join('\n\n');
}
let webConfig: { reader: string; searchKey: string } = { reader: '', searchKey: '' };
export const setWebConfig = (w: { reader: string; searchKey: string }) => { webConfig = w; };

export const TOOLS: ToolDef[] = [
  { name: 'outline', description: '看整篇的结构：各部分有多少块，正文与附录的标题树（带段号），图表清单。改之前先看这个。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read', description: '读某一部分第 from 到 to 块（含两端，0 起数）的 Markdown，每块前有 <!-- #n --> 段号标。一次最多 80 块。', parameters: { type: 'object', properties: { part: partEnum, ...range }, required: ['part', 'from', 'to'], additionalProperties: false } },
  { name: 'replace', description: '用 Markdown 换掉某一部分第 from 到 to 块（含两端）。块数可以变。只换需要改的那几块；标题的标签、引用键、公式照原样留着。表和图别用它，用 table_write / figure_write。', parameters: { type: 'object', properties: { part: partEnum, ...range, markdown: { type: 'string' } }, required: ['part', 'from', 'to', 'markdown'], additionalProperties: false } },
  { name: 'insert', description: '在某一部分第 at 块之前插入 Markdown（at 等于块数就是接在末尾）。', parameters: { type: 'object', properties: { part: partEnum, at: { type: 'integer', minimum: 0 }, markdown: { type: 'string' } }, required: ['part', 'at', 'markdown'], additionalProperties: false } },
  { name: 'delete', description: '删掉某一部分第 from 到 to 块（含两端）。', parameters: { type: 'object', properties: { part: partEnum, ...range }, required: ['part', 'from', 'to'], additionalProperties: false } },
  { name: 'table_write', description: '插一张表或换掉现有的表（给 replace 就是换）。rows 是二维数组，第一行是表头（header 为 true 时）；单元格里写 \\n 就是格内换行，也认 **粗** *斜* `代码` $公式$。fit：content 按内容分列宽、window 撑满版心平分、fixed 每列都是 colWidth 厘米。', parameters: { type: 'object', properties: { ...place, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, minItems: 1 }, header: { type: 'boolean' }, caption: { type: 'string', description: '中文题注（表题）' }, captionEn: { type: 'string' }, label: { type: 'string', description: '交叉引用用的标签，形如 tab:xxx' }, fit: { type: 'string', enum: ['content', 'window', 'fixed'] }, colWidth: { type: 'number', description: 'fixed 时每列宽，厘米' } , placement }, required: ['part', 'rows'], additionalProperties: false } },
  { name: 'figure_write', description: '插一张图或换掉现有的图。image 是工程里已有的图片名（见 images），或用户在对话里发来的图片附件的文件名——会先存进工程。', parameters: { type: 'object', properties: { ...place, image: { type: 'string' }, caption: { type: 'string', description: '中文题注（图题）' }, captionEn: { type: 'string' }, label: { type: 'string', description: '形如 fig:xxx' }, width: { type: 'number', description: '图宽，厘米（版心约 15 厘米）' }, placement }, required: ['part', 'image'], additionalProperties: false } },
  { name: 'images', description: '工程里有哪些图片，以及用户这场对话里发来的图片附件、从 PDF 里抽出来的图。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'pdf_images', description: '把用户发来的 PDF 附件里嵌的位图抽出来存成图片（file 是附件文件名，page 不给就整份、最多 60 页），回每张的名字与像素尺寸；矢量图抽不出来，用 pdf_render 截那一页。抽出来的图能直接 figure_write。', parameters: { type: 'object', properties: { file: { type: 'string' }, page: { type: 'integer', minimum: 1 } }, required: ['file'], additionalProperties: false } },
  { name: 'pdf_render', description: '把 PDF 附件的某一页画成图片（scale 1 约 72 dpi，默认 2），可以只截页面的一块：crop 是页面比例 [x, y, w, h]（0–1）。矢量图、公式截图用它。回图片名与尺寸，能直接 figure_write。', parameters: { type: 'object', properties: { file: { type: 'string' }, page: { type: 'integer', minimum: 1 }, scale: { type: 'number' }, crop: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 } }, required: ['file', 'page'], additionalProperties: false } },
  { name: 'selection', description: '用户现在在编辑器里选中的是哪一部分的哪几块，以及选中的文字。用户说「这段」「选中的」时先调它。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'guide', description: '读学校写作指南的原文。不带参数：这篇文档适用的那份指南的目录；section 填条目号（如 2.14 或 2.14.1，人文社科版是 一 /（二）/ 1.）回整条；query 填关键词（几个词用空格隔开）回含这些词的句子并标出所在条目。which 可换一份指南（键：' + GUIDES.map((g) => g.key).join(' / ') + '）。', parameters: { type: 'object', properties: { section: { type: 'string' }, query: { type: 'string' }, which: { type: 'string' } }, additionalProperties: false } },
  { name: 'diagnostics', description: '最近一次排版编译的错误与警告。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'check_order', description: '按排版结果查图、表、算法、代码清单的实际先后：每张的编号、落在第几页、浮不浮动、正文第一次提到它在第几页；指出编号乱序（编号照正文顺序编，浮动块会漂到后面的页去，规范要求全文编号由小到大）、先图后文（规范要先见文后见图）、没被正文引用的。插了浮动图表、改了 placement、挪了图之后都查一遍。要等预览整编完，长文档要几秒。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bib_list', description: '参考文献表（或成果表）里有哪些条目：引用键、类型、作者、年份、题名。正文里引用写 [@引用键]。', parameters: { type: 'object', properties: { which: { type: 'string', enum: ['references', 'achievements'] } }, additionalProperties: false } },
  { name: 'bib_add', description: '往参考文献表（或攻读学位期间的成果表）加条目：给 BibTeX，同一引用键的当作更新。字段名照 GB/T 7714：author、title、journal、year、volume、number、pages、booktitle、publisher、address、school、doi、url、urldate、langid。', parameters: { type: 'object', properties: { which: { type: 'string', enum: ['references', 'achievements'] }, bibtex: { type: 'string' } }, required: ['bibtex'], additionalProperties: false } },
  { name: 'info_read', description: '论文信息（题目、作者、导师、学科、关键词……）与档位（学位、阶段、校区、语言、文种）。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'info_write', description: '改论文信息里的字段。patch 是字段名到值的字典（字段名和说明见 info_read）；keywords / keywordsEn 是字符串数组。答辩日期 defenseDate 与封面日期 date 只有年月，写「YYYY-MM」（如 2026-06；用户说「今天 / 这个月 / 下个月」按系统提示里给的今天算），写空串就是清掉、封面日期清掉表示用编译当天。', parameters: { type: 'object', properties: { patch: { type: 'object', additionalProperties: true } }, required: ['patch'], additionalProperties: false } },
  { name: 'abbreviations', description: '缩略语表与符号表。正文里 @缩略语键 首次出现会自动展开。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'abbreviations_add', description: '往缩略语表 / 符号表加条目（同键当作更新）。缩略语要 key（正文里 @key 用）、long（中文全称）、longEn（英文全称）；符号要 symbol（LaTeX 写法）和 meaning。', parameters: { type: 'object', properties: { abbreviations: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, long: { type: 'string' }, longEn: { type: 'string' }, short: { type: 'string' } }, required: ['key', 'long'] } }, symbols: { type: 'array', items: { type: 'object', properties: { symbol: { type: 'string' }, meaning: { type: 'string' } }, required: ['symbol', 'meaning'] } } }, additionalProperties: false } },
  { name: 'schema', description: '编辑器节点的 JSON 结构：每种块 / 行内节点 / 标记的名字、属性及默认值、能装什么内容。Markdown 写不出的高级操作（表格合并格、图的浮动方式、批注……）用 read_json / write_json 直接改节点，改之前先看这个。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read_json', description: '读某一部分第 from 到 to 块的原始节点 JSON（ProseMirror 文档节点，含全部属性）。', parameters: { type: 'object', properties: { part: partEnum, ...range }, required: ['part', 'from', 'to'], additionalProperties: false } },
  { name: 'write_json', description: '用节点 JSON 换掉某一部分第 from 到 to 块（to = from - 1 就是在 from 前插入）。nodes 是块节点数组，按 schema 校验，不合法会报错、什么都不改。', parameters: { type: 'object', properties: { part: partEnum, ...range, nodes: { type: 'array', items: { type: 'object' } } }, required: ['part', 'from', 'to', 'nodes'], additionalProperties: false } },
  { name: 'settings_list', description: '论文设置里能改的开关和档位：键、说明、可选值、现在的值（auto = 跟模板按档定，旁边写着自动落在哪一档和原因）。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'settings_set', description: '改一个设置。会弹窗把这个开关的说明和改动给用户看，用户允许了才改；reason 写清为什么要改，用户看得到。', parameters: { type: 'object', properties: { key: { type: 'string' }, value: { description: '开关的档位值，或 "auto"' }, reason: { type: 'string' } }, required: ['key', 'value', 'reason'], additionalProperties: false } },
];

const partOf = (key: string) => PARTS.find((p) => p.key === key) ?? null;
const richOf = (key: RichKey): RichDoc => (useStore.getState().doc as any)[key] ?? { type: 'doc', content: [] };
const blocksOf = (key: RichKey): any[] => (getEditor(key)?.getJSON().content as any[] | undefined) ?? richOf(key).content ?? [];
const plain = (b: any): string => (b?.content ?? []).map((n: any) => n.text ?? (n.content ? plain(n) : '')).join('');
const MARK = /<!--\s*#\d+\s*-->\s*/g;

function outlineText(): string {
  const lines: string[] = [];
  for (const p of PARTS) {
    const blocks = blocksOf(p.key);
    if (!blocks.length || (blocks.length === 1 && !blocks[0].content?.length)) continue;
    lines.push(`${p.key}（${p.label}）：${blocks.length} 块`);
    blocks.forEach((b, i) => {
      if (b.type === 'heading') lines.push(`  #${i} ${'#'.repeat(b.attrs?.level ?? 1)} ${plain(b)}`);
      else if (b.type === 'figure') lines.push(`  #${i} [图] ${b.attrs?.caption ?? ''}${b.attrs?.label ? ` <${b.attrs.label}>` : ''}`);
      else if (b.type === 'tableFigure') lines.push(`  #${i} [表] ${b.attrs?.caption ?? ''}${b.attrs?.label ? ` <${b.attrs.label}>` : ''}`);
      else if (b.type === 'equation') lines.push(`  #${i} [公式]${b.attrs?.label ? ` <${b.attrs.label}>` : ''}`);
      else if (!p.headings && i === 0) lines.push(`  #0 ${toMarkdown({ type: 'doc', content: [b] }).slice(0, 80)}`);
    });
  }
  return lines.join('\n') || '（文档是空的）';
}

function readText(key: RichKey, from: number, to: number): string {
  const blocks = blocksOf(key);
  if (!blocks.length) return '（这一部分是空的）';
  from = Math.max(0, from); to = Math.min(blocks.length - 1, to, from + 79);
  if (from > to) return `段号超出范围（共 ${blocks.length} 块）`;
  return blocks.slice(from, to + 1).map((b, i) => `<!-- #${from + i} -->\n${toMarkdown({ type: 'doc', content: [b] })}`).join('\n\n');
}

/** 把 [from, to] 换成 nodes（to = from - 1 就是纯插入，nodes 空就是删）：编辑器挂着走一笔事务，否则改工程 */
function splice(key: RichKey, from: number, to: number, nodes: any[], what: string): string {
  const ed: Editor | undefined = getEditor(key);
  const blocks = blocksOf(key);
  if (from < 0 || from > blocks.length || to < from - 1 || to >= blocks.length) return `段号超出范围（共 ${blocks.length} 块）`;
  if (ed) {
    let pos = 0;
    const starts: number[] = [];
    ed.state.doc.forEach((node, offset) => { starts.push(offset); pos = offset + node.nodeSize; });
    starts.push(pos);
    const pm = nodes.map((n) => ed.schema.nodeFromJSON(n));
    try { pm.forEach((n) => n.check()); } catch (e) { return `转不成文档节点：${(e as Error).message}`; }
    const step = ed.state.tr.replaceWith(starts[from], starts[to + 1], pm);
    step.setMeta('undoLabel', 'AI 编辑');
    ed.view.dispatch(step);
  } else {
    const any = PART_KEYS.map((k) => getEditor(k)).find(Boolean);
    if (any) { try { nodes.forEach((n) => any.schema.nodeFromJSON(n).check()); } catch (e) { return `转不成文档节点：${(e as Error).message}`; } }
    const next = [...blocks]; next.splice(from, to - from + 1, ...nodes);
    useStore.getState().setRich(key, { type: 'doc', content: next.length ? next : [{ type: 'paragraph' }] });
  }
  const total = blocksOf(key).length;
  const where = to < from ? `第 ${from} 块前` : `第 ${from}${to > from ? `–${to}` : ''} 块`;
  return `${what}：${where}（这一部分现在共 ${total} 块；用户可在撤消里回退）`;
}
function placeOf(input: Record<string, any>, key: RichKey): { from: number; to: number } | string {
  const n = blocksOf(key).length;
  if (Array.isArray(input.replace) && input.replace.length === 2) return { from: Number(input.replace[0]), to: Number(input.replace[1]) };
  const at = input.at === undefined ? n : Number(input.at);
  if (!Number.isFinite(at) || at < 0 || at > n) return `at 超出范围（共 ${n} 块）`;
  return { from: at, to: at - 1 };
}
const parseMd = (md: string, headings: boolean): any[] => fromMarkdown(md.replace(MARK, ''), headings).content ?? [];

/** 单元格：按 \n 拆行，行内认 **粗** *斜* `代码` $公式$ */
function cellNode(text: string, header: boolean) {
  const content: any[] = [];
  String(text ?? '').split(/\r?\n/).forEach((line, i) => { if (i) content.push({ type: 'hardBreak' }); content.push(...inlineFromMarkdown(line)); });
  return { type: header ? 'tableHeader' : 'tableCell', attrs: { align: null }, content: [{ type: 'paragraph', content }] };
}
function tableNode(input: Record<string, any>) {
  const rows: string[][] = input.rows;
  const width = Math.max(...rows.map((r) => r.length));
  const header = input.header !== false;
  const attrs: Record<string, unknown> = {};
  for (const k of ['caption', 'captionEn', 'label', 'fit', 'colWidth', 'placement']) if (input[k] !== undefined && input[k] !== '') attrs[k] = input[k];
  return { type: 'tableFigure', attrs, content: [{ type: 'table', content: rows.map((r, ri) => ({ type: 'tableRow', content: Array.from({ length: width }, (_, ci) => cellNode(r[ci] ?? '', header && ri === 0)) })) }] };
}

async function figureNode(input: Record<string, any>): Promise<any | string> {
  const store = useStore.getState();
  let name = String(input.image ?? '').trim();
  const dims: { width?: number; height?: number } = {};
  if (!store.doc.images.some((i) => i.name === name)) {
    const att = attachments.find((a) => a.kind === 'image' && a.name === name);
    if (!att) return `没有叫「${name}」的图片：既不在工程里，用户也没在对话里发过；先用 images 看看有哪些`;
    const blob = new Blob([Uint8Array.from(atob(att.data), (c) => c.charCodeAt(0))], { type: att.type });
    name = safeImageName(att.name, new Set(store.doc.images.map((i) => i.name)));
    await putImage(name, blob);
    const d = await imageDimensions(blob);
    if (d) Object.assign(dims, d);
    store.setImages([...useStore.getState().doc.images, { name, mime: att.type, ...dims }]);
  }
  const asset = useStore.getState().doc.images.find((i) => i.name === name);
  const px = asset?.width ?? dims.width;
  const width = Number(input.width) || (px ? Math.min(14, Math.max(4, Math.round((px / 96) * 2.54 * 10) / 10)) : 8);
  const attrs: Record<string, unknown> = { image: name, width };
  for (const k of ['caption', 'captionEn', 'label', 'placement']) if (input[k]) attrs[k] = input[k];
  return { type: 'figure', attrs };
}

function selectionText(): string {
  const key = PART_KEYS.find((k) => getEditor(k)?.isFocused) ?? PART_KEYS.find((k) => { const e = getEditor(k); return e && !e.state.selection.empty; });
  const ed = key ? getEditor(key) : undefined;
  if (!key || !ed) return '现在没有选中的内容';
  const { from, to, empty } = ed.state.selection;
  let i = 0, a = -1, b = -1;
  ed.state.doc.forEach((node, offset) => { const end = offset + node.nodeSize; if (a < 0 && from < end) a = i; if (to > offset) b = i; i++; });
  if (a < 0) return '现在没有选中的内容';
  const rng = b > a ? `–${b}` : '';
  return `${key} 第 ${a}${rng} 块${empty ? '（光标在这里，没有选中文字）' : `，选中的文字：\n${ed.state.doc.textBetween(from, to, '\n')}`}`;
}

function diagnosticsText(): string {
  const ds = useCompileState.getState().diagnostics;
  if (!ds.length) return '最近一次编译没有错误或警告';
  return ds.slice(0, 40).map((d) => describeDiag(d).slice(2)).join('\n');
}

// 图表落点探针：接在整编那份 main.typ 末尾。题注的位置才是浮动块真正排到的地方（figure 自己的位置是它在正文流里的
// 占位），编号取 counter.at 在各自位置上的值——两处一样，都是正文顺序。章号从 heading 计数器在图的位置上取
const ORDER_PROBE = `#context [#metadata({
  let txt(x) = if x == none { "" } else if type(x) == str { x } else if type(x) == content {
    if x.has("text") { x.text } else if x.has("children") { x.children.map(txt).join("") } else if x.has("body") { txt(x.body) } else if x.has("child") { txt(x.child) } else { "" }
  } else { repr(x) }
  let kind(k) = if type(k) == str { k } else { repr(k) }
  let pos(l) = (page: l.page(), y: calc.round(l.position().y.pt()))
  (
    caps: query(figure.caption).map(c => (kind: kind(c.kind), seq: c.counter.at(c.location()), chap: counter(heading).at(c.location()).at(0, default: 0), fn: type(c.numbering) == function, text: txt(c.body)) + pos(c.location())),
    figs: query(figure).map(f => (kind: kind(f.kind), seq: f.counter.at(f.location()), chap: counter(heading).at(f.location()).at(0, default: 0), label: if f.has("label") { str(f.label) } else { "" }, placement: repr(f.placement)) + pos(f.location())),
    refs: query(ref).map(r => (target: str(r.target)) + pos(r.location())),
  )
}) <iota-order>]`;
const KIND_NAMES: Record<string, string> = { image: '图', table: '表', algorithm: '算法', raw: '代码' };
type Pos = { page: number; y: number };
const before = (a: Pos, b: Pos) => a.page < b.page || (a.page === b.page && a.y < b.y);
const cmpSeq = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; } return 0; };
async function checkOrder(): Promise<string> {
  report('等整编落地，再问排版结果里图表落在哪页…');
  const r = await queryDoc(ORDER_PROBE, '<iota-order>');
  if (r.error || !Array.isArray(r.result) || !r.result.length) return `查不了：${r.error ?? '模板没交回结果'}（预览要先整编成功一次）`;
  const { caps, figs, refs } = r.result[0] as { caps: (Pos & { kind: string; seq: number[]; chap: number; fn: boolean; text: string })[]; figs: (Pos & { kind: string; seq: number[]; chap: number; label: string; placement: string })[]; refs: (Pos & { target: string })[] };
  const seen = new Set<string>();
  const items = caps.filter((c) => KIND_NAMES[c.kind]).flatMap((c) => {
    const key = `${c.kind}:${c.seq.join('.')}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const f = figs.find((x) => x.kind === c.kind && !cmpSeq(x.seq, c.seq));
    const chap = f?.chap ?? c.chap;
    const num = `${KIND_NAMES[c.kind]}${c.fn && chap > 0 ? `${chap}-` : ''}${c.seq.join('.')}`;
    const mentions = f?.label ? refs.filter((x) => x.target === f.label) : [];
    const first = mentions.length ? mentions.reduce((a, b) => (before(b, a) ? b : a)) : null;
    return [{ ...c, chap, num, label: f?.label ?? '', placement: f?.placement ?? 'none', first, mentions: mentions.length }];
  }).sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
  if (!items.length) return '排版结果里没有带题注的图表';
  const floating = (it: typeof items[number]) => it.placement !== 'none' ? `，浮动 ${it.placement}` : '';
  const lines = items.map((it) => `${it.num}${it.label ? ` <${it.label}>` : ''}：第 ${it.page} 页${floating(it)}；${it.first ? `正文首次引用在第 ${it.first.page} 页` : it.label ? '正文没有引用' : '没有标签'}${it.text ? `；${it.text.slice(0, 40)}` : ''}`);
  const problems: string[] = [];
  for (const kind of Object.keys(KIND_NAMES)) {
    const seq = items.filter((it) => it.kind === kind);
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1], b = seq[i];
      if (a.chap > b.chap || (a.chap === b.chap && cmpSeq(a.seq, b.seq) > 0)) problems.push(`乱序：${a.num}（第 ${a.page} 页${floating(a)}）排在了 ${b.num}（第 ${b.page} 页${floating(b)}）前面——规范要求编号由小到大。改法：把编号大的那张在正文里往前挪、去掉浮动或改成 placement=bottom，或让前面那张也浮动`);
    }
  }
  for (const it of items) {
    if (it.first && before(it, it.first)) problems.push(`先图后文：${it.num} 在第 ${it.page} 页，正文第一次引用它在第 ${it.first.page} 页——规范要先见文后见图`);
    else if (it.first && it.page - it.first.page > 1) problems.push(`离得远：${it.num} 在第 ${it.page} 页，首次引用在第 ${it.first.page} 页，隔了 ${it.page - it.first.page} 页`);
    if (it.label && !it.mentions) problems.push(`没被引用：${it.num} <${it.label}>——正文里应先提到再出现（写 @${it.label}）`);
  }
  return `按页面先后（编号照正文顺序编；浮动块会漂）：\n${lines.join('\n')}\n\n${problems.length ? `问题：\n- ${problems.join('\n- ')}` : '没有问题：各类编号都由小到大，每张都在首次引用之后。'}`;
}


// ── 指南 ─────────────────────────────────────────────────────────────────────
async function guideTool(input: Record<string, any>): Promise<string> {
  const key = input.which && GUIDES.some((g) => g.key === input.which) ? String(input.which) : guideFor(useStore.getState().doc.settings);
  const g = await loadGuide(key);
  if (input.section) { const t = guideSection(g, String(input.section)); return t ?? `《${g.title}》里没有「${input.section}」这一条；目录：${guideToc(g, 3)}`; }
  if (input.query) { const t = guideSearch(g, String(input.query)); return t || `《${g.title}》里没有同时含「${input.query}」的句子；换个词，或按目录读整条：${guideToc(g)}`; }
  return `《${g.title}》目录（section 填条目号读整条）：\n${g.sections.map((x) => `${'  '.repeat(x.level - 1)}${x.num} ${x.title}`).join('\n')}`;
}

// ── 浏览器沙盒 ────────────────────────────────────────────────────────────────
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const sandboxFiles = (): SandboxFile[] => attachments.map((a) => (a.kind === 'text' ? { name: a.name, text: a.data } : { name: a.name, bytes: b64ToBytes(a.data) }));
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', svg: 'image/svg+xml' };
/** 沙盒交回的文件收成附件：图和 PDF 按字节，文本按字；别的只报个名 */
function collectOutputs(files: { name: string; bytes: Uint8Array }[]): string[] {
  return files.map((f) => {
    const ext = (f.name.split('.').pop() ?? '').toLowerCase();
    const mime = MIME[ext];
    if (mime && ext !== 'svg') addDerived({ id: uid(), name: f.name, type: mime, size: f.bytes.length, kind: ext === 'pdf' ? 'pdf' : 'image', data: bytesToB64(f.bytes) });
    else if (/^(txt|md|csv|tsv|json|tex|typ|bib|py|js|xml|html|svg)$/.test(ext) || f.bytes.length < 200000) addDerived({ id: uid(), name: f.name, type: 'text/plain', size: f.bytes.length, kind: 'text', data: new TextDecoder().decode(f.bytes) });
    else return `${f.name}（${fmtKb(f.bytes.length)}，二进制，留在沙盒里）`;
    return `${f.name}（${fmtKb(f.bytes.length)}）`;
  });
}
const fmtKb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const clip = (s: string, n = 12000) => (s.length > n ? `${s.slice(0, n)}\n…（截掉 ${s.length - n} 字）` : s);
function sandboxReport(r: { ok: boolean; stdout: string; stderr: string; result: string; files: { name: string; bytes: Uint8Array }[]; error?: string; ms: number }): string {
  const parts: string[] = [];
  if (r.stdout.trim()) parts.push(`stdout：\n${clip(r.stdout.trim())}`);
  if (r.stderr.trim()) parts.push(`stderr：\n${clip(r.stderr.trim(), 4000)}`);
  if (r.result.trim()) parts.push(`返回值：${clip(r.result.trim(), 4000)}`);
  if (r.files.length) parts.push(`交回的文件（已收进对话，图能直接 figure_write）：${collectOutputs(r.files).join('、')}`);
  if (!r.ok) parts.push(`出错：${r.error}`);
  if (!parts.length) parts.push('跑完了，没有输出');
  return `${parts.join('\n')}\n（${(r.ms / 1000).toFixed(1)} 秒）`;
}
/** 画图用论文那套字体：用户授权读进编译器的本机字体（宋体、黑体、Times…）原样给沙盒；一个中文字体都没有就先弹窗请用户授权，
 *  还是没有就用站内的 Noto 兜底。只在代码用到 matplotlib 时才搬（本机那套上百 MB，一个 Worker 只搬一次） */
const CJK_FONT = /song|hei|kai|fang|simsun|simhei|cjk|pingfang|han(s|d)?\b|ming|yahei|source han/i;
const fontExt = (b: Uint8Array) => (b[0] === 0x4f && b[1] === 0x54 ? 'otf' : b[0] === 0x74 && b[1] === 0x74 && b[2] === 0x63 ? 'ttc' : 'ttf');
const sentFonts = new Set<string>();
async function sandboxFonts(): Promise<{ fonts: SandboxFont[]; note: string }> {
  const fs = useFontState.getState();
  const named = (id: string) => fs.fonts.find((f) => f.id === id)?.name ?? id;
  let mine = userFontBytes();
  let note = '';
  if (!mine.some((f) => CJK_FONT.test(named(f.id))) && fs.canQuery && !fs.busy) {
    const ok = await askUser({ head: '画图要用论文的字体，需要你允许读取本机字体', title: '读取本机的宋体、黑体、Times New Roman 等', lines: ['浏览器会弹一次授权；之后论文排版和图里的文字都用这一套。不允许就用站内的 Noto 字体画。'], reason: '图里的中文没有字体会显示成方块' });
    if (ok) { await fs.readLocal(); mine = userFontBytes(); if (fs.error) note = `本机字体没读到（${useFontState.getState().error}）`; }
  }
  const fonts: SandboxFont[] = [];
  for (const f of mine) {
    const key = `u:${f.id}`;
    if (sentFonts.has(key)) continue;
    sentFonts.add(key);
    const bytes = new Uint8Array(f.data.slice(0));
    fonts.push({ name: `${named(f.id).replace(/[^\w.-]+/g, '_')}.${fontExt(bytes)}`, bytes });
  }
  if (!mine.some((f) => CJK_FONT.test(named(f.id)))) {
    for (const file of ['NotoSerifCJKsc-Regular.otf', 'NotoSansCJKsc-Regular.otf', 'texgyretermes-regular.otf', 'texgyreheros-regular.otf']) {
      if (sentFonts.has(file)) continue;
      try { const r = await fetch(new URL(`fonts/${file}`, document.baseURI).href); if (!r.ok) continue; fonts.push({ name: file, bytes: new Uint8Array(await r.arrayBuffer()) }); sentFonts.add(file); } catch { /* 没取到就没有 */ }
    }
    note = note || '用的是站内的 Noto 字体（用户没有授权本机字体）';
  }
  return { fonts, note };
}
async function runPythonTool(input: Record<string, any>): Promise<string> {
  if (!sandboxCtx.browser) return '浏览器沙盒没开，用户在 Agent 设置 › 沙盒里能打开';
  const code = String(input.code ?? ''); if (!code.trim()) return 'code 是空的';
  let fonts: SandboxFont[] = [], fontNote = '';
  if (/matplotlib/.test(code)) { report('准备论文字体给 matplotlib…'); ({ fonts, note: fontNote } = await sandboxFonts()); }
  report(pyBox.worker ? 'Python 运行中…' : '首次启动：下载 Pyodide（十几 MB，之后有缓存）…');
  const r = await pyBox.run(code, sandboxFiles(), Math.min(600, Math.max(5, Number(input.timeout) || 120)) * 1000, undefined, (p) => report(p === 'boot' ? '首次启动：下载 Pyodide（十几 MB，之后有缓存）…' : p === 'packages' ? '按 import 装 Python 包…' : p === 'fonts' ? '把论文字体装进 matplotlib…' : 'Python 运行中…'), fonts);
  if (!r.ok && pyBox.worker === null) sentFonts.clear();
  return sandboxReport(r) + (fontNote ? `\n字体：${fontNote}` : '');
}
async function runJsTool(input: Record<string, any>): Promise<string> {
  if (!sandboxCtx.browser) return '浏览器沙盒没开，用户在 Agent 设置 › 沙盒里能打开';
  const code = String(input.code ?? ''); if (!code.trim()) return 'code 是空的';
  report('JavaScript 运行中…');
  const r = await jsBox.run(code, sandboxFiles(), Math.min(600, Math.max(5, Number(input.timeout) || 60)) * 1000);
  return sandboxReport(r);
}

// ── 本机桥 ────────────────────────────────────────────────────────────────────
const bridgeOff = () => (bridgeReady(sandboxCtx.bridge) ? null : '本机桥没连上：用户要在 Agent 设置 › 沙盒里启动并填好地址与令牌');
const bridgeErr = (e: unknown) => `本机桥出错：${(e as Error).message}`;
let bridgeIntroduced = false;
async function bridgeRunTool(input: Record<string, any>): Promise<string> {
  const off = bridgeOff(); if (off) return off;
  const cmd = String(input.cmd ?? '').trim(); if (!cmd) return 'cmd 是空的';
  const b = sandboxCtx.bridge;
  if (b.confirm) {
    const ok = await askUser({ head: '要在你的电脑上运行一条命令，需要你允许', title: cmd, lines: [`目录：${input.cwd ? String(input.cwd) : '（本机桥的文件夹）'}`, '会用你的账号执行，能读写那个文件夹里的东西。'], reason: String(input.reason ?? '') });
    if (!ok) return '用户没有允许运行这条命令';
  }
  try {
    report('在你的电脑上运行中…');
    const r = await bridgeRun(b, cmd, input.cwd ? String(input.cwd) : undefined, Number(input.timeout) || undefined, input.stdin ? String(input.stdin) : undefined);
    const parts = [];
    if (r.stdout.trim()) parts.push(`stdout：\n${clip(r.stdout.trim())}`);
    if (r.stderr.trim()) parts.push(`stderr：\n${clip(r.stderr.trim(), 6000)}`);
    parts.push(r.timedOut ? '超时被杀掉了' : `退出码 ${r.code}`);
    return parts.join('\n');
  } catch (e) { return bridgeErr(e); }
}
async function bridgeLsTool(input: Record<string, any>): Promise<string> {
  const off = bridgeOff(); if (off) return off;
  try {
    const b = sandboxCtx.bridge;
    const r = await bridgeLs(b, input.path ? String(input.path) : undefined);
    const rows = r.entries.map((e) => (e.dir ? `${e.name}/` : `${e.name}（${fmtKb(e.size)}）`));
    let head = '';
    if (!bridgeIntroduced) { bridgeIntroduced = true; try { const p = await (await import('./bridge')).bridgePing(b); head = `文件夹：${p.dir}（${p.platform}，Node ${p.node}）；机器上有：${Object.entries(p.tools).filter(([, v]) => v).map(([k]) => k).join('、') || '（typst / python / git 都没找到）'}\n`; } catch { /* */ } }
    return `${head}${r.path}/ 里 ${rows.length} 项：\n${rows.join('\n') || '（空）'}`;
  } catch (e) { return bridgeErr(e); }
}
async function bridgeReadTool(input: Record<string, any>): Promise<string> {
  const off = bridgeOff(); if (off) return off;
  const p = String(input.path ?? '').trim(); if (!p) return 'path 是空的';
  try {
    const r = await bridgeRead(sandboxCtx.bridge, p);
    if (r.text !== undefined) return clip(r.text, 40000);
    const ext = (p.split('.').pop() ?? '').toLowerCase();
    const mime = MIME[ext];
    if (!mime || ext === 'svg') return `${p} 是二进制文件（${fmtKb(r.size)}），这里只收图片和 PDF`;
    const name = p.split(/[\\/]/).pop()!;
    addDerived({ id: uid(), name, type: mime, size: r.size, kind: ext === 'pdf' ? 'pdf' : 'image', data: r.b64! });
    return `${name}（${fmtKb(r.size)}）已收进对话，${ext === 'pdf' ? '能 pdf_images / pdf_render' : '能 figure_write 插进论文'}`;
  } catch (e) { return bridgeErr(e); }
}
async function bridgeWriteTool(input: Record<string, any>): Promise<string> {
  const off = bridgeOff(); if (off) return off;
  const p = String(input.path ?? '').trim(); if (!p) return 'path 是空的';
  try { const r = await bridgeWrite(sandboxCtx.bridge, p, { text: String(input.text ?? '') }); return `已写入 ${r.path}`; } catch (e) { return bridgeErr(e); }
}

function bibList(which: string): string {
  const doc = useStore.getState().doc;
  const list: BibEntry[] = which === 'achievements' ? doc.achievementEntries ?? [] : doc.references ?? [];
  if (!list.length) return which === 'achievements' ? '成果表是空的' : '参考文献表是空的';
  return list.slice(0, 300).map((e) => { const who = splitNames(e.fields.author ?? e.fields.editor ?? '').slice(0, 2).join(', '); const year = (e.fields.year ?? e.fields.date ?? '').slice(0, 4); return `${e.key}｜${e.type}｜${who}${year ? ` ${year}` : ''}｜${e.fields.title ?? ''}`; }).join('\n');
}
function bibAdd(which: string, bibtex: string): string {
  const parsed = parseBibtex(String(bibtex ?? '').normalize('NFC'));
  if (!parsed.length) return 'BibTeX 里没解析出条目（每条要 @type{key, field = {value}, …}）';
  const store = useStore.getState();
  const cur = which === 'achievements' ? store.doc.achievementEntries ?? [] : store.doc.references ?? [];
  const r = mergeEntries(cur, parsed);
  (which === 'achievements' ? store.setAchievementEntries : store.setReferences)(r.entries);
  return `${which === 'achievements' ? '成果表' : '参考文献表'}：新增 ${r.added} 条，更新 ${r.updated} 条；引用键：${parsed.map((e) => e.key).join('、')}`;
}

function infoRead(): string {
  const { doc } = useStore.getState();
  const s = doc.settings;
  const axes = AXES.filter((a) => !a.applies || a.applies(s)).map((a) => `${String(a.key)}（${a.label}）：${a.choices.find((c) => c.value === s[a.key])?.label ?? String(s[a.key])}`);
  const lines = INFO_FIELDS().filter((f) => !f.applies || f.applies(s)).map(({ key, label, hint }) => { const v = doc.info[key]; const t = Array.isArray(v) ? v.join('、') : String(v ?? ''); return `${key}（${label}${hint ? `，${hint}` : ''}）：${t || '（空）'}`; });
  return [...axes, ...lines].join('\n');
}
/** 年月：2026-06、2026/6、2026年6月、2026.6、2026-06-15、June 2026、Jun. 2026、6/2026 都收成 YYYY-MM；认不出给 null */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseMonth(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})\D+(\d{1,2})/.exec(v))) return `${m[1]}-${m[2].padStart(2, '0')}`;
  if ((m = /^(\d{1,2})\s*[/.-]\s*(\d{4})/.exec(v))) return `${m[2]}-${m[1].padStart(2, '0')}`;
  if ((m = /^([a-z]{3})[a-z]*\.?\s+(\d{4})/.exec(v)) || (m = /^(\d{4})\s+([a-z]{3})[a-z]*/.exec(v))) {
    const [name, year] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    const i = MONTHS.indexOf(name); if (i >= 0) return `${year}-${String(i + 1).padStart(2, '0')}`;
  }
  return null;
}
function infoWrite(patch: Record<string, unknown>): string {
  const out: Partial<Info> = {};
  const bad: string[] = [];
  const defs = INFO_FIELDS();
  for (const [k, v] of Object.entries(patch ?? {})) {
    const def = INFO_DEFS.find((x) => x.key === k);
    if (!def) { bad.push(k); continue; }
    if (def.kind === 'keywords') (out as any)[k] = Array.isArray(v) ? v.map(String) : String(v).split(/[;；,，、\n]+/).map((x) => x.trim()).filter(Boolean);
    else if (def.kind === 'month') {
      // 年月：2026-06、2026/6、2026年6月、2026.6 都收成 YYYY-MM；空串清掉
      const ym = parseMonth(String(v ?? ''));
      if (String(v ?? '').trim() && !ym) { bad.push(`${k}（要写成 YYYY-MM，如 2026-06）`); continue; }
      (out as any)[k] = ym ?? '';
    } else (out as any)[k] = String(v ?? '');
  }
  if (Object.keys(out).length) useStore.getState().setInfo(out);
  return `已改 ${Object.keys(out).map((k) => defs.find((f) => f.key === k)!.label).join('、') || '（没有）'}${bad.length ? `；没改：${bad.join('、')}` : ''}`;
}

function abbreviations(): string {
  const { doc } = useStore.getState();
  const a = doc.abbreviations.map((x) => `@${x.key}：${x.short || x.key}｜${x.long}｜${x.longEn}`);
  const s = doc.symbols.map((x) => `${x.symbol}｜${x.meaning}`);
  return `缩略语 ${a.length} 条${a.length ? '：\n' + a.join('\n') : ''}\n符号 ${s.length} 条${s.length ? '：\n' + s.join('\n') : ''}`;
}
function abbreviationsAdd(input: Record<string, any>): string {
  const store = useStore.getState();
  let na = 0, ns = 0;
  if (Array.isArray(input.abbreviations) && input.abbreviations.length) {
    const list = [...store.doc.abbreviations];
    for (const it of input.abbreviations) {
      const key = String(it.key ?? '').trim(); if (!key) continue;
      const entry = { key, long: String(it.long ?? ''), longEn: String(it.longEn ?? ''), short: it.short ? String(it.short) : undefined };
      const i = list.findIndex((x) => x.key === key);
      if (i >= 0) list[i] = { ...list[i], ...entry }; else list.push(entry);
      na++;
    }
    store.setAbbreviations(list);
  }
  if (Array.isArray(input.symbols) && input.symbols.length) {
    const list = [...useStore.getState().doc.symbols];
    for (const it of input.symbols) {
      const symbol = String(it.symbol ?? '').trim(); if (!symbol) continue;
      const i = list.findIndex((x) => x.symbol === symbol);
      const entry = { symbol, meaning: String(it.meaning ?? ''), mode: 'latex' as const };
      if (i >= 0) list[i] = { ...list[i], ...entry }; else list.push(entry);
      ns++;
    }
    store.setSymbols(list);
  }
  return `缩略语 ${na} 条、符号 ${ns} 条已写入`;
}

function settingsList(): string {
  const s = useStore.getState().doc.settings;
  const out: string[] = [];
  for (const a of AXES) {
    if (a.applies && !a.applies(s)) continue;
    out.push(`${String(a.key)}｜${a.label}｜${a.hint}｜可选：${a.choices.map((c) => `${c.value}=${c.label}`).join('，')}｜现在：${String(s[a.key])}`);
  }
  for (const d of SWITCHES) {
    if (d.applies && !d.applies(s)) continue;
    const r = resolveSwitch<any>(d, s);
    const cur = s[d.key];
    out.push(`${String(d.key)}｜${d.label}｜${d.hint}｜可选：auto，${d.choices.map((c) => `${String(c.value)}=${c.label}`).join('，')}｜现在：${cur === 'auto' ? `auto（落在 ${String(r.auto.value)}：${r.auto.reason}）` : String(cur)}`);
  }
  return out.join('\n');
}
async function settingsSet(input: Record<string, any>): Promise<string> {
  const s = useStore.getState().doc.settings;
  const key = String(input.key ?? '');
  const axis = AXES.find((a) => String(a.key) === key);
  const sw = SWITCHES.find((d) => String(d.key) === key);
  const def = axis ?? sw;
  if (!def) return `没有叫「${key}」的设置，先 settings_list 看看`;
  let value: unknown = input.value;
  if (typeof value === 'string' && value !== 'auto') { if (value === 'true') value = true; else if (value === 'false') value = false; }
  const ok = value === 'auto' ? !!sw : def.choices.some((c) => c.value === value);
  if (!ok) return `「${key}」不能设成 ${JSON.stringify(input.value)}，可选：${sw ? 'auto，' : ''}${def.choices.map((c) => String(c.value)).join('，')}`;
  const nameOf = (v: unknown) => (v === 'auto' ? '自动（跟模板）' : def.choices.find((c) => c.value === v)?.label ?? String(v));
  const cur = s[def.key];
  const allowed = await askUser({
    title: `${def.label}：${nameOf(cur)} → ${nameOf(value)}`,
    lines: [def.hint, sw ? `自动档现在落在：${nameOf(resolveSwitch<any>(sw, s).auto.value)}` : ''].filter(Boolean),
    reason: String(input.reason ?? ''),
  });
  if (!allowed) return '用户没有允许这次改动，设置没动';
  useStore.getState().setSettings({ [def.key]: value } as Partial<Settings>);
  return `已把「${def.label}」设成 ${nameOf(value)}`;
}

const uid = () => Math.random().toString(36).slice(2, 8);
function pdfOf(file: string): Attachment | string {
  const name = String(file ?? '').trim();
  const a = attachments.find((x) => x.kind === 'pdf' && x.name === name) ?? attachments.find((x) => x.kind === 'pdf');
  return a ?? `对话里没有 PDF 附件${name ? `「${name}」` : ''}；让用户把 PDF 发过来`;
}
async function pdfImagesTool(input: Record<string, any>): Promise<string> {
  const a = pdfOf(input.file); if (typeof a === 'string') return a;
  const list = await pdfImages(a.data, input.page ? Number(input.page) : undefined);
  if (!list.length) return `${a.name}${input.page ? ` 第 ${input.page} 页` : ''}里没有嵌的位图（图可能是矢量的，用 pdf_render 截那一页）`;
  const stem = a.name.replace(/\.pdf$/i, '');
  const names = list.map((im, i) => {
    const name = `${stem}-p${im.page}-${i + 1}.png`;
    addDerived({ id: uid(), name, type: 'image/png', size: Math.round(im.data.length * 0.75), kind: 'image', data: im.data });
    return `${name}（第 ${im.page} 页，${im.width}×${im.height}）`;
  });
  return `抽出 ${list.length} 张：\n${names.join('\n')}`;
}
async function pdfRenderTool(input: Record<string, any>): Promise<string> {
  const a = pdfOf(input.file); if (typeof a === 'string') return a;
  const crop = Array.isArray(input.crop) && input.crop.length === 4 ? (input.crop.map(Number) as [number, number, number, number]) : undefined;
  const r = await pdfRender(a.data, Number(input.page) || 1, Number(input.scale) || 2, crop);
  const name = `${a.name.replace(/\.pdf$/i, '')}-p${input.page}${crop ? '-crop' : ''}-${uid()}.png`;
  addDerived({ id: uid(), name, type: 'image/png', size: Math.round(r.data.length * 0.75), kind: 'image', data: r.data });
  return `已画成 ${name}（${r.width}×${r.height}；这份 PDF 共 ${r.pages} 页）`;
}

/** 从挂着的编辑器读 schema（没挂就找任一挂着的），节点 / 标记的属性默认值与内容表达式 */
function schemaText(): string {
  const ed = PART_KEYS.map((k) => getEditor(k)).find(Boolean);
  if (!ed) return '现在没有打开的编辑器，读不到 schema；先在左栏打开正文';
  const lines: string[] = ['节点（type｜能装的内容｜属性=默认值）：'];
  ed.schema.spec.nodes.forEach((name, spec: any) => {
    const attrs = Object.entries(spec.attrs ?? {}).map(([k, v]: [string, any]) => `${k}=${JSON.stringify(v?.default ?? null)}`).join(' ');
    lines.push(`- ${name}｜${spec.content ?? '（原子）'}${spec.group ? `｜组 ${spec.group}` : ''}${attrs ? `｜${attrs}` : ''}`);
  });
  lines.push('标记（marks，放在 text 节点的 marks 数组里）：');
  ed.schema.spec.marks.forEach((name, spec: any) => {
    const attrs = Object.entries(spec.attrs ?? {}).map(([k, v]: [string, any]) => `${k}=${JSON.stringify(v?.default ?? null)}`).join(' ');
    lines.push(`- ${name}${attrs ? `｜${attrs}` : ''}`);
  });
  lines.push('顶层块的 JSON 形如 {"type":"paragraph","attrs":{…},"content":[{"type":"text","text":"…","marks":[{"type":"bold"}]}]}；表是 tableFigure > table > tableRow > (tableHeader|tableCell) > paragraph；uid 属性别自己填，编辑器会补。');
  return lines.join('\n');
}
function readJson(key: RichKey, from: number, to: number): string {
  const blocks = blocksOf(key);
  if (!blocks.length) return '（这一部分是空的）';
  from = Math.max(0, from); to = Math.min(blocks.length - 1, to, from + 39);
  if (from > to) return `段号超出范围（共 ${blocks.length} 块）`;
  return JSON.stringify(blocks.slice(from, to + 1).map((b, i) => ({ '#': from + i, ...b })), null, 1);
}
function writeJson(key: RichKey, from: number, to: number, nodes: unknown): string {
  if (!Array.isArray(nodes)) return 'nodes 得是节点数组';
  const clean = nodes.map((n: any) => { const { '#': _i, ...rest } = n ?? {}; return rest; });
  for (const n of clean) if (!n || typeof n.type !== 'string') return '每个节点都要有 type';
  return splice(key, from, to, clean, '已按 JSON 写入');
}

function imagesText(): string {
  const imgs = useStore.getState().doc.images;
  const att = attachments.filter((a) => a.kind === 'image');
  return [`工程里的图片 ${imgs.length} 张${imgs.length ? '：\n' + imgs.map((i) => `${i.name}${i.width ? `（${i.width}×${i.height}）` : ''}`).join('\n') : ''}`, `对话里发来的图片附件 ${att.length} 张${att.length ? '：\n' + att.map((a) => a.name).join('\n') : ''}`].join('\n');
}

async function webFetch(url: string): Promise<string> {
  const u = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(u)) return '网址得以 http:// 或 https:// 开头';
  const reader = webConfig.reader.trim().replace(/\/+$/, '') + '/';
  const r = await fetch(reader + u, { headers: { Accept: 'text/plain' } });
  if (!r.ok) return `抓不到（http ${r.status}）：${u}`;
  const text = (await r.text()).trim();
  return text.length > 20000 ? text.slice(0, 20000) + '\n…（太长，截到 2 万字）' : text || '（页面没有可读的正文）';
}
async function webSearch(query: string): Promise<string> {
  const q = String(query ?? '').trim();
  if (!q) return '要搜什么？';
  if (!webConfig.searchKey.trim()) return '没有搜索密钥，只能抓用户给的网址（web_fetch）；在 Agent 设置里填 Jina 的密钥才能搜';
  const r = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${webConfig.searchKey.trim()}` } });
  if (!r.ok) return `搜索失败（http ${r.status}）`;
  const j = await r.json();
  const rows: any[] = j.data ?? [];
  if (!rows.length) return '没搜到';
  return rows.slice(0, 6).map((x, i) => `${i + 1}. ${x.title ?? ''}\n${x.url ?? ''}\n${String(x.description ?? x.content ?? '').slice(0, 400)}`).join('\n\n');
}

/** 跑一个工具，回给模型的是纯文本 */
const WRITES = new Set(['replace', 'insert', 'delete', 'table_write', 'figure_write', 'write_json', 'bib_add', 'abbreviations_add', 'info_write']);
export async function runTool(name: string, input: Record<string, any>): Promise<string> {
  const d0 = useStore.getState().doc;
  // 排版的计数与诊断要在动手之前记：短文档写完 0.1 秒就排完了，事后再记就错过了
  const c0 = { ...useCompileState.getState(), ser: useSerializeWarnings.getState().warnings };
  const out = await dispatch(name, input);
  if (!WRITES.has(name)) return out;
  // 编辑器 → store 有 100–150 ms 的节流，等它过去再看文档换没换
  await new Promise((r) => setTimeout(r, 250));
  return useStore.getState().doc === d0 ? out : afterWrite(out, c0);
}
/** 写完等排版落地（长文档先只编一章、停手一两秒后才整编，所以等到安静下来），新冒出来的错误接在结果后面
 *  （定位到第几块、附那块现在的 Markdown），模型好自己改。序列化时查出的（引用目标不存在、文献没登记）也算 */
async function afterWrite(msg: string, c0: { status: string; compileCount: number; diagnostics: Diagnostic[]; ser: string[] }): Promise<string> {
  if (c0.status !== 'ready') return msg;
  const t0 = Date.now();
  let last = Date.now(), count = c0.compileCount;
  report('写进去了，等排版看有没有报错…');
  while (Date.now() - t0 < 60000) {
    await new Promise((r) => setTimeout(r, 150));
    const s = useCompileState.getState();
    if (s.compiling || s.bgCompiling) report(s.bgCompiling ? '写进去了，等整篇重排…' : '写进去了，等排版看有没有报错…');
    if (s.compileCount !== count) { count = s.compileCount; last = Date.now(); }
    if (s.compiling || s.bgCompiling) { last = Date.now(); continue; }
    if (Date.now() - last > (count === c0.compileCount ? 5000 : 3200)) break;
  }
  if (count === c0.compileCount) return msg;
  // 错误全报；警告只报这次写完新冒出来的（找不到的引用、重复的标签这类），先前就有的不算
  const key = (d: Diagnostic) => `${d.severity}|${d.message}`;
  const before = new Set([...c0.diagnostics.map(key), ...c0.ser.map((m) => `ser|${m}`)]);
  const list = useCompileState.getState().diagnostics.filter((d) => d.severity === 'error' || !before.has(key(d))).map(describeDiag);
  for (const m of useSerializeWarnings.getState().warnings) if (!before.has(`ser|${m}`)) list.push(`- [警告] ${m}`);
  if (!list.length) return msg;
  const head = list.some((l) => l.startsWith('- [错误]')) ? '写进去之后排版报错了，请看着改（改完会再排一次）' : '写进去之后排版多了警告，看看是不是写错了';
  return `${msg}\n\n${head}：\n${list.join('\n')}`;
}
/** 一条诊断说给模型听：落在哪一部分第几块、人话 + Typst 原话、那一块现在的 Markdown */
function describeDiag(d: Diagnostic): string {
  const s = useCompileState.getState();
  const h = humanize(d.message);
  const at = locateDiagnostic(d.where, s.diagMain, s.diagSegments);
  let loc = '', md = '';
  if (at?.key === 'info') loc = '论文信息';
  else if (at) {
    const ed = getEditor(at.key);
    const label = PARTS.find((p) => p.key === at.key)?.label ?? at.key;
    if (ed) {
      const idx = ed.state.doc.resolve(Math.min(at.pos, ed.state.doc.content.size)).index(0);
      loc = `${label} 第 ${idx} 块`;
      const node = ed.state.doc.maybeChild(idx);
      if (node) md = toMarkdown({ type: 'doc', content: [node.toJSON()] } as RichDoc).slice(0, 400);
    } else loc = label;
  }
  const text = h.text === d.message ? d.message : `${h.text}（Typst：${d.message}）`;
  return `- [${d.severity === 'error' ? '错误' : '警告'}] ${loc ? `${loc}：` : ''}${text}${md ? `\n  这一块现在是：\n  ${md.replace(/\n/g, '\n  ')}` : ''}`;
}
async function dispatch(name: string, input: Record<string, any>): Promise<string> {
  const need = () => { const p = partOf(String(input.part ?? '')); if (!p) throw new Error(`part 得是 ${PART_KEYS.join(' / ')} 之一`); return p; };
  switch (name) {
    case 'outline': return outlineText();
    case 'read': return readText(need().key, Number(input.from), Number(input.to));
    case 'replace': { const p = need(); return splice(p.key, Number(input.from), Number(input.to), parseMd(String(input.markdown ?? ''), p.headings), '已换'); }
    case 'insert': { const p = need(); const at = Number(input.at); return splice(p.key, at, at - 1, parseMd(String(input.markdown ?? ''), p.headings), '已插入'); }
    case 'delete': return splice(need().key, Number(input.from), Number(input.to), [], '已删');
    case 'table_write': { const p = need(); if (!Array.isArray(input.rows) || !input.rows.length) return 'rows 得是二维数组'; const w = placeOf(input, p.key); if (typeof w === 'string') return w; return splice(p.key, w.from, w.to, [tableNode(input)], '表已写入'); }
    case 'figure_write': { const p = need(); const node = await figureNode(input); if (typeof node === 'string') return node; const w = placeOf(input, p.key); if (typeof w === 'string') return w; return splice(p.key, w.from, w.to, [node], '图已写入'); }
    case 'images': return imagesText();
    case 'selection': return selectionText();
    case 'diagnostics': return diagnosticsText();
    case 'check_order': return checkOrder();
    case 'guide': return guideTool(input);
    case 'run_python': return runPythonTool(input);
    case 'run_js': return runJsTool(input);
    case 'bridge_run': return bridgeRunTool(input);
    case 'bridge_ls': return bridgeLsTool(input);
    case 'bridge_read': return bridgeReadTool(input);
    case 'bridge_write': return bridgeWriteTool(input);
    case 'bib_list': return bibList(String(input.which ?? 'references'));
    case 'bib_add': return bibAdd(String(input.which ?? 'references'), String(input.bibtex ?? ''));
    case 'info_read': return infoRead();
    case 'info_write': return infoWrite(input.patch ?? {});
    case 'abbreviations': return abbreviations();
    case 'abbreviations_add': return abbreviationsAdd(input);
    case 'schema': return schemaText();
    case 'read_json': return readJson(need().key, Number(input.from), Number(input.to));
    case 'write_json': return writeJson(need().key, Number(input.from), Number(input.to), input.nodes);
    case 'settings_list': return settingsList();
    case 'settings_set': return settingsSet(input);
    case 'pdf_images': return pdfImagesTool(input);
    case 'pdf_render': return pdfRenderTool(input);
    case 'memory_read': return memoryCtx.enabled ? (memoryCtx.notes.trim() || '（记忆还是空的）') : '记忆功能没开';
    case 'memory_write': {
      if (!memoryCtx.enabled) return '记忆功能没开，用户在 Agent 设置里能打开';
      const text = String(input.text ?? '').trim(); if (!text) return '要记什么？';
      const notes = input.mode === 'replace' ? text : [memoryCtx.notes.trim(), text].filter(Boolean).join('\n');
      if (notes.length > 20000) return '记忆太长了（超过 2 万字），先用 replace 整理一下';
      memoryCtx.notes = notes; await memoryCtx.write(notes);
      return `已记住（现在 ${notes.split('\n').length} 条）`;
    }
    case 'web_fetch': return webFetch(input.url);
    case 'web_search': return webSearch(input.query);
    default: throw new Error(`没有这个工具：${name}`);
  }
}

export const SYSTEM_PROMPT = `你是 HιT webapp 里的写作助手（名字读 iota hit，hit 就念英文 hit 那个词；谐音 I ought hit——iota hit thesis 即 I ought hit thesis，「我该写论文了」）。HιT webapp 是哈尔滨工业大学学位论文的所见即所得编辑器，排版由 iota-hit 模板按学校规范自动完成，用户只管内容。
文档分成几部分（摘要、正文、结论、附录、致谢、简历），每部分是一串块（标题、段落、公式、图、表、列表……），用工具按「部分 + 段号」读和改。读回来、写回去的都是下面这种 Markdown，每种节点都有写法：
- 标题：# 到 ####，尾巴可带属性 {#sec:标签 en="English title" .unnumbered}。
- 段落：普通 Markdown；**粗** *斜* ~~删~~ \`代码\` [链接](url)；<u>下划线</u> <sub>下标</sub> <sup>上标</sup> <mark>突出</mark> <span color="#ff0000">红字</span> <span font="heiti">黑体</span>（中文角色 songti/heiti/kaishu/fangsong，西文角色 serif/sans——西文标点、弯引号归西文字体）<span size="sanhao">三号</span>；段尾 {.noindent} 不缩进；行尾两个空格换行。
- 行内公式：$…$ 里写 LaTeX（如 $p = \\rho R T$、$x_1^2$；\\(…\\) 也认），紧贴着写、里面不放汉字；变量、上下标、希腊字母一律进公式，不要用 Unicode 上下标（x₁、m²）或纯文字冒充。
- 行内：[@key] 引参考文献（多条 [@a; @b]，带页码 [@key, p. 15]，叙述式 [@key]{.prose}、只印作者 {.author}、只印年份 {.year}），@fig:x / @tab:x / @eq:x / @sec:x / @alg:x / @lst:x / @thm:x 交叉引用，@缩略语键 缩略语（如 @FEM，首次出现自动展开为全称），^[脚注文字] 脚注，[词]{.index} 索引项，<ccwd/> 一个汉字宽的空格。
- 行间公式：单独一段 $$ 一行 LaTeX $$（\\[…\\] 也认），收尾后可带 {#eq:标签} 或 {.unnumbered}。
- 图：![题注](图片名){#fig:标签 width=8 en="Caption" placement=top}（宽度厘米；placement 是浮动：不写就就地排，auto / top / bottom 让它浮到页顶或页底）；分图（一张图里几个 (a)(b) 小图）写成 ::: {.figure #fig:x caption="总题" columns=2} 里放几行 ![子题](图){width=6} :::，模板自己排版、编 (a)(b)，不要自己在题注里写 (a)(b) 或把几张单图硬拼；columns=0 一行排完，小图不写 width 就自动等高，整组宽写 width="12cm"；subLabel=tl/tr/bl/br 把 (a)(b) 直接印在小图的那个角上（subLabelFill=white 印白字，深色图用）；subMode=inline 把分图题连排在总题注下面。引用某个小图写 @fig:x-a。
- 表：GFM 表格（格内换行写 <br>），紧跟一行 Table: 题注 {#tab:标签 en="Caption" fit=window placement=top}（fit：content 按内容、window 撑满、fixed 定宽 colWidth=2.5；placement 同图）。
- 图注 / 表注（表下、图题上那行说明）：紧跟在 Table: 行或图那一行的下一行写 Note: 说明文字；引导词默认「注：」，Note(资料来源): … 换引导词，Note(无): … 不印引导词；几条就写几行。不要把注另起一段写。
- 代码块：\`\`\`语言；要编号带题注的代码清单：\`\`\`python {#lst:标签 .listing caption="题注"}。
- 算法：::: {.algorithm #alg:x caption="题注"} 里先写 > 输入：… / > 输出：…，再每行一条 - 步骤，缩进两格是下一层 :::。
- 定理族：::: {.theorem #thm:x note="Euler"} … :::，类名可换成 lemma / definition / proposition / corollary / axiom / assumption / example / remark / problem / conjecture / fact / exercise / proof。
- 公式下面的「式中」说明：::: {.denote} 每行 - $符号$ — 含义 :::。
- 分页：单独一行 \\newpage。引用块 >、列表 - / 1.、分隔线 --- 照 Markdown。
- 旧文档里可能出现 \`\`\`iota-node 围栏或 <!--iota-…--> 注释，原样保留就行。
你能做的：读改各部分的文字；用 table_write 写表（单元格里 \\n 换行，能定列宽方式）、figure_write 插图（工程里的图、用户发来的图片附件、或用 pdf_images / pdf_render 从 PDF 附件里抽出来的图）——直接在 Markdown 里写图和表也行；往参考文献表 / 成果表加 BibTeX 条目（bib_add）；改论文信息（info_write，日期字段是「YYYY-MM」）；加缩略语和符号；看编译诊断；改论文设置（settings_set，每次都会弹窗请用户允许）。工具表里有 web_search / web_fetch 时能联网：查来的东西要给出处（网址），没有就不要说查过。
用户问导出 Word（.docx，顶栏「下载」里）：封面 / 内封照校方范例抄、正文按排版出的 PDF 逐页对拍过，浮动图表在 Word 里是图文框；已知差别只有两处——续表没有「（续表）」题，博士论文第 1 页落在偶数页时 Word 会自己补一张白页（双面奇偶页眉的规矩）。
规矩：
- 先 outline 或 read 看清楚再改，改动尽量小，只换需要改的那几块；不要改标题的标签、引用键。
- 引用文献要先有条目：表里没有就用 bib_add 加进去再在正文里写 [@key]，不要编造文献；拿不准的出处要向用户确认。
- 缩略语：先用 abbreviations_add 登记（key、中文全称、英文全称），正文里写 @key，模板会在首次出现处展开成「全称（缩写）」、之后只印缩写；不要自己手写「有限元法（FEM）」。
- 做不到的事直说做不到、为什么，不要绕弯子也不要假装做了；用户可以自己在编辑器里做的，告诉他在哪儿做。
- 行文照学位论文的规范：客观、书面、不用第一人称口语；中文用全角标点。
- 引号：中文一律用弯引号“ ”‘ ’，禁止「」『』；英文一律用直引号 " 和 '，模板的智能引号会把成对的直引号排成弯的、走西文字体。非要写不成对的英文引号（’90s 这种）就手打弯引号 ’ 或 ”，并套上 <span font="serif">…</span> 让它用西文字体。
- 图表善用浮动（placement）：大图、整页的表让它浮到页顶或页底，正文就不会留大片空白。但编号是照正文顺序编的，浮动块会漂到后面的页，规范要求全文编号由小到大、先见文后见图——插了浮动图表、改了 placement 或挪了图之后，用 check_order 按排版结果查一遍，乱了就调（往前挪、去浮动、改 bottom）。
- Markdown 写不出的（合并单元格、批注、某个属性），用 schema 看节点结构，再 read_json / write_json 直接改节点 JSON；平常改文字还是用 Markdown。
- 中文与西文、数字之间不加空格（不要「盘古之白」，间距由模板排版时自动加）：「采用 Ergun 方程」是错的，要写「采用Ergun方程」；也别把原文里没有的空格加上。
- 每次改完用一两句话说明改了什么；不确定用户想要什么就先问。
- 回答用用户的语言，简短；代码和公式用 Markdown 的写法（\`\`\` 围栏、$…$）。`;
