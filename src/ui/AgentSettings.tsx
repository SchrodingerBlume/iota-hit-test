// Agent 设置：选服务方（或自定义地址）、贴密钥、挑模型、试连。存本机
import { useEffect, useState } from 'react';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Button, Input, Dropdown, Option, Combobox } from '@fluentui/react-components';
import { useAgent } from '../ai/state';
import { PRESETS, emptyConfig, saveConfig, listModels, configReady, type AiConfig } from '../ai/config';
import { testConnection, describeError } from '../ai/agent';
import { t as tx } from '../i18n';
import { t as tr } from '../i18n';

const caret = <i className="rb-caret" />;

export function AgentSettings() {
  const open = useAgent((s) => s.settingsOpen);
  const setOpen = useAgent((s) => s.setSettingsOpen);
  const saved = useAgent((s) => s.config);
  const setConfig = useAgent((s) => s.setConfig);
  const [c, setC] = useState<AiConfig>(emptyConfig());
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (open) { setC(saved ?? emptyConfig()); setModels([]); setNote(null); } }, [open, saved]);
  const preset = PRESETS.find((p) => p.key === c.preset) ?? PRESETS[PRESETS.length - 1];
  const pick = (key: string) => {
    const p = PRESETS.find((x) => x.key === key)!;
    setC({ preset: p.key, api: p.api, baseUrl: p.baseUrl, model: p.model, apiKey: c.preset === key ? c.apiKey : '' });
    setModels([]); setNote(null);
  };
  const fetchModels = async () => {
    setBusy(tx("正在取模型列表…")); setNote(null);
    try { const ms = await listModels(c); setModels(ms); if (!ms.length) setNote({ ok: false, text: tx("服务方没返回模型列表，自己填模型名") }); }
    catch (e) { setNote({ ok: false, text: describeError(e) }); }
    finally { setBusy(null); }
  };
  const test = async () => {
    setBusy(tx("正在试连…")); setNote(null);
    try { const r = await testConnection(c); setNote({ ok: true, text: tx("通了，它回：{{r}}", { r: r || '…' }) }); }
    catch (e) { setNote({ ok: false, text: describeError(e) }); }
    finally { setBusy(null); }
  };
  const save = async () => { await saveConfig(c); setConfig(c); setOpen(false); };
  const forget = async () => { await saveConfig(null); setConfig(null); setOpen(false); };
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) setOpen(false); }}>
      <DialogSurface className="ag-dialog">
        <DialogBody>
          <DialogTitle>{tx("Agent 设置")}</DialogTitle>
          <DialogContent>
            <p className="field-hint muted">{tx("站里不带任何模型，你接自己的：填服务方的密钥，请求从这台浏览器直接发给它，密钥只存在本机。")}</p>
            <div className="ag-grid">
              <span className="zt-lab">{tx("服务")}</span>
              <Dropdown size="small" expandIcon={caret} style={{ minWidth: 0 }} value={preset.label} selectedOptions={[preset.key]} onOptionSelect={(_, d) => pick(d.optionValue!)}>
                {PRESETS.map((p) => <Option key={p.key} value={p.key} text={p.label}>{p.label}</Option>)}
              </Dropdown>
              {preset.key === 'custom' && (<>
                <span className="zt-lab">{tx("接口")}</span>
                <Dropdown size="small" expandIcon={caret} style={{ minWidth: 0 }} value={c.api === 'anthropic' ? 'Anthropic Messages' : tr("OpenAI 兼容（chat/completions）")} selectedOptions={[c.api]} onOptionSelect={(_, d) => setC({ ...c, api: d.optionValue as AiConfig['api'] })}>
                  <Option value="openai" text={tr("OpenAI 兼容（chat/completions）")}>{tr("OpenAI 兼容（chat/completions）")}</Option>
                  <Option value="anthropic" text="Anthropic Messages">Anthropic Messages</Option>
                </Dropdown>
              </>)}
              <span className="zt-lab">{tx("地址")}</span>
              <Input size="small" value={c.baseUrl} placeholder={c.api === 'anthropic' ? 'https://api.anthropic.com' : 'https://…/v1'} onChange={(_, d) => setC({ ...c, baseUrl: d.value })} />
              <span className="zt-lab">{tx("密钥")}</span>
              <span className="ag-keyrow">
                <Input size="small" type="password" className="zt-key" value={c.apiKey} placeholder={/localhost|127\.0\.0\.1/.test(c.baseUrl) ? tx("本机服务一般不用") : 'sk-…'} onChange={(_, d) => setC({ ...c, apiKey: d.value })} />
                {preset.keysUrl && <a href={preset.keysUrl} target="_blank" rel="noreferrer">{tx("去申请 ↗")}</a>}
              </span>
              <span className="zt-lab">{tx("模型")}</span>
              <span className="ag-keyrow">
                <Combobox size="small" freeform expandIcon={caret} style={{ minWidth: 0, flex: 1 }} value={c.model} selectedOptions={[c.model]} placeholder={tx("模型名")} onInput={(e) => setC({ ...c, model: (e.target as HTMLInputElement).value })} onOptionSelect={(_, d) => { if (d.optionValue) setC({ ...c, model: d.optionValue }); }}>
                  {models.map((m) => <Option key={m} value={m} text={m}>{m}</Option>)}
                </Combobox>
                <Button size="small" disabled={!!busy || !c.baseUrl.trim()} onClick={fetchModels}>{tx("取列表")}</Button>
              </span>
            </div>
            {preset.note && <p className="field-hint muted">{preset.note}</p>}
            <div className="zt-row" style={{ marginTop: 8 }}>
              <Button size="small" disabled={!!busy || !configReady(c)} onClick={test}>{tx("试连")}</Button>
              {busy && <span className="muted">{busy}</span>}
              {note && <span className={note.ok ? 'ag-ok' : 'zt-error'}>{note.text}</span>}
            </div>
          </DialogContent>
          <DialogActions>
            {saved && <Button appearance="subtle" onClick={forget}>{tx("忘掉密钥")}</Button>}
            <Button appearance="secondary" onClick={() => setOpen(false)}>{tx("取消")}</Button>
            <Button appearance="primary" disabled={!configReady(c)} onClick={save}>{tx("保存")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
