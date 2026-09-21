// 给能被引用的节点（标题、图、表、公式）补一个稳定的 uid，作 Typst 标签用：
// 为图、表、公式和标题维护唯一标签，并修复复制粘贴产生的重复 uid。
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const TYPES = new Set(['heading', 'figure', 'tableFigure', 'equation', 'algorithm', 'codeFigure', 'theorem']);

export const newUid = () => Math.random().toString(36).slice(2, 8);

export const UniqueId = Extension.create({
  name: 'uniqueId',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('uniqueId'),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          const seen = new Set<string>();
          const tr = state.tr;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (!TYPES.has(node.type.name)) return;
            const uid = node.attrs.uid as string | null;
            if (!uid || seen.has(uid)) {
              const fresh = newUid();
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, uid: fresh });
              seen.add(fresh);
              changed = true;
            } else {
              seen.add(uid);
            }
          });
          return changed ? tr : null;
        },
      }),
    ];
  },
});
