// 固定当前 webR 仓库的语言服务依赖，作为本站可选下载资源；不在首页预载。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const exec = promisify(execFile), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/rplot/language'), repo = 'https://repo.r-wasm.org/bin/emscripten/contrib/4.6/';
const fetchBytes = async (url) => (await exec('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '90', '--retry', '2', '--retry-all-errors', '--retry-delay', '1', url], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })).stdout;
async function fetchArchive(url) {
  const head = await exec('curl', ['--fail', '--location', '--silent', '--show-error', '--head', '--max-time', '30', url], { encoding: 'utf8' });
  const size = Number([...head.stdout.matchAll(/^content-length:\s*(\d+)/gmi)].at(-1)?.[1]);
  if (!size || size <= 4 * 1024 * 1024) return fetchBytes(url);
  const step = 1024 * 1024, parts = new Array(Math.ceil(size / step)), queue = Array.from({ length: parts.length }, (_, i) => i);
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const i = queue.shift(), start = i * step, end = Math.min(size - 1, start + step - 1);
      const { stdout } = await exec('curl', ['--fail', '--location', '--silent', '--show-error', '--range', `${start}-${end}`, '--max-time', '60', '--retry', '2', '--retry-all-errors', '--retry-delay', '1', url], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
      if (stdout.length !== end - start + 1) throw new Error(`Range 长度错误：${url}`);
      parts[i] = stdout;
    }
  }));
  return Buffer.concat(parts);
}
const index = new Map();
const buffer = await fetchBytes(repo + 'PACKAGES.gz');
const text = (buffer[0] === 31 ? gunzipSync(buffer) : buffer).toString('utf8');
for (const block of text.split(/\n\s*\n/)) {
  const record = {}; let key = '';
  for (const line of block.split('\n')) {
    if (/^\s/.test(line) && key) record[key] += ' ' + line.trim();
    else { const m = /^([^:]+):\s*(.*)$/.exec(line); if (m) { key = m[1]; record[key] = m[2]; } }
  }
  if (record.Package) index.set(record.Package, record);
}
const core = JSON.parse(await fs.readFile(path.join(root, 'public/rplot/PACKAGES.json'), 'utf8'));
const available = new Set([...core.map(p => p.name), 'R', 'base', 'compiler', 'datasets', 'graphics', 'grDevices', 'grid', 'methods', 'parallel', 'splines', 'stats', 'stats4', 'tools', 'utils']);
const selected = new Map();
function visit(name) {
  if (available.has(name) || selected.has(name)) return;
  const p = index.get(name); if (!p) throw new Error(`仓库缺少 ${name}`); selected.set(name, p);
  for (const field of ['Depends', 'Imports', 'LinkingTo']) for (const dep of (p[field] ?? '').split(',').map(s => s.replace(/\s*\([^)]*\)/g, '').trim()).filter(Boolean)) visit(dep);
}
// patchwork 也按需下载，供多面板图使用，不作为 LSP 启用时的必下载项。
visit('languageserver'); visit('patchwork');
await fs.mkdir(out, { recursive: true });
const existing = await fs.readdir(out);
const packages = [], queue = [...selected.values()];
async function worker() {
  while (queue.length) {
    const p = queue.shift(), filename = p.File || `${p.Package}_${p.Version}.tgz`;
    if (!/^[\w.+-]+\.tgz$/.test(filename)) throw new Error(`无效文件名 ${filename}`);
    const cached = existing.find(n => n.startsWith(`${p.Package}_${p.Version}-`) && n.endsWith('.tgz'));
    let bytes = cached ? await fs.readFile(path.join(out, cached)) : null;
    if (!bytes || (p.MD5sum && createHash('md5').update(bytes).digest('hex') !== p.MD5sum)) bytes = await fetchArchive(repo + filename);
    if (p.MD5sum && createHash('md5').update(bytes).digest('hex') !== p.MD5sum) throw new Error(`仓库校验失败：${p.Package}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const local = `${p.Package}_${p.Version}-${hash.slice(0, 12)}.tgz`;
    await fs.writeFile(path.join(out, local), bytes);
    const record = { ...p, IotaLocalFile: local, IotaSHA256: hash, SourceURL: `https://cran.r-project.org/src/contrib/${p.Package}_${p.Version}.tar.gz`, SourceArchiveURL: `https://cran.r-project.org/src/contrib/Archive/${p.Package}/${p.Package}_${p.Version}.tar.gz` };
    // 另提供 copyleft 包的对应源码；包内原始 LICENSE/COPYING 仍原样保留在二进制包中。
    if (/GPL|LGPL/.test(p.License)) {
      const sourceName = `${p.Package}_${p.Version}-source.tar.gz`;
      let source;
      try { source = await fs.readFile(path.join(out, sourceName)); }
      catch { try { source = await fetchBytes(record.SourceURL); } catch { source = await fetchBytes(record.SourceArchiveURL); } }
      await fs.writeFile(path.join(out, sourceName), source); record.IotaSourceFile = sourceName;
    }
    packages.push(record); console.log(`${packages.length}/${selected.size} ${p.Package} ${p.Version} ${(bytes.length / 1048576).toFixed(2)} MB`);
  }
}
await Promise.all([worker(), worker()]);
packages.sort((a, b) => a.Package.localeCompare(b.Package));
await fs.writeFile(path.join(out, 'PACKAGES.json'), JSON.stringify({ webr: '0.6.1', r: '4.6', repo, packages }, null, 2) + '\n');
await fs.writeFile(path.join(out, 'THIRD-PARTY.txt'), '可选 R 语言服务与多面板绘图依赖\n二进制原样来自 repo.r-wasm.org；包内 DESCRIPTION / LICENSE / COPYING 保留原始许可。\n浏览器适配位于 src/rplot/language-service.R。本站文件均位于 rplot/language/。\n\n' + packages.map(p => `${p.Package} ${p.Version}\nLicense: ${p.License}\nBinary: ${repo}${p.File || `${p.Package}_${p.Version}.tgz`}\nSource: ${p.IotaSourceFile ? `rplot/language/${p.IotaSourceFile}` : `${p.SourceURL} (archive: ${p.SourceArchiveURL})`}\nSHA256: ${p.IotaSHA256}`).join('\n\n') + '\n');
console.log('Optional R language packages vendored.');
