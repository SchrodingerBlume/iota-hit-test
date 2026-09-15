// 活着的富文本编辑器登记表：预览区直接编辑要找到「这段字属于哪个编辑器」再往里发命令。
// 编辑器挂上来登记、卸下去注销；换节时新编辑器可能晚一拍才挂上，whenReady 等它。
import type { Editor } from '@tiptap/core';
import type { RichKey } from '../model/store';

const editors = new Map<RichKey, Editor>();
const metas = new Map<RichKey, EditorMeta>();
const listeners = new Set<() => void>();

export interface EditorMeta { blocks: boolean; headings: boolean }

export function registerEditor(key: RichKey, editor: Editor, meta: EditorMeta = { blocks: true, headings: true }) {
  editors.set(key, editor);
  metas.set(key, meta);
  for (const l of listeners) l();
}
export const getEditorMeta = (key: RichKey): EditorMeta | undefined => metas.get(key);
export function unregisterEditor(key: RichKey, editor: Editor) {
  if (editors.get(key) === editor) editors.delete(key);
  for (const l of listeners) l();
}
export const getEditor = (key: RichKey): Editor | undefined => editors.get(key);
export function onRegistryChange(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
/** 等这份富文本的编辑器挂上来（切节之后） */
export function whenEditorReady(key: RichKey, timeoutMs = 1500): Promise<Editor | null> {
  const hit = editors.get(key);
  if (hit && !hit.isDestroyed) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const off = onRegistryChange(() => { const e = editors.get(key); if (e) { off(); window.clearTimeout(t); resolve(e); } });
    const t = window.setTimeout(() => { off(); resolve(editors.get(key) ?? null); }, timeoutMs);
  });
}
