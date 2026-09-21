#!/usr/bin/env bash
# 发一版稳定镜像：构建后把 dist 作为一个孤儿提交强推到镜像仓库的 gh-pages——历史永远只有这一条，仓库不随发版变胖。
# 组织用户站绑了域名，组织下的项目站就落在 hithesis.site/<仓库名>/，不用 DNS。
#
#   npm run mirror                              # 推到 MIRROR_REPO（默认 hithesis/editor）
#   MIRROR_REPO=https://github.com/x/y.git npm run mirror
#   MIRROR_DRY=1 npm run mirror                 # 只构建、只造提交，不推；最后打印推送命令
#   MIRROR_REF=v1.0 npm run mirror              # 发某个提交 / 标签（默认 HEAD；总是从干净的 worktree 构建）
#
# 提交署名 SchrodingerBlume（MIRROR_AUTHOR / MIRROR_EMAIL 可换）。站里带一个 version.txt 记源提交号
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="${MIRROR_REPO:-https://github.com/hithesis/editor.git}"
branch="${MIRROR_BRANCH:-gh-pages}"
name="${MIRROR_AUTHOR:-SchrodingerBlume}"
email="${MIRROR_EMAIL:-SchrodingerBlume@users.noreply.github.com}"
ref="${MIRROR_REF:-HEAD}"
src="$(git -C "$here" rev-parse --short "$ref")"

# 从干净的 worktree 构建：工作树里可能有别人没提交的改动，镜像必须等于某一个提交
[ -f "$here/public/fonts/manifest.json" ] || (cd "$here" && npm run fonts)
build="$(mktemp -d)"
git -C "$here" worktree add -q --detach "$build" "$ref"
trap 'git -C "$here" worktree remove --force "$build" 2>/dev/null || true' EXIT
ln -s "$here/node_modules" "$build/node_modules"
rm -rf "$build/public/fonts" && ln -s "$here/public/fonts" "$build/public/fonts"
(cd "$build" && npm run build)
work="$(mktemp -d)"
cp -RL "$build/dist/." "$work/"
touch "$work/.nojekyll"
printf '%s\n' "$src" > "$work/version.txt"
cd "$work"
git init -q -b "$branch"
git add -A
GIT_AUTHOR_NAME="$name" GIT_AUTHOR_EMAIL="$email" GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" git commit -q -m init
echo "镜像提交已造好：$work（源 $src，$(du -sh . | cut -f1)）"
if [ -n "${MIRROR_DRY:-}" ]; then
  echo "推送命令："
  echo "  git -C $work push --force $repo $branch"
  exit 0
fi
git push --force "$repo" "$branch"
echo "已推到 $repo 的 $branch；Pages 源设成这个分支（根目录）后就在线"
