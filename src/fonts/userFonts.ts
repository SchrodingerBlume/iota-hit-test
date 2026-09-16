// 用户字体：两条来路。
//   1. Local Font Access API（Chromium 桌面版）：点一下授权，按家族名只挑模板要的那几副，
//      字节直接转移进编译 worker，不存库也不上传——每次进站点一下就有
//   2. 自己选字体文件（任何浏览器）：存进 IndexedDB，下次自动装上
// 主线程只留元数据（名字、大小、来路），字节一律住在 worker 里；本机那一套动辄三四百 MB。
import { create } from 'zustand';
import { updateUserFonts, useCompileState } from '../compiler/client';
import { saveFontFile, loadFontFile, deleteFontFile, listFontFiles } from '../model/persist';
import type { Fontset } from '../model/types';

/** 模板各档的角色 → 家族名（抄自 iota-hit/src/config/fonts.typ 的 presets） */
export const PRESET_ROLES: Record<Exclude<Fontset, 'webapp'>, { role: string; label: string; family: string; optional?: boolean }[]> = {
  windows: [
    { role: 'songti', label: '宋体', family: 'SimSun' },
    { role: 'heiti', label: '黑体', family: 'SimHei' },
    { role: 'kaishu', label: '楷体', family: 'KaiTi' },
    { role: 'fangsong', label: '仿宋', family: 'FangSong' },
    { role: 'kaishu-gb2312', label: '楷体_GB2312（封面校名）', family: 'KaiTi_GB2312', optional: true },
    { role: 'lishu', label: '隶书（报告落款）', family: 'LiSu', optional: true },
    { role: 'xinwei', label: '华文新魏（深圳本科表单）', family: 'STXinwei', optional: true },
    { role: 'serif', label: '西文衬线', family: 'Times New Roman' },
    { role: 'sans', label: '西文无衬线', family: 'Arial' },
    { role: 'mono', label: '等宽', family: 'Consolas' },
    { role: 'math', label: '数学', family: 'Cambria Math' },
  ],
  macos: [
    { role: 'songti', label: '宋体', family: 'Songti SC' },
    { role: 'heiti', label: '黑体', family: 'Heiti SC' },
    { role: 'kaishu', label: '楷体', family: 'Kaiti SC' },
    { role: 'fangsong', label: '仿宋', family: 'STFangsong' },
    { role: 'kaishu-gb2312', label: '楷体_GB2312（封面校名）', family: 'KaiTi_GB2312', optional: true },
    { role: 'lishu', label: '隶书（报告落款）', family: 'LiSu', optional: true },
    { role: 'xinwei', label: '华文新魏（深圳本科表单）', family: 'STXinwei', optional: true },
    { role: 'serif', label: '西文衬线', family: 'Times New Roman' },
    { role: 'sans', label: '西文无衬线', family: 'Arial' },
    { role: 'mono', label: '等宽', family: 'Menlo' },
    { role: 'math', label: '数学', family: 'STIX Two Math' },
  ],
};

/** 两档一共要找的家族名（小写） */
const WANTED = new Set<string>(
  [...PRESET_ROLES.windows, ...PRESET_ROLES.macos].map((r) => r.family.toLowerCase()),
);

export interface UserFont {
  /** 去重键：大小 + 前 64 KB 的散列 */
  id: string;
  /** 文件名或 postscript 名 */
  name: string;
  size: number;
  source: 'local' | 'file';
}

interface FontState {
  fonts: UserFont[];
  restoring: boolean;
  busy: string | null;
  error: string | null;
  /** Local Font Access API 可不可用 */
  canQuery: boolean;
  readLocal: () => Promise<void>;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeFile: (name: string) => Promise<void>;
  loadStored: () => Promise<void>;
  /** 上次授权过、且工程用的是本机档：进站自动再读一遍，不用再点 */
  autoReadLocal: () => Promise<void>;
}

