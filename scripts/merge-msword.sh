#!/usr/bin/env bash
# 把本机 Typst fork（typst-with-msword-linebreaks）的 msword 断行合并到 typst.ts 钉的 typst 之上，
# 导出 scripts/wasm-patch/typst-msword.patch，再编 wasm。用法：
#   scripts/merge-msword.sh [fork 目录] [工作目录]
#
# 路线：clone fork → 检出 0.15.1 基线 88a6f5669 → cherry-pick 上游 #792 与「最近一次上游合并之后」
# 的 first-parent 提交（都是 msword 自己的活）→ 合并 typst.ts/v0.8.1（两处已知冲突：Line 的 eaten
# 字段、breakpoints 回调多一个 char）→ cargo check → 导出补丁 → build-wasm.sh。
# *不要*把 typst.ts/v0.8.1 直接并进 fork 主线：主线的依赖（time / icu 等）比 typst.ts v0.8.1 的
# Cargo.lock 新，cargo 解不开（2026-10-07 实测）。
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
fork="${1:-$HOME/typst-with-msword-linebreaks}"
work="${2:-/tmp/typst.ts-src}"
base=88a6f5669
tree="$work-cp"
rm -rf "$tree"
git clone -q "$fork" "$tree"
# 最近一次上游合并之后都是 msword 提交（合并提交本身在基线上，不在 cherry-pick 范围）
merge="$(git -C "$tree" rev-list --first-parent --merges -1 HEAD)"
commits="$(git -C "$tree" log --first-parent --reverse --format=%H "$merge..HEAD")"
git -C "$tree" checkout -q -b msword-015 "$base"
git -C "$tree" -c user.name=iota4web -c user.email=iota4web@local cherry-pick -X theirs 485841043 701f12ed5
# shellcheck disable=SC2086
git -C "$tree" -c user.name=iota4web -c user.email=iota4web@local cherry-pick -X theirs $commits
# 再合并 typst.ts 那份（content hint）
git -C "$tree" remote add myriad https://github.com/Myriad-Dreamin/typst.git
git -C "$tree" fetch -q --depth 30 myriad tag typst.ts/v0.8.1
git -C "$tree" -c user.name=iota4web -c user.email=iota4web@local merge --no-edit typst.ts/v0.8.1 >/dev/null 2>&1 || true
python3 - "$tree" <<'PY'
import sys
tree = sys.argv[1]
def sub(path, a, b):
    p = f"{tree}/{path}"; s = open(p).read()
    if a not in s: return False
    open(p, 'w').write(s.replace(a, b)); return True
sub('crates/typst-layout/src/inline/line.rs',
    "<<<<<<< HEAD\n    Line { items, width, justify, dash, fixed: false }\n=======\n    Line { items, eaten, width, justify, dash }\n>>>>>>> typst.ts/v0.8.1\n",
    "    Line { items, eaten, width, justify, dash, fixed: false }\n")
sub('crates/typst-layout/src/inline/linebreak.rs',
    "<<<<<<< HEAD\npub(super) fn breakpoints(p: &Preparation, mut f: impl FnMut(usize, Breakpoint)) {\n=======\nfn breakpoints(p: &Preparation, mut f: impl FnMut(usize, Breakpoint, char)) {\n>>>>>>> typst.ts/v0.8.1\n",
    "pub(super) fn breakpoints(p: &Preparation, mut f: impl FnMut(usize, Breakpoint, char)) {\n")
# 主线那条合并路线还会在 typst-svg 的头部冲突（保留新版头、补回 pdf_to_svg 导出）；基线路线一般用不上
sub('crates/typst-svg/src/lib.rs',
    "<<<<<<< HEAD\npub use self::format::{FORMAT, SvgFormat, SvgFormatOptions};\npub use self::image::{WebImage, convert_image_scaling};\n=======\nuse comemo::Tracked;\npub use image::{WebImage, convert_image_scaling, pdf_to_svg};\nuse indexmap::IndexMap;\nuse rustc_hash::FxBuildHasher;\nuse typst_library::model::{Destination, LateLinkResolver};\n>>>>>>> typst.ts/v0.8.1\n",
    "pub use self::format::{FORMAT, SvgFormat, SvgFormatOptions};\npub use self::image::{WebImage, convert_image_scaling, pdf_to_svg};\n")
