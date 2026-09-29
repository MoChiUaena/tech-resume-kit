#!/bin/sh
set -eu
program=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec "$program/runtime/bin/node" "$program/toolkit/src/portable.mjs" --check
