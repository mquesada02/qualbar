#!/usr/bin/env bash
# Checks out one corpus repo at its pinned SHA, installs it, prepares the tool
# config, and commits the result as "bench-setup". Every measured run starts
# from that commit. Writes TARGET to $GITHUB_ENV.
# Usage: setup-target.sh <repo> quality-ts|fallow static|mutation
set -euo pipefail

REPO=$1
TOOL=$2
PURPOSE=$3
HERE=$(cd "$(dirname "$0")" && pwd)
field() { jq -r --arg r "$REPO" --arg f "$1" '.[$r][$f] // empty' "$HERE/corpus.json"; }

TARGET=${RUNNER_TEMP:-/tmp}/target
SLUG=$(field repo)
SHA=$(field sha)
if [ "$REPO" = quality-ts ]; then
  URL="https://x-access-token:${QUALITY_TS_TOKEN}@github.com/$SLUG"
else
  URL="https://github.com/$SLUG"
fi
git init -q "$TARGET"
git -C "$TARGET" fetch -q --depth 1 "$URL" "$SHA"
git -C "$TARGET" checkout -q FETCH_HEAD
echo "TARGET=$TARGET" >> "$GITHUB_ENV"

cd "$TARGET"
eval "$(field install)"
eval "$(field coverage_setup)"

if [ "$TOOL" = quality-ts ]; then
  # quality-ts init without a terminal needs every open point as a flag.
  # shellcheck disable=SC2086
  $QTS init --preset none --package-manager "$(field pm)" --test-runner "$(field runner)" \
    --coverage-command "$(field coverage)" --lcov "$(field lcov)" --force
  # One component that holds every file, so the architecture module builds
  # the full graph and the Martin metrics.
  jq '.architecture = {components: {all: {paths: ["**/*"]}}, allowedDependencies: {all: []}}' \
    quality-ts.config.json > quality-ts.config.tmp && mv quality-ts.config.tmp quality-ts.config.json
  if [ "$PURPOSE" = mutation ]; then
    if [ "$(field pm)" = npm ]; then add="npm install -D"; else add="pnpm add -D"; fi
    if [ -f pnpm-workspace.yaml ]; then add="$add -w"; fi
    $add "@stryker-mutator/core@10.0.0" "@stryker-mutator/$(field runner)-runner@10.0.0"
  else
    jq '.modules.mutation = {enabled: false, reason: "measured in the mutation workflow"}' \
      quality-ts.config.json > quality-ts.config.tmp && mv quality-ts.config.tmp quality-ts.config.json
  fi
fi

git add -A
git -c user.name=bench -c user.email=bench@localhost commit -q --allow-empty -m bench-setup
