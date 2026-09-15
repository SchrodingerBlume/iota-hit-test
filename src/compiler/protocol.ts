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
  | { type: 'pdf'; id: number }
  /** 编一个 Typst 数学片段，给编辑器里的公式预览用 */
  | { type: 'snippet'; id: number; src: string; display: boolean }
  /** 增删用户字体（本机读的或自己选的文件），字节只住在 worker；改完整表重建 */
  | { type: 'setFonts'; id: number; add: { id: string; data: ArrayBuffer }[]; remove: string[] };

export type Progress = { phase: string; loaded: number; total: number; detail?: string };

export type FromWorker =
  | { type: 'progress'; progress: Progress }
  | { type: 'ready'; ms: number; families: string[] }
  | { type: 'fatal'; message: string }
  /** glyphs：字形表，每 8 个数一个字形——page, x, y, w, h, 源码起, 源码止（main.typ 的 UTF-16 下标）, kind */
  | { type: 'compiled'; id: number; artifact: ArrayBuffer | null; diagnostics: Diagnostic[]; ms: number; glyphs: ArrayBuffer | null }
  | { type: 'pdf'; id: number; pdf: ArrayBuffer | null; diagnostics: Diagnostic[] }
  | { type: 'fontsSet'; id: number; families: string[]; error?: string }
  | { type: 'snippet'; id: number; artifact: ArrayBuffer | null; error?: string };
