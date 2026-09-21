// Agent 设置：三页——模型（存好几套接口，一套全局默认，这篇文档可以另指定）、记忆（跨模型跨文档的一段话，
// 开关 + 能自己改）、提示词（全局预设 + 这篇文档的预设）。都存本机
import { useEffect, useState } from 'react';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Button, Input, Dropdown, Option, Combobox, Checkbox, TabList, Tab, Textarea, Switch, Tooltip } from '@fluentui/react-components';
import { Add20Regular, Delete20Regular, Checkmark16Regular, Star16Filled, Document16Regular } from '@fluentui/react-icons';
import { useAgent } from '../ai/state';
import { PRESETS, newProvider, listModels, configReady, webOf, webNativeOf, providerLabel, type AiProvider, type AiSettings } from '../ai/config';
import { testConnection, describeError } from '../ai/agent';
import { bridgePing, type BridgeInfo } from '../ai/bridge';
import { t as tx } from '../i18n';

const caret = <i className="rb-caret" />;
type Page = 'models' | 'memory' | 'prompts' | 'sandbox';
const NATIVE_NOTE: Record<string, string> = {
  anthropic: tx("使用 Anthropic 的网页搜索与读取功能；费用以服务方定价为准。"),
  kimi: tx("使用 Kimi 的联网搜索（$web_search）；费用以服务方定价为准。"),
  dashscope: tx("使用通义的联网搜索（enable_search）。"),
  zhipu: tx("使用智谱的联网搜索（web_search）；费用以服务方定价为准。"),
  openrouter: tx("使用 OpenRouter 的 web 插件；费用以服务方定价为准。"),
};

