// 长文档打字时只编当前一章：这里算「当前光标在第几章」与「这一章在上次整编里占哪几页」。
import type { Editor } from '@tiptap/core';
import type { RichDoc } from '../model/types';
import { chapterRanges } from '../typst/serialize';
import { indexPositions } from '../typst/pmToTypst';
import type { Segment } from '../typst/sourcemap';
import { GLYPH_STRIDE } from './protocol';

/** 光标所在的章（1 起）；没有一级标题、光标不在正文里就 null */
export function chapterAt(body: RichDoc, editor: Editor | undefined): number | null {
  if (!editor || editor.isDestroyed) return null;
  const ranges = chapterRanges(body);
  if (ranges.length < 2) return null;
  const idx = editor.state.selection.$from.index(0);
  const k = ranges.findIndex((r) => idx >= r.from && idx < r.to);
  return k < 0 ? null : k + 1;
}

let cache: { version: number; pages: number[]; end: number } | null = null;

/**
 * 各章首页在上次整编里的页序（0 起）与正文之后第一页的页序。靠字形表：每章头一段文字落在哪一页。
 * 字形表是按编译那一版算的，用户接着敲的字只会让页往后挪，钉页码差一两页无妨。
 */
export function chapterPages(body: RichDoc, glyphs: Float64Array | null, segments: Segment[], version: number, pageCount: number): { pages: number[]; end: number } | null {
  if (!glyphs || !segments.length) return null;
  if (cache && cache.version === version) return cache;
  const ranges = chapterRanges(body);
  const nodes = body.content ?? [];
  const posOf = indexPositions(body as any);
  const bodySegs = segments.filter((s) => s.key === 'body');
  if (!bodySegs.length) return null;
  // 每章在 main.typ 里从哪起：这一章头一个节点之后的第一个正文段
  const typStarts = ranges.map((r) => { const pm = posOf.get(nodes[r.from]) ?? 0; const seg = bodySegs.find((s) => s.pmFrom >= pm); return seg ? seg.typFrom : Infinity; });
  const bodyEnd = Math.max(...bodySegs.map((s) => s.typTo));
  const pages = ranges.map(() => Infinity);
  let end = Infinity;
  for (let i = 0; i + GLYPH_STRIDE - 1 < glyphs.length; i += GLYPH_STRIDE) {
    // 3 = 目录条目、页眉里的回声：不算这一章的落点
    if (glyphs[i + 7] === 3) continue;
    const start = glyphs[i + 5];
    const page = glyphs[i];
    if (start >= bodyEnd) { if (page < end) end = page; continue; }
    let c = -1;
    for (let k = typStarts.length - 1; k >= 0; k--) if (start >= typStarts[k]) { c = k; break; }
    if (c >= 0 && page < pages[c]) pages[c] = page;
  }
  if (pages.some((p) => !Number.isFinite(p))) return null;
  cache = { version, pages, end: Number.isFinite(end) ? end : pageCount };
  return cache;
}
