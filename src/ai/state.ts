// Agent 面板的状态：开没开、接的哪家、这一场对话。对话按工程各存各的（本机 IndexedDB meta 里 agent:<工程 id>），换工程就换一份
import { create } from 'zustand';
import type { AiConfig } from './config';
import { loadConfig } from './config';
import { runTurn, describeError, type Transcript } from './agent';
import { readAttachment, type Attachment } from './files';
import { setAskUser, setAttachments, setOnDerived, type Ask } from './tools';
import { kv } from '../model/persist';
import { useStore } from '../model/store';

export interface ToolCard { name: string; input: Record<string, unknown>; result: string; isError: boolean; images?: Attachment[] }
export interface ChatItem { id: string; role: 'user' | 'assistant'; text: string; tools: ToolCard[]; files?: Attachment[]; error?: string }
/** 模型要改设置时弹的授权卡：用户点了才往下走 */
export interface Pending { ask: Ask; resolve: (ok: boolean) => void }

interface AgentState {
  open: boolean;
  setOpen: (v: boolean) => void;
  config: AiConfig | null | undefined;
  setConfig: (c: AiConfig | null) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  items: ChatItem[];
  running: boolean;
  pending: Attachment[];
  ask: Pending | null;
  answer: (ok: boolean) => void;
  attach: (files: File[]) => Promise<void>;
  detach: (id: string) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
  /** 对话跟着当前工程走：换了工程就存下这份、读那份 */
  bind: () => Promise<void>;
}

let transcript: Transcript | null = null;
let aborter: AbortController | null = null;
let sentFiles: Attachment[] = [];
let boundDoc: string | null = null;
const uid = () => Math.random().toString(36).slice(2, 9);

interface Saved { items: ChatItem[]; transcript: Transcript | null; sentFiles: Attachment[] }
const keyOf = (id: string) => `agent:${id}`;
async function persist(id: string, items: ChatItem[]) {
  if (!items.length) { await kv.del('meta', keyOf(id)); return; }
  // 附件的正文（base64）都在对话记录里，太大就只留这一场的展示、不留能续聊的原始记录
  const saved: Saved = { items, transcript, sentFiles };
  const size = JSON.stringify(saved).length;
  await kv.set('meta', keyOf(id), size > 40 * 1024 * 1024 ? { ...saved, transcript: null, sentFiles: [] } : saved);
}

export const useAgent = create<AgentState>((set, get) => ({
  open: false,
  setOpen: (v) => { set({ open: v }); if (v) { if (get().config === undefined) void loadConfig().then((c) => set({ config: c })); void get().bind(); } },
  config: undefined,
  setConfig: (c) => { set({ config: c }); transcript = null; },
  settingsOpen: false,
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  items: [],
  running: false,
  pending: [],
  ask: null,
  answer: (ok) => { const a = get().ask; if (a) { set({ ask: null }); a.resolve(ok); } },
  attach: async (files) => {
    for (const f of files) {
      try { const a = await readAttachment(f); set({ pending: [...get().pending, a] }); }
      catch (e) { set({ items: [...get().items, { id: uid(), role: 'assistant', text: '', tools: [], error: (e as Error).message }] }); }
    }
  },
  detach: (id) => set({ pending: get().pending.filter((a) => a.id !== id) }),
  send: async (text) => {
    await get().bind();
    const c = get().config;
    const files = get().pending;
    if (!c || get().running || (!text.trim() && !files.length)) return;
    if (!transcript || transcript.api !== c.api) transcript = { api: c.api, messages: [] } as Transcript;
    const reply: ChatItem = { id: uid(), role: 'assistant', text: '', tools: [] };
    set({ items: [...get().items, { id: uid(), role: 'user', text, tools: [], files }, reply], running: true, pending: [] });
    sentFiles = [...sentFiles, ...files];
    setAttachments(sentFiles);
    setAskUser((ask) => new Promise<boolean>((resolve) => set({ ask: { ask, resolve } })));
    let derived: Attachment[] = [];
    setOnDerived((a) => { sentFiles = [...sentFiles, a]; derived.push(a); });
    const patch = (p: Partial<ChatItem>) => set({ items: get().items.map((it) => (it.id === reply.id ? { ...it, ...p } : it)) });
    let buf = '';
    aborter = new AbortController();
    // 中途停了或出错：这一轮的记录整个撤掉，不然下一轮会带着没回结果的工具调用
    const mark = transcript.messages.length;
    try {
      await runTurn(c, transcript, text || '（看附件）', files, {
        onText: (d) => { buf += d; patch({ text: buf }); },
        onTool: (name, input, result, isError) => { const cur = get().items.find((it) => it.id === reply.id)!; patch({ tools: [...cur.tools, { name, input, result, isError, images: derived.length ? derived : undefined }] }); derived = []; },
      }, aborter.signal);
    } catch (e) {
      transcript.messages.length = mark;
      if (!aborter.signal.aborted) patch({ error: describeError(e) });
    } finally {
      aborter = null;
      set({ running: false });
      if (boundDoc) void persist(boundDoc, get().items);
    }
  },
  stop: () => { get().answer(false); aborter?.abort(); },
  clear: () => { transcript = null; sentFiles = []; setAttachments([]); set({ items: [] }); if (boundDoc) void kv.del('meta', keyOf(boundDoc)); },
  bind: async () => {
    const id = useStore.getState().doc.id;
    if (!id || id === boundDoc) return;
    if (get().running) { get().stop(); }
    if (boundDoc) await persist(boundDoc, get().items);
    boundDoc = id;
    const saved = await kv.get<Saved>('meta', keyOf(id));
    transcript = saved?.transcript ?? null;
    sentFiles = saved?.sentFiles ?? [];
    setAttachments(sentFiles);
    set({ items: saved?.items ?? [], pending: [], ask: null });
  },
}));
