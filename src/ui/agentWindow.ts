// Agent 面板浮成小窗：浮不浮、窗的位置与大小（相对 .main 的像素）。记在本机
import { create } from 'zustand';

export interface Rect { x: number; y: number; w: number; h: number }
interface AgentWindowState {
  float: boolean;
  rect: Rect | null;
  setFloat: (v: boolean) => void;
  setRect: (r: Rect) => void;
}
const KEY = 'iota4web-agent-window';
const read = (): Partial<AgentWindowState> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
const save = (s: AgentWindowState) => { try { localStorage.setItem(KEY, JSON.stringify({ float: s.float, rect: s.rect })); } catch { /* */ } };

export const useAgentWindow = create<AgentWindowState>((set, get) => ({
  float: !!read().float,
  rect: read().rect ?? null,
  setFloat: (v) => { set({ float: v }); save(get()); },
  setRect: (r) => { set({ rect: r }); save(get()); },
}));

export const WIN_MIN_W = 300;
export const WIN_MIN_H = 260;
/** 窗要整个留在 host 里；没记过位置的放右上角 */
export function clampRect(r: Rect | null, host: { width: number; height: number }): Rect {
  const w = Math.min(Math.max(WIN_MIN_W, r?.w ?? 400), Math.max(WIN_MIN_W, host.width - 16));
  const h = Math.min(Math.max(WIN_MIN_H, r?.h ?? 620), Math.max(WIN_MIN_H, host.height - 16));
  const x = Math.min(Math.max(8, r?.x ?? host.width - w - 16), Math.max(8, host.width - w - 8));
  const y = Math.min(Math.max(8, r?.y ?? 16), Math.max(8, host.height - h - 8));
  return { x, y, w, h };
}
