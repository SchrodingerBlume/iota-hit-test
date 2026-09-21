// Agent 面板的状态：开没开、接的哪家、这一场对话。对话按工程各存各的（本机 IndexedDB meta 里 agent:<工程 id>），换工程就换一份
import { create } from 'zustand';
import { loadSettings, saveSettings, type AiConfig, type AiSettings } from './config';
import { runTurn, describeError, type Transcript } from './agent';
import { readAttachment, type Attachment } from './files';
import { setAskUser, setAttachments, setOnDerived, setMemoryContext, setSandboxContext, systemPromptFor, dropChecks, type Ask } from './tools';
import { kv } from '../model/persist';
import { useStore } from '../model/store';

export interface ToolCard { name: string; input: Record<string, unknown>; result: string; isError: boolean; images?: Attachment[] }
export interface ChatItem { id: string; role: 'user' | 'assistant'; text: string; tools: ToolCard[]; files?: Attachment[]; error?: string; /** 正在干什么（只有最后一条、跑着的时候有）：在跑的工具、分步状态、从几点起 */ live?: { tool?: { name: string; input: Record<string, unknown> }; status: string; since: number } }
/** 模型要改设置时弹的授权卡：用户点了才往下走 */
export interface Pending { ask: Ask; resolve: (ok: boolean) => void }

interface AgentState {
  open: boolean;
  setOpen: (v: boolean) => void;
  /** 存着的几套接口、全局默认、记忆、预设 */
  settings: AiSettings | undefined;
  setSettings: (s: AiSettings) => Promise<void>;
  /** 这篇文档指定用哪套（null = 跟全局）与它自己的预设提示词 */
  docProviderId: string | null;
  docPreset: string;
  setDocOverride: (o: { providerId?: string | null; preset?: string }) => Promise<void>;
  /** 眼下生效的那一套 */
  config: AiConfig | null | undefined;
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
  /** 一个工程存很多场对话：清单、当前是哪场、新开 / 切换 / 删 */
  chats: ChatMeta[];
  chatId: string | null;
  newChat: () => Promise<void>;
  openChat: (id: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  starChat: (id: string, on: boolean) => Promise<void>;
}
export interface ChatMeta { id: string; title: string; updatedAt: number; starred?: boolean; named?: boolean }

let transcript: Transcript | null = null;
let aborter: AbortController | null = null;
let sentFiles: Attachment[] = [];
let boundDoc: string | null = null;
const uid = () => Math.random().toString(36).slice(2, 9);

interface Saved { items: ChatItem[]; transcript: Transcript | null; sentFiles: Attachment[] }
interface Index { chats: ChatMeta[]; current: string | null; providerId?: string | null; preset?: string }
const indexKey = (doc: string) => `agent:${doc}`;
const chatKey = (doc: string, chat: string) => `agent:${doc}:${chat}`;
let saveTimer = 0;
/** 星标的在前，其余按最近 */
const sortChats = (chats: ChatMeta[]) => [...chats].sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || b.updatedAt - a.updatedAt);
const titleOf = (items: ChatItem[]) => (items.find((i) => i.role === 'user')?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 28) || '新对话';
/** 读工程的对话清单；老版本那一份（键上直接是一场对话）折成清单里的第一场 */
async function loadIndex(doc: string): Promise<Index> {
  const raw = await kv.get<any>('meta', indexKey(doc));
  if (raw && Array.isArray(raw.chats)) return raw as Index;
  if (raw && Array.isArray(raw.items)) {
    const id = uid();
    await kv.set('meta', chatKey(doc, id), raw);
    const index: Index = { chats: [{ id, title: titleOf(raw.items), updatedAt: Date.now() }], current: id };
    await kv.set('meta', indexKey(doc), index);
    return index;
  }
  return { chats: [], current: null };
}
async function persistChat(doc: string, chat: string, items: ChatItem[], chats: ChatMeta[]) {
  // 附件的正文（base64）都在对话记录里，太大就只留这一场的展示、不留能续聊的原始记录
  const saved: Saved = { items, transcript, sentFiles };
  const size = JSON.stringify(saved).length;
  await kv.set('meta', chatKey(doc, chat), size > 40 * 1024 * 1024 ? { ...saved, transcript: null, sentFiles: [] } : saved);
  const meta = chats.find((c) => c.id === chat);
  const next = sortChats([{ ...meta, id: chat, title: meta?.named || (meta?.title && meta.title !== '新对话') ? meta!.title : titleOf(items), updatedAt: Date.now() }, ...chats.filter((c) => c.id !== chat)]);
  const idx = await loadIndex(doc);
  await kv.set('meta', indexKey(doc), { ...idx, chats: next, current: chat } as Index);
  return next;
}

/** 换了接口 / 模型之后接着聊：原始记录（两家接口的消息形状不同、各家的内置工具消息别家不认）不能直接带过去，
 *  按面板上显示的对话重建一份——用户那句原文 + 图片附件，模型那句原文 + 工具记录折成几行字 */
