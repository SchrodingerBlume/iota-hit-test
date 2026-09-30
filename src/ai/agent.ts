// 跟模型来回：发对话与工具表，流式收字；模型要调工具就在本地跑、把结果回给它，直到它不再调。
// 两种接口各一个驱动，对话记录按接口各自的原样存（一个会话只用一家）
import type Anthropic from '@anthropic-ai/sdk';
import { webOf, webNativeOf, type AiConfig } from './config';
import { runTool, toolsFor, setWebConfig, serverSandboxOn, collectBytes, setReporter, flushChecks, dropChecks, askUser, type ToolDef } from './tools';
import { pdfText, type Attachment } from './files';

export interface AgentEvents {
  onText: (delta: string) => void;
  /** 模型的思考流（DeepSeek 的 reasoning_content、Anthropic 的 thinking；不是每家都有） */
  onReasoning: (delta: string) => void;
  onTool: (name: string, input: Record<string, unknown>, result: string, isError: boolean) => void;
  /** 工具开始跑了（结果还没回来）：面板先立一张转圈的卡 */
  onToolStart: (name: string, input: Record<string, unknown>) => void;
  /** 眼下在等什么（等模型回复、工具里的分步进度）；空串清掉 */
  onStatus: (text: string) => void;
  /** 这一轮用掉多少 token（服务方在流里/结果里给了才有：Anthropic 每次都有，OpenAI 兼容看各家） */
  onUsage?: (u: { input: number; output: number }) => void;
}
/** 一次会话的原始记录：两家接口的消息形状不同，装在各自的数组里 */
export type Transcript = { api: 'anthropic'; messages: Anthropic.MessageParam[] } | { api: 'openai'; messages: any[] };

// 工具轮数不设死上限：每 30 轮弹一张卡问用户还接不接着，拒绝就停；300 轮是防死循环的兜底
const ASK_EVERY = 30;
const HARD_MAX = 300;
async function mayContinue(round: number): Promise<boolean> {
  if (round >= HARD_MAX) return false;
  if (round === 0 || round % ASK_EVERY) return true;
  return askUser({ head: '工具已经连续调用了不少轮', title: `第 ${round} 轮了，还让它接着做？`, lines: ['「允许」接着做，「拒绝」就停在这儿（做到一半的改动都在撤消里）。'] });
}
/** 一轮说完了：先前写入挂着的排版检查全收上来，有报错就作为新的一句发回去让它改（一次对话最多补两回） */
async function pendingFix(fixes: number): Promise<string | null> {
  if (fixes >= 2) { dropChecks(); return null; }
  const diag = await flushChecks(true);
  return diag || null;
}
const base = (u: string) => u.trim().replace(/\/+$/, '');

// ── 429 / 网络抖动的自动重试：只在「还没收到任何流内容」时重发，不会出现半截输出 ─────────────
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const onAbort = () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); };
  const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal.addEventListener('abort', onAbort, { once: true });
});
/** Retry-After 优先（单位是秒）；没有就 2、4、8… 秒，最多 30 秒 */
function retryWait(r: Response | null, attempt: number): number {
  const h = Number(r?.headers.get('retry-after'));
  if (Number.isFinite(h) && h > 0) return Math.min(60, Math.ceil(h)) * 1000;
  return Math.min(30, 2 * 2 ** attempt) * 1000;
}
/** 刚被限流过的服务方，下一轮开工前先歇一小会儿，别连着撞 */
let coolUntil = 0;
async function chatFetch(c: AiConfig, body: Record<string, unknown>, ev: AgentEvents, signal: AbortSignal): Promise<Response> {
  const url = `${base(c.baseUrl)}/chat/completions`;
  const init: RequestInit = { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) }, body: JSON.stringify(body) };
  while (coolUntil > Date.now()) await sleep(Math.min(2000, coolUntil - Date.now()), signal);
  for (let attempt = 0; ; attempt++) {
    let r: Response | null = null;
    let netErr: unknown = null;
    try { r = await fetch(url, init); } catch (e) { netErr = e; }
    if (r?.ok) return r;
    if (netErr) {
      if (signal.aborted || attempt >= 3) throw netErr;
      const wait = retryWait(null, attempt);
      ev.onStatus(`连不上服务方（网络或跨域），${Math.round(wait / 1000)} 秒后自动重试（第 ${attempt + 1} 次）…`);
      await sleep(wait, signal);
      continue;
    }
    const retriable = r!.status === 429 || r!.status >= 500;
    if (!retriable || attempt >= 3) throw new Error(`http ${r!.status}${await describeBody(r!)}`);
    const wait = retryWait(r, attempt);
    coolUntil = Date.now() + 1500;
    ev.onStatus(r!.status === 429 ? `服务方说「请求过于频繁 / 额度不足」，${Math.round(wait / 1000)} 秒后自动重试（第 ${attempt + 1} 次）…` : `服务方返回 http ${r!.status}，${Math.round(wait / 1000)} 秒后自动重试（第 ${attempt + 1} 次）…`);
    await sleep(wait, signal);
  }
}

