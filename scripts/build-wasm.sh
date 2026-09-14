#!/usr/bin/env bash
# 重新构建 vendor/typst-ts-web-compiler（typst.ts 主分支，Typst 0.15.1）。
# npm 上的 0.8.0-rc3 编进的是 Typst 0.15.0，过不了 iota-hit 的 compiler = "0.15.1" 校验，
# 所以这颗 wasm 是自己从源码编的。需要 rustup（含 wasm32-unknown-unknown）与 wasm-pack。
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
work="${1:-/tmp/typst.ts-src}"
commit="$(cat "$here/vendor/typst-ts-web-compiler/COMMIT" 2>/dev/null || echo main)"
if [ ! -d "$work" ]; then git clone https://github.com/Myriad-Dreamin/typst.ts.git "$work"; fi
git -C "$work" fetch --depth 1 origin "$commit" || true
git -C "$work" checkout "$commit" || true
rustup target add wasm32-unknown-unknown
command -v wasm-pack >/dev/null || cargo install wasm-pack
cd "$work/packages/compiler"
wasm-pack build --target web --scope myriaddreamin -- --no-default-features --features web,misc
node ../tools/wasm-debundle.mjs
out="$here/vendor/typst-ts-web-compiler"
cp pkg/typst_ts_web_compiler.mjs pkg/typst_ts_web_compiler.d.ts pkg/typst_ts_web_compiler_bg.wasm \
   pkg/typst_ts_web_compiler_bg.wasm.d.ts pkg/wasm-pack-shim.mjs pkg/wasm-pack-shim.d.mts "$out/"
git -C "$work" rev-parse HEAD > "$out/COMMIT"
echo "done → $out"
