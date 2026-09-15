// 「把这个节点的编辑框打开」：预览里双击公式、引用这类原子节点时发的请求。
// 节点视图各自盯着它，位置对上就展开自己。
import { create } from 'zustand';
import type { RichKey } from '../model/store';

interface OpenRequest { key: RichKey; pos: number; attr?: string; offset?: number; nonce: number }
interface State { req: OpenRequest | null; request: (r: Omit<OpenRequest, 'nonce'>) => void; clear: () => void }

export const useOpenRequest = create<State>((set) => ({
  req: null,
  request: (r) => set({ req: { ...r, nonce: Date.now() + Math.random() } }),
  clear: () => set({ req: null }),
}));
