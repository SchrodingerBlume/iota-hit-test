// 预览区里在编辑时，左侧编辑器没有焦点，浏览器不画光标；这里用装饰画一个跟着选区走的
// 「影子光标」（或选区高亮），两边永远指着同一处。开关由 RichEditor 按预览的焦点状态拨。
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const mirrorCaretKey = new PluginKey<boolean>('mirrorCaret');

export const MirrorCaret = Extension.create({
  name: 'mirrorCaret',
  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: mirrorCaretKey,
        state: {
          init: () => false,
          apply: (tr, on) => (tr.getMeta(mirrorCaretKey) as boolean | undefined) ?? on,
        },
        props: {
          decorations(state) {
            if (!mirrorCaretKey.getState(state)) return null;
            const sel = state.selection;
            if (sel instanceof NodeSelection) return DecorationSet.create(state.doc, [Decoration.node(sel.from, sel.to, { class: 'mirror-sel' })]);
            if (!sel.empty) return DecorationSet.create(state.doc, [Decoration.inline(sel.from, sel.to, { class: 'mirror-sel' })]);
            const el = document.createElement('span');
            el.className = 'mirror-caret';
            el.setAttribute('aria-hidden', 'true');
            return DecorationSet.create(state.doc, [Decoration.widget(sel.head, el, { side: 1, key: 'mirror-caret' })]);
          },
        },
      }),
    ];
  },
});
