// Agent 面板的状态：开没开、接的哪家、这一场对话。对话只在内存里，换工程就清
import { create } from 'zustand';
import type { AiConfig } from './config';
import { loadConfig } from './config';
import { runTurn, describeError, type Transcript } from './agent';

export interface ToolCard { name: string; input: Record<string, unknown>; result: string; isError: boolean }
export interface ChatItem { id: string; role: 'user' | 'assistant'; text: string; tools: ToolCard[]; error?: string }

interface AgentState {
  open: boolean;
  setOpen: (v: boolean) => void;
  config: AiConfig | null | undefined;
  setConfig: (c: AiConfig | null) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  items: ChatItem[];
  running: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

let transcript: Transcript | null = null;
let aborter: AbortController | null = null;
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
  send: async (text) => {
    const c = get().config;
    if (!c || get().running || !text.trim()) return;
    if (!transcript || transcript.api !== c.api) transcript = { api: c.api, messages: [] } as Transcript;
    const reply: ChatItem = { id: uid(), role: 'assistant', text: '', tools: [] };
    set({ items: [...get().items, { id: uid(), role: 'user', text, tools: [] }, reply], running: true });
    const patch = (p: Partial<ChatItem>) => set({ items: get().items.map((it) => (it.id === reply.id ? { ...it, ...p } : it)) });
    let buf = '';
    aborter = new AbortController();
    // 中途停了或出错：这一轮的记录整个撤掉，不然下一轮会带着没回结果的工具调用
    const mark = transcript.messages.length;
    try {
      await runTurn(c, transcript, text, {
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
  stop: () => { aborter?.abort(); },
  clear: () => { transcript = null; set({ items: [] }); },
}));