function rebuildTranscript(api: AiConfig['api'], items: ChatItem[]): Transcript {
  const messages: any[] = [];
  const brief = (v: unknown, n: number) => { const t = typeof v === 'string' ? v : JSON.stringify(v); return t.length > n ? `${t.slice(0, n)}…` : t; };
  for (const it of items) {
    if (it.role === 'user') {
      const imgs = (it.files ?? []).filter((f) => f.kind === 'image');
      const others = (it.files ?? []).filter((f) => f.kind !== 'image').map((f) => f.name);
      const text = `${it.text || '（看附件）'}${others.length ? `\n（附件：${others.join('、')}）` : ''}`;
      if (api === 'anthropic') messages.push({ role: 'user', content: [...imgs.map((f) => ({ type: 'image', source: { type: 'base64', media_type: f.type, data: f.data } })), { type: 'text', text }] });
      else messages.push({ role: 'user', content: imgs.length ? [...imgs.map((f) => ({ type: 'image_url', image_url: { url: `data:${f.type};base64,${f.data}` } })), { type: 'text', text }] : text });
    } else {
      const log = it.tools.map((t) => `- ${t.name}(${brief(t.input, 160)}) → ${brief(t.result, 300).replace(/\n/g, ' ')}`).join('\n');
      const text = `${it.text}${log ? `${it.text ? '\n\n' : ''}[之前调用过的工具]\n${log}` : ''}`.trim();
      if (text) messages.push({ role: 'assistant', content: text });
    }
  }
  // 两条同角色的挨在一起 Anthropic 不收：并成一条
  const merged: any[] = [];
  for (const m of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) { const toArr = (c: any) => (typeof c === 'string' ? [{ type: 'text', text: c }] : c); prev.content = [...toArr(prev.content), ...toArr(m.content)]; }
    else merged.push(m);
  }
  return { api, messages: merged } as Transcript;
}

/** 算出眼下生效的那一套；换了套就断掉续聊的原始记录（下一句发出去时按显示的对话重建） */
function refresh() {
  const st = useAgent.getState();
  const s = st.settings;
  if (!s) return;
  const pick = (id: string | null) => (id ? s.providers.find((p) => p.id === id) ?? null : null);
  const next = pick(st.docProviderId) ?? pick(s.globalId) ?? s.providers[0] ?? null;
  const cur = st.config;
  if (cur && next && (cur.api !== next.api || cur.model !== next.model || cur.baseUrl !== next.baseUrl)) transcript = null;
  useAgent.setState({ config: next });
}

