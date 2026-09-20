// 列表项、表格格、题注框各自接 Tab；落到普通段落 / 标题时吞掉——不然浏览器把焦点带出编辑器。
// 代码块里 Tab 打两个空格（首行缩进模板自己管，Word 的「Tab 缩进」不需要）。
// Home / End：macOS 的浏览器默认只滚页不动光标，Word 与 Typora 都是到行首 / 行尾，照它们
import { Extension } from '@tiptap/core';
import { cycleCase } from '../changeCase';

const lineEdge = (dir: 'backward' | 'forward', extend: boolean) => () => {
  const sel = window.getSelection();
  if (!sel?.rangeCount || typeof sel.modify !== 'function') return false;
  sel.modify(extend ? 'extend' : 'move', dir, 'lineboundary');
  return true;
};

export const EditKeys = Extension.create({
  name: 'editKeys',
  priority: 50,
  addKeyboardShortcuts() {
    return {
      Tab: () => (this.editor.isActive('codeBlock') ? this.editor.commands.insertContent('  ') : true),
      'Shift-Tab': () => true,
      Home: lineEdge('backward', false),
      End: lineEdge('forward', false),
      'Shift-Home': lineEdge('backward', true),
      'Shift-End': lineEdge('forward', true),
      'Shift-F3': () => cycleCase(this.editor),
    };
  },
});
