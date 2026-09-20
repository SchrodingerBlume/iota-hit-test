import { create } from 'zustand';
import type { ThesisDoc, Settings, Info, RichDoc, Pages, Abbreviation, SymbolEntry, Defense, DefensePerson, ImageAsset, NomenclatureOptions, Comment, OpenrightKey, TriBool } from './types';
import { emptyDoc } from './types';
import { defaultSettings } from './options';
import { defaultInfo } from './info';
import { saveProject, loadProject, deleteProjectRecord, allProjects, getActiveProjectId, setActiveProjectId, loadLegacyDoc, clearLegacyDoc, setImageNamespace, saveImage, loadImage, listImageKeys, copyImageRaw, deleteImageKey } from './persist';
import { clearImageCache } from '../editor/imageCache';
import { sampleDoc, SAMPLE_IMAGE } from './sample';
import { parseBibtex, type BibEntry } from '../bib/bibtex';
import { t } from '../i18n';

export type RichKey = 'abstractZh' | 'abstractEn' | 'body' | 'conclusion' | 'appendix' | 'acknowledgement' | 'resume';

export type Section =
  | 'settings' | 'info' | 'abstract' | 'nomenclature' | 'body' | 'conclusion'
  | 'bibliography' | 'appendix' | 'achievements' | 'defense' | 'acknowledgement' | 'resume' | 'toc' | 'index';

const person = () => ({ name: '', title: '', affiliation: '', discipline: '' });

export const newDoc = (): ThesisDoc => ({
  version: 1,
  id: crypto.randomUUID(),
  name: t("未命名论文"),
  updatedAt: new Date().toISOString(),
  settings: defaultSettings(),
  info: defaultInfo(),
  abstractZh: emptyDoc(),
  abstractEn: emptyDoc(),
  abbreviations: [],
  symbols: [],
  nomenclatureOptions: { sort: 'auto', usedOnly: 'auto', header: 'auto', hangingIndent: '', form: 'auto' },
  body: emptyDoc(),
  conclusion: emptyDoc(),
  references: [],
  bibliography: '',
  appendix: emptyDoc(),
  achievementEntries: [],
  achievements: '',
  defense: {
    enabled: false,
    reviewers: [person(), person()],
    chair: [person()],
    members: [person(), person(), person()],
    secretary: [person()],
    resolution: emptyDoc(),
  },
  acknowledgement: emptyDoc(),
  resume: emptyDoc(),
  pages: {
    cover: 'auto', titlepage: 'auto', abstract: 'auto', tableOfContents: 'auto',
    declarations: 'auto', index: 'auto', resume: 'auto', achievements: 'auto', defense: 'auto',
    listOfFigures: 'auto', listOfTables: 'auto', listOfEquations: 'auto',
    symbolsPage: 'auto', abbreviationsPage: 'auto', nomenclatureMerged: 'auto', appendix: 'auto',
  },

  images: [],
  comments: [],
});

