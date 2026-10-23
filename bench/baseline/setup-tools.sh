#!/usr/bin/env bash
# Installs the measured tool outside the target checkout and writes its command
# to $GITHUB_ENV (QTS or FALLOW).
# Usage: setup-tools.sh quality-ts|fallow
set -euo pipefail

TOOL=$1
TOOLS=${RUNNER_TEMP:-/tmp}/tools
mkdir -p "$TOOLS"

case "$TOOL" in
  quality-ts)
    # The oracle commit of "Grilling: oracle corpus and fixtures" (qualbar#18).
    git clone -q "https://x-access-token:${QUALITY_TS_TOKEN}@github.com/mquesada02/quality-ts" "$TOOLS/quality-ts"
    git -C "$TOOLS/quality-ts" checkout -q dd95c666bfb276e83bd5f68f05d788dd3194ed1b
    (cd "$TOOLS/quality-ts" && pnpm install --frozen-lockfile && pnpm build)
    echo "QTS=node $TOOLS/quality-ts/dist/cli.js" >> "$GITHUB_ENV"
    ;;
  fallow)
    npm install --prefix "$TOOLS/fallow" --no-audit --no-fund fallow@3.35.0
    echo "FALLOW=$TOOLS/fallow/node_modules/.bin/fallow" >> "$GITHUB_ENV"
    ;;
  *)
    echo "unknown tool: $TOOL" >&2
    exit 2
    ;;
esac
