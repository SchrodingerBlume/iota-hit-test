#!/usr/bin/env bash
# 把本机 Typst fork（typst-with-msword-linebreaks）合并到 typst.ts 钉的 typst 之上，导出
# scripts/wasm-patch/typst-msword.patch，再编 wasm。用法：
#   scripts/merge-msword.sh [fork 目录] [工作目录]
# 已知的两处冲突（Line 的 eaten 字段、breakpoints 回调多一个 char）脚本自己解；别的冲突就停下来报
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
fork="${1:-$HOME/typst-with-msword-linebreaks}"
work="${2:-/tmp/typst.ts-src}"
tree="$work-typst-msword"
rm -rf "$tree"
git clone -q "$fork" "$tree"
git -C "$tree" remote add myriad https://github.com/Myriad-Dreamin/typst.git
git -C "$tree" fetch -q --depth 30 myriad tag typst.ts/v0.8.1
git -C "$tree" -c user.name=iota4web -c user.email=iota4web@local merge --no-edit typst.ts/v0.8.1 >/dev/null 2>&1 || true
python3 - "$tree" <<'PY'
import sys, re
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
p = f"{tree}/crates/typst-layout/src/inline/msword.rs"; s = open(p).read()
if 'HashMap<usize, char>' not in s:
    pairs = [
      ("    let (breaks, mandatory) = collect_breaks(p, &params);", "    let (breaks, mandatory, eaten) = collect_breaks(p, &params);"),
      ("        return vec![line(engine, p, 0..p.text.len(), Breakpoint::Mandatory, None)];", "        return vec![line(engine, p, 0..p.text.len(), Breakpoint::Mandatory, None, '\\0')];"),
      ("        let mut built = line(engine, p, start..d.end, d.breakpoint, lines.last());", "        let ate = eaten.get(&d.end).copied().unwrap_or('\\0');\n        let mut built = line(engine, p, start..d.end, d.breakpoint, lines.last(), ate);"),
      ("fn collect_breaks(p: &Preparation, params: &Params) -> (Vec<usize>, Vec<usize>) {\n    let mut breaks = Vec::new();\n    let mut mandatory = Vec::new();\n    breakpoints(p, |offset, bp| match bp {",
       "fn collect_breaks(\n    p: &Preparation,\n    params: &Params,\n) -> (Vec<usize>, Vec<usize>, HashMap<usize, char>) {\n    let mut breaks = Vec::new();\n    let mut mandatory = Vec::new();\n    let mut eaten = HashMap::new();\n    breakpoints(p, |offset, bp, ate| match bp {"),
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
if grep -rl "^<<<<<<< " "$tree/crates" >/dev/null 2>&1; then echo "还有没解的冲突：" >&2; grep -rl "^<<<<<<< " "$tree/crates" >&2; exit 1; fi
(cd "$tree" && cargo check -q -p typst-layout)
git -C "$tree" add -A
git -C "$tree" -c user.name=iota4web -c user.email=iota4web@local commit -q -m "merge typst.ts/v0.8.1 (content hint) into msword linebreaks"
{
  echo "# typst-with-msword-linebreaks $(git -C "$fork" rev-parse HEAD) 合并到 Myriad-Dreamin/typst tag typst.ts/v0.8.1 之上（两处冲突：Line 的 eaten 字段、breakpoints 回调多一个 char）"
  git -C "$tree" diff typst.ts/v0.8.1 HEAD -- crates
} > "$here/scripts/wasm-patch/typst-msword.patch"
MSWORD_TYPST="$tree" bash "$here/scripts/build-wasm.sh" "$work"
