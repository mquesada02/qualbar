#!/usr/bin/env bash
# Measures one mutation shard of one tool on one prepared target (1 run).
# quality-ts uses its own --shard split; fallow gets the files of shard.py.
# Only results.jsonl leaves the runner (see run-static.sh).
# Usage: run-mutation.sh <repo> quality-ts|fallow <shard> <shards> <results-dir>
set -euo pipefail

REPO=$1
TOOL=$2
SHARD=$3
SHARDS=$4
RESULTS=$5
HERE=$(cd "$(dirname "$0")" && pwd)
field() { jq -r --arg r "$REPO" --arg f "$1" '.[$r][$f] // empty' "$HERE/corpus.json"; }
mkdir -p "$RESULTS/logs" "$RESULTS/out"

cd "$TARGET"
labels=(--label "repo=$REPO" --label "sha=$(field sha)" --label "tool=$TOOL"
  --label "mode=mutation" --label "category=shard-$SHARD-of-$SHARDS" --label "run=1")

if [ "$TOOL" = quality-ts ]; then
  cmd="$QTS check --only mutation --shard $SHARD/$SHARDS --shard-file qualbar-shard.json --format json > $RESULTS/out/qts.json"
else
  "$FALLOW" mutation --plan --all --no-cache --format json > "$RESULTS/out/plan.json"
  python3 "$HERE/shard.py" "$RESULTS/out/plan.json" "$SHARD" "$SHARDS" > "$RESULTS/out/files.txt"
  labels+=(--label "planned_files=$(wc -l < "$RESULTS/out/files.txt" | tr -d ' ')")
  cmd="xargs $FALLOW mutation --no-cache --allow-dirty --format json -o $RESULTS/out/fallow.json < $RESULTS/out/files.txt"
fi
python3 "$HERE/measure.py" --out "$RESULTS/results.jsonl" --log "$RESULTS/logs/$TOOL-mutation.log" --timeout 20400 "${labels[@]}" -- "$cmd"

# Mutant counts are numbers only, so they may leave the runner.
if [ "$TOOL" = fallow ] && [ -f "$RESULTS/out/fallow.json" ]; then
  jq -c --arg r "$REPO" --arg s "$SHARD/$SHARDS" '{repo: $r, tool: "fallow", shard: $s, counts}' \
    "$RESULTS/out/fallow.json" >> "$RESULTS/counts.jsonl" || true
fi
