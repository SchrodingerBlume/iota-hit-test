// Agent 面板：宽屏上是最右一整列（Word 的 Copilot 窗格那种位置），窄屏盖在右边。跟模型对话，
// 它读、改文档走 src/ai/tools.ts 那几件工具，每一步在对话里留一张卡；要改设置时弹授权卡等用户点
import { useEffect, useRef, useState } from 'react';
import { Button, Textarea, Tooltip, Popover, PopoverTrigger, PopoverSurface, Input, Spinner } from '@fluentui/react-components';
import { Settings20Regular, Dismiss20Regular, Send20Regular, Stop20Regular, Add20Regular, History20Regular, Delete16Regular, Star16Regular, Star16Filled, Rename16Regular, Checkmark16Regular, ChevronRight12Regular, ChevronDown12Regular, Attach20Regular, Dismiss12Regular, Image16Regular, DocumentPdf16Regular, DocumentText16Regular, BotSparkle20Regular, ShieldCheckmark20Regular } from '@fluentui/react-icons';
import { useAgent, type ToolCard, type ChatMeta, type ChatItem } from '../ai/state';
import { useStore } from '../model/store';
import { configReady, providerLabel } from '../ai/config';
import { PARTS } from '../ai/tools';
import { fmtSize, type Attachment } from '../ai/files';
import { AgentSettings } from './AgentSettings';
import { ChatMarkdown } from './ChatMarkdown';
import { t as tx } from '../i18n';

const QUICK = [
  tx("润色所选段落，保持原意并直接替换"),
  tx("通读正文，列出语病、错别字和表意不清之处，暂不修改"),
  tx("检查最近一次排版错误，并给出修改建议"),
  tx("根据各章内容起草总结，并插入结论开头"),
];

