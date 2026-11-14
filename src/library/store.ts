import { create } from 'zustand';
import type { BibEntry } from '../bib/bibtex';
import { extractPdfPages } from '../ai/files';

export interface LibraryDocument {
  id: string; name: string; title: string; size: number; pageCount: number;
  addedAt: number; updatedAt: number; status: 'ready' | 'scanned' | 'error'; error?: string;
  bib?: BibEntry;
  zotero?: { library: string; itemKey: string; attachmentKey: string; version: number; md5?: string };
}
export interface LibraryFile { blob: Blob; pages: string[] }
export const MAX_PDF_SIZE = 100 * 1024 * 1024;

// 独立于论文工程，跨工程共用；二进制与轻量清单分开，打开列表不读取整库 PDF。
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('iota4web-library', 1);
    req.onupgradeneeded = () => { for (const s of ['documents', 'files']) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function read<T>(store: string, key?: string): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store), req = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
    tx.oncomplete = () => { db.close(); resolve(req.result as T); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? req.error); };
  });
}
async function write(id: string, doc: LibraryDocument | null, file?: LibraryFile) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['documents', 'files'], 'readwrite');
    if (doc) { tx.objectStore('documents').put(doc, id); if (file) tx.objectStore('files').put(file, id); }
    else { tx.objectStore('documents').delete(id); tx.objectStore('files').delete(id); }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
  await refreshLibrary();
}
export const listLibrary = async () => (await read<LibraryDocument[]>('documents')).sort((a, b) => b.updatedAt - a.updatedAt);
export const getLibraryDocument = (id: string) => read<LibraryDocument | undefined>('documents', id);
export const getLibraryFile = (id: string) => read<LibraryFile | undefined>('files', id);
export const removeLibraryDocument = (id: string) => write(id, null);
export const useLibrary = create<{ documents: LibraryDocument[]; error: string }> (() => ({ documents: [], error: '' }));
export async function refreshLibrary() {
  try { useLibrary.setState({ documents: await listLibrary(), error: '' }); }
  catch (e) { useLibrary.setState({ error: (e as Error).message || '无法读取本地资料库' }); throw e; }
}
export async function associateLibraryDocument(id: string, bib?: BibEntry) {
  const doc = await getLibraryDocument(id); if (!doc) throw new Error('资料已被删除');
  await write(id, { ...doc, bib, updatedAt: Date.now() });
}

export async function importLibraryPdf(blob: Blob, options: { id?: string; name: string; title?: string; bib?: BibEntry; zotero?: LibraryDocument['zotero']; signal?: AbortSignal; progress?: (status: string) => void }): Promise<LibraryDocument> {
  const { signal, progress = () => {} } = options;
  if (!blob.size || blob.size > MAX_PDF_SIZE) throw new Error('PDF 不能为空，且单份不能超过 100 MB');
  if (!(await blob.slice(0, 1024).text()).includes('%PDF-')) throw new Error('下载内容不是有效 PDF，可能是网页或登录提示');
  signal?.throwIfAborted();
  const id = options.id ?? crypto.randomUUID(), old = await getLibraryDocument(id);
  let pages: string[] = [], error: string | undefined;
  try { pages = await extractPdfPages(blob, signal, (n, total) => progress(`正在索引 PDF：${n}/${total} 页`)); }
  catch (e) { signal?.throwIfAborted(); error = (e as Error).message || 'PDF 文字提取失败'; }
  signal?.throwIfAborted();
  const doc: LibraryDocument = { id, name: options.name, title: options.title || options.bib?.fields.title || options.name, size: blob.size,
    pageCount: pages.length, status: error ? 'error' : pages.some((p) => p.trim()) ? 'ready' : 'scanned', error,
    addedAt: old?.addedAt ?? Date.now(), updatedAt: Date.now(), bib: options.bib ?? old?.bib, zotero: options.zotero };
  await write(id, doc, { blob: new Blob([blob], { type: 'application/pdf' }), pages });
  return doc;
}

export interface LibraryHit { id: string; title: string; name: string; citationKey?: string; page: number; excerpt: string }
export async function searchLibrary(query: string, options: { id?: string; limit?: number; signal?: AbortSignal } = {}): Promise<LibraryHit[]> {
  const terms = query.normalize('NFC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const limit = Math.max(1, Math.min(100, options.limit ?? 20)), hits: LibraryHit[] = [];
  for (const doc of await listLibrary()) {
    options.signal?.throwIfAborted(); if (options.id && doc.id !== options.id) continue;
    const file = await getLibraryFile(doc.id); if (!file) continue;
    for (const [i, page] of file.pages.entries()) {
      const lower = page.toLocaleLowerCase(); if (!terms.every((t) => lower.includes(t))) continue;
      const at = Math.min(...terms.map((t) => lower.indexOf(t))), start = Math.max(0, at - 100);
      hits.push({ id: doc.id, title: doc.title, name: doc.name, citationKey: doc.bib?.key, page: i + 1, excerpt: `${start ? '…' : ''}${page.slice(start, start + 650)}${page.length > start + 650 ? '…' : ''}` });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