/** 老工程文件缺的键补上默认值 */
export function normalizeDoc(raw: Partial<ThesisDoc>): ThesisDoc {
  const base = newDoc();
  const doc: ThesisDoc = { ...base, ...raw, version: 1 } as ThesisDoc;
  doc.settings = { ...base.settings, ...(raw.settings ?? {}) };
  doc.info = { ...base.info, ...(raw.info ?? {}) };
  doc.pages = { ...base.pages, ...(raw.pages ?? {}) };
  // 旧工程：一个总开关管符号表与缩略语表，拆开；关着的旧布尔照旧，开着的（原来是默认）改成 auto
  const rp: any = raw.pages ?? {};
  if (rp.symbolsPage === undefined && rp.nomenclature === false) { doc.pages.symbolsPage = false; doc.pages.abbreviationsPage = false; }
  for (const k of ['declarations', 'appendix', 'symbolsPage', 'abbreviationsPage', 'nomenclatureMerged'] as (keyof Pages)[]) if (rp[k] === true) (doc.pages as any)[k] = 'auto';
  delete (doc.pages as any).nomenclature;
  doc.nomenclatureOptions = { ...base.nomenclatureOptions, ...(raw.nomenclatureOptions ?? {}) };
  doc.defense = { ...base.defense, ...(raw.defense ?? {}) };
  // 旧工程：主席、秘书各一条记录 → 一串
  for (const k of ['chair', 'secretary'] as const) if (!Array.isArray(doc.defense[k])) doc.defense[k] = [doc.defense[k] as unknown as DefensePerson];
  for (const k of ['abstractZh', 'abstractEn', 'body', 'conclusion', 'appendix', 'acknowledgement', 'resume'] as RichKey[]) {
    if (!doc[k] || doc[k].type !== 'doc') doc[k] = emptyDoc();
  }
  doc.name ||= raw.info?.title?.split('\n')[0] || t("未命名论文");
  // 旧工程：BibTeX 原文 → 结构化条目
  if (!Array.isArray(doc.references)) doc.references = [];
  if (!Array.isArray(doc.achievementEntries)) doc.achievementEntries = [];
  if (doc.bibliography?.trim()) { doc.references = [...doc.references, ...parseBibtex(doc.bibliography)]; doc.bibliography = ''; }
  if (doc.achievements?.trim()) { doc.achievementEntries = [...doc.achievementEntries, ...parseBibtex(doc.achievements)]; doc.achievements = ''; }
  doc.abbreviations ??= [];
  if (!Array.isArray(doc.comments)) doc.comments = [];
  doc.openright ??= {};
  doc.symbols ??= [];
  doc.images ??= [];
  return doc;
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  settings: Settings;
  /** 正文里有多少个块，卡片上当个规模提示 */
  blocks: number;
}

const metaOf = (d: ThesisDoc): ProjectMeta => ({ id: d.id, name: d.name, updatedAt: d.updatedAt, settings: d.settings, blocks: (d.body.content?.length ?? 0) });

interface State {
  doc: ThesisDoc;
  section: Section;
  /** 项目管理界面还是编辑器 */
  view: 'projects' | 'editor';
  projects: ProjectMeta[];
  loaded: boolean;
  dirty: boolean;
  setSection: (s: Section) => void;
  setView: (v: 'projects' | 'editor') => void;
  setSettings: (patch: Partial<Settings>) => void;
  setComments: (comments: Comment[]) => void;
  setOpenright: (patch: Partial<Record<OpenrightKey, TriBool>>) => void;
  setInfo: (patch: Partial<Info>) => void;
  setSourceDraft: (key: string, source: string | undefined) => void;
  setRich: (key: RichKey, value: RichDoc) => void;
  setPages: (patch: Partial<Pages>) => void;
  setReferences: (e: BibEntry[]) => void;
  setAchievementEntries: (e: BibEntry[]) => void;
  setAbbreviations: (a: Abbreviation[]) => void;
  setSymbols: (s: SymbolEntry[]) => void;
  setNomenclatureOptions: (patch: Partial<NomenclatureOptions>) => void;
  setDefense: (d: Defense) => void;
  setImages: (images: ImageAsset[]) => void;
  /** 打开工程文件：并入当前项目（保留 id） */
  replaceDoc: (doc: ThesisDoc) => void;
  importProject: (doc: ThesisDoc, images: { name: string; blob: Blob }[]) => Promise<void>;
  load: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  createProject: (opts: { name: string; settings: Partial<Settings>; template: 'blank' | 'sample' }) => Promise<string>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<string>;
}

let saveTimer: number | undefined;
let unsaved: ThesisDoc | null = null;
function scheduleSave(doc: ThesisDoc) {
  unsaved = doc;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { unsaved = null; void saveProject(doc.id, doc); }, 500);
}
async function flushSave() { if (unsaved) { const d = unsaved; unsaved = null; window.clearTimeout(saveTimer); await saveProject(d.id, d); } }
// 关页前把最后半秒内的改动也写进去
window.addEventListener('beforeunload', () => { void flushSave(); });

