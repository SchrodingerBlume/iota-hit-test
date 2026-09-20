// 撤消列表：给每个历史事件起 Word 那样的名字（键入 / 清除 / 粘贴 / 加粗…）。深度以 prosemirror-history 为准，
// 名字对不上数就补「编辑」；连着打的字并进同一条「键入」
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import type { Node as PMNode, Slice, Fragment } from '@tiptap/pm/model';
import { undoDepth, redoDepth, isHistoryTransaction } from '@tiptap/pm/history';
import { AddMarkStep, RemoveMarkStep, ReplaceStep, ReplaceAroundStep, AttrStep } from '@tiptap/pm/transform';
import { t } from '../i18n';

export interface HistoryEntry { label: string; text?: string }
interface Log { undo: HistoryEntry[]; redo: HistoryEntry[]; depth: number }
const logs = new WeakMap<Editor, Log>();
const logOf = (editor: Editor) => { let l = logs.get(editor); if (!l) { l = { undo: [], redo: [], depth: 0 }; logs.set(editor, l); } return l; };

export const historyLog = (editor: Editor): Log => logOf(editor);

export function entryText(e: HistoryEntry): string {
  if (!e.text) return e.label;
  const s = e.text.length > 20 ? `${e.text.slice(0, 20)}…` : e.text;
  return `${e.label} "${s}"`;
}

export function trackHistory(editor: Editor, tr: Transaction) {
  const log = logOf(editor);
  const depth = undoDepth(editor.state);
  if (isHistoryTransaction(tr)) {
    if (depth < log.depth) { const e = log.undo.pop(); if (e) log.redo.push(e); }
    else if (depth > log.depth) { const e = log.redo.pop(); if (e) log.undo.push(e); }
  } else if (tr.docChanged) {
    if (depth > log.depth) { log.undo.push(describe(tr)); log.redo.length = 0; }
    else if (depth === log.depth && depth > 0) extend(log.undo[log.undo.length - 1], tr);
  }
  fit(log.undo, depth);
  fit(log.redo, redoDepth(editor.state));
  log.depth = depth;
}

function fit(list: HistoryEntry[], n: number) {
  if (list.length > n) list.splice(0, list.length - n);
  while (list.length < n) list.unshift({ label: t("编辑") });
}

const MARKS: Record<string, () => string> = {
  bold: () => t("加粗"), italic: () => t("倾斜"), underline: () => t("下划线"), strike: () => t("删除线"),
  subscript: () => t("下标"), superscript: () => t("上标"),
};
const INSERT: Record<string, () => string> = {
  table: () => t("插入表格"), tableFigure: () => t("插入表格"), tableRow: () => t("插入行"), tableCell: () => t("插入列"), tableHeader: () => t("插入列"),
  figure: () => t("插入图片"), equation: () => t("公式插入"), mathInline: () => t("公式插入"), eqdenote: () => t("插入符号说明"),
  pageBreak: () => t("分页符"), hardBreak: () => t("换行符"), footnote: () => t("插入脚注"), cite: () => t("插入引文"), ref: () => t("交叉引用"),
  idx: () => t("标记索引项"), abbr: () => t("插入缩略语"), ccwd: () => t("插入符号"), algorithm: () => t("插入伪代码"), codeFigure: () => t("插入代码"), codeBlock: () => t("插入代码"),
  bulletList: () => t("项目符号"), orderedList: () => t("编号"), listItem: () => t("项目符号和编号"), heading: () => t("样式"), paragraph: () => t("样式"), blockquote: () => t("段落格式"),
};
const REMOVE: Record<string, () => string> = { table: () => t("删除表格"), tableFigure: () => t("删除表格"), tableRow: () => t("删除行"), tableCell: () => t("删除列"), tableHeader: () => t("删除列") };
const FORMAT: Record<string, () => string> = {
  paragraph: () => t("段落格式"), heading: () => t("样式"), figure: () => t("设置图片格式"), table: () => t("表格属性"), tableFigure: () => t("表格属性"),
  tableRow: () => t("表格属性"), tableCell: () => t("单元格对齐方式"), tableHeader: () => t("单元格对齐方式"),
};

