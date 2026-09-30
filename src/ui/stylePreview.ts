// 样式组的悬停预览（Word 的实时预览）：悬停先把样式临时套到选区所在的段落 / 标题上，
// 离开就还原；预览事务不进历史，点下去先还原再由真命令提交。
import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { newUid } from '../editor/extensions/UniqueId';

type Block = { pos: number; type: string; attrs: Record<string, unknown> };

export function useStylePreview(ed: Editor | null) {
  const state = useRef<{ timer: number; blocks: Block[] | null; doc: unknown }>({ timer: 0, blocks: null, doc: null });
  const alive = useRef(ed);
  alive.current = ed;

  const revert = () => {
    const s = state.current;
    if (s.timer) { clearTimeout(s.timer); s.timer = 0; }
    const editor = alive.current;
    if (s.blocks && editor && !editor.isDestroyed && editor.state.doc === s.doc) {
      const tr = editor.state.tr;
      let changed = false;
      for (const b of s.blocks) {
        const node = editor.state.doc.nodeAt(b.pos);
        if (!node || (node.type.name === b.type && JSON.stringify(node.attrs) === JSON.stringify(b.attrs))) continue;
        tr.setNodeMarkup(b.pos, editor.schema.nodes[b.type], b.attrs);
        changed = true;
      }
      if (changed) { tr.setMeta('addToHistory', false); editor.view.dispatch(tr); }
    }
    s.blocks = null; s.doc = null;
  };

  const hover = (level: 0 | 1 | 2 | 3 | 4) => {
    revert();
    const editor = alive.current;
    if (!editor || editor.isDestroyed) return;
    state.current.timer = window.setTimeout(() => {
      state.current.timer = 0;
      const e2 = alive.current;
      if (!e2 || e2.isDestroyed) return;
      const blocks: Block[] = [];
      const { from, to, $from } = e2.state.selection;
      if (from === to) {
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.isTextblock) { blocks.push({ pos: $from.before(d), type: n.type.name, attrs: { ...n.attrs } }); break; }
        }
      } else {
        e2.state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.isTextblock && (node.type.name === 'paragraph' || node.type.name === 'heading')) blocks.push({ pos, type: node.type.name, attrs: { ...node.attrs } });
          return true;
        });
      }
      const want = level === 0 ? 'paragraph' : 'heading';
      // skipTrailingNode：TrailingNode 补段后不会再删，预览还原就会剩一个空段；
      // 顺带把 uid 先配好，免得 UniqueId 的追加事务把 skip 绕过去
      const tr = e2.state.tr.setMeta('skipTrailingNode', true);
      let changed = false;
      for (const b of blocks) {
        if (b.type === want && (level === 0 || b.attrs.level === level)) continue;
        tr.setNodeMarkup(b.pos, e2.schema.nodes[want], level === 0 ? b.attrs : { ...b.attrs, level, uid: (b.attrs.uid as string) ?? newUid() });
        changed = true;
      }
      if (!changed) return;
      tr.setMeta('addToHistory', false);
      e2.view.dispatch(tr);
      state.current.blocks = blocks; state.current.doc = e2.state.doc;
    }, 220);
  };

  useEffect(() => () => revert(), []);
  return { hover, leave: revert };
}