export function AgentSettings() {
  const open = useAgent((s) => s.settingsOpen);
  const setOpen = useAgent((s) => s.setSettingsOpen);
  const settings = useAgent((s) => s.settings);
  const setSettings = useAgent((s) => s.setSettings);
  const docProviderId = useAgent((s) => s.docProviderId);
  const docPreset = useAgent((s) => s.docPreset);
  const setDocOverride = useAgent((s) => s.setDocOverride);
  const [page, setPage] = useState<Page>('models');
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [preset, setPreset] = useState(docPreset);
  const [docSel, setDocSel] = useState(docProviderId);
  const [bridgeNote, setBridgeNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!open || !settings) return;
    const d: AiSettings = JSON.parse(JSON.stringify(settings));
    if (!d.providers.length) { const p = newProvider(); d.providers = [p]; d.globalId = p.id; }
    setDraft(d); setSel(d.globalId ?? d.providers[0].id); setModels([]); setNote(null); setPreset(docPreset); setDocSel(docProviderId); setPage('models');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!draft) return null;
  const cur = draft.providers.find((p) => p.id === sel) ?? draft.providers[0];
  const patchCur = (p: Partial<AiProvider>) => setDraft({ ...draft, providers: draft.providers.map((x) => (x.id === cur.id ? { ...x, ...p } : x)) });
  const presetOf = PRESETS.find((p) => p.key === cur.preset);
  const pickPreset = (key: string) => {
    const p = PRESETS.find((x) => x.key === key)!;
    patchCur({ preset: p.key, api: p.api, baseUrl: p.baseUrl, model: p.model, apiKey: cur.preset === key ? cur.apiKey : '' });
    setModels([]); setNote(null);
  };
  const add = () => { const p = newProvider(); setDraft({ ...draft, providers: [...draft.providers, p], globalId: draft.globalId ?? p.id }); setSel(p.id); setModels([]); setNote(null); };
  const remove = () => {
    const rest = draft.providers.filter((x) => x.id !== cur.id);
    setDraft({ ...draft, providers: rest, globalId: draft.globalId === cur.id ? rest[0]?.id ?? null : draft.globalId });
    setSel(rest[0]?.id ?? null);
    if (docSel === cur.id) setDocSel(null);
  };
  const fetchModels = async () => {
    setBusy(tx("正在获取模型列表…")); setNote(null);
    try { const ms = await listModels(cur); setModels(ms); if (!ms.length) setNote({ ok: false, text: tx("服务方未返回模型列表，请手动填写模型名") }); }
    catch (e) { setNote({ ok: false, text: describeError(e) }); }
    finally { setBusy(null); }
  };
  const test = async () => {
    setBusy(tx("正在测试连接…")); setNote(null);
    try { const r = await testConnection(cur); setNote(r.tools === false ? { ok: false, text: tx("连接成功（模型回复：{{r}}），但该模型不支持工具调用，无法读取或修改文档。请选择支持函数调用的模型。", { r: r.reply || '…' }) } : { ok: true, text: tx("连接成功。模型回复：{{r}}{{t}}", { r: r.reply || '…', t: r.tools ? tx("；工具调用正常") : '' }) }); }
    catch (e) { setNote({ ok: false, text: describeError(e) }); }
    finally { setBusy(null); }
  };
  const save = async () => {
    const clean: AiSettings = { ...draft, providers: draft.providers.filter((p) => p.baseUrl.trim() || p.apiKey.trim() || p.model.trim()) };
    if (clean.globalId && !clean.providers.some((p) => p.id === clean.globalId)) clean.globalId = clean.providers[0]?.id ?? null;
    await setSettings(clean);
    const doc = clean.providers.some((p) => p.id === docSel) ? docSel : null;
    if (preset !== docPreset || doc !== docProviderId) await setDocOverride({ preset, providerId: doc });
    setOpen(false);
  };
  const w = webOf(cur);
  const native = webNativeOf(cur);
  const isGlobal = draft.globalId === cur.id;
  const isDoc = docSel === cur.id;
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) setOpen(false); }}>
      <DialogSurface className="ag-dialog">
        <DialogBody>
          <DialogTitle>{tx("Agent 设置")}</DialogTitle>
          <DialogContent>
            <TabList selectedValue={page} onTabSelect={(_, d) => setPage(d.value as Page)} size="small" className="ag-tabs">
              <Tab value="models">{tx("模型")}</Tab>
              <Tab value="memory">{tx("记忆")}</Tab>
              <Tab value="prompts">{tx("提示词")}</Tab>
              <Tab value="sandbox">{tx("沙盒")}</Tab>
            </TabList>

            {page === 'models' && (
              <div className="ag-models">
                <aside className="ag-plist">
                  <div className="ag-plist-head"><span>{tx("已保存的接口")}</span><Tooltip content={tx("新增配置")} relationship="label"><Button size="small" appearance="subtle" icon={<Add20Regular />} onClick={add} /></Tooltip></div>
                  {draft.providers.map((p) => (
                    <button key={p.id} type="button" className={`ag-pitem ${p.id === cur.id ? 'on' : ''}`} onClick={() => { setSel(p.id); setModels([]); setNote(null); }}>
                      <span className="ag-pname">{providerLabel(p).trim() === '·' ? tx("未填") : providerLabel(p)}</span>
                      <span className="ag-pbadges">
                        {draft.globalId === p.id && <span className="ag-badge" title={tx("全局默认")}><Star16Filled />{tx("默认")}</span>}
                        {docSel === p.id && <span className="ag-badge is-doc" title={tx("当前文档使用此配置")}><Document16Regular />{tx("本文档")}</span>}
                      </span>
                    </button>
                  ))}
                  <p className="field-hint muted">{tx("本站不提供模型服务。填写服务方密钥后，请求将由浏览器直接发送，密钥仅保存在本机。")}</p>
                </aside>
                <section className="ag-pform">
                  <div className="ag-form">
                    <label>{tx("名称")}</label>
                    <Input size="small" value={cur.name} placeholder={tx("选填；留空时显示「服务方 · 模型」")} onChange={(_, d) => patchCur({ name: d.value })} />
                    <label>{tx("服务")}</label>
                    <Dropdown size="small" expandIcon={caret} style={{ minWidth: 0 }} value={presetOf?.label ?? cur.preset} selectedOptions={[cur.preset]} onOptionSelect={(_, d) => pickPreset(d.optionValue!)}>
                      {PRESETS.map((p) => <Option key={p.key} value={p.key} text={p.label}>{p.label}{p.webNative ? <span className="muted"> · {tx("自带联网")}</span> : null}</Option>)}
                    </Dropdown>
                    {cur.preset === 'custom' && (<>
                      <label>{tx("接口")}</label>
                      <Dropdown size="small" expandIcon={caret} style={{ minWidth: 0 }} value={cur.api === 'anthropic' ? 'Anthropic Messages' : tx("OpenAI 兼容（chat/completions）")} selectedOptions={[cur.api]} onOptionSelect={(_, d) => patchCur({ api: d.optionValue as AiProvider['api'] })}>
                        <Option value="openai" text={tx("OpenAI 兼容（chat/completions）")}>{tx("OpenAI 兼容（chat/completions）")}</Option>
                        <Option value="anthropic" text="Anthropic Messages">Anthropic Messages</Option>
                      </Dropdown>
                    </>)}
                    <label>{tx("地址")}</label>
                    <Input size="small" value={cur.baseUrl} placeholder={cur.api === 'anthropic' ? 'https://api.anthropic.com' : 'https://…/v1'} onChange={(_, d) => patchCur({ baseUrl: d.value })} />
                    <label>{tx("密钥")}</label>
                    <span className="ag-keyrow">
                      <Input size="small" type="password" className="zt-key" value={cur.apiKey} placeholder={/localhost|127\.0\.0\.1/.test(cur.baseUrl) ? tx("本机服务通常无需填写") : 'sk-…'} onChange={(_, d) => patchCur({ apiKey: d.value })} onBlur={() => { if (cur.apiKey.trim() && cur.baseUrl.trim() && !models.length && !busy) void fetchModels(); }} />
                      {presetOf?.keysUrl && <a href={presetOf.keysUrl} target="_blank" rel="noreferrer">{tx("申请密钥 ↗")}</a>}
                    </span>
                    <label>{tx("模型")}</label>
                    <span className="ag-keyrow">
                      <Combobox size="small" freeform expandIcon={caret} style={{ minWidth: 0, flex: 1 }} value={cur.model} selectedOptions={[cur.model]} placeholder={tx("模型名")} onInput={(e) => patchCur({ model: (e.target as HTMLInputElement).value })} onOptionSelect={(_, d) => { if (d.optionValue) patchCur({ model: d.optionValue }); }}>
                        {models.map((m) => <Option key={m} value={m} text={m}>{m}</Option>)}
                      </Combobox>
                      <Button size="small" disabled={!!busy || !cur.baseUrl.trim()} onClick={fetchModels}>{tx("获取列表")}</Button>
                    </span>
                    <label>{tx("联网")}</label>
                    <div className="ag-web">
                      <Checkbox label={tx("允许联网")} checked={w.enabled} onChange={(_, d) => patchCur({ web: { ...w, enabled: !!d.checked } })} />
                      {w.enabled && (native
                        ? <p className="field-hint muted">{NATIVE_NOTE[native]}</p>
                        : (<div className="ag-form ag-form-sub">
                          <label>{tx("读取网页")}</label>
                          <Input size="small" value={w.reader} placeholder="https://r.jina.ai/" onChange={(_, d) => patchCur({ web: { ...w, reader: d.value } })} />
                          <label>{tx("搜索密钥")}</label>
                          <span className="ag-keyrow">
                            <Input size="small" type="password" className="zt-key" value={w.searchKey} placeholder={tx("Jina 密钥；留空时只能读取指定网址，不能搜索")} onChange={(_, d) => patchCur({ web: { ...w, searchKey: d.value } })} />
                            <a href="https://jina.ai/api-dashboard/" target="_blank" rel="noreferrer">{tx("申请密钥 ↗")}</a>
                          </span>
                          <span />
                          <p className="field-hint muted">{tx("此接口不直接联网。网页内容通过阅读代理获取，默认使用无需密钥的 r.jina.ai；搜索使用 Jina Search。")}</p>
                        </div>))}
                    </div>
                  </div>
                  {presetOf?.note && <p className="field-hint muted">{presetOf.note}</p>}
                  <div className="ag-prow">
                    <Button size="small" disabled={!!busy || !configReady(cur)} onClick={test}>{tx("测试连接")}</Button>
                    <Button size="small" appearance={isGlobal ? 'primary' : 'secondary'} icon={isGlobal ? <Checkmark16Regular /> : undefined} disabled={isGlobal} onClick={() => setDraft({ ...draft, globalId: cur.id })}>{isGlobal ? tx("全局默认") : tx("设为全局默认")}</Button>
                    <Tooltip content={isDoc ? tx("再次单击可恢复全局默认配置") : tx("仅将此配置用于当前文档")} relationship="description">
                      <Button size="small" appearance={isDoc ? 'primary' : 'secondary'} icon={isDoc ? <Checkmark16Regular /> : undefined} onClick={() => setDocSel(isDoc ? null : cur.id)}>{tx("用于当前文档")}</Button>
                    </Tooltip>
                    <span className="spacer" />
                    <Tooltip content={tx("删除配置")} relationship="label"><Button size="small" appearance="subtle" icon={<Delete20Regular />} onClick={remove} /></Tooltip>
                  </div>
                  {busy && <p className="ag-status muted">{busy}</p>}
                  {note && <p className={`ag-status ${note.ok ? 'ag-ok' : 'zt-error'}`}>{note.text}</p>}
                </section>
              </div>
            )}

            {page === 'memory' && (
              <div className="ag-page">
                <Switch label={tx("开启记忆（跨模型、跨文档）")} checked={draft.memory.enabled} onChange={(_, d) => setDraft({ ...draft, memory: { ...draft.memory, enabled: d.checked } })} />
                <p className="field-hint muted">{tx("启用后，记忆会随对话发送给模型，并可由 Agent 更新。内容保存在本机，可跨模型和文档使用；停用后不再发送或更新。")}</p>
                <Textarea className="ag-area" resize="vertical" value={draft.memory.notes} placeholder={tx("例：我写的是硕士论文，材料学方向；术语用「有限元」不用「有限元素」；每段不超过 200 字……")} onChange={(_, d) => setDraft({ ...draft, memory: { ...draft.memory, notes: d.value } })} />
                <div className="ag-prow"><span className="muted">{tx("{{n}} 字", { n: draft.memory.notes.length })}</span><span className="spacer" /><Button size="small" appearance="subtle" disabled={!draft.memory.notes} onClick={() => setDraft({ ...draft, memory: { ...draft.memory, notes: '' } })}>{tx("清空")}</Button></div>
              </div>
            )}

            {page === 'prompts' && (
              <div className="ag-page">
                <h4>{tx("全局预设")}</h4>
                <p className="field-hint muted">{tx("附加到系统提示，对所有文档生效。可填写写作偏好、禁用表达或固定流程。")}</p>
                <Textarea className="ag-area" resize="vertical" value={draft.preset} placeholder={tx("例：改动前先列出要改哪几段再动手；引用统一用 GB/T 7714 的顺序编码制……")} onChange={(_, d) => setDraft({ ...draft, preset: d.value })} />
                <h4>{tx("这篇文档的预设")}</h4>
                <p className="field-hint muted">{tx("仅对当前文档生效，与该文档的对话记录一同保存。")}</p>
                <Textarea className="ag-area" resize="vertical" value={preset} placeholder={tx("例：这篇的研究对象是多孔质气体轴承，术语表见第 2 章……")} onChange={(_, d) => setPreset(d.value)} />
              </div>
            )}
            {page === 'sandbox' && (
              <div className="ag-page">
                <Switch label={tx("浏览器代码沙盒（Python / JavaScript）")} checked={draft.sandbox.browser} onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, browser: d.checked } })} />
                <p className="field-hint muted">{tx("Python 通过 Pyodide 在本机浏览器中运行，常用科学计算包按需加载，生成的图片可插入论文。首次使用需从 jsDelivr 下载运行环境，约十余 MB。")}</p>
                <Switch label={tx("服务方沙盒（Anthropic 的 code_execution）")} checked={draft.sandbox.server} onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, server: d.checked } })} />
                <p className="field-hint muted">{tx("仅适用于 Anthropic 接口。模型可在 Anthropic 容器中运行 Python、处理附件并返回文件；费用以服务方定价为准。OpenAI 兼容接口通常不支持此功能。")}</p>
                <h4>{tx("本机桥")}</h4>
                <p className="field-hint muted">{tx("运行本机桥后，Agent 可在指定目录内读写文件，并运行 typst、python 或 git。服务仅监听本机地址并使用令牌验证；停止脚本即可断开。")}</p>
                <Switch label={tx("启用本机桥")} checked={draft.sandbox.bridge.enabled} onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, bridge: { ...draft.sandbox.bridge, enabled: d.checked } } })} />
                <div className="ag-form">
                  <label>{tx("地址")}</label>
                  <Input size="small" value={draft.sandbox.bridge.url} placeholder="http://127.0.0.1:7711" onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, bridge: { ...draft.sandbox.bridge, url: d.value } } })} />
                  <label>{tx("令牌")}</label>
                  <span className="ag-keyrow">
                    <Input size="small" type="password" className="zt-key" value={draft.sandbox.bridge.token} placeholder={tx("启动脚本后显示的令牌")} onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, bridge: { ...draft.sandbox.bridge, token: d.value } } })} />
                    <Button size="small" disabled={!!busy || !draft.sandbox.bridge.url.trim() || !draft.sandbox.bridge.token.trim()} onClick={async () => {
                      setBusy(tx("正在连接本机桥…")); setBridgeNote(null);
                      try { const p: BridgeInfo = await bridgePing(draft.sandbox.bridge); setBridgeNote({ ok: true, text: tx("已连接：目录 {{dir}}；可用命令 {{tools}}", { dir: p.dir, tools: Object.entries(p.tools).filter(([, v]) => v).map(([k]) => k).join('、') || tx("（未检测到 typst、python 或 git）") }) }); }
                      catch (e) { setBridgeNote({ ok: false, text: (e as Error).message }); }
                      finally { setBusy(null); }
                    }}>{tx("测试连接")}</Button>
                  </span>
                  <span />
                  <Checkbox label={tx("每条命令运行前先问我")} checked={draft.sandbox.bridge.confirm} onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, bridge: { ...draft.sandbox.bridge, confirm: !!d.checked } } })} />
                </div>
                {bridgeNote && <p className={`ag-status ${bridgeNote.ok ? 'ag-ok' : 'zt-error'}`}>{bridgeNote.text}</p>}
                <details className="ag-howto">
                  <summary>{tx("安装与连接")}</summary>
                  <ol>
                    <li>{tx("安装 Node.js 18 或更高版本：")}<a href="https://nodejs.org/" target="_blank" rel="noreferrer">nodejs.org</a>{tx("。安装后可在终端运行 node -v 检查版本。")}</li>
                    <li>{tx("下载桥脚本：")}<a href={new URL('bridge/hit-bridge.mjs', document.baseURI).href} download="hit-bridge.mjs">hit-bridge.mjs</a>{tx("单文件，无依赖，可保存到任意位置。")}</li>
                    <li>{tx("在终端中运行，并用 --dir 指定论文资料目录：")}
                      <pre className="ag-cmd">{`node hit-bridge.mjs --dir ~/thesis`}</pre>
                      {tx("将脚本输出的地址和令牌填入上方，测试连接后启用本机桥并保存。")}
                    </li>
                  </ol>
                  <p className="field-hint muted">{tx("本机桥仅监听 127.0.0.1，命令以当前用户身份运行，且限制在 --dir 指定的目录中。自建站点需通过 --origin 指定来源。Safari 可能阻止 HTTPS 页面访问本机服务，可改用 Chrome、Edge 或 Firefox。Windows 请使用 cmd 路径格式，如 C:\\Users\\你\\thesis。删除 ~/.hit-bridge/token 并重启可更换令牌。")}</p>
                </details>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setOpen(false)}>{tx("取消")}</Button>
            <Button appearance="primary" onClick={save}>{tx("保存")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