function describe(tr: Transaction): HistoryEntry {
  const custom = tr.getMeta('undoLabel');
  if (typeof custom === 'string') return { label: custom };
  if (tr.getMeta('paste')) return { label: t("粘贴") };
  const ui = tr.getMeta('uiEvent');
  if (ui === 'cut') return { label: t("剪切") };
  if (ui === 'drop') return { label: t("移动") };
  let text = '', removed = false, inserted = false, structural: string | undefined;
  const marks: { name: string; add: boolean }[] = [];
  tr.steps.forEach((step, i) => {
    const doc = tr.docs[i];
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) { marks.push({ name: step.mark.type.name, add: step instanceof AddMarkStep }); return; }
    if (step instanceof AttrStep) { structural ??= FORMAT[doc.nodeAt(step.pos)?.type.name ?? '']?.(); return; }
    if (step instanceof ReplaceAroundStep) {
      const was = doc.nodeAt(step.from), now = step.slice.content.firstChild;
      const kind = now?.type.name ?? was?.type.name ?? '';
      structural ??= (was && now && was.type === now.type ? FORMAT[kind] ?? INSERT[kind] : INSERT[kind])?.();
      return;
    }
    if (!(step instanceof ReplaceStep)) return;
    if (step.from < step.to) {
      removed = true;
      structural ??= match(closedNodes(doc.slice(step.from, step.to)), REMOVE);
    }
    if (step.slice.size) {
      inserted = true;
      step.slice.content.descendants((n) => { if (n.isText) text += n.text ?? ''; return true; });
      structural ??= match(closedNodes(step.slice).filter((n) => !n.isTextblock), INSERT);
    }
  });
  if (structural) return { label: structural };
  if (marks.length && !text && !removed) return { label: markLabel(marks) };
  if (inserted) return { label: t("键入"), text };
  if (removed) return { label: t("清除") };
  return { label: t("编辑") };
}

/** 切片里整个儿在里面的节点（两头敞开的外壳不算——那是拆段、并段留下的边界，不是插进来的东西） */
function closedNodes(slice: Slice): PMNode[] {
  const out: PMNode[] = [];
  const walk = (frag: Fragment, openStart: number, openEnd: number) => frag.forEach((n, _, i) => {
    const s = openStart > 0 && i === 0, e = openEnd > 0 && i === frag.childCount - 1;
    if (!s && !e) out.push(n);
    else if (!n.isText) walk(n.content, s ? openStart - 1 : 0, e ? openEnd - 1 : 0);
  });
  walk(slice.content, slice.openStart, slice.openEnd);
  return out;
}

function match(nodes: PMNode[], table: Record<string, () => string>): string | undefined {
  for (const n of nodes) {
    let hit: (() => string) | undefined = table[n.type.name];
    if (!hit) n.descendants((d) => { hit ??= table[d.type.name]; return !hit; });
    if (hit) return hit();
  }
  return undefined;
}

function markLabel(marks: { name: string; add: boolean }[]): string {
  const { name, add } = marks[0];
  if (name === 'link') return add ? t("插入超链接") : t("删除超链接");
  if (name === 'comment') return add ? t("插入批注") : t("删除批注");
  if (!add && new Set(marks.map((m) => m.name)).size > 1) return t("清除格式");
  return MARKS[name]?.() ?? t("字体格式");
}

/** 并进上一条事件（prosemirror 把连着的输入合成一组）：接着记打的字 */
function extend(entry: HistoryEntry, tr: Transaction) {
  if (entry.text === undefined) return;
  for (const step of tr.steps) {
    if (!(step instanceof ReplaceStep)) continue;
    let text = '';
    step.slice.content.descendants((n: PMNode) => { if (n.isText) text += n.text ?? ''; return true; });
    if (text) entry.text += text;
    else if (step.from < step.to) entry.text = entry.text.slice(0, Math.max(0, entry.text.length - (step.to - step.from)));
  }
}
