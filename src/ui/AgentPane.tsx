// Agent 面板：宽屏上是最右一整列（Word 的 Copilot 窗格那种位置），窄屏盖在右边。跟模型对话，
// 它读、改文档走 src/ai/tools.ts 那几件工具，每一步在对话里留一张卡；要改设置时弹授权卡等用户点
import { useEffect, useRef, useState } from 'react';
import { Button, Textarea, Tooltip, Popover, PopoverTrigger, PopoverSurface, Input, Spinner } from '@fluentui/react-components';
import { Settings20Regular, Dismiss20Regular, Send20Regular, Stop20Regular, Add20Regular, History20Regular, Delete16Regular, WindowMultiple20Regular, PanelRightContract20Regular, Star16Regular, Star16Filled, Rename16Regular, Checkmark16Regular, ChevronRight12Regular, ChevronDown12Regular, Attach20Regular, Dismiss12Regular, Image16Regular, DocumentPdf16Regular, DocumentText16Regular, BotSparkle20Regular, ShieldCheckmark20Regular, BrainCircuit20Regular, ChevronDoubleDown16Regular, Circle16Regular, CheckmarkCircle16Filled, CircleHalfFill16Regular, DismissCircle16Regular, Copy16Regular, ArrowClockwise16Regular, ArrowDownload16Regular, Edit16Regular, Broom16Regular } from '@fluentui/react-icons';
import { useAgent, type ToolCard, type ChatMeta, type ChatItem } from '../ai/state';
import { useStore, type RichKey } from '../model/store';
import { configReady, providerLabel } from '../ai/config';
import { PARTS } from '../ai/tools';
import { modelInfoOf, costOf, fmtCost, contextTokensOf } from '../ai/pricing';
import { getEditor, onRegistryChange } from '../editor/registry';
import { locateInEditor } from './editorLocate';
import { fmtSize, type Attachment } from '../ai/files';
import { AgentSettings } from './AgentSettings';
import { ChatMarkdown } from './ChatMarkdown';
import { t as tx } from '../i18n';
import { useAgentWindow } from './agentWindow';
import { useMedia, COMPACT } from './useMedia';

const QUICK = [
  tx("润色所选段落，保持原意并直接替换"),
  tx("通读正文，列出语病、错别字和表意不清之处，暂不修改"),
  tx("检查最近一次排版错误，并给出修改建议"),
  tx("根据各章内容起草总结，并插入结论开头"),
];

/** 输入框里打 / 出的命令：几个常用任务是直接发的提示语，压缩 / 导出是面板上的动作 */
const COMMANDS: { cmd: string; desc: string; text?: string; action?: 'compact' | 'export' }[] = [
  { cmd: '/润色', desc: tx("润色所选段落，保持原意并直接替换"), text: tx("润色所选段落，保持原意并直接替换") },
  { cmd: '/校对', desc: tx("通读正文，列出语病、错别字和表意不清之处，暂不修改"), text: tx("通读正文，列出语病、错别字和表意不清之处，暂不修改") },
  { cmd: '/排版', desc: tx("检查最近一次排版错误，并给出修改建议"), text: tx("检查最近一次排版错误，并给出修改建议") },
  { cmd: '/摘要', desc: tx("根据各章内容起草总结，并插入结论开头"), text: tx("根据各章内容起草总结，并插入结论开头") },
  { cmd: '/缩写', desc: tx("把正文里的缩略语和缩略语表对一遍"), text: tx("检查正文里的缩略语，和缩略语表对一遍，缺的登记上") },
  { cmd: '/压缩', desc: tx("压缩历史对话（保留摘要）"), action: 'compact' },
  { cmd: '/导出', desc: tx("导出这场对话（Markdown）"), action: 'export' },
];

/** 卡片上那笔改动是哪一部分的第几块（给「定位」用） */
function locOf(c: ToolCard): { part: RichKey; from: number; to: number } | null {
  const i = c.input as any;
  if (typeof i?.part !== 'string') return null;
  if (typeof i.from === 'number') return { part: i.part, from: i.from, to: typeof i.to === 'number' ? i.to : i.from };
  if (typeof i.at === 'number') return { part: i.part, from: i.at, to: i.at - 1 };
  if (Array.isArray(i.replace) && i.replace.length === 2) return { part: i.part, from: Number(i.replace[0]), to: Number(i.replace[1]) };
  return null;
}

