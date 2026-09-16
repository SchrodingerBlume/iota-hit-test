// 批注（Word 的「审阅 → 新建批注」）：正文里用 comment 标记（@sereneinserenade/tiptap-comment-extension）
// 圈出一段，批注本体存在工程里（doc.comments），随 .iota.json 一起走——老师导入、写批注、导出，
// 学生再导入就看得见。这里是界面状态：面板开没开、当前是哪条、审阅者叫什么。
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
