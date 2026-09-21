// 行内的字体、字号、颜色三个标记，都落到模板给的接口：#songti[…] 那四个字族、text(size: zihao.…)、text(fill:)
import { Mark, mergeAttributes } from '@tiptap/core';
import type { FontRole } from '../../model/zihao';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontMarks: {
      setFontFamily: (role: FontRole) => ReturnType;
      unsetFontFamily: () => ReturnType;
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
      setTextColor: (color: string) => ReturnType;
      unsetTextColor: () => ReturnType;
      setHighlight: (color: string) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
  }
}

export const FontFamily = Mark.create({
  name: 'fontFamily',
  addAttributes() { return { role: { default: 'songti', parseHTML: (el) => el.getAttribute('data-font'), renderHTML: (a) => ({ 'data-font': a.role }) } }; },
  parseHTML() { return [{ tag: 'span[data-font]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes), 0]; },
  addCommands() {
    return {
      setFontFamily: (role) => ({ commands }) => commands.setMark(this.name, { role }),
      unsetFontFamily: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

export const FontSize = Mark.create({
  name: 'fontSize',
  addAttributes() { return { size: { default: 'xiaosi', parseHTML: (el) => el.getAttribute('data-size'), renderHTML: (a) => ({ 'data-size': a.size }) } }; },
  parseHTML() { return [{ tag: 'span[data-size]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes), 0]; },
  addCommands() {
    return {
      setFontSize: (size) => ({ commands }) => commands.setMark(this.name, { size }),
      unsetFontSize: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() { return { color: { default: '#ff0000', parseHTML: (el) => el.getAttribute('data-color'), renderHTML: (a) => ({ 'data-color': a.color, style: `color: ${a.color}` }) } }; },
  parseHTML() { return [{ tag: 'span[data-color]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes), 0]; },
  addCommands() {
    return {
      setTextColor: (color) => ({ commands }) => commands.setMark(this.name, { color }),
      unsetTextColor: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

/** 文本突出显示颜色：Word 的荧光笔那 15 色，写出去是 #highlight(fill:)（上下沿在序言里按 em 定死） */
export const Highlight = Mark.create({
  name: 'highlight',
  addAttributes() { return { color: { default: '#ffff00', parseHTML: (el) => el.getAttribute('data-highlight'), renderHTML: (a) => ({ 'data-highlight': a.color, style: `background-color: ${a.color}` }) } }; },
  parseHTML() { return [{ tag: 'mark[data-highlight]' }]; },
  renderHTML({ HTMLAttributes }) { return ['mark', mergeAttributes(HTMLAttributes), 0]; },
  addCommands() {
    return {
      setHighlight: (color) => ({ commands }) => commands.setMark(this.name, { color }),
      unsetHighlight: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});
