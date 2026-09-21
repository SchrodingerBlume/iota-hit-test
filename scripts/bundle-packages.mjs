// 把 iota-hit 与它的全部依赖包（递归闭包）打成 tar.gz，放进 public/packages/。
// 浏览器端的编译器从这里取包，不碰 packages.typst.org——整站静态、离线可用。
//
// 来源（只读，模板本身一个字都不改）：
//   iota-hit           IOTA_HIT 环境变量，默认 ../iota-hit
//   @local/*           ~/Library/Application Support/typst/packages/local/<name>/<version>
//   @preview/*         ~/Library/Caches/typst/packages/preview/<name>/<version>
//                      或 ~/Library/Application Support/typst/packages/preview/…
//                      本机没有的从 packages.typst.org 下载
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import { execFileSync } from 'node:child_process';
import { templateRev } from './template-rev.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'public', 'packages');
const iotaDir = path.resolve(process.env.IOTA_HIT ?? path.join(root, '..', 'iota-hit'));

const home = os.homedir();
const dataDir = path.join(home, 'Library', 'Application Support', 'typst', 'packages');
const cacheDir = path.join(home, 'Library', 'Caches', 'typst', 'packages');

// 包里不该带进浏览器的东西：测试、PDF、图片样张、构建脚本
const EXCLUDE_DIRS = new Set(['tests', '.git', '.github', '__pycache__', 'bench', 'ci', '_probe', '.backup', 'easy-zh-manual', 'docs', 'examples', 'gallery', 'thumbnail', 'thumbnails', 'test', 'assets/test']);
const EXCLUDE_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.DS_Store', '.pyc', '.py', '.sh', '.zip']);

// 打包时模板的版本号（提交号，工作区有未提交改动再接内容哈希），给「模板更新了没」的检查用
function gitHead(dir) {
  try { return templateRev(dir); } catch { return null; }
}

function walk(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    const rel = path.relative(base, p);
    if (ent.isDirectory()) {
      if (EXCLUDE_DIRS.has(ent.name) || EXCLUDE_DIRS.has(rel)) continue;
      walk(p, base, out);
    } else if (ent.isFile()) {
      if (ent.name === '.DS_Store' || ent.name === '.gitignore') continue;
      if (EXCLUDE_EXT.has(path.extname(ent.name))) continue;
      out.push(rel);
    }
  }
  return out;
}

const IMPORT_RE = /@(preview|local)\/([A-Za-z0-9_-]+):(\d+\.\d+\.\d+)/g;

function scanImports(dir, files) {
  const specs = new Set();
  for (const rel of files) {
    if (!rel.endsWith('.typ')) continue;
    const src = fs.readFileSync(path.join(dir, rel), 'utf8');
    for (const line of src.split('\n')) {
      // 只认真正的 import / include 语句（行首，可带缩进），注释与报错字符串里写的包名不算
      const code = line.replace(/\/\/.*$/, '');
      if (!/^\s*#?(import|include)\s+"@/.test(code)) continue;
      for (const m of code.matchAll(IMPORT_RE)) specs.add(`${m[1]}/${m[2]}/${m[3]}`);
    }
  }
  return specs;
}

async function locate(ns, name, version) {
  const candidates = [
    path.join(dataDir, ns, name, version),
    path.join(cacheDir, ns, name, version),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, 'typst.toml'))) return c;
  if (ns !== 'preview') throw new Error(`找不到 @${ns}/${name}:${version}`);
  // 本机没有：从官方仓库下载并解到缓存目录
  const url = `https://packages.typst.org/preview/${name}-${version}.tar.gz`;
  console.log(`  下载 ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${url}: ${res.status}`);
  const target = path.join(cacheDir, ns, name, version);
  fs.mkdirSync(target, { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `${name}-${version}.tar.gz`);
  fs.writeFileSync(tmp, buf);
  await tar.x({ file: tmp, cwd: target });
  return target;
}

async function pack(ns, name, version, dir) {
  const files = walk(dir);
  const outName = `${ns}-${name}-${version}.tar.gz`;
  const outPath = path.join(outDir, outName);
  await tar.c({ gzip: true, file: outPath, cwd: dir, portable: true, mtime: new Date(0) }, files);
  const size = fs.statSync(outPath).size;
  const sha = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex').slice(0, 12);
  console.log(`  ${outName}  ${(size / 1024).toFixed(0)} KB  (${files.length} 个文件)`);
  return { namespace: ns, name, version, file: outName, size, sha, deps: scanImports(dir, files) };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (f.endsWith('.tar.gz') || f === 'manifest.json') fs.unlinkSync(path.join(outDir, f));

  const toml = fs.readFileSync(path.join(iotaDir, 'typst.toml'), 'utf8');
  const iotaVersion = /version\s*=\s*"([^"]+)"/.exec(toml)[1];
  console.log(`iota-hit ${iotaVersion} ← ${iotaDir}`);

  const manifest = [];
  const seen = new Set();
  const queue = [];

  const first = await pack('local', 'iota-hit', iotaVersion, iotaDir);
  manifest.push(first);
  seen.add(`local/iota-hit/${iotaVersion}`);
  for (const d of first.deps) queue.push(d);

  while (queue.length) {
    const spec = queue.shift();
    if (seen.has(spec)) continue;
    seen.add(spec);
    const [ns, name, version] = spec.split('/');
    const dir = await locate(ns, name, version);
    const entry = await pack(ns, name, version, dir);
    manifest.push(entry);
    for (const d of entry.deps) if (!seen.has(d)) queue.push(d);
  }

  const total = manifest.reduce((s, m) => s + m.size, 0);
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({ iotaHit: iotaVersion, iotaHitCommit: gitHead(iotaDir), packages: manifest.map(({ deps, ...m }) => m) }, null, 2),
  );
  console.log(`共 ${manifest.length} 个包，${(total / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
