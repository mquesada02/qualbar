#!/usr/bin/env bash
# Measures one tool on one prepared target: the full static check (3 runs),
# each category alone (3 runs), a changed-only check on a one-file commit
# (3 runs), then the CRAP run (1 run). CRAP runs last because a coverage
# command can build files (zod) that the other runs must not see.
# Usage: run-static.sh <repo> quality-ts|fallow <results-dir>
# Only results.jsonl leaves the runner: logs/ and out/ can hold private
# quality-ts content, and artifacts of a public repo are public.
set -euo pipefail

REPO=$1
TOOL=$2
RESULTS=$3
HERE=$(cd "$(dirname "$0")" && pwd)
field() { jq -r --arg r "$REPO" --arg f "$1" '.[$r][$f] // empty' "$HERE/corpus.json"; }
mkdir -p "$RESULTS/logs" "$RESULTS/out"
RUNS=3

# m <mode> <category> <run> <command>
m() {
  python3 "$HERE/measure.py" --out "$RESULTS/results.jsonl" --log "$RESULTS/logs/$TOOL-$1-$2.log" \
    --label "repo=$REPO" --label "sha=$(field sha)" --label "tool=$TOOL" \
    --label "mode=$1" --label "category=$2" --label "run=$3" -- "$4"
}
out() { echo "$RESULTS/out/$TOOL-$1-$2-$3.json"; }

cd "$TARGET"
STATIC=function,types,architecture,cohesion,dry-yagni

if [ "$TOOL" = quality-ts ]; then
  for run in $(seq $RUNS); do
    m full all "$run" "$QTS check --only $STATIC --format json > $(out full all "$run")"
  done
  for cat in ${STATIC//,/ }; do
    for run in $(seq $RUNS); do
      m full "$cat" "$run" "$QTS check --only $cat --format json > $(out full "$cat" "$run")"
    done
  done
else
  for run in $(seq $RUNS); do
    m full all "$run" "$FALLOW --no-cache --format json > $(out full all "$run")"
  done
  for cat in dead-code dupes health; do
    for run in $(seq $RUNS); do
      m full "$cat" "$run" "$FALLOW $cat --no-cache --format json > $(out full "$cat" "$run")"
    done
  done
fi

# The small diff: one new exported function in one source file.
cat >> "$(field edit_file)" <<'EOF'

export function qualbarBenchEdit(value: number): number {
  if (value > 10) {
    return value - 1;
  }
  return value + 1;
}
EOF
git -c user.name=bench -c user.email=bench@localhost commit -q -am bench-edit

if [ "$TOOL" = quality-ts ]; then
  for run in $(seq $RUNS); do
    m changed all "$run" "$QTS check --changed HEAD~1 --only $STATIC --format json > $(out changed all "$run")"
  done
  m changed crap 1 "$QTS check --changed HEAD~1 --only crap --format json > $(out changed crap 1)"
else
  for run in $(seq $RUNS); do
    m changed all "$run" "$FALLOW audit --base HEAD~1 --no-cache --format json > $(out changed all "$run")"
  done
fi

# CRAP at the bench-setup commit, not on the edit.
git checkout -q HEAD~1
if [ "$TOOL" = quality-ts ]; then
  m crap crap 1 "$QTS check --only crap --format json > $(out crap crap 1)"
else
  # fallow does not run tests for CRAP: it reads an Istanbul file. Measure the
  # test run and the analysis apart; their sum is the CRAP run.
  m crap tests 1 "$(field coverage)"
  m crap health 1 "$FALLOW health --coverage $(field istanbul) --no-cache --format json > $(out crap health 1)"
fi
