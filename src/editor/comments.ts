// 批注范围使用 comment 标记，内容保存在 doc.comments 中并随工程文件导入、导出。
// 此状态存储负责窗格可见性、当前批注和审阅者姓名。
import { create } from 'zustand';

const AUTHOR_KEY = 'iota4web-reviewer';

interface State {
  open: boolean;
  active: string | null;
  author: string;
  setOpen: (v: boolean) => void;
  setActive: (id: string | null) => void;
  setAuthor: (name: string) => void;
}

export const useComments = create<State>((set) => ({
  open: false,
  active: null,
  author: (() => { try { return localStorage.getItem(AUTHOR_KEY) ?? ''; } catch { return ''; } })(),
  setOpen: (open) => set({ open }),
  setActive: (active) => set({ active }),
  setAuthor: (author) => { try { localStorage.setItem(AUTHOR_KEY, author); } catch { /* */ } set({ author }); },
}));

export const newCommentId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
