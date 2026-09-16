// 列表的输入规则按 Typst 的写法：- 圆点，+ 编号（GFM 里 + 也是圆点，这里不跟）
import { wrappingInputRule } from '@tiptap/core';
import { BulletList, OrderedList } from '@tiptap/extension-list';

export const TypstBulletList = BulletList.extend({
  addInputRules() { return [wrappingInputRule({ find: /^\s*([-*])\s$/, type: this.type })]; },
});

export const TypstOrderedList = OrderedList.extend({
  addInputRules() {
    return [
      wrappingInputRule({ find: /^(\d+)\.\s$/, type: this.type, getAttributes: (m) => ({ start: +m[1] }), joinPredicate: (m, node) => node.childCount + node.attrs.start === +m[1] }),
      wrappingInputRule({ find: /^\s*\+\s$/, type: this.type }),
    ];
  },
});
