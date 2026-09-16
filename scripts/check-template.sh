#!/usr/bin/env bash
# 模板（../iota-hit）比打进 public/packages 的新了没：比较 manifest 里记的提交号与工作区
here="$(cd "$(dirname "$0")/.." && pwd)"
dir="${IOTA_HIT:-$here/../iota-hit}"
bundled="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('iotaHitCommit') or '')" "$here/public/packages/manifest.json" 2>/dev/null)"
head="$(git -C "$dir" rev-parse --short HEAD)"
dirty="$([ -n "$(git -C "$dir" status --porcelain)" ] && echo -dirty)"
now="$head$dirty"
if [ "$bundled" = "$now" ]; then echo "模板未变（$now）"; else echo "模板有更新：打包的是 ${bundled:-?}，现在是 $now → npm run packages"; exit 1; fi
