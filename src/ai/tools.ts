// Agent 能对文档做的事：按「部分 + 段号」读写。段号是富文本顶层块的下标（标题也是一块），读回来的
// Markdown 每块前带 <!-- #n --> 标；改动走挂着的编辑器（一笔事务、能撤消），没挂就直接改工程里那份
import type { Editor } from '@tiptap/core';
import { useStore, type RichKey } from '../model/store';
import type { RichDoc } from '../model/types';
import { getEditor } from '../editor/registry';
import { toMarkdown, fromMarkdown } from '../editor/markdown';
import { useCompileState } from '../compiler/client';
import { splitNames } from '../bib/bibtex';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }

export const PARTS: { key: RichKey; label: string; headings: boolean }[] = [
  { key: 'abstractZh', label: "中文摘要", headings: false },
  { key: 'abstractEn', label: "英文摘要", headings: false },
  { key: 'body', label: "正文", headings: true },
  { key: 'conclusion', label: "结论", headings: false },
  { key: 'appendix', label: "附录", headings: true },
  { key: 'acknowledgement', label: "致谢", headings: false },
  { key: 'resume', label: "简历", headings: false },
];
const PART_KEYS = PARTS.map((p) => p.key);
const partEnum = { type: 'string', enum: PART_KEYS, description: "哪一部分：abstractZh 中文摘要、abstractEn 英文摘要、body 正文、conclusion 结论、appendix 附录、acknowledgement 致谢、resume 简历" };

