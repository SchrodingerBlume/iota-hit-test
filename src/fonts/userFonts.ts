// 用户字体：两条来路。
//   1. Local Font Access API（Chromium 桌面版）：授权后按家族名读取模板所需字体，
//      字节直接转移到编译 worker，不上传服务器。
//   2. 自己选字体文件（任何浏览器）：存进 IndexedDB，下次自动装上
// 主线程只留元数据（名字、大小、来路），字节一律住在 worker 里；本机那一套动辄三四百 MB。
import { create } from 'zustand';
import { updateUserFonts, useCompileState } from '../compiler/client';
import { MATH_FONT } from '../typst/serialize';
import { saveFontFile, loadFontFile, deleteFontFile, listFontFiles } from '../model/persist';
import type { Fontset } from '../model/types';
import { t } from '../i18n';

/** 模板字体角色与家族名，来源为 iota-hit/src/fonts/presets.typ。 */
export const PRESET_ROLES: Record<Exclude<Fontset, 'webapp'>, { role: string; label: string; family: string; optional?: boolean }[]> = {
  windows: [
    { role: 'songti', label: t("宋体"), family: 'SimSun' },
    { role: 'heiti', label: t("黑体"), family: 'SimHei' },
    { role: 'kaishu', label: t("楷体"), family: 'KaiTi' },
    { role: 'fangsong', label: t("仿宋"), family: 'FangSong' },
    { role: 'kaishu-gb2312', label: t("楷体_GB2312（封面校名）"), family: 'KaiTi_GB2312', optional: true },
    { role: 'lishu', label: t("隶书（报告落款）"), family: 'LiSu', optional: true },
    { role: 'xinwei', label: t("华文新魏（深圳本科表单）"), family: 'STXinwei', optional: true },
    { role: 'serif', label: t("西文衬线"), family: 'Times New Roman' },
    { role: 'sans', label: t("西文无衬线"), family: 'Arial' },
    { role: 'mono', label: t("等宽"), family: 'Consolas' },
    { role: 'math', label: t("数学"), family: MATH_FONT },
  ],
  macos: [
    { role: 'songti', label: t("宋体"), family: 'Songti SC' },
    { role: 'heiti', label: t("黑体"), family: 'Heiti SC' },
    { role: 'kaishu', label: t("楷体"), family: 'Kaiti SC' },
    { role: 'fangsong', label: t("仿宋"), family: 'STFangsong' },
    { role: 'kaishu-gb2312', label: t("楷体_GB2312（封面校名）"), family: 'KaiTi_GB2312', optional: true },
    { role: 'lishu', label: t("隶书（报告落款）"), family: 'LiSu', optional: true },
    { role: 'xinwei', label: t("华文新魏（深圳本科表单）"), family: 'STXinwei', optional: true },
    { role: 'serif', label: t("西文衬线"), family: 'Times New Roman' },
    { role: 'sans', label: t("西文无衬线"), family: 'Arial' },
    { role: 'mono', label: t("等宽"), family: 'Menlo' },
    { role: 'math', label: t("数学"), family: MATH_FONT },
  ],
};

/** 两档一共要找的家族名（小写） */
const WANTED = new Set<string>(
  [...PRESET_ROLES.windows, ...PRESET_ROLES.macos].map((r) => r.family.toLowerCase()),
);

/** OpenType 有没有 MATH 表：只读文件头（表目录在最前面，TTC 读每一副的目录） */
export function hasMathTable(head: ArrayBuffer): boolean {
  const v = new DataView(head);
  const dir = (off: number): boolean => {
    if (off + 12 > v.byteLength) return false;
    const n = v.getUint16(off + 4);
    for (let i = 0; i < n; i++) {
      const p = off + 12 + i * 16;
      if (p + 4 > v.byteLength) return false;
      if (v.getUint32(p) === 0x4d415448) return true; // 'MATH'
    }
    return false;
  };
  if (v.byteLength < 12) return false;
  const tag = v.getUint32(0);
  if (tag === 0x74746366) { // 'ttcf'
    const n = v.getUint32(8);
    for (let i = 0; i < Math.min(n, 64); i++) { const p = 12 + i * 4; if (p + 4 > v.byteLength) break; if (dir(v.getUint32(p))) return true; }
    return false;
  }
  return dir(0);
}

