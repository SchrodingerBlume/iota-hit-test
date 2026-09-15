// 编辑器周边环境：文献 key、可引用的图表公式、缩略语——给弹出框里的选择列表用。
import { createContext, useContext, useEffect, useState } from 'react';
import type { RefTarget } from '../typst/pmToTypst';
import type { NumberInfo } from '../typst/numbering';
import type { RichKey } from '../model/store';
import { useOpenRequest } from './openRequest';

export interface EditorEnv {
  bibKeys: { key: string; title: string; group?: string }[];
  refTargets: (RefTarget & { number?: string; ref?: string })[];
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

/** 这个编辑器编的是工程里哪份富文本 */
export const RichKeyContext = createContext<RichKey | undefined>(undefined);
export const useRichKey = () => useContext(RichKeyContext);

/**
 * 预览里双击了这个节点：返回一个每次请求都变的数，节点视图据此把自己的编辑框打开。
 * getPos 是 TipTap 给节点视图的；attr / offset 说明要聚焦哪个属性的输入框、光标放第几个字。
 */
export function useOpenNonce(getPos: () => number | undefined): { nonce: number; attr?: string; offset?: number } {
  const key = useRichKey();
  const req = useOpenRequest((s) => s.req);
  const [state, setState] = useState<{ nonce: number; attr?: string; offset?: number }>({ nonce: 0 });
  useEffect(() => {
    if (!req || !key || req.key !== key) return;
    if (getPos() !== req.pos) return;
    setState({ nonce: req.nonce, attr: req.attr, offset: req.offset });
  }, [req, key, getPos]);
  return state;
}

/** 请求里点名了某个属性：把对应的输入框聚焦、光标放到那个字 */
export function focusAttrInput(root: HTMLElement | null, attr: string | undefined, offset: number | undefined) {
  if (!root || !attr) return;
  const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-attr="${attr}"]`);
  if (!el) return;
  el.focus();
  if (offset !== undefined) { try { el.setSelectionRange(offset, offset); } catch { /* 有的输入框不支持 */ } }
}

/** 当前这个编辑器里各节点的编号（标题、图、表、公式），按 label 查 */
export const NumberingContext = createContext<Map<string, NumberInfo>>(new Map());
export const useNumbering = () => useContext(NumberingContext);
