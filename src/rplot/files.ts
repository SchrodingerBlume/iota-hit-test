// R 源码与 CeTZ 输出一起存在 figure 属性里，工程保存/撤消/复制沿用富文本原有路径。
// 编译时才把 CeTZ 展开成独立的虚拟 .typ 文件，用户不需要管理它。
import { stockRPlotSource } from './typography';

export interface RPlotData {
  version: '0.5.3.1';
  code: string;
  width: number;
  height: number;
  pointsize: number;
  fontMode?: 'auto' | 'manual';
  fontReport?: import('./fontPolicy').RFontReport;
  seed: number;
  path: string;
  source: string;
  pages: number;
  dataFiles?: { name: string; data: string }[];
}

/** 画布尺寸用 cm；数据文件随占位节点保存，刷新后可恢复任务。 */
export interface RPlotDraft {
  code: string; width: number; height: number; pointsize: number; seed: number;
  caption: string; captionEn: string; label: string;
  timeout?: number;
  fontMode?: 'auto' | 'manual';
  dataFiles?: { name: string; data: string }[];
}
export interface PendingRPlot {
  id: string; state: 'pending' | 'failed' | 'cancelled'; createdAt: number; draft: RPlotDraft; error?: string;
}
export function pendingRPlotOf(value: unknown): PendingRPlot | null {
  try {
    const p = typeof value === 'string' ? JSON.parse(value) : value;
    if (!p || typeof p.id !== 'string' || typeof p.draft?.code !== 'string' || !['pending', 'failed', 'cancelled'].includes(p.state)) return null;
    if (![p.draft.width, p.draft.height, p.draft.pointsize].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) return null;
    return p as PendingRPlot;
  } catch { return null; }
}

export function rPlotDataFiles(files: { name: string; data: string }[] = []) {
  return files.map((f) => ({ name: f.name, bytes: Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)) }));
}

export function rPlotOf(value: unknown): RPlotData | null {
  try {
    const p = typeof value === 'string' ? JSON.parse(value) : value;
    if (!p || p.version !== '0.5.3.1' || typeof p.code !== 'string' || typeof p.source !== 'string' || !/^rplots\/[a-f0-9]{32}\.typ$/.test(p.path)) return null;
    if (![p.width, p.height, p.pointsize].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) return null;
    return p as RPlotData;
  } catch { return null; }
}

/** 可接收整份工程，也可接收只编一章/一段的 RichDoc。 */
export function collectRPlotFiles(value: unknown): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (v.type === 'figure') {
      const plot = rPlotOf(v.attrs?.rPlot);
      if (plot) files[plot.path] = stockRPlotSource(plot.source);
    }
    if (Array.isArray(v)) { for (const item of v) walk(item); }
    else { for (const [key, item] of Object.entries(v)) if (key !== 'attrs') walk(item); }
  };
  walk(value);
  return files;
}
