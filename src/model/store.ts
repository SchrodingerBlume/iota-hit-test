import { create } from 'zustand';
import type { ThesisDoc, Settings, Info, RichDoc, Pages, Abbreviation, SymbolEntry, Defense, ImageAsset } from './types';
import { emptyDoc } from './types';
import { defaultSettings } from './options';
import { defaultInfo } from './info';
import { saveDocJson, loadDocJson } from './persist';
import { sampleDoc } from './sample';

export type RichKey = 'abstractZh' | 'abstractEn' | 'body' | 'conclusion' | 'appendix' | 'acknowledgement' | 'resume';

export type Section =
  | 'settings' | 'info' | 'abstract' | 'nomenclature' | 'body' | 'conclusion'
  | 'bibliography' | 'appendix' | 'achievements' | 'defense' | 'acknowledgement' | 'resume' | 'pages';

const person = () => ({ name: '', title: '', affiliation: '', discipline: '' });

export const newDoc = (): ThesisDoc => ({
  version: 1,
  id: crypto.randomUUID(),
  updatedAt: new Date().toISOString(),
  settings: defaultSettings(),
  info: defaultInfo(),
  abstractZh: emptyDoc(),
  abstractEn: emptyDoc(),
  abbreviations: [],
  symbols: [],
  body: emptyDoc(),
  conclusion: emptyDoc(),
  bibliography: '',
  appendix: emptyDoc(),
  achievements: '',
  defense: {
    enabled: false,
    reviewers: [person(), person()],
    chair: person(),
    members: [person(), person(), person()],
    secretary: person(),
    resolution: emptyDoc(),
  },
  acknowledgement: emptyDoc(),
  resume: emptyDoc(),
  pages: {
    declarations: true,
    index: false,
    resume: false,
    achievements: false,
    defense: false,
    listOfFigures: false,
    listOfTables: false,
    listOfEquations: false,
    nomenclature: true,
    appendix: true,
  },
  images: [],
});

/** 老工程文件缺的键补上默认值 */
export function normalizeDoc(raw: Partial<ThesisDoc>): ThesisDoc {
  const base = newDoc();
  const doc: ThesisDoc = { ...base, ...raw, version: 1 } as ThesisDoc;
  doc.settings = { ...base.settings, ...(raw.settings ?? {}) };
  doc.info = { ...base.info, ...(raw.info ?? {}) };
  doc.pages = { ...base.pages, ...(raw.pages ?? {}) };
  doc.defense = { ...base.defense, ...(raw.defense ?? {}) };
  for (const k of ['abstractZh', 'abstractEn', 'body', 'conclusion', 'appendix', 'acknowledgement', 'resume'] as RichKey[]) {
    if (!doc[k] || doc[k].type !== 'doc') doc[k] = emptyDoc();
  }
  doc.abbreviations ??= [];
  doc.symbols ??= [];
  doc.images ??= [];
  return doc;
}

interface State {
  doc: ThesisDoc;
  section: Section;
  loaded: boolean;
  dirty: boolean;
  setSection: (s: Section) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setInfo: (patch: Partial<Info>) => void;
  setRich: (key: RichKey, value: RichDoc) => void;
  setPages: (patch: Partial<Pages>) => void;
  setBibliography: (s: string) => void;
  setAchievements: (s: string) => void;
  setAbbreviations: (a: Abbreviation[]) => void;
  setSymbols: (s: SymbolEntry[]) => void;
  setDefense: (d: Defense) => void;
  setImages: (images: ImageAsset[]) => void;
  replaceDoc: (doc: ThesisDoc) => void;
  load: () => Promise<void>;
}

let saveTimer: number | undefined;
let unsaved: ThesisDoc | null = null;
function scheduleSave(doc: ThesisDoc) {
  unsaved = doc;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { unsaved = null; void saveDocJson(doc); }, 500);
}
// 关页前把最后半秒内的改动也写进去
window.addEventListener('beforeunload', () => { if (unsaved) { void saveDocJson(unsaved); unsaved = null; } });

export const useStore = create<State>((set, get) => {
  const update = (fn: (d: ThesisDoc) => ThesisDoc) => {
    const doc = fn(get().doc);
    doc.updatedAt = new Date().toISOString();
    set({ doc, dirty: true });
    scheduleSave(doc);
  };
  return {
    doc: newDoc(),
    section: 'body',
    loaded: false,
    dirty: false,
    setSection: (section) => set({ section }),
    setSettings: (patch) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } })),
    setInfo: (patch) => update((d) => ({ ...d, info: { ...d.info, ...patch } })),
    setRich: (key, value) => update((d) => ({ ...d, [key]: value })),
    setPages: (patch) => update((d) => ({ ...d, pages: { ...d.pages, ...patch } })),
    setBibliography: (bibliography) => update((d) => ({ ...d, bibliography })),
    setAchievements: (achievements) => update((d) => ({ ...d, achievements })),
    setAbbreviations: (abbreviations) => update((d) => ({ ...d, abbreviations })),
    setSymbols: (symbols) => update((d) => ({ ...d, symbols })),
    setDefense: (defense) => update((d) => ({ ...d, defense })),
    setImages: (images) => update((d) => ({ ...d, images })),
    replaceDoc: (doc) => { set({ doc: normalizeDoc(doc), dirty: true }); scheduleSave(get().doc); },
    load: async () => {
      try {
        const saved = await loadDocJson<ThesisDoc>();
        set({ doc: saved ? normalizeDoc(saved) : sampleDoc(), loaded: true });
      } catch {
        set({ doc: sampleDoc(), loaded: true });
      }
    },
  };
});
