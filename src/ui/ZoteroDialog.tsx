// 从 Zotero 拿文献：首选云端 Web API（登录 zotero.org 建一把只读密钥贴进来，之后随时按「导入」拿最新的），
// 兜底是 Zotero 导出的 CSL JSON 文件拖进来。两条路都折成编辑器的条目，再按来源 / 引用键并进现有的
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Button, Input, Dropdown, Option, Checkbox } from '@fluentui/react-components';
import type { BibEntry } from '../bib/bibtex';
import { parseBibtex } from '../bib/bibtex';
import { entriesFromCsl, mergeEntries, parseCslJson, cslToEntry } from '../bib/csl';
import { connect, libraries, collections, items, loadAuth, saveAuth, type ZoteroAuth, type ZoteroLibrary, type ZoteroCollection } from '../bib/zotero';
import { t as tx } from '../i18n';

interface Props { open: boolean; onClose: () => void; entries: BibEntry[]; onChange: (e: BibEntry[]) => void }
const caret = <i className="rb-caret" />;
const DD = { minWidth: 0, width: '100%' } as const;
const KEYS_URL = 'https://www.zotero.org/settings/keys/new';

/** 文件内容：开头是 [ 或 { 的当 CSL JSON，其余当 BibTeX */
export function entriesFromText(text: string, taken: Set<string>): BibEntry[] {
  const t = text.normalize('NFC').trim();
  if (t.startsWith('[') || t.startsWith('{')) return entriesFromCsl(parseCslJson(t), taken);
  return parseBibtex(t);
}

