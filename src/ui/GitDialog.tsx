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
  if (!c) return <p className="muted">{tx("选择文件以查看差异。")}</p>;
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
    if (!message.trim()) throw new Error(tx("请输入提交说明"));
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
    if (!window.confirm(tx("是否恢复到提交「{{msg}}」？当前工程会先保存到本地历史。", { msg: c.message }))) return;
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
    if (!repo || !repo.remote) throw new Error(tx("请先连接仓库"));
    const r = await push(token, repo, repo.remote, step);
    setRemoteInfo((i) => (i ? { ...i, head: r.head } : i));
    await reload();
  });
  const doPull = () => run(tx("正在拉取"), async (step) => {
    if (!repo || !repo.remote) throw new Error(tx("请先连接仓库"));
    if (changes.length) throw new Error(tx("工作区有未提交的改动，请提交或恢复后再拉取"));
    if (unpushed(repo).length) throw new Error(tx("本地有尚未推送的提交，请先推送再拉取"));
    const snap = await fetchHead(token, repo.remote, step);
    if (!snap) throw new Error(tx("远端分支还不存在"));
    if (snap.sha === headCommit(repo)?.remoteSha) { setBusy(''); setError(tx("远端已经是最新的")); return; }
    const pj = snap.files.find((f) => f.path === 'project.iota.json');
    if (!pj || !('text' in pj)) throw new Error(tx("远端提交中缺少 project.iota.json，无法拉取工程"));
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
                <p>{tx("启用后可为工程创建提交、查看差异并恢复版本。提交包含 Typst 源文件、图片和完整工程；连接 GitHub 后可推送到远端。文件仍保存在当前浏览器中。")}</p>
                <Button appearance="primary" onClick={() => void run(tx("正在启用"), async () => { setRepo(await initRepo(doc.id)); await reload(); })}>{tx("启用 Git")}</Button>
              </div>
            )}
            {repo && (
              <>
                <div className="git-tabs">
                  {(['changes', 'history', 'github'] as const).map((k) => <button key={k} type="button" className={`bib-group-chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{k === 'changes' ? tx("改动") : k === 'history' ? tx("提交历史") : 'GitHub'}{k === 'changes' && changes.length ? <span className="muted"> {changes.length}</span> : null}{k === 'github' && pending ? <span className="muted"> {tx("{{n}} 个未推送", { n: pending })}</span> : null}</button>)}
                  <span className="spacer" />
                  <span className="muted">{busy || (head ? tx("最近提交：{{msg}}", { msg: head.message }) : tx("暂无提交"))}</span>
                </div>
                {error && <p className="zt-status zt-error">{error}</p>}
                {tab === 'changes' && (
                  <div className="git-grid">
                    <div>
                      {!changes.length ? <p className="muted">{head ? tx("所有改动已提交。新的编辑会显示在这里。") : tx("暂无提交。可提交当前工程。")}</p> : <ChangeList changes={changes} sel={selPath} onSel={setSelPath} />}
                      <div className="git-commit">
                        <Input size="small" value={message} placeholder={tx("提交说明")} onChange={(_, d) => setMessage(d.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void doCommit(); }} />
                        <div className="git-author">
                          <Input size="small" value={author.name} placeholder={tx("姓名")} onChange={(_, d) => setAuthor((a) => ({ ...a, name: d.value }))} />
                          <Input size="small" value={author.email} placeholder={tx("邮箱")} onChange={(_, d) => setAuthor((a) => ({ ...a, email: d.value }))} />
                        </div>
                        <Button size="small" appearance="primary" disabled={!!busy || (!changes.length && !!head)} onClick={() => void doCommit()}>{tx("提交")}</Button>
                        <span className="field-hint muted">{tx("提交先保存在本地，推送后才会上传到 GitHub。")}</span>
                      </div>
                    </div>
                    <div className="git-diff"><ChangeDiff c={changes.find((c) => c.path === selPath)} /></div>
                  </div>
                )}
                {tab === 'history' && (
                  <div className="git-grid">
                    <div>
                      {!repo.commits.length && <p className="muted">{tx("暂无提交。")}</p>}
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
                      {!selCommit && <p className="muted">{tx("选择提交以查看文件差异。")}</p>}
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
                      <p className="field-hint muted">{tx("在 GitHub 的 Settings → Developer settings 中创建 fine-grained 个人访问令牌，仅授权当前仓库的 Contents 读写权限。令牌只保存在当前浏览器会话中。")} <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">{tx("在 GitHub 创建令牌")}</a></p>
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
                        <Button size="small" disabled={!token.trim() || !remote.owner || !remote.repo || !!busy} onClick={() => void checkRemote()}>{tx("连接仓库")}</Button>
                      </div>
                      {remoteInfo && <p className="field-hint muted">{remoteInfo.head ? tx("远端分支头 {{sha}}", { sha: remoteInfo.head.slice(0, 7) }) : tx("远端分支不存在，将在首次推送时创建")} · <a href={remoteInfo.url} target="_blank" rel="noreferrer">{tx("在 GitHub 打开")}</a></p>}
                      <div className="zt-row">
                        <Button size="small" appearance="primary" disabled={!repo.remote || !token.trim() || !pending || !!busy} onClick={() => void doPush()}>{tx("推送")}{pending ? ` (${pending})` : ''}</Button>
                        <Button size="small" disabled={!repo.remote || !token.trim() || !!busy} onClick={() => void doPull()}>{tx("拉取")}</Button>
                        <span className="field-hint muted">{tx("推送会依次上传本地提交；远端有新提交时需先拉取。拉取会恢复远端工程和图片，并在本地创建镜像提交；操作前需提交或恢复工作区改动。")}</span>
                      </div>
                    </section>
                    <section className="zt-sec">
                      <Button size="small" appearance="subtle" onClick={() => void run(tx("正在停用"), async () => { if (window.confirm(tx("停用 Git 将删除此工程的全部本地提交记录，GitHub 上的提交不受影响。是否继续？"))) { await dropRepo(doc.id); setRepo(null); } })}>{tx("停用 Git")}</Button>
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
