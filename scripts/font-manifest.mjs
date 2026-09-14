// 生成 public/fonts/manifest.json：每个字体文件的大小与 typst.ts 的 font info。
// 带 info 的字体可以*懒加载*——编译器先只拿到度量信息登记进字体表，
// 真用到哪一个字面再去取字节。机制留着，但眼下一个都不懒：iota-hit 开机探针会
// 逐个字面量粗体（判「有没有真粗面」），两副 Noto CJK 粗体每次都被拉下来，
// 懒加载省不到流量，反而走同步 XHR、没进度条、也不进 Cache API。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTypstFontBuilder } from '@myriaddreamin/typst.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fontDir = path.join(root, 'public', 'fonts');
const wasmPath = path.join(root, 'vendor', 'typst-ts-web-compiler', 'typst_ts_web_compiler_bg.wasm');

// 哪些懒加载：大而少用
const LAZY = new Set([]);

const fb = createTypstFontBuilder();
await fb.init({ getModule: () => new Uint8Array(fs.readFileSync(wasmPath)) });

const files = fs.readdirSync(fontDir).filter((f) => /\.(otf|ttf)$/i.test(f)).sort();
const fonts = [];
for (const file of files) {
  const buf = new Uint8Array(fs.readFileSync(path.join(fontDir, file)));
  // getFontInfo 给的是 { info: [...], conditions: [...] }；懒字体对象要把这两个键摊平在顶层，再加 url
  const info = await fb.getFontInfo(buf);
  fonts.push({ file, size: buf.length, lazy: LAZY.has(file), info });
  console.log(`${file}  ${(buf.length / 1024 / 1024).toFixed(1)} MB  ${LAZY.has(file) ? '(lazy)' : ''}`);
}
fs.writeFileSync(path.join(fontDir, 'manifest.json'), JSON.stringify({ fonts }, null, 1));
const eager = fonts.filter((f) => !f.lazy).reduce((s, f) => s + f.size, 0);
console.log(`首次下载 ${(eager / 1024 / 1024).toFixed(1)} MB，懒加载 ${((fonts.reduce((s, f) => s + f.size, 0) - eager) / 1024 / 1024).toFixed(1)} MB`);