const MATH_KEY = 'iota4web-math-fonts';
const readMathList = (): string[] => { try { return JSON.parse(localStorage.getItem(MATH_KEY) || '[]'); } catch { return []; } };

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
  readLocal: (extra?: string[], onlyExtra?: boolean) => Promise<void>;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeFile: (name: string) => Promise<void>;
  loadStored: () => Promise<void>;
  /** 上次授权过、且工程用的是本机档：进站自动再读一遍，不用再点 */
  autoReadLocal: (extra?: string[]) => Promise<void>;
  /** 本机扫出来的数学字体（有 MATH 表的）家族名，记在本机 */
  mathFonts: string[];
  /** 扫描本机字体并返回包含 MATH 表的字体；调用前需要用户授权。 */
  scanMathFonts: () => Promise<void>;
  /** 把这一家族的字读进编译器 */
  loadFamily: (family: string) => Promise<void>;
}

async function fingerprint(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', buf.slice(0, 65536));
  return `${buf.byteLength}-${[...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function apply(add: { id: string; data: ArrayBuffer }[], remove: string[]) {
  const r = await updateUserFonts(add, remove);
  if (r.error) throw new Error(t("字体加载失败：{{error}}", { error: r.error }));
}

interface FontData { family: string; fullName: string; postscriptName: string; style: string; blob(): Promise<Blob> }

export const useFontState = create<FontState>((set, get) => ({
  fonts: [],
  restoring: false,
  busy: null,
  error: null,
  canQuery: typeof window !== 'undefined' && 'queryLocalFonts' in window,

  mathFonts: readMathList(),
  scanMathFonts: async () => {
    if (get().busy) return;
    const query = (window as unknown as { queryLocalFonts?: () => Promise<FontData[]> }).queryLocalFonts;
    if (!query) { set({ error: t("当前浏览器不支持读取本机字体，请选择字体文件。") }); return; }
    set({ busy: t("正在扫描本机数学字体…"), error: null });
    try {
      const all = await query.call(window);
      const found = new Set<string>();
      const seenFamily = new Set<string>();
      let n = 0;
      for (const f of all) {
        // 一个家族只看一副：MATH 表在常规那一副上
        if (seenFamily.has(f.family)) continue;
        seenFamily.add(f.family);
        if (++n % 50 === 0) set({ busy: t("正在扫描本机数学字体…（{{n}}/{{total}}）", { n, total: seenFamily.size + 0 }) });
        try {
          const head = await (await f.blob()).slice(0, 16384).arrayBuffer();
          if (hasMathTable(head)) found.add(f.family);
        } catch { /* 读不了的跳过 */ }
      }
      const mathFonts = [...found].sort();
      try { localStorage.setItem(MATH_KEY, JSON.stringify(mathFonts)); } catch { /* */ }
      set({ mathFonts, busy: null, error: mathFonts.length ? null : t("本机没有找到带 MATH 表的字体。") });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      set({ busy: null, error: /denied|NotAllowed|permission/i.test(msg) ? t("未获得字体访问权限。请再次读取字体，并在浏览器提示中选择“允许”。") : msg });
    }
  },
  loadFamily: async (family) => { await get().readLocal([family], true); },

  readLocal: async (extra: string[] = [], onlyExtra = false) => {
    if (get().busy) return;
    const query = (window as unknown as { queryLocalFonts?: () => Promise<FontData[]> }).queryLocalFonts;
    if (!query) { set({ error: t("当前浏览器不支持读取本机字体，请选择字体文件。") }); return; }
    set({ busy: t("正在读取本机字体…"), error: null });
    try {
      const all = await query.call(window);
      const wanted = new Set([...(onlyExtra ? [] : WANTED), ...extra.map((x) => x.toLowerCase())]);
      // 编译器里已经有的家族不再读一遍（本机那一套一百多 MB，只补缺的）
      const have = new Set(useCompileState.getState().families.map((x) => x.toLowerCase()));
      const hits = all.filter((f) => wanted.has(f.family.toLowerCase()) && !have.has(f.family.toLowerCase()));
      if (!hits.length && all.some((f) => wanted.has(f.family.toLowerCase()))) { set({ busy: null }); return; }
      if (!hits.length) { set({ busy: null, error: t("未找到所需字体，请选择字体文件或使用内置字体。") }); return; }
      const fonts = [...get().fonts];
      const seen = new Set<string>();
      const add: { id: string; data: ArrayBuffer }[] = [];
      let n = 0;
      for (const f of hits) {
        set({ busy: t("读取 {{family}}（{{v1}}/{{length}}）", { family: f.family, v1: ++n, length: hits.length }) });
        const data = await (await f.blob()).arrayBuffer();
        const id = await fingerprint(data);
        if (seen.has(id)) continue; // 同一个 .ttc 里的几个字面共用一份字节
        seen.add(id);
        if (!fonts.some((font) => font.id === id)) fonts.push({ id, name: f.postscriptName || f.fullName, size: data.byteLength, source: 'local' });
        add.push({ id, data });
      }
      set({ busy: t("正在加载字体…") });
      await apply(add, []);
      set({ fonts, busy: null });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      set({ busy: null, error: /denied|NotAllowed|permission/i.test(msg) ? t("未获得字体访问权限。请再次读取字体，并在浏览器提示中选择“允许”。") : msg });
    }
  },

  addFiles: async (files) => {
    if (get().busy) return;
    set({ busy: t("正在加载字体…"), error: null });
    try {
    const list = [...files].filter((f) => /\.(otf|ttf|ttc|otc)$/i.test(f.name));
    if (!list.length) { set({ error: t("请选择 .otf、.ttf 或 .ttc 字体文件") }); return; }
    set({ busy: t("选择字体文件…"), error: null });
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
    set({ busy: t("正在加载字体…") });
    await apply(add, []);
    set({ fonts });
    set({ busy: null });
    } catch (error) { set({ error: String((error as Error)?.message ?? error) }); }
    finally { set({ busy: null }); }
  },

  removeFile: async (name) => {
    if (get().busy) return;
    set({ busy: t("正在加载字体…"), error: null });
    try {
    await deleteFontFile(name);
    const gone = get().fonts.filter((f) => f.source === 'file' && f.name === name).map((f) => f.id);
    set({ fonts: get().fonts.filter((f) => !gone.includes(f.id)), busy: t("正在重建字体表…") });
    await apply([], gone);
    set({ busy: null });
    } catch (error) { set({ error: String((error as Error)?.message ?? error) }); }
    finally { set({ busy: null }); }
  },

  autoReadLocal: async (extra = []) => {
    if (!get().canQuery) return;
    try {
      const p = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
      if (p.state === 'granted') await get().readLocal(extra);
    } catch { /* 浏览器不认这个权限名就算了 */ }
  },

  loadStored: async () => {
    if (get().busy) return;
    set({ busy: t("正在加载字体…"), error: null });
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
export function roleAvailability(fontset: Exclude<Fontset, 'webapp'>, mathFont?: string): { role: string; label: string; family: string; optional: boolean; ok: boolean }[] {
  const have = new Set(useCompileState.getState().families.map((f) => f.toLowerCase()));
  return PRESET_ROLES[fontset].map((r) => { const family = r.role === 'math' && mathFont ? mathFont : r.family; return { ...r, family, optional: !!r.optional, ok: have.has(family.toLowerCase()) }; });
}
