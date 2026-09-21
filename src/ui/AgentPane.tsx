// Agent 面板：宽屏上是最右一整列（Word 的 Copilot 窗格那种位置），窄屏盖在右边。跟模型对话，
// 它读、改文档走 src/ai/tools.ts 那几件工具，每一步在对话里留一张卡；要改设置时弹授权卡等用户点
import { useEffect, useRef, useState } from 'react';
import { Button, Textarea, Tooltip, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, MenuDivider } from '@fluentui/react-components';
import { Settings20Regular, Dismiss20Regular, Send20Regular, Stop20Regular, Add20Regular, History20Regular, Delete16Regular, ChevronRight12Regular, ChevronDown12Regular, Attach20Regular, Dismiss12Regular, Image16Regular, DocumentPdf16Regular, DocumentText16Regular, BotSparkle20Regular, ShieldCheckmark20Regular } from '@fluentui/react-icons';
import { useAgent, type ToolCard } from '../ai/state';
import { useStore } from '../model/store';
import { configReady, providerLabel } from '../ai/config';
import { PARTS } from '../ai/tools';
import { fmtSize, type Attachment } from '../ai/files';
import { AgentSettings } from './AgentSettings';
import { ChatMarkdown } from './ChatMarkdown';
import { t as tx } from '../i18n';

const QUICK = [
  tx("润色我选中的这段，保持原意，改完直接替换"),
  tx("通读正文，指出语病、错别字和表述不清的地方，先列出来别改"),
  tx("看看最近一次编译的错误，告诉我怎么改"),
  tx("按现有各章内容，给结论写一段总结的草稿，加在结论的开头"),
];

