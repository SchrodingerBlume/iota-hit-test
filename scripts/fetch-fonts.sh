#!/usr/bin/env bash
# 下载 presets.webapp 那一档的开源字体到 public/fonts/（楷体换 FandolKai）。
# 字体不进 git，构建前跑一次；跑完再 node scripts/font-manifest.mjs 生成 manifest。
#
#   Noto Serif/Sans CJK SC   SIL OFL 1.1      github.com/notofonts/noto-cjk（语言专属 OTF，家族名带 CJK）
#   FandolKai                GPL-3.0+ (FE)    CTAN fonts/fandol
#   TeX Gyre Termes / Heros  GUST Font License  CTAN fonts/tex-gyre
#   TeX Gyre Termes Math     GUST Font License  CTAN fonts/tex-gyre-math
#   DejaVu Sans Mono         DejaVu license   typst-assets 自带的那四个文件
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/public/fonts"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

get() { # get <url> <dest>
  if [ -s "$2" ]; then echo "  已有 $(basename "$2")"; return; fi
  echo "  ↓ $1"
  curl -fsSL --retry 3 -o "$2" "$1"
}

echo "Noto CJK SC"
noto=https://raw.githubusercontent.com/notofonts/noto-cjk/main
get "$noto/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf" "$out/NotoSerifCJKsc-Regular.otf"
get "$noto/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Bold.otf"    "$out/NotoSerifCJKsc-Bold.otf"
get "$noto/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf"   "$out/NotoSansCJKsc-Regular.otf"
get "$noto/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf"      "$out/NotoSansCJKsc-Bold.otf"

echo "DejaVu Sans Mono"
dv=https://cdn.jsdelivr.net/gh/typst/typst-assets@v0.13.1/files/fonts
for f in DejaVuSansMono.ttf DejaVuSansMono-Bold.ttf DejaVuSansMono-Oblique.ttf DejaVuSansMono-BoldOblique.ttf; do
  get "$dv/$f" "$out/$f"
done

echo "TeX Gyre Termes / Heros"
if [ ! -s "$out/texgyretermes-regular.otf" ] || [ ! -s "$out/texgyreheros-regular.otf" ]; then
  get https://www.gust.org.pl/projects/e-foundry/tex-gyre/termes/qtm2.004otf.zip "$tmp/qtm.zip"
  get https://www.gust.org.pl/projects/e-foundry/tex-gyre/heros/qhv2.004otf.zip "$tmp/qhv.zip"
  unzip -oq "$tmp/qtm.zip" -d "$tmp/tg"; unzip -oq "$tmp/qhv.zip" -d "$tmp/tg"
  for f in texgyretermes-regular texgyretermes-bold texgyretermes-italic texgyretermes-bolditalic \
           texgyreheros-regular texgyreheros-bold texgyreheros-italic texgyreheros-bolditalic; do
    cp "$(find "$tmp/tg" -name "$f.otf" | head -1)" "$out/$f.otf"
  done
fi

echo "TeX Gyre Termes Math"
if [ ! -s "$out/texgyretermes-math.otf" ]; then
  get https://mirrors.ctan.org/fonts/tex-gyre-math.zip "$tmp/tgm.zip"
  unzip -oq "$tmp/tgm.zip" -d "$tmp/tgm"
  cp "$(find "$tmp/tgm" -name 'texgyretermes-math.otf' | head -1)" "$out/texgyretermes-math.otf"
fi

echo "FandolKai"
if [ ! -s "$out/FandolKai-Regular.otf" ]; then
  get https://mirrors.ctan.org/fonts/fandol.zip "$tmp/fandol.zip"
  unzip -oq "$tmp/fandol.zip" -d "$tmp/fandol"
  cp "$(find "$tmp/fandol" -name 'FandolKai-Regular.otf' | head -1)" "$out/FandolKai-Regular.otf"
fi

echo "完成：$(ls "$out"/*.otf "$out"/*.ttf | wc -l | tr -d ' ') 个文件，$(du -sh "$out" | cut -f1)"