async function fingerprint(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', buf.slice(0, 65536));
  return `${buf.byteLength}-${[...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function apply(add: { id: string; data: ArrayBuffer }[], remove: string[]) {
  const r = await updateUserFonts(add, remove);
  if (r.error) throw new Error(`字体加载失败：${r.error}`);
}

interface FontData { family: string; fullName: string; postscriptName: string; style: string; blob(): Promise<Blob> }

export const useFontState = create<FontState>((set, get) => ({
  fonts: [],
  restoring: false,
  busy: null,
  error: null,
  canQuery: typeof window !== 'undefined' && 'queryLocalFonts' in window,

  readLocal: async () => {
    if (get().busy) return;
    const query = (window as unknown as { queryLocalFonts?: () => Promise<FontData[]> }).queryLocalFonts;
    if (!query) { set({ error: '当前浏览器不支持读取本机字体，请选择字体文件。' }); return; }
    set({ busy: '正在读取本机字体…', error: null });
    try {
      const all = await query.call(window);
      const hits = all.filter((f) => WANTED.has(f.family.toLowerCase()));
      if (!hits.length) { set({ busy: null, error: '未找到所需字体，请选择字体文件或使用内置字体。' }); return; }
      const fonts = [...get().fonts];
      const seen = new Set<string>();
      const add: { id: string; data: ArrayBuffer }[] = [];
      let n = 0;
      for (const f of hits) {
        set({ busy: `读取 ${f.family}（${++n}/${hits.length}）` });
        const data = await (await f.blob()).arrayBuffer();
        const id = await fingerprint(data);
        if (seen.has(id)) continue; // 同一个 .ttc 里的几个字面共用一份字节
        seen.add(id);
        if (!fonts.some((font) => font.id === id)) fonts.push({ id, name: f.postscriptName || f.fullName, size: data.byteLength, source: 'local' });
        add.push({ id, data });
      }
      set({ busy: '正在加载字体…' });
      await apply(add, []);
      set({ fonts, busy: null });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      set({ busy: null, error: /denied|NotAllowed|permission/i.test(msg) ? '未获得字体访问权限。请再次读取字体，并在浏览器提示中选择“允许”。' : msg });
    }
  },

  addFiles: async (files) => {
    if (get().busy) return;
    set({ busy: '正在加载字体…', error: null });
    try {
    const list = [...files].filter((f) => /\.(otf|ttf|ttc|otc)$/i.test(f.name));
    if (!list.length) { set({ error: '只认 .otf / .ttf / .ttc 文件' }); return; }
    set({ busy: '读取字体文件…', error: null });
    const fonts = [...get().fonts];
    const seen = new Set(fonts.map((f) => f.id));
    const add: { id: string; data: ArrayBuffer }[] = [];
    for (const f of list) {
      const data = await f.arrayBuffer();
      const id = await fingerprint(data);
      if (seen.has(id)) continue;
      seen.add(id);
      await saveFontFile(f.name, f);
      fonts.push({ id, name: f.name, size: data.byteLength, source: 'file' });
      add.push({ id, data });
    }
    set({ busy: '正在加载字体…' });
    await apply(add, []);
    set({ fonts });
    set({ busy: null });
    } catch (error) { set({ error: String((error as Error)?.message ?? error) }); }
    finally { set({ busy: null }); }
  },

  removeFile: async (name) => {
    if (get().busy) return;
    set({ busy: '正在加载字体…', error: null });
    try {
    await deleteFontFile(name);
    const gone = get().fonts.filter((f) => f.source === 'file' && f.name === name).map((f) => f.id);
    set({ fonts: get().fonts.filter((f) => !gone.includes(f.id)), busy: '正在重建字体表…' });
    await apply([], gone);
    set({ busy: null });
    } catch (error) { set({ error: String((error as Error)?.message ?? error) }); }
    finally { set({ busy: null }); }
  },

  autoReadLocal: async () => {
    if (!get().canQuery) return;
    try {
      const p = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
      if (p.state === 'granted') await get().readLocal();
    } catch { /* 浏览器不认这个权限名就算了 */ }
  },

  loadStored: async () => {
    if (get().busy) return;
    set({ busy: '正在加载字体…', error: null });
    try {
    const names = await listFontFiles();
    if (!names.length) return;
    const fonts = [...get().fonts];
    const seen = new Set(fonts.map((f) => f.id));
    const add: { id: string; data: ArrayBuffer }[] = [];
    for (const name of names) {
      const blob = await loadFontFile(name);
      if (!blob) continue;
      const data = await blob.arrayBuffer();
      const id = await fingerprint(data);
      if (seen.has(id)) continue;
      seen.add(id);
      fonts.push({ id, name, size: data.byteLength, source: 'file' });
      add.push({ id, data });
    }
    if (add.length) await apply(add, []);
    set({ fonts });
    } catch (error) { set({ error: String((error as Error)?.message ?? error) }); }
    finally { set({ busy: null }); }
  },
}));

/** 某一档的每个角色现在有没有字：按编译器报回来的家族名判 */
export function roleAvailability(fontset: Exclude<Fontset, 'webapp'>): { role: string; label: string; family: string; optional: boolean; ok: boolean }[] {
  const have = new Set(useCompileState.getState().families.map((f) => f.toLowerCase()));
  return PRESET_ROLES[fontset].map((r) => ({ ...r, optional: !!r.optional, ok: have.has(r.family.toLowerCase()) }));
}
