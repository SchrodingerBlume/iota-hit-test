// 编辑器周边环境：文献 key、可引用的图表公式、缩略语——给弹出框里的选择列表用。
import { createContext, useContext } from 'react';
import type { RefTarget } from '../typst/pmToTypst';

export interface EditorEnv {
  bibKeys: { key: string; title: string }[];
  refTargets: RefTarget[];
  abbrs: { key: string; long: string }[];
  images: { name: string }[];
  /** 上传图片：返回存进库里的文件名 */
  addImage: (file: File) => Promise<{ name: string; width?: number; height?: number }>;
}

export const EditorEnvContext = createContext<EditorEnv>({
  bibKeys: [], refTargets: [], abbrs: [], images: [],
  addImage: async () => { throw new Error('no env'); },
});

export const useEditorEnv = () => useContext(EditorEnvContext);

/** 从 BibTeX 原文里抓 key 与 title（不求全，够列个清单） */
export function parseBibKeys(bib: string): { key: string; title: string }[] {
  const out: { key: string; title: string }[] = [];
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n@|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bib))) {
    if (m[1].toLowerCase() === 'comment' || m[1].toLowerCase() === 'string' || m[1].toLowerCase() === 'preamble') continue;
    const title = /title\s*=\s*[{"]([\s\S]*?)[}"]\s*,?\s*\n/i.exec(m[3])?.[1]?.replace(/[{}]/g, '').trim() ?? '';
    out.push({ key: m[2], title });
  }
  return out;
}