/** 图片块上没有文件名，模型看见图却不知道叫什么，插图时就瞎猜：附件清单接在这句话后面 */
const KIND: Record<Attachment['kind'], string> = { image: '图片', pdf: 'PDF', text: '文本' };
const withFileNames = (text: string, files: Attachment[]) => (files.length ? `${text}\n\n（本条消息的附件：${files.map((f) => `${f.name}〔${KIND[f.kind]}〕`).join('、')}。插图时 figure_write 的 image 就填这里的文件名）` : text);
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
  const client = new Client({ apiKey: c.apiKey, baseURL: base(c.baseUrl), dangerouslyAllowBrowser: true, maxRetries: 2 });
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
  messages.push({ role: 'user', content: parts.length ? [...parts, { type: 'text', text: withFileNames(userText, files) }] : userText });
  setReporter(ev.onStatus);
  let fixes = 0;
  for (let round = 0; ; round++) {
    if (!(await mayContinue(round))) { ev.onText(round >= HARD_MAX ? '\n（工具调用轮数太多，先停在这儿）' : '\n（按你的要求停在这儿）'); return; }
    ev.onStatus(round ? '工具结果发回去了，等模型接着说…' : '等模型回复…');
    const stream = client.messages.stream({
      model: c.model, max_tokens: 16000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools, messages,
    }, { signal });
    let first = true;
    stream.on('text', (delta) => { if (first) { first = false; ev.onStatus(''); } ev.onText(delta); });
    // 带思考的模型（扩展思考）会先流一段 thinking；没有的就永远不触发
    let think = false;
    (stream as any).on('thinking', (delta: string) => { if (!think) { think = true; ev.onStatus(''); } ev.onReasoning(delta); });
    const msg = await stream.finalMessage();
    const u = msg.usage;
    if (u) ev.onUsage?.({ input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0 });
    ev.onStatus('');
    messages.push({ role: 'assistant', content: msg.content });
    await reportServerTools(client, msg.content, ev);
    if (msg.stop_reason === 'refusal') { ev.onText("\n（模型拒绝了这次请求）"); return; }
    if (msg.stop_reason !== 'tool_use') {
      const diag = await pendingFix(fixes);
      if (!diag) return;
      fixes++;
      ev.onTool('diagnostics', {}, diag, true);
      ev.onText('\n');
      messages.push({ role: 'user', content: `${diag}\n\n（这是排版结果，不是我说的话——请直接修正，改完简短说一句）` });
      continue;
    }
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
  messages.push({ role: 'user', content: parts.length ? [...parts, { type: 'text', text: withFileNames(userText, files) }] : userText });
  setReporter(ev.onStatus);
  let fixes = 0;
  for (let round = 0; ; round++) {
    if (!(await mayContinue(round))) { ev.onText(round >= HARD_MAX ? '\n（工具调用轮数太多，先停在这儿）' : '\n（按你的要求停在这儿）'); return; }
    ev.onStatus(round ? '工具结果发回去了，等模型接着说…' : '等模型回复…');
    const r = await chatFetch(c, { model: c.model, messages, tools, stream: true, ...extra }, ev, signal);
    let text = '';
    let thinking = false;
    const calls = new Map<number, ToolCallAcc>();
    let finish = '';
    for await (const data of sse(r, signal)) {
      if (data === '[DONE]') break;
      let j: any; try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
      // 有些家会在最后一个 chunk 里带 usage（不带 choice）
      if (j.usage) { const ti = Number(j.usage.prompt_tokens ?? j.usage.input_tokens ?? 0); const to = Number(j.usage.completion_tokens ?? j.usage.output_tokens ?? 0); if (ti || to) ev.onUsage?.({ input: ti, output: to }); }
      const ch = j.choices?.[0]; if (!ch) continue;
      const d = ch.delta ?? {};
      if (typeof d.content === 'string' && d.content) { if (!text) ev.onStatus(''); text += d.content; ev.onText(d.content); }
      const rc = typeof d.reasoning_content === 'string' ? d.reasoning_content : typeof d.reasoning === 'string' ? d.reasoning : '';
      if (rc) { if (!thinking) { thinking = true; ev.onStatus(''); } ev.onReasoning(rc); }
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
    if (!list.length || (finish && finish !== 'tool_calls' && finish !== 'function_call')) {
      messages.push({ role: 'assistant', content: text });
      const diag = await pendingFix(fixes);
      if (!diag) return;
      fixes++;
      ev.onTool('diagnostics', {}, diag, true);
      ev.onText('\n');
      messages.push({ role: 'user', content: `${diag}\n\n（这是排版结果，不是我说的话——请直接修正，改完简短说一句）` });
      continue;
    }
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

/** 把一段对话文字压成交接摘要（压缩历史用）：不吃工具表、纯文本进纯文本出 */
export async function summarize(c: AiConfig, text: string, signal?: AbortSignal): Promise<string> {
  const ask = `下面是一段写作助手与用户的对话记录（含工具调用与结果）。把它压缩成一份交接说明，供同一个助手接着这份工作：保留用户的原始要求、已经改过什么（部分、段号、改了什么）、用户明确的偏好与禁区、未完成的事项和下一步；具体段号、标签、数字、命令不要丢。用中文条目式，尽量不超过 800 字。\n\n${text}`;
  if (c.api === 'anthropic') {
    const { default: Client } = await import('@anthropic-ai/sdk');
    const client = new Client({ apiKey: c.apiKey, baseURL: base(c.baseUrl), dangerouslyAllowBrowser: true, maxRetries: 0 });
    const m = await client.messages.create({ model: c.model, max_tokens: 2000, messages: [{ role: 'user', content: ask }] }, { signal });
    return m.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  }
  const r = await fetch(`${base(c.baseUrl)}/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) }, body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: ask }] }) });
  if (!r.ok) throw new Error(`http ${r.status}${await describeBody(r)}`);
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content ?? '').trim();
}

export function describeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|Load failed|Connection error/i.test(m)) return "连不上：网络不通，或服务方不允许网页直连（跨域）。本机模型要打开 CORS；不允许直连的服务可以在本机起个代理";
  if (/http 401|authentication|invalid.*api.key|Unauthorized/i.test(m)) return "密钥不对（401）";
  if (/http 403/.test(m)) return "没有权限（403）：密钥没开这个模型，或余额不足";
  if (/http 404|not_found|does not exist/i.test(m)) return `模型或地址不对（404）：${m}`;
  if (/http 429|rate.?limit/i.test(m)) return "请求太频繁或额度用完（429）：自动重试了几次还是被拒——等一两分钟再发，或在 Agent 设置里换个接口（Kimi 这类按分钟限流的服务，连续工具调用很容易触发）";
  return m;
}
