// 跟模型来回：发对话与工具表，流式收字；模型要调工具就在本地跑、把结果回给它，直到它不再调。
// 两种接口各一个驱动，对话记录按接口各自的原样存（一个会话只用一家）
import type Anthropic from '@anthropic-ai/sdk';
import { webOf, webNativeOf, type AiConfig } from './config';
import { runTool, toolsFor, setWebConfig, serverSandboxOn, collectBytes, setReporter, type ToolDef } from './tools';
import { pdfText, type Attachment } from './files';

export interface AgentEvents {
  onText: (delta: string) => void;
  onTool: (name: string, input: Record<string, unknown>, result: string, isError: boolean) => void;
  /** 工具开始跑了（结果还没回来）：面板先立一张转圈的卡 */
  onToolStart: (name: string, input: Record<string, unknown>) => void;
  /** 眼下在等什么（等模型回复、工具里的分步进度）；空串清掉 */
  onStatus: (text: string) => void;
}
/** 一次会话的原始记录：两家接口的消息形状不同，装在各自的数组里 */
export type Transcript = { api: 'anthropic'; messages: Anthropic.MessageParam[] } | { api: 'openai'; messages: any[] };

const MAX_ROUNDS = 12;
const base = (u: string) => u.trim().replace(/\/+$/, '');

async function exec(name: string, input: Record<string, unknown>): Promise<{ result: string; isError: boolean }> {
  try { return { result: await runTool(name, input), isError: false }; }
  catch (e) { return { result: `工具出错：${(e as Error).message}`, isError: true }; }
}

export async function runTurn(c: AiConfig, t: Transcript, userText: string, files: Attachment[], system: string, ev: AgentEvents, signal: AbortSignal): Promise<void> {
  if (t.api === 'anthropic') return anthropicTurn(c, t.messages, userText, files, system, ev, signal);
  return openaiTurn(c, t.messages, userText, files, system, ev, signal);
}

// ── Anthropic Messages（官方 SDK，浏览器里直连要 dangerouslyAllowBrowser）────────────────────
async function anthropicTurn(c: AiConfig, messages: Anthropic.MessageParam[], userText: string, files: Attachment[], system: string, ev: AgentEvents, signal: AbortSignal) {
  const { default: Client } = await import('@anthropic-ai/sdk');
  const client = new Client({ apiKey: c.apiKey, baseURL: base(c.baseUrl), dangerouslyAllowBrowser: true, maxRetries: 1 });
  const tools: Anthropic.ToolUnion[] = toolsFor(c).map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters as Anthropic.Tool.InputSchema }));
  // 联网走 Anthropic 自带的服务端工具：新一代模型用带动态过滤的那版，老模型只有基础搜索
  if (webOf(c).enabled) {
    if (/opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|fable|mythos/.test(c.model)) tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 8 } as any, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 } as any);
    else tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 8 } as any);
  }
  // 服务方沙盒：Anthropic 容器里跑 Python（bash + 文件编辑两个内置工具）；附件顺带传进容器，模型在里面能直接读
  const server = serverSandboxOn();
  if (server) tools.push({ type: 'code_execution_20260120', name: 'code_execution' } as any);
  const parts: Anthropic.ContentBlockParam[] = files.map((f) => f.kind === 'image'
    ? { type: 'image', source: { type: 'base64', media_type: f.type as 'image/png', data: f.data } }
    : f.kind === 'pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data }, title: f.name }
    : { type: 'document', source: { type: 'text', media_type: 'text/plain', data: f.data }, title: f.name });
  if (server) {
    for (const f of files) {
      try {
        const blob = f.kind === 'text' ? new Blob([f.data], { type: 'text/plain' }) : new Blob([Uint8Array.from(atob(f.data), (ch) => ch.charCodeAt(0))], { type: f.type });
        const up = await client.files.upload({ file: new File([blob], f.name, { type: blob.type }) });
        parts.push({ type: 'container_upload', file_id: up.id } as any);
      } catch (e) { console.warn('[agent] 附件没传进容器', f.name, e); }
    }
  }
  messages.push({ role: 'user', content: parts.length ? [...parts, { type: 'text', text: userText }] : userText });
  setReporter(ev.onStatus);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    ev.onStatus(round ? '工具结果发回去了，等模型接着说…' : '等模型回复…');
    const stream = client.messages.stream({
      model: c.model, max_tokens: 16000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools, messages,
    }, { signal });
    let first = true;
    stream.on('text', (delta) => { if (first) { first = false; ev.onStatus(''); } ev.onText(delta); });
    const msg = await stream.finalMessage();
    ev.onStatus('');
    messages.push({ role: 'assistant', content: msg.content });
    await reportServerTools(client, msg.content, ev);
    if (msg.stop_reason === 'refusal') { ev.onText("\n（模型拒绝了这次请求）"); return; }
    if (msg.stop_reason !== 'tool_use') return;
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;
      const input = (block.input ?? {}) as Record<string, unknown>;
      ev.onToolStart(block.name, input);
      const { result, isError } = await exec(block.name, input);
      ev.onTool(block.name, input, result, isError);
      results.push({ type: 'tool_result', tool_use_id: block.id, content: result, is_error: isError || undefined });
    }
    messages.push({ role: 'user', content: results });
  }
  ev.onText("\n（工具调用轮数到上限，先停在这儿）");
}

