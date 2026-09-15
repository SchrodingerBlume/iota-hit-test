// 查找 / 替换：命中的地方用装饰高亮（当前那一处深一些）。查询词与当前序号由查找栏
// 通过事务 meta 发进来；文档一改就重新找，序号钉住不乱跳。
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface SearchMatch { from: number; to: number }
export interface SearchState { query: string; caseSensitive: boolean; current: number; matches: SearchMatch[] }
export const searchKey = new PluginKey<SearchState>('search');

export function findMatches(doc: PMNode, query: string, caseSensitive: boolean): SearchMatch[] {
  const out: SearchMatch[] = [];
  if (!query) return out;
  const q = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // 原子节点占一个字符，用占位符顶着，偏移才对得上
    const text = node.textBetween(0, node.content.size, undefined, '￼');
    const hay = caseSensitive ? text : text.toLowerCase();
    let i = hay.indexOf(q);
    while (i >= 0) { out.push({ from: pos + 1 + i, to: pos + 1 + i + query.length }); i = hay.indexOf(q, i + Math.max(1, query.length)); }
    return false;
  });
  return out;
}

export const Search = Extension.create({
  name: 'search',
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: '', caseSensitive: false, current: 0, matches: [] }),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined;
            let s = meta ? { ...prev, ...meta } : prev;
            if (meta?.query !== undefined || meta?.caseSensitive !== undefined || (tr.docChanged && s.query)) {
              s = { ...s, matches: findMatches(state.doc, s.query, s.caseSensitive) };
            } else if (tr.docChanged) {
              s = { ...s, matches: s.matches.map((m) => ({ from: tr.mapping.map(m.from, 1), to: tr.mapping.map(m.to, -1) })).filter((m) => m.to > m.from) };
            }
            if (s.matches.length) s.current = ((s.current % s.matches.length) + s.matches.length) % s.matches.length;
            else s.current = 0;
            return s;
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state);
            if (!s || !s.matches.length) return null;
            return DecorationSet.create(state.doc, s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? 'search-hit is-current' : 'search-hit' })));
          },
        },
      }),
    ];
  },
});

/** 把选区放到当前命中处并滚过去 */
export function selectCurrentMatch(view: { state: any; dispatch: (tr: any) => void }) {
  const s = searchKey.getState(view.state);
  const m = s?.matches[s.current];
  if (!m) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView());
}