export function ZoteroDialog({ open, onClose, entries, onChange }: Props) {
  const [auth, setAuth] = useState<ZoteroAuth | null | undefined>(undefined);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libs, setLibs] = useState<ZoteroLibrary[]>([]);
  const [lib, setLib] = useState<string>('');
  const [cols, setCols] = useState<ZoteroCollection[]>([]);
  const [col, setCol] = useState<string>('');
  const [asGroup, setAsGroup] = useState(true);
  const [result, setResult] = useState<{ added: number; updated: number; total: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setResult(null); setError(null); void loadAuth().then((a) => setAuth(a ?? null)); } }, [open]);
  useEffect(() => {
    if (!auth) { setLibs([]); setLib(''); return; }
    setBusy(tx("正在读取文库…"));
    libraries(auth).then((ls) => { setLibs(ls); setLib((l) => l || ls[0].id); }).catch((e) => setError(describe(e))).finally(() => setBusy(null));
  }, [auth]);
  useEffect(() => {
    if (!auth || !lib) { setCols([]); return; }
    setBusy(tx("正在读取收藏夹…")); setCol('');
    collections(auth, lib).then(setCols).catch((e) => setError(describe(e))).finally(() => setBusy(null));
  }, [auth, lib]);

  const doConnect = async () => {
    setError(null); setResult(null); setBusy(tx("正在连接…"));
    try { const a = await connect(keyInput); await saveAuth(a); setAuth(a); setKeyInput(''); } catch (e) { setError(describe(e)); } finally { setBusy(null); }
  };
  const disconnect = async () => { await saveAuth(null); setAuth(null); setCols([]); setResult(null); };
  const merge = (incoming: BibEntry[], group?: string) => {
    const r = mergeEntries(entries, incoming, group);
    onChange(r.entries);
    setResult({ added: r.added, updated: r.updated, total: incoming.length });
  };
  const doImport = async () => {
    if (!auth) return;
    setError(null); setResult(null); setBusy(tx("正在下载条目…"));
    try {
      const list = await items(auth, lib, col || null, (n, total) => setBusy(tx("正在下载条目… {{n}} / {{total}}", { n, total })));
      const taken = new Set(entries.map((e) => e.key));
      const incoming = list.map((it) => {
        const e = cslToEntry(it.csl, taken, it.citationKey && !taken.has(it.citationKey) ? it.citationKey : undefined);
        taken.add(e.key);
        e.source = `zotero:${it.key}`;
        return e;
      });
      merge(incoming, asGroup && col ? cols.find((c) => c.key === col)?.name : undefined);
    } catch (e) { setError(describe(e)); } finally { setBusy(null); }
  };
  const importFiles = async (files: FileList | File[]) => {
    setError(null); setResult(null);
    const taken = new Set(entries.map((e) => e.key));
    const all: BibEntry[] = [];
    for (const f of Array.from(files)) {
      try { const got = entriesFromText(await f.text(), taken); for (const e of got) taken.add(e.key); all.push(...got); }
      catch (e) { setError(tx("{{name}}：读不出条目（{{err}}）", { name: f.name, err: describe(e) })); return; }
    }
    if (!all.length) { setError(tx("文件里没有条目")); return; }
    merge(all);
  };
  const curLib = libs.find((l) => l.id === lib);
  const curCol = cols.find((c) => c.key === col);
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface className="zt-dialog">
        <DialogBody>
          <DialogTitle>{tx("从 Zotero 导入")}</DialogTitle>
          <DialogContent>
            <section className="zt-sec">
              <h4>{tx("云端（推荐）")}</h4>
              {auth === undefined ? null : !auth ? (
                <>
                  <p className="field-hint muted">{tx("Zotero 开着同步的话，文献已经在 zotero.org 上：登录后到 设置 → 安全 → 新建私钥，勾上「允许读取文库」（只读就够，要导群组的再把群组权限设成只读），把密钥粘到这里。密钥只存在这台浏览器里。")}{' '}<a href={KEYS_URL} target="_blank" rel="noreferrer">{tx("去 zotero.org 新建密钥 ↗")}</a></p>
                  <div className="zt-row">
                    <Input size="small" className="zt-key" value={keyInput} placeholder={tx("API 密钥（24 位）")} onChange={(_, d) => setKeyInput(d.value)} onKeyDown={(e) => { if (e.key === 'Enter' && keyInput.trim()) void doConnect(); }} />
                    <Button size="small" appearance="primary" disabled={!keyInput.trim() || !!busy} onClick={doConnect}>{tx("连接")}</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="zt-row">
                    <span>{tx("已连接")}<b> {auth.username}</b><span className="muted">（{tx("用户号")} {auth.userID}）</span></span>
                    <Button size="small" appearance="subtle" onClick={disconnect}>{tx("断开")}</Button>
                  </div>
                  <div className="zt-grid">
                    <span className="zt-lab">{tx("文库")}</span>
                    <Dropdown size="small" expandIcon={caret} style={DD} value={curLib ? (curLib.kind === 'user' ? tx("我的文库") : curLib.label) : ''} selectedOptions={[lib]} onOptionSelect={(_, d) => setLib(d.optionValue!)} disabled={!libs.length}>
                      {libs.map((l) => <Option key={l.id} value={l.id} text={l.kind === 'user' ? tx("我的文库") : l.label}>{l.kind === 'user' ? tx("我的文库") : l.label}</Option>)}
                    </Dropdown>
                    <span className="zt-lab">{tx("收藏夹")}</span>
                    <Dropdown size="small" expandIcon={caret} style={DD} value={curCol ? curCol.name : tx("整个文库")} selectedOptions={[col]} onOptionSelect={(_, d) => setCol(d.optionValue!)} disabled={!!busy}>
                      <Option value="" text={tx("整个文库")}>{tx("整个文库")}</Option>
                      {cols.map((c) => <Option key={c.key} value={c.key} text={c.name}><span style={{ paddingLeft: c.depth * 14 }}>{c.name}</span><span className="muted"> {c.count}</span></Option>)}
                    </Dropdown>
                  </div>
                  <div className="zt-row">
                    <Checkbox size="medium" label={tx("按收藏夹名放进分组")} checked={asGroup} disabled={!col} onChange={(_, d) => setAsGroup(!!d.checked)} />
                    <span className="spacer" />
                    <Button size="small" appearance="primary" disabled={!!busy || !lib} onClick={doImport}>{tx("导入")}</Button>
                  </div>
                  <p className="field-hint muted">{tx("再点一次「导入」就是同步：已导入过的按 Zotero 条目对上、就地更新，引用键与分组不动；Zotero 里删掉的这里不删。选收藏夹只拿它直属的条目，不含子收藏夹。")}</p>
                </>
              )}
            </section>
            <section className="zt-sec">
              <h4>{tx("文件")}</h4>
              <p className="field-hint muted">{tx("Zotero 里 文件 → 导出文献库…（或右键收藏夹 → 导出收藏夹…），格式选 CSL JSON；.bib 也认。导出的是当时那一份快照，库改了要重新导。")}</p>
              <div className={`zt-drop ${drag ? 'is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void importFiles(e.dataTransfer.files); }} onClick={() => fileInput.current?.click()}>
                {tx("把文件拖到这里，或点击选择")}
                <input ref={fileInput} type="file" accept=".json,.bib,application/json,text/plain" multiple hidden onChange={(e) => { if (e.target.files?.length) void importFiles(e.target.files); e.target.value = ''; }} />
              </div>
            </section>
            {busy && <p className="zt-status muted">{busy}</p>}
            {error && <p className="zt-status zt-error">{error}</p>}
            {result && <p className="zt-status">{tx("读到 {{total}} 条：新增 {{added}}，更新 {{updated}}", result)}</p>}
          </DialogContent>
          <DialogActions><Button appearance="secondary" onClick={onClose}>{tx("关闭")}</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function describe(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m === 'forbidden') return tx("密钥不对，或没有读取这个文库的权限");
  if (m === 'notfound') return tx("找不到：密钥无效，或这个文库 / 收藏夹不存在");
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return tx("连不上 api.zotero.org（检查网络；校园网可能拦了）");
  return m;
}
