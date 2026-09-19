// Typora 的写法：`$x^2$` 敲完后面那个 $ 就成行内公式；空段里敲 `$$` 加空格（或回车）就是一条行间公式
import { Extension, InputRule } from '@tiptap/core';

export const MathInputRules = Extension.create({
  name: 'mathInputRules',
  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|[^$\\])\$([^$\s](?:[^$]*?[^$\s])?)\$$/,
        handler: ({ state, range, match, chain }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code || $from.marks().some((m) => m.type.name === 'code')) return;
          // 前面那个字符不属于公式（只是用来确认不是 $$），留下
          const start = range.from + (match[0].startsWith('$') ? 0 : 1);
          chain().deleteRange({ from: start, to: range.to }).insertContentAt(start, { type: 'mathInline', attrs: { src: match[1], mode: 'latex' } }).run();
        },
      }),
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range, chain }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== 'paragraph' || $from.parent.textContent.trim() !== '$$') return;
          if (!state.schema.nodes.equation) return;
          chain().deleteRange({ from: $from.before(), to: $from.after() }).insertContentAt($from.before(), { type: 'equation', attrs: { src: '', mode: 'latex' } }).run();
        },
      }),
    ];
  },
});