export const useAgent = create<AgentState>((set, get) => ({
  open: false,
  setOpen: (v) => { set({ open: v }); if (v) { if (get().settings === undefined) void loadSettings().then((st) => { set({ settings: st }); refresh(); }); void get().bind(); } },
  settings: undefined,
  setSettings: async (st) => { await saveSettings(st); set({ settings: st }); refresh(); },
  docProviderId: null,
  docPreset: '',
  setDocOverride: async (o) => {
    set({ docProviderId: o.providerId !== undefined ? o.providerId : get().docProviderId, docPreset: o.preset !== undefined ? o.preset : get().docPreset });
    refresh();
    if (boundDoc) { const idx = await loadIndex(boundDoc); await kv.set('meta', indexKey(boundDoc), { ...idx, providerId: get().docProviderId, preset: get().docPreset } as Index); }
  },
  config: undefined,
  settingsOpen: false,
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  items: [],
  running: false,
  pending: [],
  ask: null,
  chats: [],
  chatId: null,
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
    if (!transcript || transcript.api !== c.api) transcript = rebuildTranscript(c.api, get().items);
    const reply: ChatItem = { id: uid(), role: 'assistant', text: '', tools: [] };
    const save = () => { const st = get(); if (boundDoc && st.chatId) void persistChat(boundDoc, st.chatId, st.items, st.chats).then((chats) => set({ chats })); };
    if (!get().chatId) { const id = uid(); set({ chatId: id, chats: [{ id, title: '新对话', updatedAt: Date.now() }, ...get().chats] }); }
    set({ items: [...get().items, { id: uid(), role: 'user', text, tools: [], files }, reply], running: true, pending: [] });
    save();
    sentFiles = [...sentFiles, ...files];
    setAttachments(sentFiles);
    setAskUser((ask) => new Promise<boolean>((resolve) => set({ ask: { ask, resolve } })));
    let derived: Attachment[] = [];
    setOnDerived((a) => { sentFiles = [...sentFiles, a]; derived.push(a); });
    // 每一步都落盘（节流），刷新页面也不丢半场对话
    const patch = (p: Partial<ChatItem>) => { set({ items: get().items.map((it) => (it.id === reply.id ? { ...it, ...p } : it)) }); window.clearTimeout(saveTimer); saveTimer = window.setTimeout(save, 600); };
    let buf = '';
    aborter = new AbortController();
    // 中途停了或出错：这一轮的记录整个撤掉，不然下一轮会带着没回结果的工具调用
    const mark = transcript.messages.length;
    try {
      const st = get().settings;
      setMemoryContext({ enabled: !!st?.memory.enabled, notes: st?.memory.notes ?? '', write: async (notes) => { const cur = get().settings; if (cur) await get().setSettings({ ...cur, memory: { ...cur.memory, notes } }); } });
      dropChecks();
      setSandboxContext(st?.sandbox ?? { browser: true, server: false, bridge: { enabled: false, url: '', token: '', confirm: true } });
      const liveOf = () => get().items.find((it) => it.id === reply.id)?.live;
      patch({ live: { status: '准备系统提示…', since: Date.now() } });
      await runTurn(c, transcript, text || '（看附件）', files, await systemPromptFor(st, get().docPreset), {
        onText: (d) => { buf += d; patch({ text: buf }); },
        onTool: (name, input, result, isError) => { const cur = get().items.find((it) => it.id === reply.id)!; patch({ tools: [...cur.tools, { name, input, result, isError, images: derived.length ? derived : undefined }], live: { status: '', since: Date.now() } }); derived = []; },
        onToolStart: (name, input) => patch({ live: { tool: { name, input }, status: '', since: Date.now() } }),
        onStatus: (status) => { const l = liveOf(); patch({ live: { tool: l?.tool, status, since: status && status !== l?.status ? Date.now() : l?.since ?? Date.now() } }); },
      }, aborter.signal);
    } catch (e) {
      transcript.messages.length = mark;
      if (!aborter.signal.aborted) patch({ error: describeError(e) });
    } finally {
      aborter = null;
      set({ running: false, items: get().items.map((it) => (it.id === reply.id ? { ...it, live: undefined } : it)) });
      window.clearTimeout(saveTimer);
      save();
    }
  },
  stop: () => { get().answer(false); aborter?.abort(); },
  clear: () => { const st = get(); if (st.chatId) void st.deleteChat(st.chatId); },
  bind: async () => {
    const id = useStore.getState().doc.id;
    if (!id || id === boundDoc) return;
    if (get().running) get().stop();
    const prev = get();
    if (boundDoc && prev.chatId && prev.items.length) await persistChat(boundDoc, prev.chatId, prev.items, prev.chats);
    boundDoc = id;
    const index = await loadIndex(id);
    set({ chats: sortChats(index.chats), chatId: null, items: [], pending: [], ask: null, docProviderId: index.providerId ?? null, docPreset: index.preset ?? '' });
    refresh();
    transcript = null; sentFiles = []; setAttachments([]);
    if (index.current && index.chats.some((c) => c.id === index.current)) await get().openChat(index.current);
  },
  newChat: async () => {
    const st = get();
    if (st.running) st.stop();
    if (boundDoc && st.chatId && st.items.length) await persistChat(boundDoc, st.chatId, st.items, st.chats);
    transcript = null; sentFiles = []; setAttachments([]);
    set({ chatId: null, items: [], pending: [], ask: null });
    if (boundDoc) await kv.set('meta', indexKey(boundDoc), { ...(await loadIndex(boundDoc)), chats: get().chats, current: null } as Index);
  },
  openChat: async (id) => {
    if (!boundDoc) return;
    const st = get();
    if (st.chatId === id) return;
    if (st.running) st.stop();
    if (st.chatId && st.items.length) await persistChat(boundDoc, st.chatId, st.items, st.chats);
    const saved = await kv.get<Saved>('meta', chatKey(boundDoc, id));
    transcript = saved?.transcript ?? null;
    sentFiles = saved?.sentFiles ?? [];
    setAttachments(sentFiles);
    set({ chatId: id, items: saved?.items ?? [], pending: [], ask: null });
    await kv.set('meta', indexKey(boundDoc), { ...(await loadIndex(boundDoc)), chats: get().chats, current: id } as Index);
  },
  renameChat: async (id, title) => {
    const t = title.replace(/\s+/g, ' ').trim();
    const chats = get().chats.map((c) => (c.id === id ? { ...c, title: t || c.title, named: !!t } : c));
    set({ chats });
    if (boundDoc) await kv.set('meta', indexKey(boundDoc), { ...(await loadIndex(boundDoc)), chats } as Index);
  },
  starChat: async (id, on) => {
    const chats = sortChats(get().chats.map((c) => (c.id === id ? { ...c, starred: on } : c)));
    set({ chats });
    if (boundDoc) await kv.set('meta', indexKey(boundDoc), { ...(await loadIndex(boundDoc)), chats } as Index);
  },
  deleteChat: async (id) => {
    if (!boundDoc) return;
    const st = get();
    if (st.chatId === id) { if (st.running) st.stop(); transcript = null; sentFiles = []; setAttachments([]); set({ chatId: null, items: [], pending: [], ask: null }); }
    const chats = st.chats.filter((c) => c.id !== id);
    set({ chats });
    await kv.del('meta', chatKey(boundDoc, id));
    await kv.set('meta', indexKey(boundDoc), { ...(await loadIndex(boundDoc)), chats, current: get().chatId } as Index);
  },
}));
