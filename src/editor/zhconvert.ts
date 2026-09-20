// 审阅页的「简转繁 / 繁转简」：zhconv-rs 的 wasm（MediaWiki + OpenCC 转换表，按词组语境分「皇后」与「后台」）。
// 1.7 MB，第一次用才加载。有选区改选区，没有就改这一节整篇；标记原样留着
import type { Editor } from '@tiptap/core';
import { t } from '../i18n';

let ready: Promise<(text: string, target: string) => string> | null = null;
function load() {
  return ready ??= (async () => {
    const [bg, { default: init }] = await Promise.all([import('zhconv/zhconv_bg.js'), import('zhconv/zhconv_bg.wasm?init')]);
    const inst = await init({ './zhconv_bg.js': bg as unknown as WebAssembly.ModuleImports });
    bg.__wbg_set_wasm(inst.exports);
    return bg.zhconv as (text: string, target: string) => string;
  })();
}

export async function convertChinese(ed: Editor, target: 'zh-Hant' | 'zh-Hans'): Promise<boolean> {
  const conv = await load();
  const { from, to, empty } = ed.state.selection;
  const range = empty ? { from: 0, to: ed.state.doc.content.size } : { from, to };
  const edits: { from: number; to: number; text: string; marks: readonly import('@tiptap/pm/model').Mark[] }[] = [];
  ed.state.doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!node.isText || !node.text) return;
    const s = Math.max(pos, range.from), e = Math.min(pos + node.nodeSize, range.to);
    const text = node.text.slice(s - pos, e - pos);
    const next = conv(text, target);
    if (next !== text) edits.push({ from: s, to: e, text: next, marks: node.marks });
  });
  if (!edits.length) return false;
  const tr = ed.state.tr;
  for (const c of edits.reverse()) tr.replaceWith(c.from, c.to, ed.schema.text(c.text, c.marks));
  tr.setMeta('undoLabel', target === 'zh-Hant' ? t("简转繁") : t("繁转简"));
  if (!empty) tr.setSelection(ed.state.selection.map(tr.doc, tr.mapping));
  ed.view.dispatch(tr);
  return true;
}
