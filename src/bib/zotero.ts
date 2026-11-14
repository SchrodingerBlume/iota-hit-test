// Zotero Web API（api.zotero.org，只读）。密钥存在本机 IndexedDB（meta.zotero），不出浏览器。
// 条目要 include=data,csljson：csljson 是排版认的那份，data 里有条目键与 Zotero 7 的引用键
import { kv } from '../model/persist';
import type { CslItem } from './csl';

const API = 'https://api.zotero.org';

export interface ZoteroAuth { key: string; userID: number; username: string; groups: boolean }
export interface ZoteroLibrary { id: string; label: string; kind: 'user' | 'group' }
export interface ZoteroCollection { key: string; name: string; parent: string | null; depth: number; count: number }
export interface ZoteroItem { key: string; version: number; citationKey?: string; csl: CslItem }

export const loadAuth = () => kv.get<ZoteroAuth>('meta', 'zotero');
export const saveAuth = (a: ZoteroAuth | null) => (a ? kv.set('meta', 'zotero', a) : kv.del('meta', 'zotero'));

async function get(path: string, key: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<{ body: any; total: number }> {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { signal, headers: { ...(key ? { 'Zotero-API-Key': key } : {}), 'Zotero-API-Version': '3' } });
  if (!r.ok) throw new Error(r.status === 403 ? 'forbidden' : r.status === 404 ? 'notfound' : `http ${r.status}`);
  return { body: await r.json(), total: Number(r.headers.get('Total-Results') ?? 0) };
}
async function all<T>(path: string, key: string, params: Record<string, string>, onProgress?: (n: number, total: number) => void, signal?: AbortSignal): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; ; ) {
    const { body, total } = await get(path, key, { ...params, limit: '100', start: String(start) }, signal);
    out.push(...(body as T[]));
    start += (body as T[]).length;
    onProgress?.(start, total);
    if (!(body as T[]).length || (total > 0 ? start >= total : body.length < 100)) break;
  }
  return out;
}

/** 拿密钥换用户号与用户名（/keys/<key> 不用别的凭证） */
export async function connect(key: string): Promise<ZoteroAuth> {
  const { body } = await get(`/keys/${encodeURIComponent(key.trim())}`, key.trim());
  const groups = !!body.access?.groups;
  return { key: key.trim(), userID: body.userID, username: body.username ?? String(body.userID), groups };
}

export async function libraries(a: ZoteroAuth): Promise<ZoteroLibrary[]> {
  const out: ZoteroLibrary[] = [{ id: `users/${a.userID}`, label: '', kind: 'user' }];
  if (a.groups) {
    const gs = await all<any>(`/users/${a.userID}/groups`, a.key, {});
    for (const g of gs) out.push({ id: `groups/${g.id}`, label: g.data?.name ?? String(g.id), kind: 'group' });
  }
  return out;
}

/** 收藏夹拍平成树的先序：depth 给缩进 */
export async function collections(a: ZoteroAuth, lib: string): Promise<ZoteroCollection[]> {
  const raw = await all<any>(`/${lib}/collections`, a.key, {});
  const byParent = new Map<string | false, any[]>();
  for (const c of raw) { const p = c.data.parentCollection || false; if (!byParent.has(p)) byParent.set(p, []); byParent.get(p)!.push(c); }
  const out: ZoteroCollection[] = [];
  const walk = (parent: string | false, depth: number) => {
    for (const c of (byParent.get(parent) ?? []).sort((x, y) => String(x.data.name).localeCompare(String(y.data.name), 'zh'))) {
      out.push({ key: c.key, name: c.data.name, parent: parent || null, depth, count: c.meta?.numItems ?? 0 });
      walk(c.key, depth + 1);
    }
  };
  walk(false, 0);
  return out;
}

export async function items(a: ZoteroAuth, lib: string, collection: string | null, onProgress?: (n: number, total: number) => void, signal?: AbortSignal): Promise<ZoteroItem[]> {
  const path = collection ? `/${lib}/collections/${collection}/items` : `/${lib}/items`;
  const raw = await all<any>(path, a.key, { format: 'json', include: 'data,csljson', itemType: '-attachment || note || annotation' }, onProgress, signal);
  return raw.filter((x) => x.csljson).map((x) => ({ key: x.key, version: x.version, citationKey: x.data?.citationKey || undefined, csl: x.csljson }));
}

export interface ZoteroPdf { key: string; version: number; name: string; linkMode: string; md5?: string }
export const zoteroSource = (library: string, key: string) => `zotero:${library}/${key}`;
export async function pdfAttachments(a: ZoteroAuth, library: string, itemKey: string, signal?: AbortSignal): Promise<ZoteroPdf[]> {
  if (!/^(users|groups)\/\d+$/.test(library) || !/^[A-Z0-9]{8}$/.test(itemKey)) throw new Error('无效的 Zotero 文库或条目键');
  const raw = await all<any>(`/${library}/items/${itemKey}/children`, a.key, { format: 'json', include: 'data', itemType: 'attachment' }, undefined, signal);
  return raw.filter((x) => x.data?.itemType === 'attachment' && (x.data.contentType === 'application/pdf' || /\.pdf$/i.test(x.data.filename ?? ''))).map((x) => ({ key: x.key, version: x.version, name: x.data.filename || `${x.key}.pdf`, linkMode: x.data.linkMode, md5: x.data.md5 || undefined }));
}

export async function downloadPdf(a: ZoteroAuth, library: string, pdf: ZoteroPdf, signal?: AbortSignal, progress: (bytes: number, total?: number) => void = () => {}): Promise<Blob> {
  if (!/^(users|groups)\/\d+$/.test(library) || !/^[A-Z0-9]{8}$/.test(pdf.key)) throw new Error('无效的 Zotero 附件键');
  if (!['imported_file', 'imported_url'].includes(pdf.linkMode)) throw new Error('这是本机链接附件，Zotero 云端没有文件；请手动上传 PDF');
  // 标准 Authorization 在跨域重定向时由浏览器剥除，密钥不会随 S3 下载地址转发。
  const r = await fetch(`${API}/${library}/items/${pdf.key}/file?v=3`, { signal, headers: { Authorization: `Bearer ${a.key}` }, referrerPolicy: 'no-referrer' });
  if (!r.ok) throw new Error(r.status === 403 ? '没有 PDF 文件读取权限，请检查 Zotero 密钥的文件权限' : r.status === 404 ? 'PDF 未同步至 Zotero Storage（可能仅在本机或 WebDAV）；请手动上传' : `PDF 下载失败（HTTP ${r.status}）`);
  const max = 100 * 1024 * 1024, total = Number(r.headers.get('Content-Length')) || undefined;
  if (total && total > max) { await r.body?.cancel(); throw new Error('单份 PDF 不能超过 100 MB'); }
  const chunks: Uint8Array<ArrayBuffer>[] = []; let bytes = 0;
  if (r.body) {
    const reader = r.body.getReader();
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > max) { await reader.cancel(); throw new Error('单份 PDF 不能超过 100 MB'); } chunks.push(part.value); progress(bytes, total); }
  } else { const b = new Uint8Array(await r.arrayBuffer()); chunks.push(b); bytes = b.length; progress(bytes, total); }
  return new Blob(chunks, { type: 'application/pdf' });
}
