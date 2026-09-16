// 预览缩放与页面布局的外部接口：Preview 挂上来时把 zoomBy / zoomTo / fitPage 登记进来，
// 功能区的「视图」页与预览栏都调它。每行几页（Word 的「多页」视图）记在本机。
import { create } from 'zustand';

export type PerRow = 1 | 2 | 3;
const PER_ROW_KEY = 'iota4web-preview-per-row';
const readPerRow = (): PerRow => { try { const v = Number(localStorage.getItem(PER_ROW_KEY)); return v === 2 || v === 3 ? v : 1; } catch { return 1; } };

interface ZoomState {
  zoom: number;
  zoomBy: (factor: number) => void;
  zoomTo: (z: number) => void;
  /** 整页：缩到一页正好放进视口高度 */
  fitPage: () => void;
  perRow: PerRow;
  setPerRow: (n: PerRow) => void;
  set: (p: Partial<ZoomState>) => void;
}

export const usePreviewZoom = create<ZoomState>((set) => ({
  zoom: 1,
  zoomBy: () => {},
  zoomTo: () => {},
  fitPage: () => {},
  perRow: readPerRow(),
  setPerRow: (n) => { try { localStorage.setItem(PER_ROW_KEY, String(n)); } catch { /* */ } set({ perRow: n }); },
  set: (p) => set(p),
}));
