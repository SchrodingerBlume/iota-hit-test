// 冷启动缓存：最近一次整编的产物与字形表按工程存在 IndexedDB。重开工程先把上次的版面画出来，
// 引擎起来后再整编一遍校准——几百页的稿子不必白等第一次整编。
import { BUILD } from '../version';
import { kv } from '../model/persist';
import type { Segment } from '../typst/sourcemap';
import type { ThesisDoc } from '../model/types';

export interface CachedLayout {
  /** 版面签名（layoutSig）：构建 / 文档修改时间 / 设置，任一变这个缓存就不算数 */
  sig: string;
  /** 存进来时的页数；第一次整编落地时可能还没渲染过（0），之后重编会补上 */
  pageCount: number;
  /** main.typ 的长度：页数还没数出来时用它判断是不是大文档 */
  mainLen: number;
  savedAt: number;
  artifact: Uint8Array;
  glyphs: Float64Array;
  segments: Segment[];
}

/** 够长才值得缓存：门槛与 client.LONG_DOC 同档（页数没数出来就拿 main.typ 长度估） */
export const CACHE_MIN_PAGES = 40;
export const CACHE_MIN_MAIN = 120_000;

const STORE = 'cache';
const KEY = (id: string) => `layout:${id}`;
/** 最多留几个工程的版面：50 MB 上下一个，别把配额吃光 */
const KEEP = 3;

let memo: { d: string; s: unknown; sig: string } | null = null;
/** 版面签名：构建 + 文档修改时间 + 设置；任一变，缓存作废 */
export function layoutSig(doc: Pick<ThesisDoc, 'updatedAt' | 'settings'>): string {
  if (memo && memo.d === doc.updatedAt && memo.s === doc.settings) return memo.sig;
  const sig = `${BUILD}|${doc.updatedAt}|${JSON.stringify(doc.settings)}`;
  memo = { d: doc.updatedAt, s: doc.settings, sig };
  return sig;
}

const lastSaved = new Map<string, { sig: string; pages: number }>();

/** 整编落地后调用：闲时写（产物加字形表 50 MB 上下，别和打字抢主线程） */
export function scheduleLayoutSave(docId: string, sig: string, mainLen: number, pageCount: number, artifact: Uint8Array, glyphs: Float64Array, segments: Segment[]) {
  if (mainLen < CACHE_MIN_MAIN && pageCount < CACHE_MIN_PAGES) return;
  const pages = Math.max(0, pageCount);
  const prev = lastSaved.get(docId);
  if (prev && prev.sig === sig && (prev.pages === pages || pages === 0)) return;
  const write = () => {
    void (async () => {
      try {
        const old = await kv.get<CachedLayout>(STORE, KEY(docId));
        const best = Math.max(pages, old && old.sig === sig ? old.pageCount : 0);
        if (old && old.sig === sig && old.pageCount >= best) { lastSaved.set(docId, { sig, pages: best }); return; }
        await kv.set(STORE, KEY(docId), { sig, pageCount: best, mainLen, savedAt: Date.now(), artifact, glyphs, segments } satisfies CachedLayout);
        lastSaved.set(docId, { sig, pages: best });
        await prune(docId);
      } catch { /* 配额不够或隐私模式：没有就没有 */ }
    })();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(write, { timeout: 3000 });
  else window.setTimeout(write, 1200);
}

async function prune(keepId: string) {
  try {
    const keys = (await kv.keys(STORE) as string[]).filter((k) => k.startsWith('layout:'));
    if (keys.length <= KEEP) return;
    const rows: { key: string; at: number }[] = [];
    for (const k of keys) rows.push({ key: k, at: (await kv.get<CachedLayout>(STORE, k))?.savedAt ?? 0 });
    rows.sort((a, b) => b.at - a.at);
    for (const r of rows.slice(KEEP)) if (r.key !== KEY(keepId)) await kv.del(STORE, r.key);
  } catch { /* 清不掉也不致命 */ }
}

/** 开工程时取上次的版面；签名对不上或不够大就 null */
export async function loadLayout(docId: string, sig: string): Promise<CachedLayout | null> {
  try {
    const rec = await kv.get<CachedLayout>(STORE, KEY(docId));
    if (!rec || rec.sig !== sig) return null;
    if (rec.mainLen < CACHE_MIN_MAIN && rec.pageCount < CACHE_MIN_PAGES) return null;
    return rec;
  } catch { return null; }
}

export function dropLayout(docId: string) {
  lastSaved.delete(docId);
  void kv.del(STORE, KEY(docId)).catch(() => { /* */ });
}
