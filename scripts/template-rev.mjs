// 模板工作树的版本号：提交号；有未提交改动时再接一截内容哈希（git diff HEAD 与未跟踪文件），
// 光标 -dirty 看不出树里又改了什么，打包前后比不出差别
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function templateRev(dir) {
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const head = git('rev-parse', '--short', 'HEAD').trim();
  const status = git('status', '--porcelain', '-z');
  if (!status.trim()) return head;
  const h = crypto.createHash('sha1').update(git('diff', 'HEAD'));
  for (const f of git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).sort()) {
    h.update(f);
    try { h.update(fs.readFileSync(path.join(dir, f))); } catch { /* 目录或读不了的 */ }
  }
  return `${head}-dirty-${h.digest('hex').slice(0, 8)}`;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  console.log(templateRev(path.resolve(process.argv[2] ?? path.join(path.dirname(self), '..', '..', 'iota-hit'))));
}
