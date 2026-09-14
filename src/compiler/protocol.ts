// 主线程 ↔ 编译 worker 的消息。

export interface Diagnostic {
  severity: 'error' | 'warning' | string;
  message: string;
  /** 文件与位置，如 main.typ:12:3 */
  where: string;
  package?: string;
  path?: string;
  range?: string;
}

export type ToWorker =
  | { type: 'init'; baseUrl: string }
  | { type: 'compile'; id: number; main: string; files: Record<string, string>; images: { name: string; data: ArrayBuffer }[]; removeImages: string[] }
  | { type: 'pdf'; id: number };

export type Progress = { phase: string; loaded: number; total: number; detail?: string };

export type FromWorker =
  | { type: 'progress'; progress: Progress }
  | { type: 'ready'; ms: number }
  | { type: 'fatal'; message: string }
  | { type: 'compiled'; id: number; artifact: ArrayBuffer | null; diagnostics: Diagnostic[]; ms: number }
  | { type: 'pdf'; id: number; pdf: ArrayBuffer | null; diagnostics: Diagnostic[] };