const fmtWhen = (ts: number) => { const d = new Date(ts); const now = new Date(); const same = d.toDateString() === now.toDateString(); return same ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getMonth() + 1}/${d.getDate()}`; };
function partLabel(key: unknown) { return PARTS.find((p) => p.key === key)?.label ?? String(key ?? ''); }
function cardTitle(c: ToolCard): string {
  const i = c.input;
  const rng = i.to !== undefined && i.to !== i.from ? `#${i.from}–${i.to}` : `#${i.from}`;
  const where = Array.isArray(i.replace) ? tx("替换 #{{a}}–{{b}}", { a: i.replace[0], b: i.replace[1] }) : i.at !== undefined ? tx("插在 #{{at}} 前", { at: i.at }) : tx("添加到末尾");
  switch (c.name) {
    case 'outline': return tx("已读取文档结构");
    case 'read': return tx("已读取{{part}} {{rng}}", { part: partLabel(i.part), rng });
    case 'replace': return tx("已修改{{part}} {{rng}}", { part: partLabel(i.part), rng });
    case 'insert': return tx("在{{part}} #{{at}} 前插入", { part: partLabel(i.part), at: i.at });
    case 'delete': return tx("已删除{{part}} {{rng}}", { part: partLabel(i.part), rng });
    case 'table_write': return tx("已插入表格：{{part}}，{{where}}", { part: partLabel(i.part), where });
    case 'figure_write': return tx("已插入图片：{{part}}，{{where}}", { part: partLabel(i.part), where });
    case 'images': return tx("已读取图片列表");
    case 'selection': return tx("已读取所选内容");
    case 'diagnostics': return tx("已读取排版诊断");
    case 'bib_list': return i.which === 'achievements' ? tx("已读取成果表") : tx("已读取参考文献表");
    case 'bib_add': return i.which === 'achievements' ? tx("已向成果表添加条目") : tx("已向参考文献表添加条目");
    case 'info_read': return tx("已读取论文信息");
    case 'info_write': return tx("已修改论文信息");
    case 'abbreviations': return tx("已读取缩略语表");
    case 'abbreviations_add': return tx("已添加缩略语或符号");
    case 'settings_list': return tx("已读取论文设置");
    case 'settings_set': return tx("已修改设置：{{key}}", { key: i.key });
    case 'schema': return tx("已读取节点结构");
    case 'read_json': return tx("已读取{{part}} {{rng}} 的 JSON", { part: partLabel(i.part), rng });
    case 'write_json': return tx("已通过 JSON 修改{{part}} {{rng}}", { part: partLabel(i.part), rng });
    case 'pdf_images': return tx("已从 {{file}} 提取图片", { file: i.file });
    case 'pdf_render': return tx("已将 {{file}} 第 {{page}} 页转换为图片", { file: i.file, page: i.page });
    case 'web_fetch': return tx("已读取网页 {{url}}", { url: String(i.url ?? '').replace(/^https?:\/\//, '').slice(0, 60) });
    case 'web_search': return tx("已搜索「{{q}}」", { q: i.query });
    case 'check_order': return tx("已核对图表顺序");
    case 'guide': return i.section ? tx("已读取指南 {{s}}", { s: i.section }) : i.query ? tx("已在指南中检索「{{q}}」", { q: i.query }) : tx("已读取指南目录");
    case 'run_python': return tx("已运行 Python");
    case 'run_js': return tx("已运行 JavaScript");
    case 'code_execution': return i.command ? tx("在服务方沙盒里运行：{{cmd}}", { cmd: String(i.command).slice(0, 60) }) : tx("已修改服务方沙盒中的文件");
    case 'bridge_run': return tx("在本机运行：{{cmd}}", { cmd: String(i.cmd ?? '').slice(0, 60) });
    case 'bridge_ls': return tx("已读取本机文件夹 {{p}}", { p: i.path ?? '/' });
    case 'bridge_read': return tx("已读取本机文件 {{p}}", { p: i.path });
    case 'bridge_write': return tx("已写入本机文件 {{p}}", { p: i.path });
    case 'memory_read': return tx("已读取记忆");
    case 'memory_write': return tx("已写入记忆");
    default: return c.name;
  }
}
/** 正在跑的工具：现在时的说法；没有的用过去时那句凑合 */
function liveTitle(name: string, input: Record<string, any>): string {
  const part = partLabel(input.part);
  const rng = input.to !== undefined && input.to !== input.from ? `#${input.from}–${input.to}` : input.from !== undefined ? `#${input.from}` : '';
  switch (name) {
    case 'outline': return tx("正在读取文档结构…");
    case 'read': case 'read_json': return tx("正在读取{{part}} {{rng}}…", { part, rng });
    case 'replace': case 'write_json': return tx("正在修改{{part}} {{rng}}…", { part, rng });
    case 'insert': return tx("正在向{{part}}插入内容…", { part });
    case 'delete': return tx("正在删除{{part}} {{rng}}…", { part, rng });
    case 'table_write': return tx("正在插入表格…");
    case 'figure_write': return tx("正在插入图片…");
    case 'run_python': return tx("正在运行 Python…");
    case 'run_js': return tx("正在运行 JavaScript…");
    case 'check_order': return tx("正在核对图表顺序…");
    case 'guide': return tx("正在检索写作指南…");
    case 'web_fetch': return tx("正在读取网页 {{url}}…", { url: String(input.url ?? '').replace(/^https?:\/\//, '').slice(0, 50) });
    case 'web_search': return tx("正在搜索「{{q}}」…", { q: input.query });
    case 'bridge_run': return tx("在本机运行：{{cmd}}", { cmd: String(input.cmd ?? '').slice(0, 60) });
    case 'bridge_ls': case 'bridge_read': case 'bridge_write': return tx("正在访问本机文件…");
    case 'pdf_images': case 'pdf_render': return tx("正在处理 PDF…");
    case 'bib_add': return tx("正在添加参考文献…");
    case 'settings_set': return tx("正在修改设置…");
    case 'diagnostics': return tx("正在读取排版诊断…");
    default: return tx("正在调用 {{name}}…", { name });
  }
}
function Live({ live, hasText }: { live: ChatItem['live']; hasText: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(t); }, []);
  const secs = live ? Math.max(0, Math.round((Date.now() - live.since) / 1000)) : 0;
  const long = secs >= 4 ? tx("（{{s}} 秒）", { s: secs }) : '';
  if (live?.tool) return <div className="ag-card is-live"><div className="ag-card-head"><Spinner size="extra-tiny" /><span>{liveTitle(live.tool.name, live.tool.input)}</span><span className="muted ag-live-secs">{long}</span></div>{live.status && <div className="ag-live-status muted">{live.status}</div>}</div>;
  if (live?.status) return <div className="ag-thinking muted"><Spinner size="extra-tiny" />{live.status}{long}</div>;
  if (!hasText) return <div className="ag-thinking muted"><Spinner size="extra-tiny" />{tx("正在生成回复…")}{long}</div>;
  return null;
}
const EDIT_TOOLS = new Set(['replace', 'insert', 'delete', 'table_write', 'figure_write', 'bib_add', 'info_write', 'abbreviations_add', 'settings_set', 'write_json']);

function ChatList({ chats, current, onOpen, onDelete, onRename, onStar, onNew }: { chats: ChatMeta[]; current: string | null; onOpen: (id: string) => void; onDelete: (id: string) => void; onRename: (id: string, title: string) => void; onStar: (id: string, on: boolean) => void; onNew: () => void }) {
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const commit = () => { if (editing) onRename(editing.id, editing.title); setEditing(null); };
  return (
    <div className="ag-chatlist" role="list">
      {chats.map((c) => (
        <div key={c.id} role="listitem" className={`ag-chatrow ${c.id === current ? 'is-current' : ''} ${c.starred ? 'is-starred' : ''}`}>
          <button type="button" className={`ag-chat-star ${c.starred ? 'on' : ''}`} aria-label={c.starred ? tx("取消星标") : tx("加星标")} title={c.starred ? tx("取消星标") : tx("加星标")} onClick={() => onStar(c.id, !c.starred)}>{c.starred ? <Star16Filled /> : <Star16Regular />}</button>
          {editing?.id === c.id
            ? <Input size="small" className="ag-chat-edit" autoFocus value={editing.title} onChange={(_, d) => setEditing({ id: c.id, title: d.value })} onBlur={commit} onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }} contentAfter={<Checkmark16Regular onMouseDown={(e) => e.preventDefault()} onClick={commit} />} />
            : <button type="button" className="ag-chat-title" title={c.title} onClick={() => onOpen(c.id)} onDoubleClick={() => setEditing({ id: c.id, title: c.title })}>{c.title}</button>}
          <span className="ag-chat-side">
            <span className="muted">{fmtWhen(c.updatedAt)}</span>
            <button type="button" className="ag-chat-x" aria-label={tx("重命名")} title={tx("重命名（双击标题也行）")} onClick={() => setEditing({ id: c.id, title: c.title })}><Rename16Regular /></button>
            <button type="button" className="ag-chat-x is-danger" aria-label={tx("删除这场对话")} title={tx("删除这场对话")} onClick={() => onDelete(c.id)}><Delete16Regular /></button>
          </span>
        </div>
      ))}
      <button type="button" className="ag-chatrow ag-chat-new" onClick={onNew}><Add20Regular />{tx("新对话")}</button>
    </div>
  );
}

function FileChip({ f, onRemove }: { f: Attachment; onRemove?: () => void }) {
  const Icon = f.kind === 'image' ? Image16Regular : f.kind === 'pdf' ? DocumentPdf16Regular : DocumentText16Regular;
  return (
    <span className="ag-file" title={`${f.name} · ${fmtSize(f.size)}`}>
      {f.kind === 'image' ? <img src={`data:${f.type};base64,${f.data}`} alt="" /> : <Icon />}
      <span className="ag-file-name">{f.name}</span>
      {onRemove && <button type="button" className="ag-file-x" aria-label={tx("移除")} onClick={onRemove}><Dismiss12Regular /></button>}
    </span>
  );
}

function Card({ c }: { c: ToolCard }) {
  const [open, setOpen] = useState(false);
  const detail = c.name === 'replace' || c.name === 'insert' ? `${String(c.input.markdown ?? '')}\n\n— ${c.result}`
    : c.name === 'table_write' ? `${(c.input.rows as string[][] | undefined)?.map((r) => r.join(' | ')).join('\n') ?? ''}\n\n— ${c.result}`
    : c.name === 'bib_add' ? `${String(c.input.bibtex ?? '')}\n\n— ${c.result}`
    : c.name === 'write_json' ? `${JSON.stringify(c.input.nodes, null, 1)}\n\n— ${c.result}` : c.result;
  return (
    <div className={`ag-card ${c.isError ? 'is-error' : EDIT_TOOLS.has(c.name) ? 'is-edit' : ''}`}>
      <button type="button" className="ag-card-head" onClick={() => setOpen(!open)}>{open ? <ChevronDown12Regular /> : <ChevronRight12Regular />}<span>{cardTitle(c)}</span></button>
      {!!c.images?.length && <div className="ag-card-imgs">{c.images.map((im) => <img key={im.id} src={`data:${im.type};base64,${im.data}`} alt={im.name} title={im.name} />)}</div>}
      {open && <pre className="ag-card-body">{detail}</pre>}
    </div>
  );
}

export function AgentPane({ overlay }: { overlay?: boolean }) {
  const { items, running, send, stop, config, setOpen, setSettingsOpen, pending, attach, detach, ask, answer, chats, chatId, newChat, openChat, deleteChat, renameChat, starChat, settings, docProviderId } = useAgent();
  const [chatsOpen, setChatsOpen] = useState(false);
  const provider = settings?.providers.find((p) => p.id === (docProviderId ?? settings.globalId)) ?? settings?.providers[0];
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ready = configReady(config);
  const docId = useStore((s) => s.doc.id);
  useEffect(() => { void useAgent.getState().bind(); }, [docId]);
  // 贴底才跟着滚：用户往上翻着看的时候，模型一边输出一边把列表拽到底是骚扰；自己发一句、换一场对话就回到底
  const stick = useRef(true);
  useEffect(() => { const el = listRef.current; if (!el) return; const onScroll = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }; el.addEventListener('scroll', onScroll, { passive: true }); return () => el.removeEventListener('scroll', onScroll); }, []);
  useEffect(() => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items, ask]);
  useEffect(() => { stick.current = true; const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chatId]);
  useEffect(() => { if (settings === undefined) useAgent.getState().setOpen(true); }, [settings]);
  const submit = () => { const t = draft.trim(); if ((!t && !pending.length) || running || !ready) return; setDraft(''); stick.current = true; void send(t); };
  const onFiles = (list: FileList | File[] | null | undefined) => { if (list?.length && ready) void attach(Array.from(list)); };
  const last = items[items.length - 1];
  return (
    <aside className={`agent-pane ${overlay ? 'is-overlay' : ''} ${drag ? 'is-drop' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }} onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}>
      <div className="ag-head">
        <BotSparkle20Regular className="ag-logo" />
        <b>Agent</b>
        <button type="button" className="ag-model" title={config ? `${config.baseUrl}${docProviderId ? tx("（本文档指定）") : ''}` : ''} onClick={() => setSettingsOpen(true)}>{ready && provider ? providerLabel(provider) : tx("未配置模型")}</button>
        <span className="spacer" />
        <Tooltip content={tx("新对话")} relationship="label"><Button size="small" appearance="subtle" icon={<Add20Regular />} disabled={!items.length && !chatId} onClick={() => void newChat()} /></Tooltip>
        <Popover positioning="below-end" open={chatsOpen} onOpenChange={(_, d) => setChatsOpen(d.open)}>
          <PopoverTrigger disableButtonEnhancement>
            <Tooltip content={tx("当前文档的对话记录")} relationship="label"><Button size="small" appearance="subtle" icon={<History20Regular />} disabled={!chats.length} /></Tooltip>
          </PopoverTrigger>
          <PopoverSurface className="ag-chats">
            <ChatList chats={chats} current={chatId} onOpen={(id) => { setChatsOpen(false); void openChat(id); }} onDelete={(id) => void deleteChat(id)} onRename={(id, t) => void renameChat(id, t)} onStar={(id, on) => void starChat(id, on)} onNew={() => { setChatsOpen(false); void newChat(); }} />
          </PopoverSurface>
        </Popover>
        <Tooltip content={tx("Agent 设置")} relationship="label"><Button size="small" appearance="subtle" icon={<Settings20Regular />} onClick={() => setSettingsOpen(true)} /></Tooltip>
        <Tooltip content={tx("关闭")} relationship="label"><Button size="small" appearance="subtle" icon={<Dismiss20Regular />} onClick={() => setOpen(false)} /></Tooltip>
      </div>
      <div className="ag-list" ref={listRef}>
        {!ready && settings !== undefined && (
          <div className="ag-empty">
            <p>{tx("配置 Anthropic、OpenAI、DeepSeek、Kimi、通义、智谱、OpenRouter，或本机的 Ollama / LM Studio。请求直达服务方，密钥仅保存在当前浏览器中。")}</p>
            <Button appearance="primary" size="small" onClick={() => setSettingsOpen(true)}>{tx("配置模型")}</Button>
          </div>
        )}
        {ready && !items.length && (
          <div className="ag-empty">
            <p className="muted">{tx("Agent 可读取和修改论文、插入表格与图片、管理参考文献，并检查排版错误。修改设置前会征求允许，文档改动可撤消。")}</p>
            {QUICK.map((q) => <button key={q} type="button" className="ag-quick" onClick={() => { stick.current = true; void send(q); }}>{q}</button>)}
          </div>
        )}
        {items.map((it) => (
          <div key={it.id} className={`ag-msg is-${it.role}`}>
            {it.tools.map((c, i) => <Card key={i} c={c} />)}
            {!!it.files?.length && <div className="ag-files">{it.files.map((f) => <FileChip key={f.id} f={f} />)}</div>}
            {it.text && (it.role === 'user' ? <div className="ag-text">{it.text}</div> : <div className="ag-text"><ChatMarkdown text={it.text} /></div>)}
            {it.error && <div className="ag-error">{it.error}</div>}
            {it.role === 'assistant' && running && it.id === last?.id && !ask && <Live live={it.live} hasText={!!it.text} />}
          </div>
        ))}
        {ask && (
          <div className="ag-ask">
            <div className="ag-ask-head"><ShieldCheckmark20Regular />{ask.ask.head ?? tx("Agent 请求修改设置")}</div>
            <b>{ask.ask.title}</b>
            {ask.ask.lines.map((l, i) => <p key={i} className="muted">{l}</p>)}
            {ask.ask.reason && <p>{tx("修改理由：")}{ask.ask.reason}</p>}
            <div className="ag-ask-btns">
              <Button size="small" appearance="primary" onClick={() => answer(true)}>{tx("允许")}</Button>
              <Button size="small" onClick={() => answer(false)}>{tx("拒绝")}</Button>
            </div>
          </div>
        )}
      </div>
      {!!pending.length && <div className="ag-files ag-pending">{pending.map((f) => <FileChip key={f.id} f={f} onRemove={() => detach(f.id)} />)}</div>}
      <div className="ag-input">
        <Tooltip content={tx("附件：图片、PDF、文本文件；也可以拖进来或粘贴")} relationship="label"><Button size="small" appearance="subtle" icon={<Attach20Regular />} disabled={!ready || running} onClick={() => fileInput.current?.click()} /></Tooltip>
        <input ref={fileInput} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.txt,.md,.bib,.csv,.json,.tex,.typ" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
        <Textarea resize="vertical" value={draft} placeholder={ready ? tx("输入任务；Enter 发送，Shift+Enter 换行") : tx("请先在设置中配置模型")} disabled={!ready} onChange={(_, d) => setDraft(d.value)} onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); onFiles(fs); } }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        {running
          ? <Tooltip content={tx("停止")} relationship="label"><Button appearance="secondary" icon={<Stop20Regular />} onClick={stop} /></Tooltip>
          : <Tooltip content={tx("发送")} relationship="label"><Button appearance="primary" icon={<Send20Regular />} disabled={!ready || (!draft.trim() && !pending.length)} onClick={submit} /></Tooltip>}
      </div>
      <AgentSettings />
    </aside>
  );
}
