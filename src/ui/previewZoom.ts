// 预览缩放的外部接口：Preview 挂上来时把 zoomBy / zoomTo 登记进来，功能区的「视图」页调它。
import { create } from 'zustand';

interface ZoomState {
  zoom: number;
  zoomBy: (factor: number) => void;
  zoomTo: (z: number) => void;
  set: (p: Partial<ZoomState>) => void;
}

export const usePreviewZoom = create<ZoomState>((set) => ({
  zoom: 1,
  zoomBy: () => {},
  zoomTo: () => {},
  set: (p) => set(p),
}));
