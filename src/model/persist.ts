// IndexedDB：
//   projects  项目 id → 整份工程 JSON（含 name）
//   images    `${项目 id}/${文件名}` → Blob
//   fonts     用户自己选的字体文件（文件名 → Blob），跨项目共用
//   meta      activeProject 等零碎
// 不用 localStorage：论文正文的 JSON 轻易过 5 MB。
// v1/v2 时只有一份工程存在 doc/current，v3 迁成一个项目。

const DB = 'iota4web';
const VERSION = 3;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['doc', 'images', 'cache', 'fonts', 'projects', 'meta']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
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
  all: <T>(store: string) => tx<T[]>(store, 'readonly', (s) => s.getAll()),
};

// ── 项目 ──
export const saveProject = (id: string, doc: unknown) => kv.set('projects', id, doc);
export const loadProject = <T>(id: string) => kv.get<T>('projects', id);
export const deleteProjectRecord = (id: string) => kv.del('projects', id);
export const allProjects = <T>() => kv.all<T>('projects');
export const getActiveProjectId = () => kv.get<string>('meta', 'activeProject');
export const setActiveProjectId = (id: string) => kv.set('meta', 'activeProject', id);
/** v2 遗留的那一份单工程 */
export const loadLegacyDoc = <T>() => kv.get<T>('doc', 'current');
export const clearLegacyDoc = () => kv.del('doc', 'current');

// ── 图片：按项目分名字空间 ──
let activeProject = '';
export const setImageNamespace = (projectId: string) => { activeProject = projectId; };
const imgKey = (name: string) => `${activeProject}/${name}`;
export const saveImage = (name: string, blob: Blob) => kv.set('images', imgKey(name), blob);
export const loadImage = (name: string) => kv.get<Blob>('images', imgKey(name));
export const deleteImage = (name: string) => kv.del('images', imgKey(name));
export const listImages = async () => (await kv.keys('images') as string[]).filter((k) => k.startsWith(`${activeProject}/`)).map((k) => k.slice(activeProject.length + 1));
/** 跨项目搬图（复制项目、迁移遗留数据） */
export const copyImageRaw = async (fromKey: string, toKey: string) => { const b = await kv.get<Blob>('images', fromKey); if (b) await kv.set('images', toKey, b); };
export const listImageKeys = () => kv.keys('images') as Promise<string[]>;
export const deleteImageKey = (key: string) => kv.del('images', key);

// ── 字体文件 ──
export const saveFontFile = (name: string, blob: Blob) => kv.set('fonts', name, blob);
export const loadFontFile = (name: string) => kv.get<Blob>('fonts', name);
export const deleteFontFile = (name: string) => kv.del('fonts', name);
export const listFontFiles = () => kv.keys('fonts') as Promise<string[]>;
