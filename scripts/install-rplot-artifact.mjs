// gh run download ... 解压后的 artifact 根目录作为唯一参数。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = process.argv[2];
if (!artifact) throw new Error('用法：node scripts/install-rplot-artifact.mjs <artifact目录>');
const out = path.join(root, 'public/rplot');
await fs.mkdir(out, { recursive: true });
for (const name of ['library.data', 'library.js.metadata']) await fs.copyFile(path.join(artifact, '_r-wasm-image', name), path.join(out, name));
const data = await fs.readFile(path.join(out, 'library.data'));
let versions = {};
try { versions = JSON.parse(await fs.readFile(path.join(out, 'VERSIONS.json'), 'utf8')); } catch { /* 首次安装 */ }
await fs.writeFile(path.join(out, 'VERSIONS.json'), JSON.stringify({ ...versions, webr: '0.6.1', cetzDevice: '0.5.3.1', cetz: '0.5.3', libraryHash: createHash('sha256').update(data).digest('hex') }, null, 2) + '\n');
const metadata = JSON.parse(await fs.readFile(path.join(out, 'library.js.metadata'), 'utf8'));
const packages = [];
const notices = ['R/Wasm 绘图随站分发的 R 包', '原始来源：cetzDevice 固定提交 cd8cdd701dd209757aceca22a3564a760c5b09a8；其余包来自 repo.r-wasm.org。', 'cetzDevice 源码随站提供：cetzDevice-0.5.3.1-source.tar.gz。浏览器字体测量适配在仓库 src/rplot/adapter.R。', 'This product includes color specifications and designs developed by Cynthia Brewer (http://colorbrewer.org/).', ''];
for (const f of metadata.files) {
  if (!/^\/[^/]+\/DESCRIPTION$/.test(f.filename)) continue;
  const description = data.subarray(f.start, f.end).toString('utf8').replace(/\n[ \t]+/g, ' ');
  const fields = Object.fromEntries(description.split('\n').filter((l) => l.includes(':')).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
  packages.push({ name: fields.Package, version: fields.Version, license: fields.License, author: fields.Author, url: fields.URL });
  notices.push(`${fields.Package} ${fields.Version}\nLicense: ${fields.License}\nAuthor: ${fields.Author ?? fields['Authors@R'] ?? ''}\nSource: ${fields.URL ?? 'https://cran.r-project.org/package=' + fields.Package}\n`);
}
for (const f of metadata.files) {
  if (/\/(LICENSE|LICENCE|COPYING|COPYRIGHTS|GPL-[23])(?:\.(?:txt|md))?$/i.test(f.filename)) notices.push(`${f.filename}\n${'-'.repeat(60)}\n${data.subarray(f.start, f.end).toString('utf8').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '')}\n`);
}
await fs.writeFile(path.join(out, 'PACKAGES.json'), JSON.stringify(packages, null, 2) + '\n');
await fs.writeFile(path.join(out, 'THIRD-PARTY.txt'), notices.join('\n').trimEnd() + '\n');
console.log('Installed cetzDevice 0.5.3.1 Wasm library image');