export const TOOLS: ToolDef[] = [
  { name: 'outline', description: "看整篇的结构：各部分有多少块，正文与附录的标题树（带段号）。改之前先看这个。", parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read', description: "读某一部分第 from 到 to 块（含两端，0 起数）的 Markdown，每块前有 <!-- #n --> 段号标。一次最多 80 块。", parameters: { type: 'object', properties: { part: partEnum, from: { type: 'integer', minimum: 0 }, to: { type: 'integer', minimum: 0 } }, required: ['part', 'from', 'to'], additionalProperties: false } },
  { name: 'replace', description: "用 Markdown 换掉某一部分第 from 到 to 块（含两端）。块数可以变。只改需要改的那几块；标题、公式、图表、引用键、标签照原样留着。", parameters: { type: 'object', properties: { part: partEnum, from: { type: 'integer', minimum: 0 }, to: { type: 'integer', minimum: 0 }, markdown: { type: 'string' } }, required: ['part', 'from', 'to', 'markdown'], additionalProperties: false } },
  { name: 'insert', description: "在某一部分第 at 块之前插入 Markdown（at 等于块数就是接在末尾）。", parameters: { type: 'object', properties: { part: partEnum, at: { type: 'integer', minimum: 0 }, markdown: { type: 'string' } }, required: ['part', 'at', 'markdown'], additionalProperties: false } },
  { name: 'delete', description: "删掉某一部分第 from 到 to 块（含两端）。", parameters: { type: 'object', properties: { part: partEnum, from: { type: 'integer', minimum: 0 }, to: { type: 'integer', minimum: 0 } }, required: ['part', 'from', 'to'], additionalProperties: false } },
  { name: 'selection', description: "用户现在在编辑器里选中的是哪一部分的哪几块，以及选中的文字。用户说「这段」「选中的」时先调它。", parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'diagnostics', description: "最近一次排版编译的错误与警告。", parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'references', description: "参考文献表里有哪些条目（引用键、作者、年份、题名），正文里引用写 [@引用键]。", parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'thesis', description: "这篇论文的基本信息：题目、作者、学位、阶段、校区、语言。", parameters: { type: 'object', properties: {}, additionalProperties: false } },
];

const partOf = (key: string) => PARTS.find((p) => p.key === key) ?? null;
const richOf = (key: RichKey): RichDoc => (useStore.getState().doc as any)[key] ?? { type: 'doc', content: [] };
const blocksOf = (key: RichKey): any[] => (getEditor(key)?.getJSON().content as any[] | undefined) ?? richOf(key).content ?? [];
const headingText = (b: any): string => (b.content ?? []).map((n: any) => n.text ?? '').join('');
const MARK = /<!--\s*#\d+\s*-->\s*/g;

export function outlineText(): string {
  const lines: string[] = [];
  for (const p of PARTS) {
    const blocks = blocksOf(p.key);
    if (!blocks.length || (blocks.length === 1 && !blocks[0].content?.length)) continue;
    lines.push(`${p.key}（${p.label}）：${blocks.length} 块`);
    if (p.headings) blocks.forEach((b, i) => { if (b.type === 'heading') lines.push(`  #${i} ${'#'.repeat(b.attrs?.level ?? 1)} ${headingText(b)}`); });
    else lines.push(`  #0 ${toMarkdown({ type: 'doc', content: [blocks[0]] }).slice(0, 80)}`);
  }
  return lines.join('\n') || "（文档是空的）";
}

function readText(key: RichKey, from: number, to: number): string {
  const blocks = blocksOf(key);
  if (!blocks.length) return "（这一部分是空的）";
  from = Math.max(0, from); to = Math.min(blocks.length - 1, to, from + 79);
  if (from > to) return `段号超出范围（共 ${blocks.length} 块）`;
  return blocks.slice(from, to + 1).map((b, i) => `<!-- #${from + i} -->\n${toMarkdown({ type: 'doc', content: [b] })}`).join('\n\n');
}

/** 把 [from, to] 换成 nodes（nodes 空 = 删）：编辑器挂着就走一笔事务，否则改工程 */
function splice(key: RichKey, from: number, to: number, nodes: any[]): string {
  const ed: Editor | undefined = getEditor(key);
  const blocks = blocksOf(key);
  if (from < 0 || from > blocks.length || to < from - 1 || to >= blocks.length) return `段号超出范围（共 ${blocks.length} 块）`;
  if (ed) {
    const doc = ed.state.doc;
    let pos = 0;
    const starts: number[] = [];
    doc.forEach((node, offset) => { starts.push(offset); pos = offset + node.nodeSize; });
    starts.push(pos);
    const a = starts[from], b = starts[to + 1];
    const pm = nodes.map((n) => ed.schema.nodeFromJSON(n));
    try { pm.forEach((n) => n.check()); } catch (e) { return `Markdown 转不成文档节点：${(e as Error).message}`; }
    const step = ed.state.tr.replaceWith(a, b, pm);
    step.setMeta('undoLabel', "AI 编辑");
    ed.view.dispatch(step);
  } else {
    const next = [...blocks]; next.splice(from, to - from + 1, ...nodes);
    useStore.getState().setRich(key, { type: 'doc', content: next.length ? next : [{ type: 'paragraph' }] });
  }
  const total = blocksOf(key).length;
  return nodes.length ? `已把第 ${from}–${to} 块换成 ${nodes.length} 块（这一部分现在共 ${total} 块；用户可在撤消里回退）` : `已删掉第 ${from}–${to} 块（共 ${total} 块）`;
}

function parseMd(md: string, headings: boolean): any[] {
  const doc = fromMarkdown(md.replace(MARK, ''), headings);
  return doc.content ?? [];
}

function selectionText(): string {
  const key = PART_KEYS.find((k) => getEditor(k)?.isFocused) ?? PART_KEYS.find((k) => { const e = getEditor(k); return e && !e.state.selection.empty; });
  const ed = key ? getEditor(key) : undefined;
  if (!key || !ed) return "现在没有选中的内容";
  const { from, to, empty } = ed.state.selection;
  let i = 0, a = -1, b = -1;
  ed.state.doc.forEach((node, offset) => { const end = offset + node.nodeSize; if (a < 0 && from < end) a = i; if (to > offset) b = i; i++; });
  if (a < 0) return "现在没有选中的内容";
  const text = empty ? '' : ed.state.doc.textBetween(from, to, '\n');
  const rng = b > a ? `–${b}` : '';
  return `${key} 第 ${a}${rng} 块${empty ? '（光标在这里，没有选中文字）' : `，选中的文字：\n${text}`}`;
}

function diagnosticsText(): string {
  const ds = useCompileState.getState().diagnostics;
  if (!ds.length) return "最近一次编译没有错误或警告";
  return ds.slice(0, 40).map((d) => `[${d.severity}] ${d.message}${d.where ? `（${d.where}）` : ''}`).join('\n');
}

function referencesText(): string {
  const refs = useStore.getState().doc.references ?? [];
  if (!refs.length) return "参考文献表是空的";
  return refs.slice(0, 200).map((e) => { const who = splitNames(e.fields.author ?? e.fields.editor ?? '').slice(0, 2).join(', '); const year = (e.fields.year ?? e.fields.date ?? '').slice(0, 4); return `${e.key}｜${who}${year ? ` ${year}` : ''}｜${e.fields.title ?? ''}`; }).join('\n');
}

function thesisText(): string {
  const { doc } = useStore.getState();
  const s = doc.settings;
  return [`题目：${doc.info.title || "（未填）"}`, `作者：${doc.info.author || "（未填）"}`, `学位：${s.degreeLevel}`, `阶段：${s.stage}`, `校区：${s.campus}`, `语言：${s.lang}`, `文种：${s.form}`].join('\n');
}

/** 跑一个工具，回给模型的是纯文本 */
export function runTool(name: string, input: Record<string, any>): string {
  const need = (k: string) => { const p = partOf(String(input[k] ?? '')); if (!p) throw new Error(`part 得是 ${PART_KEYS.join(' / ')} 之一`); return p; };
  switch (name) {
    case 'outline': return outlineText();
    case 'read': return readText(need('part').key, Number(input.from), Number(input.to));
    case 'replace': { const p = need('part'); return splice(p.key, Number(input.from), Number(input.to), parseMd(String(input.markdown ?? ''), p.headings)); }
    case 'insert': { const p = need('part'); const at = Number(input.at); return splice(p.key, at, at - 1, parseMd(String(input.markdown ?? ''), p.headings)); }
    case 'delete': return splice(need('part').key, Number(input.from), Number(input.to), []);
    case 'selection': return selectionText();
    case 'diagnostics': return diagnosticsText();
    case 'references': return referencesText();
    case 'thesis': return thesisText();
    default: throw new Error(`没有这个工具：${name}`);
  }
}

export const SYSTEM_PROMPT = "你是 iota4web 里的写作助手。iota4web 是哈尔滨工业大学学位论文的所见即所得编辑器，排版由 iota-hit 模板按学校规范自动完成，用户只管内容。\n文档分成几部分（摘要、正文、结论、附录、致谢……），每部分是一串块（标题、段落、公式、图、表、列表……），用工具按「部分 + 段号」读和改。\n读回来的是 Markdown：# 是标题（正文按章节层级），$…$ 是行内公式，[@key] 是引参考文献，@fig:xx / @tab:xx / @eq:xx 是交叉引用，^[…] 是脚注；```iota-node 围起来的 JSON 块和 <!--iota-inline:…--> 注释是编辑器专有的节点（图、表、公式、缩略语等），改动时原样保留，不要重写它们。\n规矩：\n- 先 outline 或 read 看清楚再改，改动尽量小，只换需要改的那几块；不要改标题的编号、标签、引用键。\n- 不要编造参考文献；要引用就用 references 里已有的键。\n- 行文照学位论文的规范：客观、书面、不用第一人称口语；中文用全角标点。\n- 每次改完用一两句话说明改了什么；不确定用户想要什么就先问。\n- 用用户说话的语言回答，简短。";
