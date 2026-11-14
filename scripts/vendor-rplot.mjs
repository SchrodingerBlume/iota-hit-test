// 固定版本 webR 随站分发；不依赖第三方 CDN 在用户打开绘图窗口时可用。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/rplot');
await fs.mkdir(out, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'iota-rplot-'));
try {
  const r = await fetch('https://registry.npmjs.org/webr/-/webr-0.6.1.tgz');
  if (!r.ok) throw new Error(`webR download: ${r.status}`);
  const archive = path.join(temp, 'webr.tgz');
  await fs.writeFile(archive, new Uint8Array(await r.arrayBuffer()));
  execFileSync('tar', ['xzf', archive, '-C', temp]);
  await fs.cp(path.join(temp, 'package/dist'), path.join(out, 'webr'), {
    recursive: true,
    filter: (file) => !file.endsWith('.d.ts') && !file.endsWith('.map') && !/\/(tests|repl|webR)($|\/)/.test(file),
  });
  await fs.copyFile(path.join(temp, 'package/LICENSE.md'), path.join(out, 'WEBR-LICENSE.md'));
  const source = await fetch('https://api.github.com/repos/SchrodingerBlume/cetzDevice/tarball/cd8cdd701dd209757aceca22a3564a760c5b09a8');
  if (!source.ok) throw new Error(`cetzDevice source: ${source.status}`);
  await fs.writeFile(path.join(out, 'cetzDevice-0.5.3.1-source.tar.gz'), new Uint8Array(await source.arrayBuffer()));
  await fs.writeFile(path.join(out, 'VERSIONS.json'), JSON.stringify({ webr: '0.6.1', cetzDevice: '0.5.3.1', cetz: '0.5.3', source: 'cd8cdd701dd209757aceca22a3564a760c5b09a8' }, null, 2) + '\n');
  console.log('Vendored webR 0.6.1 and cetzDevice 0.5.3.1 source');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
