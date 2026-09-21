// Agent 面板的状态：开没开、接的哪家、这一场对话。对话只在内存里，换工程就清
import { create } from 'zustand';
import type { AiConfig } from './config';
import { loadConfig } from './config';
import { runTurn, describeError, type Transcript } from './agent';
import { readAttachment, type Attachment } from './files';
import { setAskUser, setAttachments, type Ask } from './tools';

export interface ToolCard { name: string; input: Record<string, unknown>; result: string; isError: boolean }
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
}

let transcript: Transcript | null = null;
let aborter: AbortController | null = null;
let sentFiles: Attachment[] = [];
const uid = () => Math.random().toString(36).slice(2, 9);

export const useAgent = create<AgentState>((set, get) => ({
  open: false,
  setOpen: (v) => { set({ open: v }); if (v && get().config === undefined) void loadConfig().then((c) => set({ config: c })); },
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
    const c = get().config;
    const files = get().pending;
    if (!c || get().running || (!text.trim() && !files.length)) return;
    if (!transcript || transcript.api !== c.api) transcript = { api: c.api, messages: [] } as Transcript;
    const reply: ChatItem = { id: uid(), role: 'assistant', text: '', tools: [] };
    set({ items: [...get().items, { id: uid(), role: 'user', text, tools: [], files }, reply], running: true, pending: [] });
    sentFiles = [...sentFiles, ...files];
    setAttachments(sentFiles);
    setAskUser((ask) => new Promise<boolean>((resolve) => set({ ask: { ask, resolve } })));
    const patch = (p: Partial<ChatItem>) => set({ items: get().items.map((it) => (it.id === reply.id ? { ...it, ...p } : it)) });
    let buf = '';
    aborter = new AbortController();
    // 中途停了或出错：这一轮的记录整个撤掉，不然下一轮会带着没回结果的工具调用
    const mark = transcript.messages.length;
    try {
      await runTurn(c, transcript, text || '（看附件）', files, {
        onText: (d) => { buf += d; patch({ text: buf }); },
        onTool: (name, input, result, isError) => { const cur = get().items.find((it) => it.id === reply.id)!; patch({ tools: [...cur.tools, { name, input, result, isError }] }); },
      }, aborter.signal);
    } catch (e) {
      transcript.messages.length = mark;
      if (!aborter.signal.aborted) patch({ error: describeError(e) });
    } finally {
      aborter = null;
      set({ running: false });
    }
  },
  stop: () => { get().answer(false); aborter?.abort(); },
  clear: () => { transcript = null; sentFiles = []; setAttachments([]); set({ items: [] }); },
}));
