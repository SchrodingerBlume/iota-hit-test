// 本机桥的客户端：网页连用户自己电脑上跑的 public/bridge/hit-bridge.mjs（只听 127.0.0.1、凭令牌）。
// https 页面连 http://127.0.0.1 浏览器放行（回环地址算安全上下文），Ollama / LM Studio 也是这么连的
export interface BridgeConfig { enabled: boolean; url: string; token: string; confirm: boolean }
export const defaultBridge = (): BridgeConfig => ({ enabled: false, url: 'http://127.0.0.1:7711', token: '', confirm: true });

const base = (u: string) => u.trim().replace(/\/+$/, '');
async function call<T>(b: BridgeConfig, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${base(b.url)}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${b.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal });
  } catch (e) { throw new Error(`连不上本机桥 ${b.url}：${(e as Error).message}。确认 hit-bridge.mjs 还在运行、地址一致`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `http ${r.status}`);
  return j as T;
}

export interface BridgeInfo { ok: boolean; dir: string; node: string; platform: string; tools: { typst: boolean; python: boolean; git: boolean } }
export const bridgePing = (b: BridgeConfig, signal?: AbortSignal) => call<BridgeInfo>(b, '/ping', undefined, signal);
export const bridgeRun = (b: BridgeConfig, cmd: string, cwd?: string, timeout?: number, stdin?: string, signal?: AbortSignal) => call<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>(b, '/run', { cmd, cwd, timeout, stdin }, signal);
export const bridgeLs = (b: BridgeConfig, path?: string) => call<{ path: string; entries: { name: string; dir: boolean; size: number; mtime: number }[] }>(b, `/ls?path=${encodeURIComponent(path ?? '.')}`);
export const bridgeRead = (b: BridgeConfig, path: string, b64 = false) => call<{ path: string; text?: string; b64?: string; size: number }>(b, `/read?path=${encodeURIComponent(path)}${b64 ? '&b64=1' : ''}`);
export const bridgeWrite = (b: BridgeConfig, path: string, data: { text?: string; b64?: string }) => call<{ ok: boolean; path: string }>(b, '/write', { path, ...data });
