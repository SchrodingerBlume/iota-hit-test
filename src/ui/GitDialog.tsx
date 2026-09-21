// Git（照 Tylina 缩成一根线）：启用后改动一目了然、写说明提交、提交历史逐条看差异、恢复到某次提交；
// 连上 GitHub 就能推到仓库、从仓库拉回来。令牌只在本次会话里。
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Button, Input } from '@fluentui/react-components';
import { useStore } from '../model/store';
import { saveImage } from '../model/persist';
import { takeSnapshot } from '../history/history';
import { loadRepo, initRepo, dropRepo, workTree, status, commit, commitChanges, docAt, headCommit, commitOf, unpushed, loadAuthor, saveAuthor, saveRepo, type Repo, type Commit, type Change, type Author, type Remote } from '../git/repo';
import { loadToken, saveToken, whoami, repoInfo, push, fetchHead, mirror, remoteHead } from '../git/github';
import { DiffView } from './DiffView';
import { t as tx } from '../i18n';

export const useGitDialog = create<{ open: boolean; set: (v: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

const fmt = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const KIND = { added: tx("新增"), modified: tx("修改"), deleted: tx("删除") } as const;

function ChangeList({ changes, sel, onSel }: { changes: Change[]; sel: string | null; onSel: (p: string) => void }) {
  return (
    <ul className="git-files">
      {changes.map((c) => <li key={c.path} className={c.path === sel ? 'on' : ''}><button type="button" onClick={() => onSel(c.path)}><span className={`git-kind is-${c.kind}`}>{KIND[c.kind]}</span><code>{c.path}</code></button></li>)}
    </ul>
  );
}
function ChangeDiff({ c }: { c: Change | undefined }) {
  if (!c) return <p className="muted">{tx("选一个文件看差异。")}</p>;
  if (c.before === undefined && c.after === undefined) return <p className="muted">{tx("二进制文件（{{kind}}）", { kind: KIND[c.kind] })}</p>;
  return <DiffView before={c.before ?? ''} after={c.after ?? ''} />;
}

export function GitDialog() {
  const open = useGitDialog((s) => s.open);
  const close = () => useGitDialog.getState().set(false);
  const doc = useStore((s) => s.doc);
  const [repo, setRepo] = useState<Repo | null | undefined>(undefined);
  const [changes, setChanges] = useState<Change[]>([]);
  const [selPath, setSelPath] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [author, setAuthor] = useState<Author>(loadAuthor);
  const [selCommit, setSelCommit] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<Change[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'changes' | 'history' | 'github'>('changes');
  // GitHub
  const [token, setToken] = useState(loadToken);
  const [login, setLogin] = useState('');
  const [remote, setRemote] = useState<Remote>({ owner: '', repo: '', branch: 'main' });
  const [remoteInfo, setRemoteInfo] = useState<{ head: string | null; url: string } | null>(null);

  const reload = async () => {
    const r = (await loadRepo(doc.id)) ?? null;
    setRepo(r);
    if (r) { setChanges(await status(r, headCommit(r), await workTree(doc))); if (r.remote) setRemote(r.remote); }
  };
  useEffect(() => { if (open) { setError(''); setSelPath(null); setSelCommit(null); void reload(); } }, [open, doc.id]);
  useEffect(() => { if (!open || !repo) return; const c = commitOf(repo, selCommit); if (!c) { setCommitFiles([]); return; } void commitChanges(repo, c).then(setCommitFiles); }, [selCommit, repo, open]);
  const run = async (label: string, fn: (step: (s: string) => void) => Promise<void>) => {
    setError(''); setBusy(label);
    try { await fn((s) => setBusy(`${label}${s ? `：${s}` : ''}`)); } catch (e) { setError(String((e as Error).message ?? e)); }
    setBusy('');
  };
  const doCommit = () => run(tx("正在提交"), async () => {
    if (!repo) return;
    if (!message.trim()) throw new Error(tx("先写一句提交说明"));
    saveAuthor(author);
    await commit(repo, await workTree(doc), message.trim(), author);
    setMessage('');
    await takeSnapshot(doc, 'git');
    await reload();
  });
  const restore = (c: Commit) => run(tx("正在恢复"), async () => {
    if (!repo) return;
    const d = await docAt(repo, c);
    if (!d) throw new Error(tx("这次提交里没有工程文件（project.iota.json）"));
    if (!window.confirm(tx("把整份工程换成「{{msg}}」那一次的？现在这份会先存进本地历史。", { msg: c.message }))) return;
    await takeSnapshot(doc, 'restore');
    useStore.getState().replaceDoc(d);
    close();
  });
  const connect = () => run(tx("正在连接"), async () => {
    const me = await whoami(token);
    setLogin(me.login);
    saveToken(token);
    if (!author.name && me.name) setAuthor((a) => ({ ...a, name: me.name ?? '' }));
    if (!remote.owner) setRemote((r) => ({ ...r, owner: me.login }));
  });
  const checkRemote = () => run(tx("正在读取仓库"), async () => {
    if (!repo) return;
    const info = await repoInfo(token, remote);
    const r = { ...remote, branch: remote.branch || info.default_branch };
    setRemote(r);
    repo.remote = r; await saveRepo(repo); setRepo({ ...repo });
    setRemoteInfo({ head: await remoteHead(token, r), url: info.html_url });
  });
  const doPush = () => run(tx("正在推送"), async (step) => {
    if (!repo || !repo.remote) throw new Error(tx("先连上仓库"));
    const r = await push(token, repo, repo.remote, step);
    setRemoteInfo((i) => (i ? { ...i, head: r.head } : i));
    await reload();
  });
  const doPull = () => run(tx("正在拉取"), async (step) => {
    if (!repo || !repo.remote) throw new Error(tx("先连上仓库"));
    if (changes.length) throw new Error(tx("工作区还有没提交的改动，先提交（或恢复）再拉"));
    if (unpushed(repo).length) throw new Error(tx("本地有没推的提交，先推上去再拉"));
    const snap = await fetchHead(token, repo.remote, step);
    if (!snap) throw new Error(tx("远端分支还不存在"));
    if (snap.sha === headCommit(repo)?.remoteSha) { setBusy(''); setError(tx("远端已经是最新的")); return; }
    const pj = snap.files.find((f) => f.path === 'project.iota.json');
    if (!pj || !('text' in pj)) throw new Error(tx("远端这次提交里没有 project.iota.json，拉不回工程"));
    const incoming = JSON.parse(pj.text);
    for (const f of snap.files) if ('bytes' in f && f.path.startsWith('images/')) await saveImage(f.path.slice(7), new Blob([f.bytes as BlobPart]), doc.id);
    await takeSnapshot(doc, 'restore');
    await mirror(repo, snap);
    useStore.getState().replaceDoc(incoming);
    setRemoteInfo((i) => (i ? { ...i, head: snap.sha } : i));
    await reload();
  });
  const pending = useMemo(() => (repo ? unpushed(repo).length : 0), [repo]);
  const head = repo ? headCommit(repo) : null;
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) close(); }}>
      <DialogSurface className="git-dialog">
        <DialogBody>
          <DialogTitle>Git</DialogTitle>
          <DialogContent>
            {repo === undefined && <p className="muted">{tx("正在读取…")}</p>}
            {repo === null && (
              <div className="git-init">
                <p>{tx("为这份工程记录有名称的提交：每次提交把 Typst 源（main.typ、refs.bib、图片）和整份工程一起记下，能看差异、能恢复，连上 GitHub 还能推到仓库。文件继续保存在这个浏览器里。")}</p>
                <Button appearance="primary" onClick={() => void run(tx("正在启用"), async () => { setRepo(await initRepo(doc.id)); await reload(); })}>{tx("启用 Git")}</Button>
              </div>
            )}
            {repo && (
              <>
                <div className="git-tabs">
                  {(['changes', 'history', 'github'] as const).map((k) => <button key={k} type="button" className={`bib-group-chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{k === 'changes' ? tx("改动") : k === 'history' ? tx("提交历史") : 'GitHub'}{k === 'changes' && changes.length ? <span className="muted"> {changes.length}</span> : null}{k === 'github' && pending ? <span className="muted"> {tx("{{n}} 未推", { n: pending })}</span> : null}</button>)}
                  <span className="spacer" />
                  <span className="muted">{busy || (head ? tx("最近提交：{{msg}}", { msg: head.message }) : tx("还没有提交"))}</span>
                </div>
                {error && <p className="zt-status zt-error">{error}</p>}
                {tab === 'changes' && (
                  <div className="git-grid">
                    <div>
                      {!changes.length ? <p className="muted">{head ? tx("所有改动已提交。新的编辑会显示在这里。") : tx("还没有提交，把现在这份提交一次吧。")}</p> : <ChangeList changes={changes} sel={selPath} onSel={setSelPath} />}
                      <div className="git-commit">
                        <Input size="small" value={message} placeholder={tx("提交说明")} onChange={(_, d) => setMessage(d.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void doCommit(); }} />
                        <div className="git-author">
                          <Input size="small" value={author.name} placeholder={tx("姓名")} onChange={(_, d) => setAuthor((a) => ({ ...a, name: d.value }))} />
                          <Input size="small" value={author.email} placeholder={tx("邮箱")} onChange={(_, d) => setAuthor((a) => ({ ...a, email: d.value }))} />
                        </div>
                        <Button size="small" appearance="primary" disabled={!!busy || (!changes.length && !!head)} onClick={() => void doCommit()}>{tx("提交")}</Button>
                        <span className="field-hint muted">{tx("提交先记在本地，推送后才到 GitHub。")}</span>
                      </div>
                    </div>
                    <div className="git-diff"><ChangeDiff c={changes.find((c) => c.path === selPath)} /></div>
                  </div>
                )}
                {tab === 'history' && (
                  <div className="git-grid">
                    <div>
                      {!repo.commits.length && <p className="muted">{tx("还没有提交。")}</p>}
                      <ul className="git-log">
                        {[...repo.commits].reverse().map((c) => (
                          <li key={c.id} className={c.id === selCommit ? 'on' : ''}>
                            <button type="button" onClick={() => { setSelCommit(c.id === selCommit ? null : c.id); setSelPath(null); }}>
                              <b>{c.message}</b>
                              <span className="muted">{c.author.name || tx("（未署名）")} · {fmt(c.ts)} · {c.remoteSha ? tx("已推送") : tx("本地")}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="git-diff">
                      {!selCommit && <p className="muted">{tx("选一条提交，看它改了哪些文件。")}</p>}
                      {selCommit && (() => { const c = commitOf(repo, selCommit)!; return (
                        <>
                          <div className="hist-actions">
                            <span className="muted">{c.remoteSha ? <a href={repo.remote ? `https://github.com/${repo.remote.owner}/${repo.remote.repo}/commit/${c.remoteSha}` : '#'} target="_blank" rel="noreferrer">{c.remoteSha.slice(0, 7)}</a> : c.id.slice(0, 7)}</span>
                            <span className="spacer" />
                            <Button size="small" onClick={() => void restore(c)}>{tx("恢复到这次提交")}</Button>
                          </div>
                          {!commitFiles.length ? <p className="muted">{tx("文件内容没有变化。")}</p> : <ChangeList changes={commitFiles} sel={selPath} onSel={setSelPath} />}
                          <ChangeDiff c={commitFiles.find((f) => f.path === selPath)} />
                        </>
                      ); })()}
                    </div>
                  </div>
                )}
                {tab === 'github' && (
                  <div className="git-github">
                    <section className="zt-sec">
                      <h4>{tx("账户")}</h4>
                      <p className="field-hint muted">{tx("到 GitHub 的 Settings → Developer settings 新建一个 fine-grained 个人访问令牌，只选这个仓库，给 Contents 读写权限。令牌只保存在当前浏览器会话里。")} <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">{tx("在 GitHub 创建令牌")}</a></p>
                      <div className="zt-row">
                        <Input size="small" type="password" value={token} placeholder={tx("个人访问令牌")} onChange={(_, d) => setToken(d.value)} style={{ flex: 1, minWidth: 240 }} />
                        <Button size="small" appearance="primary" disabled={!token.trim() || !!busy} onClick={() => void connect()}>{login ? tx("重新连接") : tx("连接 GitHub")}</Button>
                        {login && <span>{tx("已连接")} <b>{login}</b></span>}
                        {login && <Button size="small" appearance="subtle" onClick={() => { setToken(''); saveToken(''); setLogin(''); }}>{tx("断开")}</Button>}
                      </div>
                    </section>
                    <section className="zt-sec">
                      <h4>{tx("仓库")}</h4>
                      <div className="zt-row">
                        <Input size="small" value={remote.owner} placeholder={tx("用户或组织")} onChange={(_, d) => setRemote((r) => ({ ...r, owner: d.value.trim() }))} style={{ width: 150 }} />
                        <span>/</span>
                        <Input size="small" value={remote.repo} placeholder={tx("仓库名")} onChange={(_, d) => setRemote((r) => ({ ...r, repo: d.value.trim() }))} style={{ width: 170 }} />
                        <Input size="small" value={remote.branch} placeholder={tx("分支")} onChange={(_, d) => setRemote((r) => ({ ...r, branch: d.value.trim() }))} style={{ width: 110 }} />
                        <Button size="small" disabled={!token.trim() || !remote.owner || !remote.repo || !!busy} onClick={() => void checkRemote()}>{tx("连上仓库")}</Button>
                      </div>
                      {remoteInfo && <p className="field-hint muted">{remoteInfo.head ? tx("远端分支头 {{sha}}", { sha: remoteInfo.head.slice(0, 7) }) : tx("远端分支还不存在，第一次推送会建")} · <a href={remoteInfo.url} target="_blank" rel="noreferrer">{tx("在 GitHub 打开")}</a></p>}
                      <div className="zt-row">
                        <Button size="small" appearance="primary" disabled={!repo.remote || !token.trim() || !pending || !!busy} onClick={() => void doPush()}>{tx("推送")}{pending ? ` (${pending})` : ''}</Button>
                        <Button size="small" disabled={!repo.remote || !token.trim() || !!busy} onClick={() => void doPull()}>{tx("拉取")}</Button>
                        <span className="field-hint muted">{tx("推：本地没推过的提交按顺序造到远端，远端有别处的新提交就先拉。拉：远端更新时取回整份工程与图片、本地记一条镜像提交，工作区得先干净。")}</span>
                      </div>
                    </section>
                    <section className="zt-sec">
                      <Button size="small" appearance="subtle" onClick={() => void run(tx("正在停用"), async () => { if (window.confirm(tx("停用 Git 会删掉这个工程在本机的全部提交记录（GitHub 上的不动）。确定？"))) { await dropRepo(doc.id); setRepo(null); } })}>{tx("停用 Git")}</Button>
                    </section>
                  </div>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions><Button appearance="secondary" onClick={close}>{tx("关闭")}</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