const fmtWhen = (ts: number) => { const d = new Date(ts); const now = new Date(); const same = d.toDateString() === now.toDateString(); return same ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getMonth() + 1}/${d.getDate()}`; };
/** 工具跑完花了多久：不到 1 秒报毫秒，后面一位小数、整分 */
const fmtDur = (ms: number): string => ms < 950 ? tx("{{n}} 毫秒", { n: Math.max(1, Math.round(ms)) }) : ms < 60000 ? tx("{{n}} 秒", { n: Math.round(ms / 100) / 10 }) : tx("{{m}} 分 {{s}} 秒", { m: Math.floor(ms / 60000), s: Math.round((ms % 60000) / 1000) });
/** token 数：上 k 就报一位小数 */
const fmtTok = (n: number): string => n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
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
    case 'todo': { const t: any[] = Array.isArray(i.todos) ? (i.todos as any[]) : []; const done = t.filter((x) => x?.status === 'completed').length; return t.length ? tx("任务清单（{{d}}/{{n}} 完成）", { d: done, n: t.length }) : tx("任务清单已清空"); }
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
  // 秒数从第一秒就显示：等的时候有个在走的东西，才不像卡住
  const long = secs >= 1 ? tx("（{{s}} 秒）", { s: secs }) : '';
  if (live?.tool) return <div className="ag-card is-live"><div className="ag-card-head"><Spinner size="extra-tiny" /><span className="ag-live-title">{liveTitle(live.tool.name, live.tool.input)}</span><span className="muted ag-live-secs">{long}</span></div>{live.status && <div className="ag-live-status muted">{live.status}</div>}</div>;
  if (live?.status) return <div className="ag-thinking muted"><Spinner size="extra-tiny" />{live.status}{long}</div>;
  if (!hasText) return <div className="ag-thinking muted"><Spinner size="extra-tiny" />{secs >= 20 ? tx("还在等模型的首个字…（有的服务方排队时慢，可以再等等或换个接口）") : tx("正在生成回复…")}{long}</div>;
  return null;
}
const EDIT_TOOLS = new Set(['replace', 'insert', 'delete', 'table_write', 'figure_write', 'bib_add', 'info_write', 'abbreviations_add', 'settings_set', 'write_json']);

function ChatList({ chats, current, onOpen, onDelete, onRename, onStar, onNew }: { chats: ChatMeta[]; current: string | null; onOpen: (id: string) => void; onDelete: (id: string) => void; onRename: (id: string, title: string) => void; onStar: (id: string, on: boolean) => void; onNew: () => void }) {
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [q, setQ] = useState('');
  const commit = () => { if (editing) onRename(editing.id, editing.title); setEditing(null); };
  const kw = q.trim().toLowerCase();
  const shown = kw ? chats.filter((c) => c.title.toLowerCase().includes(kw)) : chats;
  return (
    <div className="ag-chatlist" role="list">
      {chats.length > 4 && <Input size="small" className="ag-chat-search" value={q} onChange={(_, d) => setQ(d.value)} placeholder={tx("搜索对话标题")} />}
      {!!kw && !shown.length && <div className="ag-chat-none muted">{tx("没有匹配的对话")}</div>}
      {shown.map((c) => (
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

function FileChip({ f, onRemove, onZoom }: { f: Attachment; onRemove?: () => void; onZoom?: (src: string, name: string) => void }) {
  const Icon = f.kind === 'image' ? Image16Regular : f.kind === 'pdf' ? DocumentPdf16Regular : DocumentText16Regular;
  return (
    <span className="ag-file" title={`${f.name} · ${fmtSize(f.size)}`}>
      {f.kind === 'image' ? <img src={`data:${f.type};base64,${f.data}`} alt="" onClick={onZoom ? () => onZoom(`data:${f.type};base64,${f.data}`, f.name) : undefined} /> : <Icon />}
      <span className="ag-file-name">{f.name}</span>
      {onRemove && <button type="button" className="ag-file-x" aria-label={tx("移除")} onClick={onRemove}><Dismiss12Regular /></button>}
    </span>
  );
}

function DiffBody({ d }: { d: NonNullable<ToolCard['diff']> }) {
  return (
    <div className="ag-diff">
      {d.lines.map((l, i) => <div key={i} className={`ag-dline is-${l.kind}`}>{`${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`}</div>)}
      {d.more > 0 && <div className="ag-dline is-ctx muted">{tx("还有 {{n}} 行未显示", { n: d.more })}</div>}
    </div>
  );
}

/** 模型的思考流：流着的时候展开、计着秒；开始说正文就自己收起来（用户手动点开过就照用户的） */
function Think({ text, active, since, ms }: { text: string; active: boolean; since?: number; ms?: number }) {
  const [open, setOpen] = useState(active);
  const touched = useRef(false);
  const [, tick] = useState(0);
  useEffect(() => { if (!active) return; const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(t); }, [active]);
  useEffect(() => { if (!touched.current) setOpen(active); }, [active]);
  const secs = active && since ? Math.max(0, Math.round((Date.now() - since) / 1000)) : 0;
  const head = active ? tx("正在思考…（{{s}} 秒）", { s: secs }) : ms !== undefined ? tx("思考 {{s}} 秒", { s: Math.max(1, Math.round(ms / 1000)) }) : tx("思考过程");
  return (
    <div className={`ag-think ${active ? 'is-live' : ''}`}>
      <button type="button" className="ag-think-head" onClick={() => { touched.current = true; setOpen(!open); }}>
        {open ? <ChevronDown12Regular /> : <ChevronRight12Regular />}
        <BrainCircuit20Regular className="ag-think-icon" />
        <span className={active ? 'is-active' : undefined}>{head}</span>
      </button>
      {open && <div className="ag-think-body">{text}</div>}
    </div>
  );
}

/** 任务清单：模型每步更新一次，画成勾选列表（进行中的一条高亮） */
function TodoBody({ input }: { input: Record<string, unknown> }) {
  const raw = Array.isArray(input.todos) ? (input.todos as any[]) : [];
  const list = raw.map((t) => ({ text: String(t?.text ?? '').trim(), status: ['pending', 'in_progress', 'completed', 'cancelled'].includes(t?.status) ? String(t.status) : 'pending' })).filter((t) => t.text);
  if (!list.length) return <div className="ag-todo is-empty">{tx("清单已清空")}</div>;
  return (
    <div className="ag-todo">
      {list.map((t, i) => {
        const Icon = t.status === 'completed' ? CheckmarkCircle16Filled : t.status === 'in_progress' ? CircleHalfFill16Regular : t.status === 'cancelled' ? DismissCircle16Regular : Circle16Regular;
        const label = t.status === 'completed' ? tx("已完成") : t.status === 'in_progress' ? tx("进行中") : t.status === 'cancelled' ? tx("已取消") : tx("待办");
        return <div key={i} className={`ag-todo-row is-${t.status}`} title={label}><Icon className="ag-todo-icon" /><span className="ag-todo-text">{t.text}</span></div>;
      })}
    </div>
  );
}

/** 复制一条回复的原文（Markdown） */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="ag-act" title={tx("复制这条回复")} onClick={() => { void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => { /* 剪贴板不可用 */ }); }}>{done ? <Checkmark16Regular /> : <Copy16Regular />}{done ? tx("已复制") : tx("复制")}</button>;
}

/** 点击图片放大：铺满屏幕，Esc / 点背景关掉 */
function Lightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  return (
    <div className="ag-lightbox" role="dialog" aria-label={name} onClick={onClose}>
      <img src={src} alt={name} onClick={(e) => e.stopPropagation()} />
      <div className="ag-lb-bar" onClick={(e) => e.stopPropagation()}>
        <span>{name}</span>
        <button type="button" onClick={onClose} title={tx("关闭")} aria-label={tx("关闭")}><Dismiss20Regular /></button>
      </div>
    </div>
  );
}

function Card({ c, anchorId, flash, onZoom }: { c: ToolCard; anchorId?: string; flash?: boolean; onZoom?: (src: string, name: string) => void }) {
  const [open, setOpen] = useState(c.isError || c.name === 'todo');
  useEffect(() => { if (flash) setOpen(true); }, [flash]);
  const loc = locOf(c);
  const canLoc = !!loc && !!getEditor(loc.part);
  const detail = c.name === 'replace' || c.name === 'insert' ? `${String(c.input.markdown ?? '')}\n\n— ${c.result}`
    : c.name === 'table_write' ? `${(c.input.rows as string[][] | undefined)?.map((r) => r.join(' | ')).join('\n') ?? ''}\n\n— ${c.result}`
    : c.name === 'bib_add' ? `${String(c.input.bibtex ?? '')}\n\n— ${c.result}`
    : c.name === 'write_json' ? `${JSON.stringify(c.input.nodes, null, 1)}\n\n— ${c.result}` : c.result;
  return (
    <div id={anchorId ? `agc-${anchorId}` : undefined} className={`ag-card ${c.isError ? 'is-error' : EDIT_TOOLS.has(c.name) ? 'is-edit' : ''} ${flash ? 'is-flash' : ''}`}>
      <div className="ag-card-top">
        <button type="button" className="ag-card-head" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown12Regular /> : <ChevronRight12Regular />}
          <span>{cardTitle(c)}</span>
          <span className="ag-card-side">
            {!!c.diff && (c.diff.add > 0 || c.diff.del > 0) && <span className="ag-diffnum"><span className="is-add">{`+${c.diff.add}`}</span><span className="is-del">{`-${c.diff.del}`}</span></span>}
            {c.ms !== undefined && <span className="muted">{fmtDur(c.ms)}</span>}
          </span>
        </button>
        {canLoc && loc && <button type="button" className="ag-locate" title={tx("在编辑器里定位到这一块")} onClick={() => void locateInEditor(loc.part, loc.from, loc.to)}>{tx("定位")}</button>}
      </div>
      {!!c.images?.length && <div className="ag-card-imgs">{c.images.map((im) => <img key={im.id} src={`data:${im.type};base64,${im.data}`} alt={im.name} title={im.name} onClick={onZoom ? () => onZoom(`data:${im.type};base64,${im.data}`, im.name) : undefined} />)}</div>}
      {open && (c.name === 'todo'
        ? <TodoBody input={c.input} />
        : c.diff
        ? <><DiffBody d={c.diff} /><div className="ag-card-foot">{c.result}</div></>
        : <pre className="ag-card-body">{detail}</pre>)}
    </div>
  );
}

export function AgentPane({ overlay }: { overlay?: boolean }) {
  const { items, running, compacting, send, stop, regenerate, editResend, compact: compactChat, config, setOpen, setSettingsOpen, pending, queued, dequeue, attach, detach, ask, answer, chats, chatId, newChat, openChat, deleteChat, renameChat, starChat, settings, docProviderId, setDocOverride } = useAgent();
  const [chatsOpen, setChatsOpen] = useState(false);
  const [sumOpen, setSumOpen] = useState(false);
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [slashSel, setSlashSel] = useState(0);
  const [, setEdTick] = useState(0);
  const float = useAgentWindow((s) => s.float);
  const compact = useMedia(COMPACT);
  const provider = settings?.providers.find((p) => p.id === (docProviderId ?? settings.globalId)) ?? settings?.providers[0];
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState(false);
  const [pinned, setPinned] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ready = configReady(config);
  const docId = useStore((s) => s.doc.id);
  useEffect(() => { void useAgent.getState().bind(); }, [docId]);
  // 贴底才跟着滚：用户往上翻着看的时候，模型一边输出一边把列表拽到底是骚扰；自己发一句、换一场对话就回到底
  const stick = useRef(true);
  useEffect(() => { const el = listRef.current; if (!el) return; const onScroll = () => { const p = el.scrollHeight - el.scrollTop - el.clientHeight < 48; stick.current = p; setPinned(p); }; el.addEventListener('scroll', onScroll, { passive: true }); return () => el.removeEventListener('scroll', onScroll); }, []);
  useEffect(() => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items, ask]);
  useEffect(() => { stick.current = true; setPinned(true); const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chatId]);
  useEffect(() => { setShowAll(false); }, [chatId]);
  // 编辑器挂上 / 卸下时重画一遍卡片（「定位」按钮只在对应那节的编辑器挂着时出现）
  useEffect(() => onRegistryChange(() => setEdTick((n) => n + 1)), []);
  useEffect(() => { if (settings === undefined) useAgent.getState().setOpen(true); }, [settings]);
  // Esc 停掉正在跑的这一轮 / 压缩（设置面板、弹层、编辑框开着时不抢）
  useEffect(() => {
    if (!running && !compacting) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || useAgent.getState().settingsOpen) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[role="dialog"], .fui-DialogSurface, .fui-PopoverSurface')) return;
      e.preventDefault();
      stop();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [running, compacting, stop]);
  const submit = () => { const t = draft.trim(); if ((!t && !pending.length) || !ready) return; if (running && !t) return; setDraft(''); stick.current = true; setPinned(true); void send(t); };
  const onFiles = (list: FileList | File[] | null | undefined) => { if (list?.length && ready) void attach(Array.from(list)); };
  const last = items[items.length - 1];
  const lastUser = [...items].reverse().find((i) => i.role === 'user');
  // 更早的轮次折起来：一轮 = 一条用户消息 + 它后面的回复（注记跟在前一轮里）
  const groups: ChatItem[][] = [];
  for (const it of items) { if (it.role === 'user' || !groups.length) groups.push([it]); else groups[groups.length - 1].push(it); }
  const hidden = showAll ? 0 : Math.max(0, groups.length - 2);
  const shownItems = hidden ? groups.slice(hidden).flat() : items;
  // 花费与上下文占比：牌价认得出这个模型才算，上下文按字符数粗估
  const modelInfo = config ? modelInfoOf(config.model) : undefined;
  const totalUsage = items.reduce((a, it) => (it.usage ? { input: a.input + it.usage.input, output: a.output + it.usage.output } : a), { input: 0, output: 0 });
  const cost = modelInfo && (totalUsage.input || totalUsage.output) ? costOf(modelInfo, totalUsage) : undefined;
  const ctxTokens = contextTokensOf(items);
  const ctxPct = modelInfo ? Math.min(100, Math.round((ctxTokens / modelInfo.ctx) * 100)) : undefined;
  // 输入框里的 / 命令
  const slashQ = draft.startsWith('/') ? draft.slice(1).trim().toLowerCase() : null;
  const slashItems = slashQ === null ? [] : COMMANDS.filter((c) => c.cmd.slice(1).toLowerCase().includes(slashQ) || c.desc.toLowerCase().includes(slashQ));
  useEffect(() => { setSlashSel(0); }, [slashQ]);
  // 清单只留最新那一版：旧卡片不画（老记录没有 parts 也一样）
  const lastTodo = (() => { for (let i = items.length - 1; i >= 0; i--) { const list = items[i].tools; for (let j = list.length - 1; j >= 0; j--) if (list[j].name === 'todo') return list[j]; } return undefined; })();
  // 本场改动汇总：每条带「消息 id-序号」，点开列表能定位回卡片
  const editRows = items.flatMap((it) => it.tools.map((c, ci) => ({ key: `${it.id}-${ci}`, card: c }))).filter((r) => !!r.card.diff && (r.card.diff.add > 0 || r.card.diff.del > 0));
  const sumAdd = editRows.reduce((n, r) => n + (r.card.diff?.add ?? 0), 0);
  const sumDel = editRows.reduce((n, r) => n + (r.card.diff?.del ?? 0), 0);
  const locate = (key: string) => {
    setSumOpen(false);
    setShowAll(true);
    setFlash(key);
    // 展开更早的轮次后卡片才挂上，下一拍再滚
    window.setTimeout(() => document.getElementById(`agc-${key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    window.setTimeout(() => setFlash((f) => (f === key ? null : f)), 1800);
  };
  const runSlash = (c: typeof COMMANDS[number]) => {
    setDraft(''); setSlashSel(0);
    if (c.action === 'compact') { void compactChat(); return; }
    if (c.action === 'export') { exportChat(); return; }
    if (c.text) void send(c.text);
  };
  const openZoom = (src: string, name: string) => setZoom({ src, name });
  const exportChat = () => {
    if (!items.length) return;
    const title = chats.find((c) => c.id === chatId)?.title ?? '对话';
    const lines: string[] = [`# ${title}`, '', `（HιT webapp Agent 对话导出，${new Date().toLocaleString('zh-CN')}）`, ''];
    for (const it of items) {
      if (it.note) { lines.push(`> ${it.note}`, ''); continue; }
      if (it.role === 'user') {
        lines.push('## 我', '', it.text || '（附件）', '');
        if (it.files?.length) lines.push(`附件：${it.files.map((f) => f.name).join('、')}`, '');
      } else {
        if (it.reasoning) lines.push('<details><summary>思考</summary>', '', it.reasoning, '', '</details>', '');
        for (const c of it.tools) lines.push(`- ${cardTitle(c)}${c.isError ? '（出错）' : ''}${c.diff ? ` +${c.diff.add} −${c.diff.del}` : ''}`);
        if (it.tools.length) lines.push('');
        if (it.text) lines.push(it.text, '');
        if (it.error) lines.push(`> 出错：${it.error}`, '');
        if (it.stopped) lines.push('> （已停止）', '');
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    setChatsOpen(false);
  };
  // Esc 关掉放大图（捕获阶段先收，别让它把正在跑的一轮也停了）
  useEffect(() => {
    if (!zoom) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setZoom(null); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [zoom]);
  return (
    <aside className={`agent-pane ${overlay ? 'is-overlay' : ''} ${drag ? 'is-drop' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }} onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}>
      <div className="ag-head">
        <BotSparkle20Regular className="ag-logo" />
        <b>Agent</b>
        <Popover positioning="below-start">
          <PopoverTrigger disableButtonEnhancement>
            <button type="button" className="ag-model" title={config ? `${config.baseUrl}${docProviderId ? tx("（本文档指定）") : ''}` : ''}>{ready && provider ? providerLabel(provider) : tx("未配置模型")}</button>
          </PopoverTrigger>
          <PopoverSurface className="ag-modelswitch">
            {(settings?.providers ?? []).map((p) => (
              <button key={p.id} type="button" className={`ag-msrow ${p.id === (docProviderId ?? settings?.globalId) ? 'on' : ''}`} onClick={() => void setDocOverride({ providerId: p.id })}>
                <span className="ag-msname">{providerLabel(p)}</span>
                {p.id === (docProviderId ?? settings?.globalId) && <Checkmark16Regular />}
              </button>
            ))}
            {docProviderId && <button type="button" className="ag-msrow" onClick={() => void setDocOverride({ providerId: null })}>{tx("跟随全局默认")}</button>}
            <button type="button" className="ag-msrow is-manage" onClick={() => setSettingsOpen(true)}><Settings20Regular />{tx("管理模型…")}</button>
          </PopoverSurface>
        </Popover>
        {ctxPct !== undefined && (
          <button
            type="button"
            className={`ag-ctx ${ctxPct >= 80 ? 'is-high' : ''}`}
            title={tx("上下文约用了 {{p}}%（约 {{n}} / {{c}} tokens，估算）；点开对话记录可压缩历史", { p: ctxPct, n: fmtTok(ctxTokens), c: fmtTok(modelInfo!.ctx) }) + (cost !== undefined ? tx("；本场花费约 {{c}}", { c: fmtCost(cost) }) : '')}
            onClick={() => setChatsOpen(true)}
          >{tx("上下文 {{p}}%", { p: ctxPct === 0 && ctxTokens > 0 ? '<1' : String(ctxPct) })}</button>
        )}
        {editRows.length > 0 && (
          <Popover positioning="below-start" open={sumOpen} onOpenChange={(_, d) => setSumOpen(d.open)}>
            <PopoverTrigger disableButtonEnhancement>
              <button type="button" className="ag-sum" title={tx("本场对话的文档改动")}>
                <span className="is-add">{`+${sumAdd}`}</span>
                <span className="is-del">{`-${sumDel}`}</span>
                <span className="muted">{tx("{{n}} 处改动", { n: editRows.length })}</span>
              </button>
            </PopoverTrigger>
            <PopoverSurface className="ag-sumsurface">
              <div className="ag-sumlist">
                {editRows.map((r) => (
                  <button key={r.key} type="button" className="ag-sumrow" onClick={() => locate(r.key)} title={tx("跳到这张卡片")}>
                    <span className="ag-sumtitle">{cardTitle(r.card)}</span>
                    <span className="ag-diffnum"><span className="is-add">{`+${r.card.diff!.add}`}</span><span className="is-del">{`-${r.card.diff!.del}`}</span></span>
                  </button>
                ))}
              </div>
              <div className="muted ag-sumhint">{tx("点一条跳到对话里对应的卡片（展开逐行 diff）")}</div>
            </PopoverSurface>
          </Popover>
        )}
        <span className="spacer" />
        <Tooltip content={tx("新对话")} relationship="label"><Button size="small" appearance="subtle" icon={<Add20Regular />} disabled={!items.length && !chatId} onClick={() => void newChat()} /></Tooltip>
        <Popover positioning="below-end" open={chatsOpen} onOpenChange={(_, d) => setChatsOpen(d.open)}>
          <PopoverTrigger disableButtonEnhancement>
            <Tooltip content={tx("当前文档的对话记录")} relationship="label"><Button size="small" appearance="subtle" icon={<History20Regular />} disabled={!chats.length} /></Tooltip>
          </PopoverTrigger>
          <PopoverSurface className="ag-chats">
            <ChatList chats={chats} current={chatId} onOpen={(id) => { setChatsOpen(false); void openChat(id); }} onDelete={(id) => void deleteChat(id)} onRename={(id, t) => void renameChat(id, t)} onStar={(id, on) => void starChat(id, on)} onNew={() => { setChatsOpen(false); void newChat(); }} />
            <button type="button" className="ag-chat-export" disabled={!items.length || compacting} onClick={() => { setChatsOpen(false); void compactChat(); }}>
              {compacting ? <Spinner size="extra-tiny" /> : <Broom16Regular />}
              {compacting ? tx("压缩中…") : tx("压缩历史对话（保留摘要）")}
            </button>
            <button type="button" className="ag-chat-export" disabled={!items.length} onClick={exportChat}><ArrowDownload16Regular />{tx("导出这场对话（Markdown）")}</button>
          </PopoverSurface>
        </Popover>
        {!compact && <Tooltip content={float ? tx("停靠回右侧") : tx("浮成小窗")} relationship="label"><Button size="small" appearance="subtle" icon={float ? <PanelRightContract20Regular /> : <WindowMultiple20Regular />} onClick={() => useAgentWindow.getState().setFloat(!useAgentWindow.getState().float)} /></Tooltip>}
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
        {hidden > 0 && <button type="button" className="ag-fold" onClick={() => setShowAll(true)}>{tx("更早的 {{n}} 轮对话（点击展开）", { n: hidden })}</button>}
        {shownItems.map((it) => {
          if (it.note) return <div key={it.id} className="ag-note">{it.note}</div>;
          return (
          <div key={it.id} className={`ag-msg is-${it.role}`}>
            {it.reasoning && <Think text={it.reasoning} active={running && it.id === last?.id && !it.text} since={it.thinkSince} ms={it.thinkMs} />}
            {it.role === 'user' ? (
              editing?.id === it.id ? (
                <div className="ag-edit">
                  <Textarea value={editing.text} autoFocus onChange={(_, d) => setEditing({ id: it.id, text: d.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); const t = editing.text; setEditing(null); void editResend(t); } }} />
                  <div className="ag-edit-btns">
                    <Button size="small" appearance="primary" disabled={!editing.text.trim() && !it.files?.length} onClick={() => { const t = editing.text; setEditing(null); void editResend(t); }}>{tx("重发")}</Button>
                    <Button size="small" onClick={() => setEditing(null)}>{tx("取消")}</Button>
                  </div>
                </div>
              ) : (
                <>
                  {!!it.files?.length && <div className="ag-files">{it.files.map((f) => <FileChip key={f.id} f={f} onZoom={openZoom} />)}</div>}
                  {it.text && <div className="ag-text">{it.text}</div>}
                  {it.id === lastUser?.id && !running && !compacting && (
                    <div className="ag-actions">
                      <button type="button" className="ag-act" title={tx("编辑这条消息并重发")} onClick={() => setEditing({ id: it.id, text: it.text })}><Edit16Regular />{tx("编辑重发")}</button>
                    </div>
                  )}
                </>
              )
            ) : (it.parts?.length
              ? it.parts.map((p, i) => p.kind === 'text'
                ? <div key={i} className="ag-text"><ChatMarkdown text={p.text} /></div>
                : (p.card.name === 'todo' && p.card !== lastTodo ? null : <Card key={i} c={p.card} anchorId={`${it.id}-${it.tools.indexOf(p.card)}`} flash={flash === `${it.id}-${it.tools.indexOf(p.card)}`} onZoom={openZoom} />))
              : (
                <>
                  {it.tools.map((c, i) => c.name === 'todo' && c !== lastTodo ? null : <Card key={i} c={c} anchorId={`${it.id}-${i}`} flash={flash === `${it.id}-${i}`} onZoom={openZoom} />)}
                  {it.text && <div className="ag-text"><ChatMarkdown text={it.text} /></div>}
                </>
              ))}
            {it.error && (
              <div className="ag-error">
                {it.error}
                {it.role === 'assistant' && it.id === last?.id && !running && !ask && <button type="button" className="ag-act ag-retry" onClick={() => void regenerate()}>{tx("重试")}</button>}
              </div>
            )}
            {it.stopped && <div className="ag-stopped muted">{tx("已停止")}</div>}
            {it.role === 'assistant' && (it.text || it.usage || it.id === last?.id) && (
              <div className="ag-actions">
                {it.text && <CopyButton text={it.text} />}
                {!running && !ask && it.id === last?.id && !it.error && <button type="button" className="ag-act" title={tx("重新生成这条回复")} onClick={() => void regenerate()}><ArrowClockwise16Regular />{tx("重新生成")}</button>}
                {it.usage && <span className="ag-usage muted" title={tx("这一轮的 token 用量（输入 / 输出）")}>{`↑${fmtTok(it.usage.input)} ↓${fmtTok(it.usage.output)}`}</span>}
                {it.usage && modelInfo && <span className="ag-usage muted" title={tx("这一轮的花费（按服务方牌价估算）")}>{`≈${fmtCost(costOf(modelInfo, it.usage))}`}</span>}
              </div>
            )}
            {it.role === 'assistant' && running && it.id === last?.id && !ask && (!it.reasoning || it.text) && <Live live={it.live} hasText={!!it.text} />}
          </div>
          );
        })}
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
        {!pinned && <button type="button" className="ag-jump" onClick={() => { stick.current = true; setPinned(true); const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }}><ChevronDoubleDown16Regular />{tx("回到底部")}</button>}
      </div>
      {!!pending.length && <div className="ag-files ag-pending">{pending.map((f) => <FileChip key={f.id} f={f} onRemove={() => detach(f.id)} onZoom={openZoom} />)}</div>}
      {!!queued.length && (
        <div className="ag-queue">
          <div className="ag-queue-head muted">{tx("排队中：这一轮结束后自动发送")}</div>
          {queued.map((q) => (
            <div key={q.id} className="ag-queue-row">
              <span>{q.text}</span>
              <button type="button" title={tx("从队列里移除")} onClick={() => dequeue(q.id)}><Dismiss12Regular /></button>
            </div>
          ))}
        </div>
      )}
      {compacting && <div className="ag-compacting muted"><Spinner size="extra-tiny" />{tx("正在压缩历史对话…")}</div>}
      <div className="ag-input">
        <Tooltip content={tx("附件：图片、PDF、文本文件；也可以拖进来或粘贴")} relationship="label"><Button size="small" appearance="subtle" icon={<Attach20Regular />} disabled={!ready || running} onClick={() => fileInput.current?.click()} /></Tooltip>
        <input ref={fileInput} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.txt,.md,.bib,.csv,.json,.tex,.typ" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
        <div className="ag-ta-wrap">
          <Textarea resize="vertical" value={draft} placeholder={ready ? (running ? tx("说下一句，Enter 排队，这一轮结束自动发") : tx("输入任务，Enter 发送；输入 / 看命令")) : tx("请先在设置中配置模型")} disabled={!ready} onChange={(_, d) => setDraft(d.value)} onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); onFiles(fs); } }} onKeyDown={(e) => {
            if (slashItems.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const d = e.key === 'ArrowDown' ? 1 : -1; setSlashSel((n) => (n + d + slashItems.length) % slashItems.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); runSlash(slashItems[Math.min(slashSel, slashItems.length - 1)]); return; }
              if (e.key === 'Escape') { e.preventDefault(); setDraft(''); setSlashSel(0); return; }
            }
            if (e.key === 'ArrowUp' && !draft && !running && !compacting && !e.nativeEvent.isComposing && lastUser?.text) { e.preventDefault(); setDraft(lastUser.text); return; }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }} />
          {slashItems.length > 0 && (
            <div className="ag-slash" role="listbox" aria-label={tx("命令")}>
              {slashItems.map((c, i) => (
                <button key={c.cmd} type="button" role="option" aria-selected={i === slashSel} className={`ag-slashrow ${i === slashSel ? 'on' : ''}`} onMouseEnter={() => setSlashSel(i)} onMouseDown={(e) => { e.preventDefault(); runSlash(c); }}>
                  <b>{c.cmd}</b><span className="muted">{c.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {running
          ? <Tooltip content={tx("停止（排队中的消息也会清掉）")} relationship="label"><Button appearance="secondary" icon={<Stop20Regular />} onClick={stop} /></Tooltip>
          : <Tooltip content={tx("发送")} relationship="label"><Button appearance="primary" icon={<Send20Regular />} disabled={!ready || (!draft.trim() && !pending.length)} onClick={submit} /></Tooltip>}
      </div>
      {zoom && <Lightbox src={zoom.src} name={zoom.name} onClose={() => setZoom(null)} />}
      <AgentSettings />
    </aside>
  );
}
