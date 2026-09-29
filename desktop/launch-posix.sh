#!/bin/sh
set -eu
program=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
if [ ! -x "$program/runtime/bin/node" ]; then
  echo '请先完整解压启动包，再运行启动脚本。' >&2
  exit 1
fi
exec "$program/runtime/bin/node" "$program/toolkit/src/portable.mjs" "$@"
