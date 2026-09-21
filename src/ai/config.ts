// Agent 面板接哪家模型：用户自己填（照 Tylina 的路子，站内不带任何密钥）。两种接口——Anthropic 的 Messages、
// 其余走 OpenAI 兼容的 chat/completions（DeepSeek、Kimi、通义、智谱、OpenRouter、本机 Ollama / LM Studio 都是）。
// 密钥存本机 IndexedDB（meta.ai），只从浏览器直连服务方
import { kv } from '../model/persist';
import { t } from '../i18n';

export type AiApi = 'anthropic' | 'openai';
/** 联网：Anthropic 走服务方自带的搜索与抓取；其余接口走阅读代理抓网页（默认 r.jina.ai，不用密钥），搜索要 Jina 的密钥 */
export interface WebConfig { enabled: boolean; reader: string; searchKey: string }
export interface AiConfig { preset: string; api: AiApi; baseUrl: string; apiKey: string; model: string; web?: WebConfig }
export const defaultWeb = (): WebConfig => ({ enabled: true, reader: 'https://r.jina.ai/', searchKey: '' });
export const webOf = (c: AiConfig): WebConfig => ({ ...defaultWeb(), ...(c.web ?? {}) });
export interface AiPreset { key: string; label: string; api: AiApi; baseUrl: string; model: string; keysUrl?: string; note?: string }

export const PRESETS: AiPreset[] = [
  { key: 'anthropic', label: 'Anthropic', api: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5', keysUrl: 'https://console.anthropic.com/settings/keys' },
  { key: 'openai', label: 'OpenAI', api: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', keysUrl: 'https://platform.openai.com/api-keys' },
  { key: 'deepseek', label: 'DeepSeek', api: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keysUrl: 'https://platform.deepseek.com/api_keys' },
  { key: 'moonshot', label: 'Kimi（Moonshot）', api: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: '', keysUrl: 'https://platform.moonshot.cn/console/api-keys' },
  { key: 'qwen', label: t("通义千问（DashScope）"), api: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: '', keysUrl: 'https://bailian.console.aliyun.com/?apiKey=1' },
  { key: 'zhipu', label: t("智谱 GLM"), api: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: '', keysUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { key: 'openrouter', label: 'OpenRouter', api: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', keysUrl: 'https://openrouter.ai/keys' },
  { key: 'ollama', label: t("Ollama（本机）"), api: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', note: t("启动时要允许网页跨域：OLLAMA_ORIGINS=* ollama serve") },
  { key: 'lmstudio', label: t("LM Studio（本机）"), api: 'openai', baseUrl: 'http://localhost:1234/v1', model: '', note: t("在 LM Studio 的服务器设置里打开 CORS") },
  { key: 'custom', label: t("自定义"), api: 'openai', baseUrl: '', model: '' },
];

export const emptyConfig = (): AiConfig => ({ preset: 'anthropic', api: 'anthropic', baseUrl: PRESETS[0].baseUrl, apiKey: '', model: PRESETS[0].model });
export const loadConfig = async (): Promise<AiConfig | null> => (await kv.get<AiConfig>('meta', 'ai')) ?? null;
export const saveConfig = (c: AiConfig | null) => (c ? kv.set('meta', 'ai', c) : kv.del('meta', 'ai'));
export const configReady = (c: AiConfig | null | undefined): c is AiConfig => !!c && !!c.baseUrl.trim() && !!c.model.trim() && (!!c.apiKey.trim() || /localhost|127\.0\.0\.1/.test(c.baseUrl));

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
