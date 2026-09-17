import { create } from 'zustand';

interface InputState {
  composing: boolean;
  depth: number;
  begin: () => void;
  end: () => void;
}

/** 中文输入法组词期间暂停整篇排版，避免候选文字的中间状态触发无效编译。 */
export const useInputState = create<InputState>((set) => ({
  composing: false,
  depth: 0,
  begin: () => set((state) => ({ depth: state.depth + 1, composing: true })),
  end: () => set((state) => { const depth = Math.max(0, state.depth - 1); return { depth, composing: depth > 0 }; }),
}));
