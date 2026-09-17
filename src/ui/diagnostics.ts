// 编译诊断给用户看：Typst 的 main.typ:行:列 折回文档里的位置（能跳过去），常见的话翻成人话
import type { Segment } from '../typst/sourcemap';
import type { RichKey } from '../model/store';
import { t } from '../i18n';

export interface DiagTarget { key: RichKey | 'info'; pos: number; node: boolean }

/** 行列 → 在 main 里的下标。typst.ts 报的行、列都从 0 起（实测 main.typ:128:5 指第 129 行第 6 个字），列按字符数 */
function offsetOf(main: string, line: number, col: number): number {
  let i = 0;
  for (let l = 0; l < line; l++) { const j = main.indexOf('\n', i); if (j < 0) return -1; i = j + 1; }
  return i + Math.max(0, col);
}

/** 诊断落在文档的哪一段：取包住那个位置的最里层文字 / 节点 / 属性段 */
export function locateDiagnostic(where: string, main: string, segments: Segment[]): DiagTarget | null {
  const m = /^main\.typ:(\d+):(\d+)/.exec(where);
  if (!m || !main) return null;
  const off = offsetOf(main, +m[1], +m[2]);
  if (off < 0) return null;
  let best: Segment | null = null;
  for (const s of segments) {
    if (s.typFrom > off) break;
    if (s.typTo <= off && s.typFrom !== s.typTo) continue;
    if (s.kind === 'para' || s.kind === 'info') continue;
    if (!best || s.typFrom >= best.typFrom) best = s;
  }
  if (!best) return null;
  return { key: best.key, pos: best.pmFrom, node: best.kind === 'node' };
}

/** Typst 的原话翻成用户看得懂的；翻不了的照抄 */
export function humanize(message: string): { text: string; internal: boolean } {
  let m: RegExpExecArray | null;
  if ((m = /^label `<([^>]+)>` is not attached to anything/.exec(message))) return { text: t("标签 {{label}} 没挂到任何元素上——这是本站生成排版代码时出的问题，请把这条反馈给开发者", { label: m[1] }), internal: true };
  if ((m = /^label `<([^>]+)>` does not exist/.exec(message))) return { text: t("引用的目标 {{label}} 不存在：被引用的图、表、公式或标题已删掉，或还没加标签", { label: m[1] }), internal: false };
  if ((m = /^label `<([^>]+)>` occurs multiple times/.exec(message))) return { text: t("标签 {{label}} 出现了不止一次", { label: m[1] }), internal: false };
  if ((m = /^unknown font family: (.+)/.exec(message))) return { text: t("找不到字体 {{font}}：本机字体档没读到这副字，或它不在字体方案里", { font: m[1] }), internal: false };
  if (/^file not found/.test(message)) return { text: t("找不到图片文件：图片可能没导入，或已从工程里删掉"), internal: false };
  if (/^unexpected|^expected|unclosed delimiter/.test(message)) return { text: t("生成的排版代码有语法错误——这是本站的问题，请把这条反馈给开发者：") + message, internal: true };
  return { text: message, internal: false };
}
