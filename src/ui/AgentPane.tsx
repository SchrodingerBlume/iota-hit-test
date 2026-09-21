// Agent 面板：在编辑区右边跟模型对话，它读、改文档走 src/ai/tools.ts 那几件工具，每一步在对话里留一张卡
import { useEffect, useRef, useState } from 'react';
import { Button, Textarea, Tooltip } from '@fluentui/react-components';
import { Settings20Regular, Dismiss20Regular, Send20Regular, Stop20Regular, Broom20Regular, ChevronRight12Regular, ChevronDown12Regular } from '@fluentui/react-icons';
import { useAgent, type ToolCard } from '../ai/state';
import { configReady, PRESETS } from '../ai/config';
import { PARTS } from '../ai/tools';
import { AgentSettings } from './AgentSettings';
import { t as tx } from '../i18n';

const QUICK = [
  tx("润色我选中的这段，保持原意，改完直接替换"),
  tx("通读正文，指出语病、错别字和表述不清的地方，先列出来别改"),
  tx("看看最近一次编译的错误，告诉我怎么改"),
  tx("按现有各章内容，给结论写一段总结的草稿，加在结论的开头"),
];

function partLabel(key: unknown) { return PARTS.find((p) => p.key === key)?.label ?? String(key ?? ''); }
function cardTitle(c: ToolCard): string {
  const i = c.input; const rng = i.to !== undefined && i.to !== i.from ? `#${i.from}–${i.to}` : `#${i.from}`;
  switch (c.name) {
    case 'outline': return tx("看了结构");
    case 'read': return tx("读了{{part}} {{rng}}", { part: partLabel(i.part), rng });
    case 'replace': return tx("改了{{part}} {{rng}}", { part: partLabel(i.part), rng });
    case 'insert': return tx("在{{part}} #{{at}} 前插入", { part: partLabel(i.part), at: i.at });
    case 'delete': return tx("删了{{part}} {{rng}}", { part: partLabel(i.part), rng });
    case 'selection': return tx("看了选中的内容");
    case 'diagnostics': return tx("看了编译诊断");
    case 'references': return tx("看了参考文献表");
    case 'thesis': return tx("看了论文信息");
    default: return c.name;
  }
}

function Card({ c }: { c: ToolCard }) {
  const [open, setOpen] = useState(false);
  const edit = ['replace', 'insert', 'delete'].includes(c.name);
  return (
    <div className={`ag-card ${c.isError ? 'is-error' : edit ? 'is-edit' : ''}`}>
      <button type="button" className="ag-card-head" onClick={() => setOpen(!open)}>{open ? <ChevronDown12Regular /> : <ChevronRight12Regular />}<span>{cardTitle(c)}</span></button>
      {open && <pre className="ag-card-body">{c.name === 'replace' || c.name === 'insert' ? `${String(c.input.markdown ?? '')}\n\n— ${c.result}` : c.result}</pre>}
    </div>
  );
}

export function AgentPane() {
  const { items, running, send, stop, clear, config, setOpen, setSettingsOpen } = useAgent();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const ready = configReady(config);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [items]);
  useEffect(() => { if (config === undefined) useAgent.getState().setOpen(true); }, [config]);
  const submit = () => { const t = draft.trim(); if (!t || running || !ready) return; setDraft(''); void send(t); };
  const preset = PRESETS.find((p) => p.key === config?.preset);
  return (
    <aside className="agent-pane">
      <div className="ag-head">
        <b>Agent</b>
        <span className="muted ag-model" title={config ? `${config.baseUrl}` : ''}>{ready ? `${preset?.label ?? config!.preset} · ${config!.model}` : tx("还没接模型")}</span>
        <span className="spacer" />
        <Tooltip content={tx("清空对话")} relationship="label"><Button size="small" appearance="subtle" icon={<Broom20Regular />} disabled={!items.length || running} onClick={clear} /></Tooltip>
        <Tooltip content={tx("Agent 设置")} relationship="label"><Button size="small" appearance="subtle" icon={<Settings20Regular />} onClick={() => setSettingsOpen(true)} /></Tooltip>
        <Tooltip content={tx("关闭")} relationship="label"><Button size="small" appearance="subtle" icon={<Dismiss20Regular />} onClick={() => setOpen(false)} /></Tooltip>
      </div>
      <div className="ag-list" ref={listRef}>
        {!ready && config !== undefined && (
          <div className="ag-empty">
            <p>{tx("接你自己的模型：Anthropic、OpenAI、DeepSeek、Kimi、通义、智谱、OpenRouter，或本机的 Ollama / LM Studio。密钥只存在这台浏览器里，直连服务方。")}</p>
            <Button appearance="primary" size="small" onClick={() => setSettingsOpen(true)}>{tx("去接模型")}</Button>
          </div>
        )}
        {ready && !items.length && (
          <div className="ag-empty">
            <p className="muted">{tx("它能读整篇、按段改、看编译错误、查参考文献表；改动都能在撤消里回退。")}</p>
            {QUICK.map((q) => <button key={q} type="button" className="ag-quick" onClick={() => void send(q)}>{q}</button>)}
          </div>
        )}
        {items.map((it) => (
          <div key={it.id} className={`ag-msg is-${it.role}`}>
            {it.tools.map((c, i) => <Card key={i} c={c} />)}
            {it.text && <div className="ag-text">{it.text}</div>}
            {it.error && <div className="ag-error">{it.error}</div>}
            {it.role === 'assistant' && running && it.id === items[items.length - 1]?.id && !it.text && !it.tools.length && <div className="ag-thinking muted">{tx("正在想…")}</div>}
          </div>
        ))}
      </div>
      <div className="ag-input">
        <Textarea resize="vertical" value={draft} placeholder={ready ? tx("要它做什么？Enter 发送，Shift+Enter 换行") : tx("先在设置里接一个模型")} disabled={!ready} onChange={(_, d) => setDraft(d.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        {running
          ? <Button appearance="secondary" icon={<Stop20Regular />} onClick={stop}>{tx("停止")}</Button>
          : <Button appearance="primary" icon={<Send20Regular />} disabled={!ready || !draft.trim()} onClick={submit}>{tx("发送")}</Button>}
      </div>
      <AgentSettings />
    </aside>
  );
}
