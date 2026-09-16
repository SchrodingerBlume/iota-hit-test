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

/** 字形表每个字形占几个数；后两个（首个码点、占几个字）给主线程按原文对齐用——模板的 show regex 会把文本切片，切片后的源码偏移不可靠 */
export const GLYPH_STRIDE = 10;

export type ToWorker =
  | { type: 'init'; baseUrl: string }
  | { type: 'compile'; id: number; force?: boolean; main: string; files: Record<string, string>; images: { name: string; data: ArrayBuffer }[]; removeImages: string[] }
  /** main：正式排版用的 main.typ（不带预览记号），与预览编的那份不同 */
  | { type: 'pdf'; id: number; main: string }
  /** 编一个 Typst 数学片段，给编辑器里的公式预览用 */
  | { type: 'snippet'; id: number; src: string; display: boolean }
  /** 增删用户字体（本机读的或自己选的文件），字节只住在 worker；改完整表重建 */
  | { type: 'setFonts'; id: number; add: { id: string; data: ArrayBuffer }[]; remove: string[] };

export type Progress = { phase: string; loaded: number; total: number; detail?: string };

export type FromWorker =
  | { type: 'progress'; progress: Progress }
  | { type: 'ready'; ms: number; families: string[] }
  | { type: 'fatal'; message: string }
  /** glyphs：字形表，每 GLYPH_STRIDE 个数一个字形——page, x, y, w, h, 源码起, 源码止（main.typ 的 UTF-16 下标）, kind, 首个码点, 占几个字 */
  /** artifact 是与上一版的差（增量）；fresh = 增量服务刚建，这一份是完整的，渲染器要 reset */
  | { type: 'compiled'; id: number; artifact: ArrayBuffer | null; fresh: boolean; diagnostics: Diagnostic[]; ms: number; glyphs: ArrayBuffer | null }
  | { type: 'pdf'; id: number; pdf: ArrayBuffer | null; diagnostics: Diagnostic[] }
  | { type: 'fontsSet'; id: number; families: string[]; error?: string }
  | { type: 'snippet'; id: number; artifact: ArrayBuffer | null; error?: string };