/** 样例项目引用的那张图：从站内拿进当前项目的名字空间 */
async function ensureSampleImage() {
  if (await loadImage(SAMPLE_IMAGE)) return;
  try {
    const blob = await fetch(new URL('sample/sample-bearing.png', document.baseURI)).then((r) => r.blob());
    await saveImage(SAMPLE_IMAGE, blob);
  } catch { /* 没有也不致命 */ }
}

let loadOnce: Promise<void> | null = null;

export const useStore = create<State>((set, get) => {
  const update = (fn: (d: ThesisDoc) => ThesisDoc) => {
    const doc = fn(get().doc);
    doc.updatedAt = new Date().toISOString();
    set({ doc, dirty: true, projects: get().projects.map((p) => (p.id === doc.id ? metaOf(doc) : p)) });
    scheduleSave(doc);
  };
  const activate = async (doc: ThesisDoc) => {
    clearImageCache();
    setImageNamespace(doc.id);
    await setActiveProjectId(doc.id);
    set({ doc, view: 'editor', section: 'body', loaded: true });
  };
  return {
    doc: newDoc(),
    section: 'body',
    view: 'projects',
    projects: [],
    loaded: false,
    dirty: false,
    setSection: (section) => set({ section }),
    setView: (view) => set({ view }),
    setSettings: (patch) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } })),
    setComments: (comments) => update((d) => ({ ...d, comments })),
    setOpenright: (patch) => update((d) => ({ ...d, openright: { ...d.openright, ...patch } })),
    setInfo: (patch) => update((d) => ({ ...d, info: { ...d.info, ...patch } })),
    setSourceDraft: (key, source) => update((d) => { const sourceDrafts = { ...d.sourceDrafts }; if (source === undefined) delete sourceDrafts[key]; else sourceDrafts[key] = source; return { ...d, sourceDrafts }; }),
    // Markdown 模式会在每次成功解析后同步富文本；草稿由模式切换显式清理，避免一次输入触发两次整篇保存与排版。
    setRich: (key, value) => update((d) => ({ ...d, [key]: value })),
    setPages: (patch) => update((d) => ({ ...d, pages: { ...d.pages, ...patch } })),
    setReferences: (references) => update((d) => ({ ...d, references })),
    setAchievementEntries: (achievementEntries) => update((d) => ({ ...d, achievementEntries })),
    setAbbreviations: (abbreviations) => update((d) => ({ ...d, abbreviations })),
    setSymbols: (symbols) => update((d) => ({ ...d, symbols })),
    setNomenclatureOptions: (patch) => update((d) => ({ ...d, nomenclatureOptions: { ...d.nomenclatureOptions, ...patch } })),
    setDefense: (defense) => update((d) => ({ ...d, defense })),
    setImages: (images) => update((d) => ({ ...d, images })),
    replaceDoc: (incoming) => {
      const cur = get().doc;
      const doc = normalizeDoc({ ...incoming, id: cur.id, name: incoming.name || cur.name });
      update(() => doc);
    },

    importProject: async (incoming, images) => {
      await flushSave();
      const doc = normalizeDoc({ ...incoming, id: crypto.randomUUID(), updatedAt: new Date().toISOString() });
      try {
        for (const image of images) await saveImage(image.name, image.blob, doc.id);
        await saveProject(doc.id, doc);
      } catch (error) {
        await deleteProjectRecord(doc.id);
        for (const key of await listImageKeys()) if (key.startsWith(`${doc.id}/`)) await deleteImageKey(key);
        throw error;
      }
      await get().refreshProjects();
      await activate(doc);
    },

    refreshProjects: async () => {
      const docs = (await allProjects<ThesisDoc>()).map(normalizeDoc);
      docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      set({ projects: docs.map(metaOf) });
    },

    load: () => {
      // StrictMode 会把初始化跑两遍，别建出两份样例
      if (loadOnce) return loadOnce;
      loadOnce = (async () => {
      try {
        // v2 → v3：把单份工程迁成一个项目，图片挪进它的名字空间
        const legacy = await loadLegacyDoc<ThesisDoc>();
        if (legacy) {
          const doc = normalizeDoc({ ...legacy, name: legacy.name || legacy.info?.title?.split('\n')[0] || t("未命名论文") });
          await saveProject(doc.id, doc);
          for (const key of await listImageKeys()) {
            if (!key.includes('/')) { await copyImageRaw(key, `${doc.id}/${key}`); await deleteImageKey(key); }
          }
          await clearLegacyDoc();
        }
        await get().refreshProjects();
        const projects = get().projects;
        if (!projects.length) {
          set({ loaded: true, view: 'projects' });
          return;
        }
        const activeId = (await getActiveProjectId()) ?? projects[0].id;
        const doc = (await loadProject<ThesisDoc>(activeId)) ?? (await loadProject<ThesisDoc>(projects[0].id));
        if (!doc) { set({ loaded: true, view: 'projects' }); return; }
        setImageNamespace(doc.id);
        if (doc.images.some((i) => i.name === SAMPLE_IMAGE)) await ensureSampleImage();
        set({ doc: normalizeDoc(doc), loaded: true, view: 'projects' });
        await setActiveProjectId(doc.id);
      } catch (e) {
        console.error('[iota4web] 读取工程失败', e);
        set({ loaded: true, view: 'projects' });
      }
      })();
      return loadOnce;
    },

    openProject: async (id) => {
      await flushSave();
      const doc = await loadProject<ThesisDoc>(id);
      if (!doc) return;
      await activate(normalizeDoc(doc));
    },

    createProject: async ({ name, settings, template }) => {
      await flushSave();
      const doc = template === 'sample' ? sampleDoc({ ...defaultSettings(), ...settings }) : newDoc();
      doc.id = crypto.randomUUID();
      doc.name = name.trim() || (template === 'sample' ? doc.name : t("未命名论文"));
      doc.settings = { ...doc.settings, ...settings };
      doc.updatedAt = new Date().toISOString();
      await saveProject(doc.id, doc);
      setImageNamespace(doc.id);
      if (doc.images.some((image) => image.name === SAMPLE_IMAGE)) await ensureSampleImage();
      await get().refreshProjects();
      await activate(doc);
      return doc.id;
    },

    renameProject: async (id, name) => {
      await flushSave();
      const doc = id === get().doc.id ? get().doc : await loadProject<ThesisDoc>(id);
      if (!doc) return;
      const next = { ...doc, name: name.trim() || doc.name, updatedAt: new Date().toISOString() };
      await saveProject(id, next);
      if (id === get().doc.id) set({ doc: next });
      await get().refreshProjects();
    },

    deleteProject: async (id) => {
      await flushSave();
      await deleteProjectRecord(id);
      for (const key of await listImageKeys()) if (key.startsWith(`${id}/`)) await deleteImageKey(key);
      await get().refreshProjects();
      if (id === get().doc.id) {
        const next = get().projects[0];
        if (next) await get().openProject(next.id);
        else { clearImageCache(); set({ doc: newDoc(), view: 'projects', dirty: false }); }
      }
    },

    duplicateProject: async (id) => {
      await flushSave();
      const src = id === get().doc.id ? get().doc : await loadProject<ThesisDoc>(id);
      if (!src) return id;
      const copy = normalizeDoc({ ...JSON.parse(JSON.stringify(src)), id: crypto.randomUUID(), name: t("{{name}} 副本", { name: src.name }), updatedAt: new Date().toISOString() });
      await saveProject(copy.id, copy);
      for (const key of await listImageKeys()) if (key.startsWith(`${id}/`)) await copyImageRaw(key, `${copy.id}/${key.slice(id.length + 1)}`);
      await get().refreshProjects();
      return copy.id;
    },
  };
});