p = f"{tree}/crates/typst-layout/src/inline/msword.rs"; s = open(p).read()
if 'HashMap<usize, char>' not in s:
    pairs = [
      ("    let (mut breaks, mandatory) = collect_breaks(p, &params, &symbols);", "    let (mut breaks, mandatory, eaten) = collect_breaks(p, &params, &symbols);"),
      ("        return vec![line(engine, p, 0..p.text.len(), Breakpoint::Mandatory, None)];", "        return vec![line(engine, p, 0..p.text.len(), Breakpoint::Mandatory, None, '\\0')];"),
      ("        let mut built = line(engine, p, start..d.end, d.breakpoint, lines.last());", "        let ate = eaten.get(&d.end).copied().unwrap_or('\\0');\n        let mut built = line(engine, p, start..d.end, d.breakpoint, lines.last(), ate);"),
      ("    symbols: &[std::ops::Range<usize>],\n) -> (Vec<usize>, Vec<usize>) {\n    let mut breaks = Vec::new();\n    let mut mandatory = Vec::new();\n    breakpoints(p, |offset, bp| match bp {",
       "    symbols: &[std::ops::Range<usize>],\n) -> (Vec<usize>, Vec<usize>, HashMap<usize, char>) {\n    let mut breaks = Vec::new();\n    let mut mandatory = Vec::new();\n    let mut eaten = HashMap::new();\n    breakpoints(p, |offset, bp, ate| match bp {"),
      ("    (breaks, mandatory)\n}", "    (breaks, mandatory, eaten)\n}"),
      ("use typst_library::engine::Engine;\n", "use std::collections::HashMap;\nuse typst_library::engine::Engine;\n"),
    ]
    for a, b in pairs:
        if s.count(a) != 1: sys.exit(f"msword.rs 长得不一样了，找不到：{a[:60]!r}")
        s = s.replace(a, b)
    i = s.index("breakpoints(p, |offset, bp, ate| match bp {"); j = s.index("});", i); blk = s[i:j]
    blk2 = blk.replace("Breakpoint::Normal => breaks.push(offset),", "Breakpoint::Normal => {\n            breaks.push(offset);\n            eaten.insert(offset, ate);\n        }").replace("            breaks.push(offset);\n            mandatory.push(offset);", "            breaks.push(offset);\n            mandatory.push(offset);\n            eaten.insert(offset, ate);")
    if blk2 == blk: sys.exit("msword.rs 的 breakpoints 回调长得不一样了")
    s = s[:i] + blk2 + s[j:]
    open(p, 'w').write(s)
PY
# Apache-2.0 §4(b)：合并时改过的文件头部注明
for f in line.rs linebreak.rs msword.rs; do
  p="$tree/crates/typst-layout/src/inline/$f"
  grep -q "^// 本文件基于" "$p" || { printf '%s\n' "// 本文件基于 Typst（typst/typst）与 typst-with-msword-linebreaks 修改（iota4web 合并到 Myriad-Dreamin/typst 之上，见 scripts/wasm-patch/typst-msword.patch）" | cat - "$p" > "$p.tmp" && mv "$p.tmp" "$p"; }
done
if grep -rl "^<<<<<<< " "$tree/crates" >/dev/null 2>&1; then echo "还有没解的冲突：" >&2; grep -rl "^<<<<<<< " "$tree/crates" >&2; exit 1; fi
(cd "$tree" && cargo check -q -p typst-layout)
git -C "$tree" add -A
git -C "$tree" -c user.name=iota4web -c user.email=iota4web@local commit -q -m "merge typst.ts/v0.8.1 (content hint) into msword linebreaks (0.15.1 baseline + cherry-picks)"
{
  echo "# typst-with-msword-linebreaks $(git -C "$fork" rev-parse HEAD) 的 msword 提交（$(printf '%s\n' "$commits" | wc -l | tr -d ' ') 笔，cherry-pick 到 $base 基线之上；上游 #792 两笔）再合并到 Myriad-Dreamin/typst tag typst.ts/v0.8.1（两处冲突：Line 的 eaten 字段、breakpoints 回调多一个 char）"
  git -C "$tree" diff typst.ts/v0.8.1 HEAD -- crates
} > "$here/scripts/wasm-patch/typst-msword.patch"
MSWORD_TYPST="$tree" bash "$here/scripts/build-wasm.sh" "$work"
