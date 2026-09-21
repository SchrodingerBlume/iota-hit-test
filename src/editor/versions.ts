// 文档版本与位置换算。
//
// 预览区的字形表是按「编译那一刻」的文档算的；用户接着又敲了几个字，位置就错开了。
// 这里记下编译之后每一笔事务的 mapping，把「现在的位置」换算回「编译那一版的位置」
// （或反过来），字形表不用等下一次编译就能继续用。
import { Mapping } from '@tiptap/pm/transform';
import type { Transaction } from '@tiptap/pm/state';
import type { RichKey } from '../model/store';

let version = 0;
/** 这一版之前的位置一律作废（换了文档、重建了编辑器） */
let resetAt = 0;
const log: { v: number; key: RichKey; mapping: Mapping }[] = [];

export const docVersion = () => version;

/** 回灌进 store 的那份 JSON 是在哪一版截的：编译按它记版本——回灌是节流的，编译发出去那一刻编辑器可能又走了几笔，
 *  拿编辑器的现版当产物的版本，字形表就会把没编进去的那几笔当成已经排上了，光标与暂印的字全错位 */
const stamps = new WeakMap<object, number>();
export function stampVersion(json: object, v = version) { stamps.set(json, v); }
export const versionOf = (json: object | undefined | null): number | undefined => (json ? stamps.get(json) : undefined);

export function recordTransaction(key: RichKey, tr: Transaction) {
  if (!tr.docChanged) return;
  version++;
  log.push({ v: version, key, mapping: tr.mapping });
  if (log.length > 400) log.splice(0, log.length - 400);
}

/** 内容整个换掉了：老位置全不作数 */
export function invalidatePositions() {
  version++;
  resetAt = version;
  log.length = 0;
}

const cache = new Map<string, Mapping>();

/** 从 fromVersion 到现在，这份富文本的位置变换；null = 那一版已经作废 */
export function mappingSince(key: RichKey, fromVersion: number): Mapping | null {
  if (fromVersion < resetAt) return null;
  const id = `${key}:${fromVersion}:${version}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const m = new Mapping();
  for (const e of log) if (e.v > fromVersion && e.key === key) m.appendMapping(e.mapping);
  if (cache.size > 64) cache.clear();
  cache.set(id, m);
  return m;
}

/** 从 fromVersion 到 toVersion 的位置变换；null = 起点那一版已经作废 */
export function mappingBetween(key: RichKey, fromVersion: number, toVersion: number): Mapping | null {
  if (fromVersion < resetAt) return null;
  const m = new Mapping();
  for (const e of log) if (e.v > fromVersion && e.v <= toVersion && e.key === key) m.appendMapping(e.mapping);
  return m;
}

/** 现在的位置 → 编译那一版的位置 */
export function toOldPos(key: RichKey, fromVersion: number, pos: number, assoc: -1 | 1 = 1): number | null {
  const m = mappingSince(key, fromVersion);
  if (!m) return null;
  return m.invert().map(pos, assoc);
}
/** 编译那一版的位置 → 现在的位置 */
export function toNewPos(key: RichKey, fromVersion: number, pos: number, assoc: -1 | 1 = 1): number | null {
  const m = mappingSince(key, fromVersion);
  if (!m) return null;
  return m.map(pos, assoc);
}

