// 浏览器里的 Git（照 Tylina 的路子，缩成一根线）：每个工程一个仓库，提交链与文件内容都在 IndexedDB 里，
// 不分支、不暂存——一次提交把工作树的全部改动记下来。工作树 = 导出的 Typst 源（main.typ、refs.bib、
// images/…）+ project.iota.json（整份工程，拉回来能原样打开）。blob 的 sha 照 git 的算法算，推到 GitHub
// 时同一个 sha 直接对得上。
import { kv, loadImage } from '../model/persist';
import type { ThesisDoc } from '../model/types';
import { serializeProject } from '../typst/serialize';

export interface Author { name: string; email: string }
export interface Commit {
  id: string;
  parent: string | null;
  message: string;
  author: Author;
  ts: number;
  /** 路径 → blob sha */
  tree: Record<string, string>;
  /** 推到 GitHub 后那边的提交 sha */
  remoteSha?: string;
}
export interface Remote { owner: string; repo: string; branch: string }
export interface Repo {
  project: string;
  commits: Commit[];
  head: string | null;
  remote?: Remote;
}
export type WorkFile = { path: string; text: string } | { path: string; bytes: Uint8Array };
export interface Change { path: string; kind: 'added' | 'modified' | 'deleted'; before?: string; after?: string }

const repoKey = (project: string) => `${project}/repo`;
const blobKey = (project: string, sha: string) => `${project}/blob/${sha}`;
export const isText = (path: string) => /\.(typ|bib|json|md|txt|csv|yml|yaml|toml)$/i.test(path);

const enc = new TextEncoder();
export const bytesOf = (f: WorkFile): Uint8Array => ('text' in f ? enc.encode(f.text) : f.bytes);
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
/** git 的 blob sha：sha1("blob <字节数>\0" + 内容) */
export async function blobSha(bytes: Uint8Array): Promise<string> {
  const head = enc.encode(`blob ${bytes.byteLength}\0`);
  const all = new Uint8Array(head.byteLength + bytes.byteLength);
  all.set(head); all.set(bytes, head.byteLength);
  return hex(await crypto.subtle.digest('SHA-1', all));
}
const commitId = async (c: Omit<Commit, 'id'>) => hex(await crypto.subtle.digest('SHA-1', enc.encode(JSON.stringify([c.parent, c.message, c.author, c.ts, c.tree]))));

export const loadRepo = (project: string) => kv.get<Repo>('git', repoKey(project));
export const saveRepo = (repo: Repo) => kv.set('git', repoKey(repo.project), repo);
export async function initRepo(project: string): Promise<Repo> {
  const repo: Repo = { project, commits: [], head: null };
  await saveRepo(repo);
  return repo;
}
export async function dropRepo(project: string) {
  for (const k of (await kv.keys('git')).map(String)) if (k.startsWith(project + '/')) await kv.del('git', k);
}
export const headCommit = (repo: Repo) => repo.commits.find((c) => c.id === repo.head) ?? null;
export const commitOf = (repo: Repo, id: string | null) => (id ? repo.commits.find((c) => c.id === id) ?? null : null);

export const readBlob = (project: string, sha: string) => kv.get<Blob>('git', blobKey(project, sha));
export async function readBlobText(project: string, sha: string): Promise<string | null> { const b = await readBlob(project, sha); return b ? b.text() : null; }
export async function writeBlob(project: string, bytes: Uint8Array): Promise<string> {
  const sha = await blobSha(bytes);
  if (!(await kv.get('git', blobKey(project, sha)))) await kv.set('git', blobKey(project, sha), new Blob([bytes as BlobPart]));
  return sha;
}

/** 当前工程折成工作树里的文件 */
export async function workTree(doc: ThesisDoc): Promise<WorkFile[]> {
  const p = serializeProject(doc);
  const files: WorkFile[] = [{ path: 'main.typ', text: p.main }];
  for (const [name, text] of Object.entries(p.files)) files.push({ path: name, text });
  for (const name of p.images) {
    const blob = await loadImage(name);
    if (blob) files.push({ path: `images/${name}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  files.push({ path: 'project.iota.json', text: JSON.stringify(doc, null, 1) });
  return files;
}

/** 工作树对着某个提交的树：加了 / 改了 / 删了哪些，文本文件带前后内容 */
export async function status(repo: Repo, base: Commit | null, files: WorkFile[]): Promise<Change[]> {
  const out: Change[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    seen.add(f.path);
    const sha = await blobSha(bytesOf(f));
    const old = base?.tree[f.path];
    if (old === sha) continue;
    const after = 'text' in f ? f.text : undefined;
    out.push({ path: f.path, kind: old ? 'modified' : 'added', before: old && isText(f.path) ? (await readBlobText(repo.project, old)) ?? undefined : undefined, after });
  }
  for (const path of Object.keys(base?.tree ?? {})) if (!seen.has(path)) out.push({ path, kind: 'deleted', before: isText(path) ? (await readBlobText(repo.project, base!.tree[path])) ?? undefined : undefined });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function commit(repo: Repo, files: WorkFile[], message: string, author: Author): Promise<Commit> {
  const tree: Record<string, string> = {};
  for (const f of files) tree[f.path] = await writeBlob(repo.project, bytesOf(f));
  const body = { parent: repo.head, message, author, ts: Date.now(), tree };
  const c: Commit = { id: await commitId(body), ...body };
  repo.commits.push(c);
  repo.head = c.id;
  await saveRepo(repo);
  return c;
}

/** 某个提交跟它父提交比改了哪些文件 */
export async function commitChanges(repo: Repo, c: Commit): Promise<Change[]> {
  const parent = commitOf(repo, c.parent);
  const out: Change[] = [];
  const text = async (sha: string | undefined, path: string) => (sha && isText(path) ? (await readBlobText(repo.project, sha)) ?? undefined : undefined);
  for (const [path, sha] of Object.entries(c.tree)) {
    const old = parent?.tree[path];
    if (old === sha) continue;
    out.push({ path, kind: old ? 'modified' : 'added', before: await text(old, path), after: await text(sha, path) });
  }
  for (const path of Object.keys(parent?.tree ?? {})) if (!(path in c.tree)) out.push({ path, kind: 'deleted', before: await text(parent!.tree[path], path) });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** 提交里存的那份工程 */
export async function docAt(repo: Repo, c: Commit): Promise<ThesisDoc | null> {
  const sha = c.tree['project.iota.json'];
  if (!sha) return null;
  try { const t = await readBlobText(repo.project, sha); return t ? (JSON.parse(t) as ThesisDoc) : null; } catch { return null; }
}

/** 还没推到远端的提交（从最后一个带 remoteSha 的之后数） */
export function unpushed(repo: Repo): Commit[] {
  const chain: Commit[] = [];
  for (let c = headCommit(repo); c && !c.remoteSha; c = commitOf(repo, c.parent)) chain.unshift(c);
  return chain;
}

const AUTHOR_KEY = 'iota4web-git-author';
export const loadAuthor = (): Author => { try { return { name: '', email: '', ...JSON.parse(localStorage.getItem(AUTHOR_KEY) ?? '{}') }; } catch { return { name: '', email: '' }; } };
export const saveAuthor = (a: Author) => { try { localStorage.setItem(AUTHOR_KEY, JSON.stringify(a)); } catch { /* 无所谓 */ } };
