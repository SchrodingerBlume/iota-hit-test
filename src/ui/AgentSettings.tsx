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
  anthropic: tx("走 Anthropic 自带的网页搜索与抓取（按次计费，见其价目）。"),
  kimi: tx("走 Kimi 自带的联网搜索（$web_search，按其价目计费）。"),
  dashscope: tx("走通义自带的联网搜索（enable_search）。"),
  zhipu: tx("走智谱自带的联网搜索（web_search 工具，按其价目计费）。"),
  openrouter: tx("走 OpenRouter 的 web 插件（按其价目计费）。"),
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
    setBusy(tx("正在取模型列表…")); setNote(null);
    try { const ms = await listModels(cur); setModels(ms); if (!ms.length) setNote({ ok: false, text: tx("服务方没返回模型列表，自己填模型名") }); }
    catch (e) { setNote({ ok: false, text: describeError(e) }); }
    finally { setBusy(null); }
  };
  const test = async () => {
    setBusy(tx("正在试连…")); setNote(null);
    try { const r = await testConnection(cur); setNote(r.tools === false ? { ok: false, text: tx("通了（它回：{{r}}），但这个模型不调工具——接上了也只能聊天，读不了、改不了文档；换个支持函数调用的模型", { r: r.reply || '…' }) } : { ok: true, text: tx("通了，它回：{{r}}{{t}}", { r: r.reply || '…', t: r.tools ? tx("；工具调用正常") : '' }) }); }
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
                  <div className="ag-plist-head"><span>{tx("已存的接口")}</span><Tooltip content={tx("新增一套")} relationship="label"><Button size="small" appearance="subtle" icon={<Add20Regular />} onClick={add} /></Tooltip></div>
                  {draft.providers.map((p) => (
                    <button key={p.id} type="button" className={`ag-pitem ${p.id === cur.id ? 'on' : ''}`} onClick={() => { setSel(p.id); setModels([]); setNote(null); }}>
                      <span className="ag-pname">{providerLabel(p).trim() === '·' ? tx("未填") : providerLabel(p)}</span>
                      <span className="ag-pbadges">
                        {draft.globalId === p.id && <span className="ag-badge" title={tx("全局默认")}><Star16Filled />{tx("默认")}</span>}
                        {docSel === p.id && <span className="ag-badge is-doc" title={tx("这篇文档指定用它")}><Document16Regular />{tx("本文档")}</span>}
                      </span>
                    </button>
                  ))}
                  <p className="field-hint muted">{tx("站里不带任何模型：填服务方的密钥，请求从这台浏览器直接发给它，密钥只存在本机。")}</p>
                </aside>
                <section className="ag-pform">
                  <div className="ag-form">
                    <label>{tx("名称")}</label>
                    <Input size="small" value={cur.name} placeholder={tx("随便起，不填就显示「服务方 · 模型」")} onChange={(_, d) => patchCur({ name: d.value })} />
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
                      <Input size="small" type="password" className="zt-key" value={cur.apiKey} placeholder={/localhost|127\.0\.0\.1/.test(cur.baseUrl) ? tx("本机服务一般不用") : 'sk-…'} onChange={(_, d) => patchCur({ apiKey: d.value })} onBlur={() => { if (cur.apiKey.trim() && cur.baseUrl.trim() && !models.length && !busy) void fetchModels(); }} />
                      {presetOf?.keysUrl && <a href={presetOf.keysUrl} target="_blank" rel="noreferrer">{tx("去申请 ↗")}</a>}
                    </span>
                    <label>{tx("模型")}</label>
                    <span className="ag-keyrow">
                      <Combobox size="small" freeform expandIcon={caret} style={{ minWidth: 0, flex: 1 }} value={cur.model} selectedOptions={[cur.model]} placeholder={tx("模型名")} onInput={(e) => patchCur({ model: (e.target as HTMLInputElement).value })} onOptionSelect={(_, d) => { if (d.optionValue) patchCur({ model: d.optionValue }); }}>
                        {models.map((m) => <Option key={m} value={m} text={m}>{m}</Option>)}
                      </Combobox>
                      <Button size="small" disabled={!!busy || !cur.baseUrl.trim()} onClick={fetchModels}>{tx("取列表")}</Button>
                    </span>
                    <label>{tx("联网")}</label>
                    <div className="ag-web">
                      <Checkbox label={tx("允许联网")} checked={w.enabled} onChange={(_, d) => patchCur({ web: { ...w, enabled: !!d.checked } })} />
                      {w.enabled && (native
                        ? <p className="field-hint muted">{NATIVE_NOTE[native]}</p>
                        : (<div className="ag-form ag-form-sub">
                          <label>{tx("抓网页")}</label>
                          <Input size="small" value={w.reader} placeholder="https://r.jina.ai/" onChange={(_, d) => patchCur({ web: { ...w, reader: d.value } })} />
                          <label>{tx("搜索密钥")}</label>
                          <span className="ag-keyrow">
                            <Input size="small" type="password" className="zt-key" value={w.searchKey} placeholder={tx("Jina 的密钥，不填就只能抓网址不能搜")} onChange={(_, d) => patchCur({ web: { ...w, searchKey: d.value } })} />
                            <a href="https://jina.ai/api-dashboard/" target="_blank" rel="noreferrer">{tx("去申请 ↗")}</a>
                          </span>
                          <span />
                          <p className="field-hint muted">{tx("这家接口自己不联网：抓网页经阅读代理（网址前面接上它，默认 r.jina.ai，不用密钥），搜索用 Jina 的搜索接口。")}</p>
                        </div>))}
                    </div>
                  </div>
                  {presetOf?.note && <p className="field-hint muted">{presetOf.note}</p>}
                  <div className="ag-prow">
                    <Button size="small" disabled={!!busy || !configReady(cur)} onClick={test}>{tx("试连")}</Button>
                    <Button size="small" appearance={isGlobal ? 'primary' : 'secondary'} icon={isGlobal ? <Checkmark16Regular /> : undefined} disabled={isGlobal} onClick={() => setDraft({ ...draft, globalId: cur.id })}>{isGlobal ? tx("全局默认") : tx("设为全局默认")}</Button>
                    <Tooltip content={isDoc ? tx("再点一下改回跟全局") : tx("只对当前这篇文档换成这一套")} relationship="description">
                      <Button size="small" appearance={isDoc ? 'primary' : 'secondary'} icon={isDoc ? <Checkmark16Regular /> : undefined} onClick={() => setDocSel(isDoc ? null : cur.id)}>{tx("本文档用它")}</Button>
                    </Tooltip>
                    <span className="spacer" />
                    <Tooltip content={tx("删除这套")} relationship="label"><Button size="small" appearance="subtle" icon={<Delete20Regular />} onClick={remove} /></Tooltip>
                  </div>
                  {busy && <p className="ag-status muted">{busy}</p>}
                  {note && <p className={`ag-status ${note.ok ? 'ag-ok' : 'zt-error'}`}>{note.text}</p>}
                </section>
              </div>
            )}

            {page === 'memory' && (
              <div className="ag-page">
                <Switch label={tx("开启记忆（跨模型、跨文档）")} checked={draft.memory.enabled} onChange={(_, d) => setDraft({ ...draft, memory: { ...draft.memory, enabled: d.checked } })} />
                <p className="field-hint muted">{tx("开着时这段话会随每次对话一起发给模型；你说「记住……」它就往这里记。存在本机，换模型、换文档都在。关了就不发也不记。")}</p>
                <Textarea className="ag-area" resize="vertical" value={draft.memory.notes} placeholder={tx("例：我写的是硕士论文，材料学方向；术语用「有限元」不用「有限元素」；每段不超过 200 字……")} onChange={(_, d) => setDraft({ ...draft, memory: { ...draft.memory, notes: d.value } })} />
                <div className="ag-prow"><span className="muted">{tx("{{n}} 字", { n: draft.memory.notes.length })}</span><span className="spacer" /><Button size="small" appearance="subtle" disabled={!draft.memory.notes} onClick={() => setDraft({ ...draft, memory: { ...draft.memory, notes: '' } })}>{tx("清空")}</Button></div>
              </div>
            )}

            {page === 'prompts' && (
              <div className="ag-page">
                <h4>{tx("全局预设")}</h4>
                <p className="field-hint muted">{tx("接在系统提示后面，每篇文档都生效：写作口味、禁忌、固定流程都可以放这儿。")}</p>
                <Textarea className="ag-area" resize="vertical" value={draft.preset} placeholder={tx("例：改动前先列出要改哪几段再动手；引用统一用 GB/T 7714 的顺序编码制……")} onChange={(_, d) => setDraft({ ...draft, preset: d.value })} />
                <h4>{tx("这篇文档的预设")}</h4>
                <p className="field-hint muted">{tx("只对当前文档生效，跟着文档的对话记录存。")}</p>
                <Textarea className="ag-area" resize="vertical" value={preset} placeholder={tx("例：这篇的研究对象是多孔质气体轴承，术语表见第 2 章……")} onChange={(_, d) => setPreset(d.value)} />
              </div>
            )}
            {page === 'sandbox' && (
              <div className="ag-page">
                <Switch label={tx("浏览器里跑代码（Python / JavaScript）")} checked={draft.sandbox.browser} onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, browser: d.checked } })} />
                <p className="field-hint muted">{tx("Python 走 Pyodide：numpy、pandas、matplotlib、scipy、sympy 按需自动装，画出的图能直接插进论文；全在你这台电脑的浏览器里跑，没有服务器。第一次用要从 jsDelivr 下载十几 MB，之后浏览器缓存着。")}</p>
                <Switch label={tx("服务方沙盒（Anthropic 的 code_execution）")} checked={draft.sandbox.server} onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, server: d.checked } })} />
                <p className="field-hint muted">{tx("只对 Anthropic 接口生效：模型在 Anthropic 的容器里跑 Python、读写文件，附件会传进容器，产出的文件回到对话里。按其价目计费（每月有免费时长）。OpenAI 兼容的接口一般没有这项。")}</p>
                <h4>{tx("本机桥：让 Agent 用你的电脑")}</h4>
                <p className="field-hint muted">{tx("网页碰不到你的硬盘和命令行。在你电脑上跑一个小脚本，它只听本机、只认一个令牌、只碰你指定的文件夹；网页里的 Agent 就能读写那里的文件、跑 typst / python / git。关掉脚本就断开。")}</p>
                <Switch label={tx("启用本机桥")} checked={draft.sandbox.bridge.enabled} onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, bridge: { ...draft.sandbox.bridge, enabled: d.checked } } })} />
                <div className="ag-form">
                  <label>{tx("地址")}</label>
                  <Input size="small" value={draft.sandbox.bridge.url} placeholder="http://127.0.0.1:7711" onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, bridge: { ...draft.sandbox.bridge, url: d.value } } })} />
                  <label>{tx("令牌")}</label>
                  <span className="ag-keyrow">
                    <Input size="small" type="password" className="zt-key" value={draft.sandbox.bridge.token} placeholder={tx("脚本启动时打印的那串")} onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, bridge: { ...draft.sandbox.bridge, token: d.value } } })} />
                    <Button size="small" disabled={!!busy || !draft.sandbox.bridge.url.trim() || !draft.sandbox.bridge.token.trim()} onClick={async () => {
                      setBusy(tx("正在连本机桥…")); setBridgeNote(null);
                      try { const p: BridgeInfo = await bridgePing(draft.sandbox.bridge); setBridgeNote({ ok: true, text: tx("连上了：文件夹 {{dir}}；机器上有 {{tools}}", { dir: p.dir, tools: Object.entries(p.tools).filter(([, v]) => v).map(([k]) => k).join('、') || tx("（没找到 typst / python / git）") }) }); }
                      catch (e) { setBridgeNote({ ok: false, text: (e as Error).message }); }
                      finally { setBusy(null); }
                    }}>{tx("试连")}</Button>
                  </span>
                  <span />
                  <Checkbox label={tx("每条命令运行前先问我")} checked={draft.sandbox.bridge.confirm} onChange={(_, d) => setDraft({ ...draft, sandbox: { ...draft.sandbox, bridge: { ...draft.sandbox.bridge, confirm: !!d.checked } } })} />
                </div>
                {bridgeNote && <p className={`ag-status ${bridgeNote.ok ? 'ag-ok' : 'zt-error'}`}>{bridgeNote.text}</p>}
                <details className="ag-howto">
                  <summary>{tx("怎么装、怎么开（三步）")}</summary>
                  <ol>
                    <li>{tx("装 Node.js（18 以上）：")}<a href="https://nodejs.org/" target="_blank" rel="noreferrer">nodejs.org</a>{tx("，装好后终端里 node -v 能打出版本号就行。")}</li>
                    <li>{tx("下载桥脚本：")}<a href={new URL('bridge/hit-bridge.mjs', document.baseURI).href} download="hit-bridge.mjs">hit-bridge.mjs</a>{tx("（一个文件，零依赖），放到哪儿都行。")}</li>
                    <li>{tx("在终端里运行，--dir 指到你放论文材料的文件夹：")}
                      <pre className="ag-cmd">{`node hit-bridge.mjs --dir ~/thesis`}</pre>
                      {tx("它会打印地址和令牌，填到上面两栏，点「试连」，再打开「启用本机桥」，保存。")}
                    </li>
                  </ol>
                  <p className="field-hint muted">{tx("注意：桥只接受这个网站发来的请求（自己搭的站要加 --origin 你的地址），只在 127.0.0.1 上听，命令用你的账号执行、限定在 --dir 那个文件夹里。Safari 可能拦 https 页面连本机的请求，用 Chrome / Edge / Firefox。Windows 用 cmd 语法，路径写成 C:\\Users\\你\\thesis。想换令牌删掉 ~/.hit-bridge/token 再启动。")}</p>
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