/** 服务方沙盒在这一条消息里干了什么：每次 bash / 文件编辑配成一张卡，产出的文件按 file_id 下回来收成附件 */
async function reportServerTools(client: any, content: any[], ev: AgentEvents) {
  const uses = new Map<string, any>();
  for (const b of content) if (b.type === 'server_tool_use') uses.set(b.id, b);
  for (const b of content) {
    if (b.type !== 'bash_code_execution_tool_result' && b.type !== 'text_editor_code_execution_tool_result') continue;
    const use = uses.get(b.tool_use_id);
    const input = use?.input ?? {};
    const r = b.content ?? {};
    if (r.type === 'code_execution_tool_result_error' || r.type === 'bash_code_execution_tool_result_error' || r.type === 'text_editor_code_execution_tool_result_error') { ev.onTool('code_execution', input, `出错：${r.error_code ?? JSON.stringify(r)}`, true); continue; }
    const parts: string[] = [];
    if (r.stdout?.trim()) parts.push(`stdout：\n${String(r.stdout).slice(0, 12000)}`);
    if (r.stderr?.trim()) parts.push(`stderr：\n${String(r.stderr).slice(0, 4000)}`);
    if (r.return_code !== undefined) parts.push(`退出码 ${r.return_code}`);
    if (r.type === 'text_editor_code_execution_view_result') parts.push(String(r.content ?? '').slice(0, 8000));
    if (r.type === 'text_editor_code_execution_create_result' || r.type === 'text_editor_code_execution_str_replace_result') parts.push(r.is_file_update ? '改了文件' : '写了文件');
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const f of r.content ?? []) {
      if (f.type !== 'bash_code_execution_output' || !f.file_id) continue;
      try {
        const meta = await client.files.retrieveMetadata(f.file_id);
        const res = await client.files.download(f.file_id);
        files.push({ name: String(meta.filename ?? f.file_id).split(/[\\/]/).pop()!, bytes: new Uint8Array(await res.arrayBuffer()) });
      } catch (e) { parts.push(`有个产出文件没下回来（${(e as Error).message}）`); }
    }
    if (files.length) parts.push(`产出的文件（已收进对话）：${collectBytes(files).join('、')}`);
    ev.onTool('code_execution', input, parts.join('\n') || '（没有输出）', false);
  }
}

// ── OpenAI 兼容 chat/completions（DeepSeek、Kimi、通义、智谱、OpenRouter、Ollama…），SSE 自己解 ──
interface ToolCallAcc { id: string; name: string; args: string }

