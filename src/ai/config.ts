// Agent 面板接哪家模型：用户自己填（照 Tylina 的路子，站内不带任何密钥）。两种接口——Anthropic 的 Messages、
// 其余走 OpenAI 兼容的 chat/completions（DeepSeek、Kimi、通义、智谱、OpenRouter、本机 Ollama / LM Studio 都是）。
// 能存好几套，一套是全局默认，每篇文档可以指定用另一套；密钥、记忆、预设提示词都存本机 IndexedDB（meta.ai），
// 只从浏览器直连服务方
import { kv } from '../model/persist';

export type AiApi = 'anthropic' | 'openai';
/** 联网：Anthropic 走服务方自带的搜索与抓取；其余接口走阅读代理抓网页（默认 r.jina.ai，不用密钥），搜索要 Jina 的密钥 */
export interface WebConfig { enabled: boolean; reader: string; searchKey: string }
export interface AiConfig { preset: string; api: AiApi; baseUrl: string; apiKey: string; model: string; web?: WebConfig }
/** 存起来的一套接口配置 */
export interface AiProvider extends AiConfig { id: string; name: string }
export interface AiSettings {
  providers: AiProvider[];
  /** 全局默认用哪套 */
  globalId: string | null;
  /** 记忆：跨模型、跨文档的一段话，模型能读能记；关了就不给模型看也不让它写 */
  memory: { enabled: boolean; notes: string };
  /** 全局预设提示词，接在系统提示后面 */
  preset: string;
}
/** webNative：这家接口自带联网搜索怎么开（kimi 的 $web_search 内置函数、dashscope 的 enable_search、智谱的 web_search 工具、openrouter 的 web 插件、anthropic 的服务端工具）；没有的走阅读代理 */
export type WebNative = 'anthropic' | 'kimi' | 'dashscope' | 'zhipu' | 'openrouter';
export interface AiPreset { key: string; label: string; api: AiApi; baseUrl: string; model: string; keysUrl?: string; note?: string; webNative?: WebNative; cn?: boolean }

// 顺序：国内在前、国外在后；自带联网搜索的在前、要外接阅读代理的在后
export const PRESETS: AiPreset[] = [
  { key: 'moonshot', label: 'Kimi（Moonshot）', api: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-turbo-preview', keysUrl: 'https://platform.moonshot.cn/console/api-keys', webNative: 'kimi', cn: true },
  { key: 'qwen', label: '通义千问（DashScope）', api: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keysUrl: 'https://bailian.console.aliyun.com/?apiKey=1', webNative: 'dashscope', cn: true },
  { key: 'zhipu', label: '智谱 GLM', api: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.5', keysUrl: 'https://open.bigmodel.cn/usercenter/apikeys', webNative: 'zhipu', cn: true },
  { key: 'deepseek', label: 'DeepSeek', api: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keysUrl: 'https://platform.deepseek.com/api_keys', cn: true },
  { key: 'anthropic', label: 'Anthropic', api: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5', keysUrl: 'https://console.anthropic.com/settings/keys', webNative: 'anthropic' },
  { key: 'openrouter', label: 'OpenRouter', api: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', keysUrl: 'https://openrouter.ai/keys', webNative: 'openrouter' },
  { key: 'openai', label: 'OpenAI', api: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', keysUrl: 'https://platform.openai.com/api-keys' },
  { key: 'ollama', label: 'Ollama（本机）', api: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', note: '启动时要允许网页跨域：OLLAMA_ORIGINS=* ollama serve' },
  { key: 'lmstudio', label: 'LM Studio（本机）', api: 'openai', baseUrl: 'http://localhost:1234/v1', model: '', note: '在 LM Studio 的服务器设置里打开 CORS' },
  { key: 'custom', label: '自定义', api: 'openai', baseUrl: '', model: '' },
];
export const webNativeOf = (c: AiConfig): WebNative | undefined => (c.api === 'anthropic' ? 'anthropic' : PRESETS.find((p) => p.key === c.preset)?.webNative);


export const defaultWeb = (): WebConfig => ({ enabled: true, reader: 'https://r.jina.ai/', searchKey: '' });
export const webOf = (c: AiConfig): WebConfig => ({ ...defaultWeb(), ...(c.web ?? {}) });
const uid = () => Math.random().toString(36).slice(2, 9);
export const newProvider = (presetKey = 'moonshot'): AiProvider => { const p = PRESETS.find((x) => x.key === presetKey) ?? PRESETS[0]; return { id: uid(), name: '', preset: p.key, api: p.api, baseUrl: p.baseUrl, apiKey: '', model: p.model }; };
export const emptySettings = (): AiSettings => ({ providers: [], globalId: null, memory: { enabled: false, notes: '' }, preset: '' });
/** 显示名：起了名用名，否则「服务方 · 模型」 */
export const providerLabel = (p: AiProvider) => p.name.trim() || `${PRESETS.find((x) => x.key === p.preset)?.label ?? p.preset} · ${p.model}`;
export const configReady = (c: AiConfig | null | undefined): c is AiConfig => !!c && !!c.baseUrl.trim() && !!c.model.trim() && (!!c.apiKey.trim() || /localhost|127\.0\.0\.1/.test(c.baseUrl));

/** 读设置；老版本存的是单独一套配置，折成清单里的第一套并设为全局 */
export async function loadSettings(): Promise<AiSettings> {
  const raw = await kv.get<any>('meta', 'ai');
  if (!raw) return emptySettings();
  if (Array.isArray(raw.providers)) return { ...emptySettings(), ...raw };
  if (raw.baseUrl !== undefined) { const p: AiProvider = { id: uid(), name: '', ...raw }; const s: AiSettings = { ...emptySettings(), providers: [p], globalId: p.id }; await kv.set('meta', 'ai', s); return s; }
  return emptySettings();
}
export const saveSettings = (s: AiSettings) => kv.set('meta', 'ai', s);

const base = (u: string) => u.trim().replace(/\/+$/, '');

/** 列服务方有哪些模型（GET /models；两种接口都有） */
export async function listModels(c: AiConfig, signal?: AbortSignal): Promise<string[]> {
  const url = c.api === 'anthropic' ? `${base(c.baseUrl)}/v1/models?limit=100` : `${base(c.baseUrl)}/models`;
  const headers: Record<string, string> = c.api === 'anthropic'
    ? { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
    : { Authorization: `Bearer ${c.apiKey}` };
  const r = await fetch(url, { headers, signal });
  if (!r.ok) throw new Error(`http ${r.status}`);
  const j = await r.json();
  const rows: any[] = j.data ?? j.models ?? [];
  return rows.map((m) => String(m.id ?? m.name ?? '')).filter(Boolean).sort();
}

