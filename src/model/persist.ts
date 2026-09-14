// IndexedDB 里两张表：doc（整份工程 JSON，一条）与 images（文件名 → Blob）。
// 不用 localStorage：论文正文的 JSON 轻易过 5 MB。

const DB = 'iota4web';
const VERSION = 2;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('doc')) db.createObjectStore('doc');
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      // v2：用户自己选的字体文件（文件名 → Blob）
      if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export const kv = {
  get: <T>(store: string, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key)),
  set: (store: string, key: string, value: unknown) => tx<IDBValidKey>(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: string, key: string) => tx<undefined>(store, 'readwrite', (s) => s.delete(key)),
  keys: (store: string) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()),
};

export const saveDocJson = (doc: unknown) => kv.set('doc', 'current', doc);
export const loadDocJson = <T>() => kv.get<T>('doc', 'current');
export const saveImage = (name: string, blob: Blob) => kv.set('images', name, blob);
export const loadImage = (name: string) => kv.get<Blob>('images', name);
export const deleteImage = (name: string) => kv.del('images', name);
export const listImages = () => kv.keys('images') as Promise<string[]>;
export const saveFontFile = (name: string, blob: Blob) => kv.set('fonts', name, blob);
export const loadFontFile = (name: string) => kv.get<Blob>('fonts', name);
export const deleteFontFile = (name: string) => kv.del('fonts', name);
export const listFontFiles = () => kv.keys('fonts') as Promise<string[]>;
