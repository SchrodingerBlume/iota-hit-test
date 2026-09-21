#!/usr/bin/env bash
# 发一版稳定镜像到 hithesis.site：hithesis.site 是 hithesis/hithesis 这个项目站自己绑的域名，别的仓库不继承，
# 所以镜像塞进它 gh-pages 分支的 editor/ 目录 → https://hithesis.site/editor/。主站那几个文件不动，只换这个目录。
#
#   npm run mirror                          # 构建、换掉 editor/、提交、推
#   MIRROR_DRY=1 npm run mirror             # 只构建、只造提交，不推；最后打印推送命令
#   MIRROR_REF=v1.0 npm run mirror          # 发某个提交 / 标签（默认 HEAD；总是从干净的 worktree 构建）
#   MIRROR_DIR= npm run mirror              # 目录留空 = 整个分支就是站（孤儿提交强推，历史只一条），配 MIRROR_REPO 用
#
# 提交署名 SchrodingerBlume（MIRROR_AUTHOR / MIRROR_EMAIL 可换），不带别的署名。站里带一个 version.txt 记源提交号
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="${MIRROR_REPO:-https://github.com/hithesis/hithesis.git}"
branch="${MIRROR_BRANCH:-gh-pages}"
dir="${MIRROR_DIR-editor}"
name="${MIRROR_AUTHOR:-SchrodingerBlume}"
email="${MIRROR_EMAIL:-SchrodingerBlume@users.noreply.github.com}"
ref="${MIRROR_REF:-HEAD}"
src="$(git -C "$here" rev-parse --short "$ref")"
export GIT_AUTHOR_NAME="$name" GIT_AUTHOR_EMAIL="$email" GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email"

# 从干净的 worktree 构建：工作树里可能有别人没提交的改动，镜像必须等于某一个提交
[ -f "$here/public/fonts/manifest.json" ] || (cd "$here" && npm run fonts)
build="$(mktemp -d)"
git -C "$here" worktree add -q --detach "$build" "$ref"
trap 'git -C "$here" worktree remove --force "$build" 2>/dev/null || true' EXIT
ln -s "$here/node_modules" "$build/node_modules"
rm -rf "$build/public/fonts" && ln -s "$here/public/fonts" "$build/public/fonts"
(cd "$build" && npm run build)

work="$(mktemp -d)"
if [ -n "$dir" ]; then
  # 接在主站分支上：浅克隆，只换 editor/ 目录，根上补 .nojekyll（从分支发布默认过 Jekyll，没必要让它碰这 140 MB）
  git clone -q --depth 1 --branch "$branch" "$repo" "$work"
  rm -rf "$work/$dir"
  mkdir -p "$work/$dir"
  cp -RL "$build/dist/." "$work/$dir/"
  touch "$work/.nojekyll"
  printf '%s\n' "$src" > "$work/$dir/version.txt"
  cd "$work"
  git add -A
  git commit -q -m "$dir: $src"
  push=(git -C "$work" push "$repo" "$branch")
else
  # 整个分支就是站：孤儿提交、强推，历史永远只有 init 这一条
  cp -RL "$build/dist/." "$work/"
  touch "$work/.nojekyll"
  printf '%s\n' "$src" > "$work/version.txt"
  cd "$work"
  git init -q -b "$branch"
  git add -A
  git commit -q -m init
  push=(git -C "$work" push --force "$repo" "$branch")
fi
echo "镜像提交已造好：$work（源 $src，$(du -sh --exclude=.git . 2>/dev/null | cut -f1 || du -sh . | cut -f1)）"
git -C "$work" log --format='  %an <%ae>  %s' -1
if [ -n "${MIRROR_DRY:-}" ]; then
  echo "推送命令："
  echo "  ${push[*]}"
  exit 0
fi
"${push[@]}"
echo "已推到 $repo 的 $branch${dir:+/$dir}"
