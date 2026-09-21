// 本地历史（照 Typst Studio 的样子）：整份工程按时间存快照到 IndexedDB，能看跟现在的差异、能整份恢复。
// 每隔几分钟有改动就自动存一份，手动、导出、恢复前另存；每个项目最多留 MAX 份，先淘汰最老的自动快照。
import { kv } from '../model/persist';
import type { ThesisDoc } from '../model/types';
import { t } from '../i18n';

export interface SnapshotMeta { key: string; project: string; ts: number; label: HistoryLabel; bytes: number; hash: string }
export const HISTORY_LABELS = { auto: t("自动"), manual: t("手动"), restore: t("恢复前"), export: t("导出"), open: t("打开"), git: 'Git' } as const;
export type HistoryLabel = keyof typeof HISTORY_LABELS;

const MAX = 80;
const AUTO_EVERY = 5 * 60 * 1000;
const ENABLED_KEY = 'iota4web-history-enabled';

export const historyEnabled = () => { try { return localStorage.getItem(ENABLED_KEY) !== '0'; } catch { return true; } };
export const setHistoryEnabled = (v: boolean) => { try { localStorage.setItem(ENABLED_KEY, v ? '1' : '0'); } catch { /* 无所谓 */ } };

const enc = new TextEncoder();
export async function sha1(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', enc.encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function gzip(text: string): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return new Blob([text]);
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
async function gunzip(blob: Blob, packed: boolean): Promise<string> {
  if (!packed) return blob.text();
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

interface Stored { ts: number; label: HistoryLabel; bytes: number; hash: string; packed: boolean; data: Blob }
const keyOf = (project: string, ts: number) => `${project}/${String(ts).padStart(15, '0')}`;

/** 快照里存什么：工程本身（图片二进制在 images 库里，不进快照） */
export const snapshotText = (doc: ThesisDoc) => JSON.stringify(doc);

export async function listHistory(project: string): Promise<SnapshotMeta[]> {
  const keys = (await kv.keys('history')).map(String).filter((k) => k.startsWith(project + '/')).sort();
  const out: SnapshotMeta[] = [];
  for (const key of keys) {
    const s = await kv.get<Stored>('history', key);
    if (s) out.push({ key, project, ts: s.ts, label: s.label, bytes: s.bytes, hash: s.hash });
  }
  return out;
}
export async function loadSnapshot(key: string): Promise<ThesisDoc | null> {
  const s = await kv.get<Stored>('history', key);
  if (!s) return null;
  try { return JSON.parse(await gunzip(s.data, s.packed)) as ThesisDoc; } catch { return null; }
}
export const deleteSnapshot = (key: string) => kv.del('history', key);
export async function clearHistory(project: string) { for (const k of (await kv.keys('history')).map(String)) if (k.startsWith(project + '/')) await kv.del('history', k); }

const lastHash = new Map<string, string>();
/** 存一份；跟上一份内容一样就不存（返回 null） */
export async function takeSnapshot(doc: ThesisDoc, label: HistoryLabel): Promise<SnapshotMeta | null> {
  const text = snapshotText(doc);
  const hash = await sha1(text);
  if (lastHash.get(doc.id) === hash) return null;
  const list = await listHistory(doc.id);
  if (list.length && list[list.length - 1].hash === hash) { lastHash.set(doc.id, hash); return null; }
  const packed = typeof CompressionStream !== 'undefined';
  const data = await gzip(text);
  const ts = Date.now();
  const stored: Stored = { ts, label, bytes: text.length, hash, packed, data };
  await kv.set('history', keyOf(doc.id, ts), stored);
  lastHash.set(doc.id, hash);
  // 超了先扔最老的自动快照，再扔最老的
  let all = [...list, { key: keyOf(doc.id, ts), project: doc.id, ts, label, bytes: text.length, hash }];
  while (all.length > MAX) {
    const victim = all.find((s) => s.label === 'auto') ?? all[0];
    await kv.del('history', victim.key);
    all = all.filter((s) => s !== victim);
  }
  return { key: keyOf(doc.id, ts), project: doc.id, ts, label, bytes: text.length, hash };
}

/** 定时自动存：App 挂一个，每 5 分钟看一眼当前文档变没变 */
export function startAutoHistory(getDoc: () => ThesisDoc | null): () => void {
  const tick = () => { const d = getDoc(); if (d && historyEnabled()) void takeSnapshot(d, 'auto'); };
  const timer = window.setInterval(tick, AUTO_EVERY);
  const onHide = () => { if (document.visibilityState === 'hidden') tick(); };
  document.addEventListener('visibilitychange', onHide);
  return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onHide); };
}
