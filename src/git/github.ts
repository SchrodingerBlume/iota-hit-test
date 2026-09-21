// 跟 GitHub 同步（Git Data API：blobs → trees → commits → refs），令牌只放在这个浏览器会话里。
// 推：把本地没推过的提交按链一条条造到远端，远端头不是上次推的那个就不推（先拉）。
// 拉：远端头比上次推的新、本地又干净时，取远端那份 project.iota.json 与图片回来，本地记一条镜像提交。
import { type Repo, type Commit, type Remote, type WorkFile, commitOf, headCommit, unpushed, writeBlob, saveRepo, bytesOf, isText, readBlob } from './repo';
import { t as tx } from '../i18n';

const TOKEN_KEY = 'iota4web-github-token';
export const loadToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } };
export const saveToken = (t: string) => { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* 无所谓 */ } };

export class GitHubError extends Error { constructor(message: string, public status: number) { super(message); } }

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).message ?? msg; } catch { /* 没有正文 */ }
    throw new GitHubError(msg, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const whoami = (token: string) => api<{ login: string; name: string | null; email: string | null }>(token, '/user');
export const repoInfo = (token: string, r: Remote) => api<{ default_branch: string; html_url: string; private: boolean }>(token, `/repos/${r.owner}/${r.repo}`);

/** 远端分支头的提交 sha；分支不存在给 null */
export async function remoteHead(token: string, r: Remote): Promise<string | null> {
  try { return (await api<{ commit: { sha: string } }>(token, `/repos/${r.owner}/${r.repo}/branches/${encodeURIComponent(r.branch)}`)).commit.sha; }
  catch (e) { if (e instanceof GitHubError && e.status === 404) return null; throw e; }
}

const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0));

/** 把一条本地提交造到远端，返回远端 sha。父提交的树 GitHub 已有，只传改了的 blob（sha 一样的它认） */
async function pushOne(token: string, repo: Repo, r: Remote, c: Commit, parentSha: string | null, onStep: (s: string) => void): Promise<string> {
  const base = `/repos/${r.owner}/${r.repo}/git`;
  const parent = commitOf(repo, c.parent);
  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
  for (const [path, sha] of Object.entries(c.tree)) {
    if (parent?.tree[path] !== sha || !parentSha) {
      const blob = await readBlob(repo.project, sha);
      if (!blob) throw new Error(tx("本地缺了 {{path}} 的内容", { path: path }));
      onStep(tx("上传 {{path}}", { path: path }));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const made = await api<{ sha: string }>(token, `${base}/blobs`, { method: 'POST', body: JSON.stringify(isText(path) ? { content: new TextDecoder().decode(bytes), encoding: 'utf-8' } : { content: b64(bytes), encoding: 'base64' }) });
      if (made.sha !== sha) throw new Error(tx("{{path}} 的 sha 对不上（本地 {{v1}}，GitHub {{v2}}）", { path: path, v1: sha.slice(0, 7), v2: made.sha.slice(0, 7) }));
    }
    tree.push({ path, mode: '100644', type: 'blob', sha });
  }
  onStep(tx("造树"));
  const t = await api<{ sha: string }>(token, `${base}/trees`, { method: 'POST', body: JSON.stringify({ tree }) });
  onStep(tx("造提交"));
  const made = await api<{ sha: string }>(token, `${base}/commits`, { method: 'POST', body: JSON.stringify({ message: c.message, tree: t.sha, parents: parentSha ? [parentSha] : [], author: { name: c.author.name || 'iota4web', email: c.author.email || 'iota4web@localhost', date: new Date(c.ts).toISOString() } }) });
  return made.sha;
}

export interface PushResult { pushed: number; head: string }
export async function push(token: string, repo: Repo, r: Remote, onStep: (s: string) => void = () => {}): Promise<PushResult> {
  const chain = unpushed(repo);
  if (!chain.length) return { pushed: 0, head: headCommit(repo)?.remoteSha ?? '' };
  const remote = await remoteHead(token, r);
  const lastPushed = commitOf(repo, chain[0].parent)?.remoteSha ?? null;
  if (remote !== lastPushed) throw new Error(remote ? tx("远端分支有别处推上来的提交，先拉取") : tx("远端分支在别处被删了，换个分支名再推"));
  let parentSha = lastPushed;
  for (const c of chain) {
    parentSha = await pushOne(token, repo, r, c, parentSha, onStep);
    c.remoteSha = parentSha;
    await saveRepo(repo);
  }
  onStep(tx("更新分支"));
  const ref = `/repos/${r.owner}/${r.repo}/git/refs/heads/${r.branch}`;
  if (remote) await api(token, ref, { method: 'PATCH', body: JSON.stringify({ sha: parentSha, force: false }) });
  else await api(token, `/repos/${r.owner}/${r.repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${r.branch}`, sha: parentSha }) });
  return { pushed: chain.length, head: parentSha! };
}

export interface RemoteSnapshot { sha: string; message: string; author: { name: string; email: string; date: string }; files: WorkFile[]; tree: Record<string, string> }
/** 远端头那次提交的全部文件（文本与图片都取回来） */
export async function fetchHead(token: string, r: Remote, onStep: (s: string) => void = () => {}): Promise<RemoteSnapshot | null> {
  const sha = await remoteHead(token, r);
  if (!sha) return null;
  const base = `/repos/${r.owner}/${r.repo}`;
  const c = await api<{ sha: string; message: string; author: { name: string; email: string; date: string }; tree: { sha: string } }>(token, `${base}/git/commits/${sha}`);
  const t = await api<{ tree: { path: string; type: string; sha: string; size?: number }[]; truncated: boolean }>(token, `${base}/git/trees/${c.tree.sha}?recursive=1`);
  if (t.truncated) throw new Error(tx("仓库文件太多，一次读不完"));
  const files: WorkFile[] = [];
  const tree: Record<string, string> = {};
  for (const e of t.tree) {
    if (e.type !== 'blob') continue;
    tree[e.path] = e.sha;
    onStep(tx("读取 {{path}}", { path: e.path }));
    const b = await api<{ content: string; encoding: string }>(token, `${base}/git/blobs/${e.sha}`);
    const bytes = b.encoding === 'base64' ? unb64(b.content) : new TextEncoder().encode(b.content);
    files.push(isText(e.path) ? { path: e.path, text: new TextDecoder().decode(bytes) } : { path: e.path, bytes });
  }
  return { sha: c.sha, message: c.message, author: c.author, files, tree };
}

/** 远端那次提交在本地记一条镜像（内容存进 blob 库，remoteSha 对上） */
export async function mirror(repo: Repo, snap: RemoteSnapshot): Promise<Commit> {
  const tree: Record<string, string> = {};
  for (const f of snap.files) tree[f.path] = await writeBlob(repo.project, bytesOf(f));
  const c: Commit = { id: snap.sha, parent: repo.head, message: snap.message, author: { name: snap.author.name, email: snap.author.email }, ts: Date.parse(snap.author.date) || Date.now(), tree, remoteSha: snap.sha };
  repo.commits.push(c);
  repo.head = c.id;
  await saveRepo(repo);
  return c;
}