const fmtWhen = (ts: number) => { const d = new Date(ts); const now = new Date(); const same = d.toDateString() === now.toDateString(); return same ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getMonth() + 1}/${d.getDate()}`; };
function partLabel(key: unknown) { return PARTS.find((p) => p.key === key)?.label ?? String(key ?? ''); }
function cardTitle(c: ToolCard): string {
  const i = c.input;
  const rng = i.to !== undefined && i.to !== i.from ? `#${i.from}–${i.to}` : `#${i.from}`;
  const where = Array.isArray(i.replace) ? tx("换掉 #{{a}}–{{b}}", { a: i.replace[0], b: i.replace[1] }) : i.at !== undefined ? tx("插在 #{{at}} 前", { at: i.at }) : tx("接在末尾");
  switch (c.name) {
    case 'outline': return tx("看了结构");
    case 'read': return tx("读了{{part}} {{rng}}", { part: partLabel(i.part), rng });
    case 'replace': return tx("改了{{part}} {{rng}}", { part: partLabel(i.part), rng });
    case 'insert': return tx("在{{part}} #{{at}} 前插入", { part: partLabel(i.part), at: i.at });
    case 'delete': return tx("删了{{part}} {{rng}}", { part: partLabel(i.part), rng });
    case 'table_write': return tx("写了一张表：{{part}}，{{where}}", { part: partLabel(i.part), where });
    case 'figure_write': return tx("插了一张图：{{part}}，{{where}}", { part: partLabel(i.part), where });
    case 'images': return tx("看了有哪些图片");
    case 'selection': return tx("看了选中的内容");
    case 'diagnostics': return tx("看了编译诊断");
    case 'bib_list': return i.which === 'achievements' ? tx("看了成果表") : tx("看了参考文献表");
    case 'bib_add': return i.which === 'achievements' ? tx("往成果表加了条目") : tx("往参考文献表加了条目");
    case 'info_read': return tx("看了论文信息");
    case 'info_write': return tx("改了论文信息");
    case 'abbreviations': return tx("看了缩略语表");
    case 'abbreviations_add': return tx("加了缩略语 / 符号");
    case 'settings_list': return tx("看了论文设置");
    case 'settings_set': return tx("改设置：{{key}}", { key: i.key });
    case 'schema': return tx("看了节点结构");
    case 'read_json': return tx("读了{{part}} {{rng}} 的 JSON", { part: partLabel(i.part), rng });
    case 'write_json': return tx("按 JSON 改了{{part}} {{rng}}", { part: partLabel(i.part), rng });
    case 'pdf_images': return tx("从 {{file}} 抽了图", { file: i.file });
    case 'pdf_render': return tx("把 {{file}} 第 {{page}} 页画成了图", { file: i.file, page: i.page });
    case 'web_fetch': return tx("抓了网页 {{url}}", { url: String(i.url ?? '').replace(/^https?:\/\//, '').slice(0, 60) });
    case 'web_search': return tx("搜了「{{q}}」", { q: i.query });
    default: return c.name;
  }
}
const EDIT_TOOLS = new Set(['replace', 'insert', 'delete', 'table_write', 'figure_write', 'bib_add', 'info_write', 'abbreviations_add', 'settings_set', 'write_json']);

function FileChip({ f, onRemove }: { f: Attachment; onRemove?: () => void }) {
  const Icon = f.kind === 'image' ? Image16Regular : f.kind === 'pdf' ? DocumentPdf16Regular : DocumentText16Regular;
  return (
    <span className="ag-file" title={`${f.name} · ${fmtSize(f.size)}`}>
      {f.kind === 'image' ? <img src={`data:${f.type};base64,${f.data}`} alt="" /> : <Icon />}
      <span className="ag-file-name">{f.name}</span>
      {onRemove && <button type="button" className="ag-file-x" aria-label={tx("去掉")} onClick={onRemove}><Dismiss12Regular /></button>}
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
  const { items, running, send, stop, config, setOpen, setSettingsOpen, pending, attach, detach, ask, answer, chats, chatId, newChat, openChat, deleteChat, settings, docProviderId } = useAgent();
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
        <button type="button" className="ag-model" title={config ? `${config.baseUrl}${docProviderId ? tx("（本文档指定）") : ''}` : ''} onClick={() => setSettingsOpen(true)}>{ready && provider ? providerLabel(provider) : tx("还没接模型")}</button>
        <span className="spacer" />
        <Tooltip content={tx("新对话")} relationship="label"><Button size="small" appearance="subtle" icon={<Add20Regular />} disabled={!items.length && !chatId} onClick={() => void newChat()} /></Tooltip>
        <Menu positioning="below-end">
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content={tx("这个文档的对话记录")} relationship="label"><Button size="small" appearance="subtle" icon={<History20Regular />} disabled={!chats.length} /></Tooltip>
          </MenuTrigger>
          <MenuPopover className="ag-chats">
            <MenuList>
              {chats.map((c) => (
                <MenuItem key={c.id} className={c.id === chatId ? 'is-current' : ''} onClick={() => void openChat(c.id)} secondaryContent={<span className="ag-chat-side"><span className="muted">{fmtWhen(c.updatedAt)}</span><button type="button" className="ag-chat-x" aria-label={tx("删除这场对话")} onClick={(e) => { e.stopPropagation(); void deleteChat(c.id); }}><Delete16Regular /></button></span>}>{c.title}</MenuItem>
              ))}
              <MenuDivider />
              <MenuItem icon={<Add20Regular />} onClick={() => void newChat()}>{tx("新对话")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Tooltip content={tx("Agent 设置")} relationship="label"><Button size="small" appearance="subtle" icon={<Settings20Regular />} onClick={() => setSettingsOpen(true)} /></Tooltip>
        <Tooltip content={tx("关闭")} relationship="label"><Button size="small" appearance="subtle" icon={<Dismiss20Regular />} onClick={() => setOpen(false)} /></Tooltip>
      </div>
      <div className="ag-list" ref={listRef}>
        {!ready && settings !== undefined && (
          <div className="ag-empty">
            <p>{tx("接你自己的模型：Anthropic、OpenAI、DeepSeek、Kimi、通义、智谱、OpenRouter，或本机的 Ollama / LM Studio。密钥只存在这台浏览器里，直连服务方。")}</p>
            <Button appearance="primary" size="small" onClick={() => setSettingsOpen(true)}>{tx("去接模型")}</Button>
          </div>
        )}
        {ready && !items.length && (
          <div className="ag-empty">
            <p className="muted">{tx("它能读整篇、按段改、写表插图、加参考文献和缩略语、改论文信息，看编译错误；改设置会先问你。改动都能在撤消里回退。")}</p>
            {QUICK.map((q) => <button key={q} type="button" className="ag-quick" onClick={() => { stick.current = true; void send(q); }}>{q}</button>)}
          </div>
        )}
        {items.map((it) => (
          <div key={it.id} className={`ag-msg is-${it.role}`}>
            {it.tools.map((c, i) => <Card key={i} c={c} />)}
            {!!it.files?.length && <div className="ag-files">{it.files.map((f) => <FileChip key={f.id} f={f} />)}</div>}
            {it.text && (it.role === 'user' ? <div className="ag-text">{it.text}</div> : <div className="ag-text"><ChatMarkdown text={it.text} /></div>)}
            {it.error && <div className="ag-error">{it.error}</div>}
            {it.role === 'assistant' && running && it.id === last?.id && !it.text && !it.tools.length && !ask && <div className="ag-thinking muted">{tx("正在想…")}</div>}
          </div>
        ))}
        {ask && (
          <div className="ag-ask">
            <div className="ag-ask-head"><ShieldCheckmark20Regular />{tx("要改一项设置，需要你允许")}</div>
            <b>{ask.ask.title}</b>
            {ask.ask.lines.map((l, i) => <p key={i} className="muted">{l}</p>)}
            {ask.ask.reason && <p>{tx("它的理由：")}{ask.ask.reason}</p>}
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
        <Textarea resize="vertical" value={draft} placeholder={ready ? tx("要它做什么？Enter 发送，Shift+Enter 换行") : tx("先在设置里接一个模型")} disabled={!ready} onChange={(_, d) => setDraft(d.value)} onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); onFiles(fs); } }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        {running
          ? <Tooltip content={tx("停止")} relationship="label"><Button appearance="secondary" icon={<Stop20Regular />} onClick={stop} /></Tooltip>
          : <Tooltip content={tx("发送")} relationship="label"><Button appearance="primary" icon={<Send20Regular />} disabled={!ready || (!draft.trim() && !pending.length)} onClick={submit} /></Tooltip>}
      </div>
      <AgentSettings />
    </aside>
  );
}
