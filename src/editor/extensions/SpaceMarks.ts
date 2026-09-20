// 启用编辑标记时，以 span.ws 标记空格并显示中点。
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

interface SpaceState { on: boolean; set: DecorationSet }
export const spaceMarksKey = new PluginKey<SpaceState>('spaceMarks');

function decorate(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((n, pos) => {
    if (!n.isText || !n.text) return;
    const re = /[  　]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(n.text))) decos.push(Decoration.inline(pos + m.index, pos + m.index + 1, { class: m[0] === '　' ? 'ws ws-full' : 'ws' }));
  });
  return DecorationSet.create(doc, decos);
}

export const SpaceMarks = Extension.create({
  name: 'spaceMarks',
  addProseMirrorPlugins() {
    return [new Plugin<SpaceState>({
      key: spaceMarksKey,
      state: {
        init: () => ({ on: false, set: DecorationSet.empty }),
        apply: (tr, prev, _old, state) => {
          const on = tr.getMeta(spaceMarksKey) ?? prev.on;
          if (!on) return { on, set: DecorationSet.empty };
          if (on !== prev.on || tr.docChanged) return { on, set: decorate(state.doc) };
          return prev;
        },
      },
      props: { decorations: (state) => spaceMarksKey.getState(state)?.set ?? null },
    })];
  },
});
