// 只修复打包快照，不改写正在独立开发的 iota-hit 源码工作区。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';

export async function applyIotaCompatibility(file) {
  const dir = fs.mkdtempSync(path.join(process.env.PACKAGE_PATCH_TMP || os.tmpdir(), 'iota-package-fix-'));
  try {
    const files = [];
    await tar.t({ file, onReadEntry(e) { if (e.type === 'File') files.push(e.path); } });
    await tar.x({ file, cwd: dir });
    const axes = path.join(dir, 'src/axes.typ');
    const source = fs.readFileSync(axes, 'utf8');
    const mark = '// iota4web: degree-type none';
    if (source.includes(mark)) return ['degree-type-none'];
    const loop = '  for (axis, value) in variant {\n';
    const guard = '    if axis == "degree-type" and value == none { continue }\n';
    if (!source.includes(loop) || !source.includes('by-axis.at(value, default: value)') || source.includes(guard)) return [];
    fs.writeFileSync(axes, source.replace(loop, `${loop}    ${mark}：隐藏类别时省略该轴，不把 none 当成字典键。\n${guard}`));
    await tar.c({ file, cwd: dir, gzip: true, portable: true, mtime: new Date(0) }, files);
    return ['degree-type-none'];
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const root = path.resolve(path.dirname(self), '..');
  const manifestFile = path.join(root, 'public/packages/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  const pkg = manifest.packages.find(p => p.namespace === 'local' && p.name === 'iota-hit');
  const file = path.join(root, 'public/packages', pkg.file);
  const patches = await applyIotaCompatibility(file);
  const bytes = fs.readFileSync(file);
  Object.assign(pkg, { size: bytes.length, sha: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12), ...(patches.length ? { patches } : {}) });
  manifest.iotaHitPatches = patches;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`iota-hit compatibility patches: ${patches.join(', ') || 'none needed'}`);
}