async function openaiTurn(c: AiConfig, messages: any[], userText: string, files: Attachment[], system: string, ev: AgentEvents, signal: AbortSignal) {
  const w = webOf(c);
  setWebConfig({ reader: w.reader, searchKey: w.searchKey });
  const tools: any[] = toolsFor(c).map((d: ToolDef) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } }));
  // 自带联网的几家：Kimi 是内置函数 $web_search（模型调了要把参数原样回给它、搜索在它那边做），智谱是 web_search 工具，
  // 通义 / OpenRouter 是请求体里的开关
  const native = w.enabled ? webNativeOf(c) : undefined;
  const extra: Record<string, unknown> = {};
  if (native === 'kimi') tools.push({ type: 'builtin_function', function: { name: '$web_search' } });
  else if (native === 'zhipu') tools.push({ type: 'web_search', web_search: { enable: true, search_result: true } });
  else if (native === 'dashscope') extra.enable_search = true;
  else if (native === 'openrouter') extra.plugins = [{ id: 'web' }];
  // 系统提示每轮刷新（记忆、预设可能变了）
  if (messages[0]?.role === 'system') messages[0] = { role: 'system', content: system }; else messages.unshift({ role: 'system', content: system });
  const parts: any[] = [];
  for (const f of files) {
    if (f.kind === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${f.type};base64,${f.data}` } });
    else if (f.kind === 'pdf') parts.push({ type: 'text', text: await pdfText(f.data, f.name) });
    else parts.push({ type: 'text', text: `${f.name}\n${f.data}` });
  }
  messages.push({ role: 'user', content: parts.length ? [...parts, { type: 'text', text: userText }] : userText });
  setReporter(ev.onStatus);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    ev.onStatus(round ? '工具结果发回去了，等模型接着说…' : '等模型回复…');
    const r = await fetch(`${base(c.baseUrl)}/chat/completions`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) },
      body: JSON.stringify({ model: c.model, messages, tools, stream: true, ...extra }),
    });
    if (!r.ok) throw new Error(`http ${r.status}${await describeBody(r)}`);
    let text = '';
    const calls = new Map<number, ToolCallAcc>();
    let finish = '';
    for await (const data of sse(r, signal)) {
      if (data === '[DONE]') break;
      let j: any; try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
      const ch = j.choices?.[0]; if (!ch) continue;
      const d = ch.delta ?? {};
      if (typeof d.content === 'string' && d.content) { if (!text) ev.onStatus(''); text += d.content; ev.onText(d.content); }
      for (const tc of d.tool_calls ?? []) {
        const i = tc.index ?? 0;
        const acc = calls.get(i) ?? { id: '', name: '', args: '' };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
        calls.set(i, acc);
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    }
    const list = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    if (!list.length || (finish && finish !== 'tool_calls' && finish !== 'function_call')) { messages.push({ role: 'assistant', content: text }); return; }
    messages.push({ role: 'assistant', content: text || null, tool_calls: list.map((v, i) => ({ id: v.id || `call_${round}_${i}`, type: 'function', function: { name: v.name, arguments: v.args || '{}' } })) });
    for (const [i, v] of list.entries()) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(v.args || '{}'); } catch { /* 参数不是合法 JSON */ }
      if (v.name === '$web_search') { ev.onTool('web_search', { query: (input as any).search_query ?? (input as any).query ?? '' }, '（Kimi 自己搜的）', false); messages.push({ role: 'tool', tool_call_id: v.id || `call_${round}_${i}`, name: '$web_search', content: v.args || '{}' }); continue; }
      ev.onToolStart(v.name, input);
      const { result, isError } = await exec(v.name, input);
      ev.onTool(v.name, input, result, isError);
      messages.push({ role: 'tool', tool_call_id: v.id || `call_${round}_${i}`, content: result });
    }
  }
  ev.onText("\n（工具调用轮数到上限，先停在这儿）");
}

async function describeBody(r: Response): Promise<string> {
  try { const j = await r.json(); const m = j.error?.message ?? j.message ?? j.error; return m ? `：${typeof m === 'string' ? m : JSON.stringify(m)}` : ''; } catch { return ''; }
}

async function* sse(r: Response, signal: AbortSignal): AsyncGenerator<string> {
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

/** 试连：一句最短的对话；OpenAI 兼容的再试一次工具调用——不会调工具的模型接上了也只能聊天 */
export async function testConnection(c: AiConfig, signal?: AbortSignal): Promise<{ reply: string; tools: boolean | null }> {
  if (c.api === 'anthropic') {
    const { default: Client } = await import('@anthropic-ai/sdk');
    const client = new Client({ apiKey: c.apiKey, baseURL: base(c.baseUrl), dangerouslyAllowBrowser: true, maxRetries: 0 });
    const m = await client.messages.create({ model: c.model, max_tokens: 32, messages: [{ role: 'user', content: "回复一个字：好" }] }, { signal });
    return { reply: m.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim(), tools: null };
  }
  const post = async (body: Record<string, unknown>) => {
    const r = await fetch(`${base(c.baseUrl)}/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) }, body: JSON.stringify({ model: c.model, ...body }) });
    if (!r.ok) throw new Error(`http ${r.status}${await describeBody(r)}`);
    return r.json();
  };
  const j = await post({ messages: [{ role: 'user', content: "回复一个字：好" }], max_tokens: 32 });
  const reply = String(j.choices?.[0]?.message?.content ?? '').trim();
  let tools: boolean | null = null;
  try {
    const t = await post({ messages: [{ role: 'user', content: '请调用 ping 工具，参数 n 填 1' }], tools: [{ type: 'function', function: { name: 'ping', description: '测试用', parameters: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } } }], max_tokens: 64 });
    tools = !!t.choices?.[0]?.message?.tool_calls?.length;
  } catch { tools = false; }
  return { reply, tools };
}

export function describeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|Load failed|Connection error/i.test(m)) return "连不上：网络不通，或服务方不允许网页直连（跨域）。本机模型要打开 CORS；不允许直连的服务可以在本机起个代理";
  if (/http 401|authentication|invalid.*api.key|Unauthorized/i.test(m)) return "密钥不对（401）";
  if (/http 403/.test(m)) return "没有权限（403）：密钥没开这个模型，或余额不足";
  if (/http 404|not_found|does not exist/i.test(m)) return `模型或地址不对（404）：${m}`;
  if (/http 429|rate.?limit/i.test(m)) return "请求太频繁或额度用完（429）";
  return m;
}
