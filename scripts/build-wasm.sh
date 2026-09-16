#!/usr/bin/env bash
# 重新构建 vendor/typst-ts-web-compiler（typst.ts 主分支 + 本机 Typst fork「msword 断行」，Typst 0.15.1）。
# npm 上的 0.8.0-rc3 编进的是 Typst 0.15.0，过不了 iota-hit 的 compiler = "0.15.1" 校验，
# 所以这颗 wasm 是自己从源码编的。需要 rustup（含 wasm32-unknown-unknown）与 wasm-pack。
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
work="${1:-/tmp/typst.ts-src}"
commit="$(cat "$here/vendor/typst-ts-web-compiler/COMMIT" 2>/dev/null || echo main)"
if [ ! -d "$work" ]; then git clone https://github.com/Myriad-Dreamin/typst.ts.git "$work"; fi
git -C "$work" fetch --depth 1 origin "$commit" || true
git -C "$work" checkout "$commit" || true
# 预览区直接编辑要的字形表接口（glyph_map）不在上游，打个小补丁；见 scripts/wasm-patch/
git -C "$work" checkout -- packages/compiler/src/lib.rs Cargo.toml
git -C "$work" apply "$here/scripts/wasm-patch/compiler-glyph-map.patch"
# 预览引擎：Typst 0.15.1 + 「msword 断行」（本机 fork typst-with-msword-linebreaks，
# par(linebreaks: "msword")）。typst.ts 钉的 typst 带自己的 content_hint 改动，所以是
# 克隆它钉的那份、再打上 fork 的合并补丁 scripts/wasm-patch/typst-msword.patch（fork 更新后
# 重做一次三方合并、重新导出这个补丁），最后把 [patch.crates-io] 里的 typst* 指过去
tree="${MSWORD_TYPST:-$work-typst-msword}"
if [ ! -d "$tree/crates/typst" ]; then
  git clone -q --depth 1 --branch typst.ts/v0.8.1 https://github.com/Myriad-Dreamin/typst.git "$tree"
  git -C "$tree" apply "$here/scripts/wasm-patch/typst-msword.patch"
fi
perl -0pi -e 's{^(typst(?:-[a-z]+)?) = \{ git = "https://github.com/Myriad-Dreamin/typst.git", tag = "typst.ts/v0.8.1" \}}{$1 = { path = "'"$tree"'/crates/$1" }}gm' "$work/Cargo.toml"
grep -q "$tree/crates/typst\"" "$work/Cargo.toml" || { echo "Cargo.toml 的 patch 段没换上" >&2; exit 1; }
rustup target add wasm32-unknown-unknown
command -v wasm-pack >/dev/null || cargo install wasm-pack
cd "$work/packages/compiler"
wasm-pack build --target web --scope myriaddreamin -- --no-default-features --features web,misc
node ../tools/wasm-debundle.mjs
out="$here/vendor/typst-ts-web-compiler"
cp pkg/typst_ts_web_compiler.mjs pkg/typst_ts_web_compiler.d.ts pkg/typst_ts_web_compiler_bg.wasm \
   pkg/typst_ts_web_compiler_bg.wasm.d.ts pkg/wasm-pack-shim.mjs pkg/wasm-pack-shim.d.mts "$out/"
git -C "$work" rev-parse HEAD > "$out/COMMIT"
head -1 "$here/scripts/wasm-patch/typst-msword.patch" > "$out/FORK_COMMIT"
echo "done → $out"
