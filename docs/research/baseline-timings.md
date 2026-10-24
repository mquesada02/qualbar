# Baseline timings of quality-ts and fallow

Ticket: [Task: baseline timings of quality-ts and fallow](https://github.com/mquesada02/qualbar/issues/23). Input to [Grilling: performance targets and benchmarks](https://github.com/mquesada02/qualbar/issues/24).

Measured on 2026-10-23 on free GitHub-hosted standard runners, by the workflows on branch `research/baseline-timings`.

## Summary

Linux x64 (`ubuntu-24.04`, 4 vCPU, 16 GB), wall time in seconds, median of 3 runs (CRAP: 1 run):

| Repo | fallow full | quality-ts full | fallow changed | quality-ts changed | test run with coverage | quality-ts CRAP | fallow CRAP (`health --coverage`) |
|---|---|---|---|---|---|---|---|
| quality-ts | 0.29 | 8.93 | 0.42 | 7.12 | 379.50 | 288.31 | 0.34 |
| zustand | 0.24 | 7.12 | 0.29 | 6.40 | 8.86 | 10.37 | 0.21 |
| ts-pattern | 0.15 | 3.27 | 0.20 | 3.02 | 13.55 | 14.72 | 0.15 |
| zod | 0.51 | 87.38 | 0.70 | 63.03 | 74.01 | error | 0.47 |
| date-fns | 1.04 | 31.47 | 1.57 | 21.67 | 9.78 | 18.61 | 0.92 |

Mutation on Linux, all shards summed (one job per shard):

| Repo | quality-ts | fallow |
|---|---|---|
| quality-ts | unsupported (Stryker initial test run fails) | 11.91 h or more (6,325 planned mutants; shard 1 of 8 hit the 340 min limit) |
| zustand | 168 s | 412 s (416 mutants) |
| ts-pattern | 456 s | unsupported (Jest) |
| zod | unsupported (Stryker sandbox error) | unsupported (Vitest file-based projects) |
| date-fns | refused (TypeScript 7, Vitest 5) | 6.10 h, slowest shard 0.66 h (`pkgs/core` only, 7,241 mutants) |

Main facts:
- fallow static is 22 to 170 times faster than quality-ts static. On Linux it stays under 1.6 s and 330 MB on every repo.
- quality-ts static is dominated by `function` and `types` (TypeScript program build). zod needs 4.1 GB on Linux, and aborts at the V8 heap limit on macOS (7 GB) unless `--max-old-space-size` is raised.
- Changed-only mode barely helps either tool on a 1-file diff. quality-ts changed takes 69 to 92 % of full. fallow `audit` is slower than full fallow.
- CRAP cost is the test run with coverage. quality-ts CRAP adds 1 to 9 s over the bare test run. On the quality-ts repo it is 91 s faster than the bare test run; the cause is not known.
- Mutation is hours, not seconds: fallow on the quality-ts repo needs 12 h or more of runner time, and its file shards are very uneven (476 s to over 20,400 s).
- macOS (3 vCPU arm64) is 1.1 to 1.7 times slower than Linux for full static runs, and 0.8 to 1.6 times for one mutation shard.

## Method

### Machines

| Runner label | OS, CPU | vCPU | RAM |
|---|---|---|---|
| `ubuntu-24.04` | Linux x64 | 4 | 16 GB |
| `macos-15` | macOS arm64 | 3 | 7 GB |

The exact runner image of each job is in its `machine.txt` artifact.

### Tools

| Tool | Version | How it runs |
|---|---|---|
| quality-ts | commit `dd95c66` (the oracle of [Grilling: oracle corpus and fixtures](https://github.com/mquesada02/qualbar/issues/18)) | built from source; `quality-ts init --preset none` writes the config, then one architecture component `all` with `**/*` is added |
| fallow | 3.35.0 (npm) | no config; `--no-cache` on every run (cold) |
| Stryker | 10.0.0 core + runner | added to the target as dev dependencies; quality-ts drives it |

### Corpus

| Repo | SHA | Runner | Node | Why this SHA |
|---|---|---|---|---|
| mquesada02/quality-ts | `dd95c666` | Vitest 4 | 24 | the oracle commit |
| pmndrs/zustand | `da2706c3` | Vitest 4 | 24 | last commit before Vitest 5 (#18 lists Vitest 4) |
| gvergnaud/ts-pattern | `f11be73a` | Jest 30 | 24 | default branch head |
| colinhacks/zod | `7a002366` | Vitest 4 | 22 | last commit before the move from pnpm to Nub (#18 lists a pnpm monorepo) |
| date-fns/date-fns | `df2af046` | Vitest 5 | 26 | default branch head (TypeScript 7.0.2) |

These SHAs are a proposal for `oracle/corpus.toml`. date-fns is now a pnpm monorepo (`pkgs/core`, `tz`, `utc`, `docs`, `dev`), not the "single, large" shape that #18 lists.

Bench-only changes to the targets, the same for both tools (`bench/baseline/corpus.json`):
- quality-ts: `test/adapters/readline-prompter.test.ts` is deleted. Its 2 tests read stdin and fail on runners, and a failed test run writes no coverage.
- zod: `packages/treeshake/tsconfig.json` is added (the package has TS files and no tsconfig, so `quality-ts init` stops). The coverage command runs `pnpm -w run build` first, because the treeshake tests need the build.
- date-fns: Chromium is installed for its browser test project.

### Modes

| Mode | Runs | quality-ts command | fallow command |
|---|---|---|---|
| full static | 3 | `check --only function,types,architecture,cohesion,dry-yagni` | `fallow` (dead code, duplication, health) |
| one category | 3 each | `check --only <module>` | `fallow dead-code`, `dupes`, `health` |
| changed-only | 3 | `check --changed HEAD~1 --only <static modules>` | `fallow audit --base HEAD~1` |
| CRAP | 1 | `check --only crap` (runs the coverage command) | the coverage command, then `fallow health --coverage coverage-final.json` |
| changed CRAP | 1 | `check --changed HEAD~1 --only crap` | none |
| mutation | 1 per shard | `check --only mutation --shard i/N` | `fallow mutation <files of shard i>` |

The changed-only diff is one new exported 6-line function in one source file, committed on top of the setup commit. Static and changed runs happen before any coverage run, so build output (zod) never reaches them.

Mutation runs every shard on Linux and shard 1 only on macOS (a macOS/Linux ratio). quality-ts splits files itself; fallow gets file lists that balance its planned mutant counts (`bench/baseline/shard.py`). Each shard has a 340 min limit.

### Numbers

- **Wall time:** from process start to exit, in Python (`time.perf_counter`).
- **Peak memory:** the larger of (a) the summed RSS of the whole process tree, sampled every 20 ms, and (b) `ru_maxrss` of the largest child process. (a) counts worker processes; (b) catches runs shorter than one sample.
- **Exit code:** 0 pass, 1 findings (a normal result for a timing), 2 tool error, 134 aborted (V8 heap limit), `timeout`.
- Tables show the median of the runs, with min-max.

### Repeat

1. Push a change to `bench/baseline/` on branch `research/baseline-timings` (needs the `QUALITY_TS_TOKEN` secret: read-only access to quality-ts). For mutation, set `PLAN` in `.github/workflows/baseline-mutation.yml` to empty for the full plan (it is set to the last rerun).
2. Download the artifacts: `gh run download <run-id> -p 'static-*'` (or `'mutation-*'`).
3. Run `python3 bench/baseline/summarize.py <artifact-dir>`.

quality-ts is private and this repo is public, so jobs upload only numbers. The user approved a few extra lines in public logs to debug failures: quality-ts error reasons for public targets, and failing test names and one error line per tool for the quality-ts repo.

## Results

### Static, CRAP and changed-only

Mode `crap`, category `tests` is the bare test run with coverage that fallow needs before `health --coverage`.

#### macOS arm64 (macos-15)

| Repo | Tool | Mode | Category | Wall s, median (min-max) | Peak MB | Exit |
|---|---|---|---|---|---|---|
| date-fns | fallow | changed | all | 3.66 (3.14-3.92) | 284 | 0 |
| date-fns | fallow | crap | health | 1.18 (1.18-1.18) | 231 | 1 |
| date-fns | fallow | crap | tests | 10.07 (10.07-10.07) | 1270 | 0 |
| date-fns | fallow | full | all | 1.34 (1.31-1.52) | 313 | 0 |
| date-fns | fallow | full | dead-code | 0.68 (0.66-0.70) | 172 | 1 |
| date-fns | fallow | full | dupes | 0.51 (0.48-0.64) | 203 | 0 |
| date-fns | fallow | full | health | 1.06 (0.91-1.17) | 247 | 1 |
| date-fns | quality-ts | changed | all | 37.28 (36.98-38.52) | 1593 | 1 |
| date-fns | quality-ts | changed | crap | 15.29 (15.29-15.29) | 1874 | 0 |
| date-fns | quality-ts | crap | crap | 18.80 (18.80-18.80) | 1738 | 1 |
| date-fns | quality-ts | full | all | 39.43 (33.10-40.91) | 2101 | 1 |
| date-fns | quality-ts | full | architecture | 3.12 (3.10-3.38) | 492 | 1 |
| date-fns | quality-ts | full | cohesion | 2.81 (2.38-2.82) | 482 | 1 |
| date-fns | quality-ts | full | dry-yagni | 18.49 (17.70-18.90) | 599 | 1 |
| date-fns | quality-ts | full | function | 8.66 (8.61-8.75) | 1493 | 1 |
| date-fns | quality-ts | full | types | 9.29 (8.77-9.45) | 1472 | 1 |
| quality-ts | fallow | changed | all | 0.68 (0.68-0.76) | 160 | 1 |
| quality-ts | fallow | crap | health | 0.30 (0.30-0.30) | 134 | 2 |
| quality-ts | fallow | crap | tests | 424.73 (424.73-424.73) | 2453 | 1 |
| quality-ts | fallow | full | all | 0.33 (0.32-0.43) | 205 | 0 |
| quality-ts | fallow | full | dead-code | 0.21 (0.19-0.21) | 128 | 1 |
| quality-ts | fallow | full | dupes | 0.14 (0.13-0.15) | 112 | 0 |
| quality-ts | fallow | full | health | 0.31 (0.27-0.31) | 148 | 1 |
| quality-ts | quality-ts | changed | all | 12.39 (12.28-12.70) | 1018 | 1 |
| quality-ts | quality-ts | changed | crap | 420.98 (420.98-420.98) | 2530 | 2 |
| quality-ts | quality-ts | crap | crap | 462.70 (462.70-462.70) | 2540 | 2 |
| quality-ts | quality-ts | full | all | 13.02 (12.21-14.16) | 1304 | 1 |
| quality-ts | quality-ts | full | architecture | 2.25 (2.15-2.57) | 380 | 1 |
| quality-ts | quality-ts | full | cohesion | 2.17 (2.15-2.60) | 373 | 0 |
| quality-ts | quality-ts | full | dry-yagni | 4.61 (4.00-5.03) | 472 | 1 |
| quality-ts | quality-ts | full | function | 6.21 (5.50-6.88) | 862 | 1 |
| quality-ts | quality-ts | full | types | 6.81 (6.45-7.15) | 722 | 1 |
| ts-pattern | fallow | changed | all | 0.48 (0.45-0.48) | 141 | 1 |
| ts-pattern | fallow | crap | health | 0.68 (0.68-0.68) | 138 | 1 |
| ts-pattern | fallow | crap | tests | 21.26 (21.26-21.26) | 2035 | 0 |
| ts-pattern | fallow | full | all | 0.24 (0.23-0.37) | 186 | 0 |
| ts-pattern | fallow | full | dead-code | 0.19 (0.17-0.21) | 126 | 1 |
| ts-pattern | fallow | full | dupes | 0.14 (0.12-0.15) | 109 | 0 |
| ts-pattern | fallow | full | health | 0.21 (0.20-0.23) | 137 | 1 |
| ts-pattern | quality-ts | changed | all | 5.89 (5.14-6.06) | 604 | 1 |
| ts-pattern | quality-ts | changed | crap | 29.66 (29.66-29.66) | 2335 | 0 |
| ts-pattern | quality-ts | crap | crap | 19.95 (19.95-19.95) | 2400 | 1 |
| ts-pattern | quality-ts | full | all | 4.87 (3.71-6.68) | 658 | 1 |
| ts-pattern | quality-ts | full | architecture | 1.31 (1.24-1.48) | 306 | 1 |
| ts-pattern | quality-ts | full | cohesion | 1.65 (1.58-2.36) | 290 | 1 |
| ts-pattern | quality-ts | full | dry-yagni | 3.40 (3.05-3.55) | 387 | 1 |
| ts-pattern | quality-ts | full | function | 2.30 (2.28-2.33) | 442 | 1 |
| ts-pattern | quality-ts | full | types | 2.10 (1.84-2.52) | 436 | 1 |
| zod | fallow | changed | all | 1.74 (1.71-3.28) | 248 | 0 |
| zod | fallow | crap | health | 0.95 (0.95-0.95) | 220 | 1 |
| zod | fallow | crap | tests | 125.30 (125.30-125.30) | 1751 | 0 |
| zod | fallow | full | all | 0.89 (0.86-0.97) | 281 | 0 |
| zod | fallow | full | dead-code | 0.46 (0.42-0.49) | 168 | 1 |
| zod | fallow | full | dupes | 0.24 (0.24-0.25) | 154 | 0 |
| zod | fallow | full | health | 0.59 (0.57-0.62) | 214 | 1 |
| zod | quality-ts | changed | all | 24.73 (24.42-27.10) | 2201 | 134 |
| zod | quality-ts | changed | crap | 22.35 (22.35-22.35) | 1324 | 2 |
| zod | quality-ts | changed-big-heap | all | 126.92 (126.92-126.92) | 2906 | 1 |
| zod | quality-ts | crap | crap | 337.21 (337.21-337.21) | 1851 | 2 |
| zod | quality-ts | full | all | 41.63 (33.94-57.69) | 2267 | 134 |
| zod | quality-ts | full | architecture | 2.36 (2.13-2.72) | 309 | 1 |
| zod | quality-ts | full | cohesion | 3.31 (3.24-3.39) | 443 | 1 |
| zod | quality-ts | full | dry-yagni | 6.07 (5.79-6.40) | 491 | 1 |
| zod | quality-ts | full | function | 22.45 (19.89-29.10) | 1790 | 1 |
| zod | quality-ts | full | types | 22.65 (21.03-24.22) | 2208 | 134 |
| zod | quality-ts | full-big-heap | all | 120.75 (120.75-120.75) | 3094 | 1 |
| zustand | fallow | changed | all | 0.45 (0.43-0.55) | 136 | 0 |
| zustand | fallow | crap | health | 0.28 (0.28-0.28) | 128 | 1 |
| zustand | fallow | crap | tests | 9.31 (9.31-9.31) | 771 | 0 |
| zustand | fallow | full | all | 0.33 (0.30-0.59) | 187 | 0 |
| zustand | fallow | full | dead-code | 0.19 (0.18-0.25) | 131 | 1 |
| zustand | fallow | full | dupes | 0.11 (0.11-0.11) | 111 | 0 |
| zustand | fallow | full | health | 0.21 (0.19-0.22) | 129 | 1 |
| zustand | quality-ts | changed | all | 7.17 (5.78-7.51) | 858 | 1 |
| zustand | quality-ts | changed | crap | 12.42 (12.42-12.42) | 1034 | 0 |
| zustand | quality-ts | crap | crap | 11.14 (11.14-11.14) | 1050 | 1 |
| zustand | quality-ts | full | all | 7.62 (6.93-9.57) | 949 | 1 |
| zustand | quality-ts | full | architecture | 2.14 (1.73-2.47) | 301 | 1 |
| zustand | quality-ts | full | cohesion | 1.53 (1.49-1.62) | 314 | 0 |
| zustand | quality-ts | full | dry-yagni | 2.06 (2.05-2.54) | 406 | 1 |
| zustand | quality-ts | full | function | 3.97 (3.06-4.22) | 599 | 1 |
| zustand | quality-ts | full | types | 4.43 (4.06-5.15) | 574 | 1 |

#### Linux x64 (ubuntu-24.04)

| Repo | Tool | Mode | Category | Wall s, median (min-max) | Peak MB | Exit |
|---|---|---|---|---|---|---|
| date-fns | fallow | changed | all | 1.57 (1.52-1.58) | 328 | 0 |
| date-fns | fallow | crap | health | 0.92 (0.92-0.92) | 235 | 1 |
| date-fns | fallow | crap | tests | 9.78 (9.78-9.78) | 1472 | 0 |
| date-fns | fallow | full | all | 1.04 (1.03-1.23) | 268 | 0 |
| date-fns | fallow | full | dead-code | 0.56 (0.56-0.56) | 190 | 1 |
| date-fns | fallow | full | dupes | 0.41 (0.41-0.41) | 220 | 0 |
| date-fns | fallow | full | health | 0.95 (0.86-0.96) | 240 | 1 |
| date-fns | quality-ts | changed | all | 21.67 (21.43-21.87) | 1774 | 1 |
| date-fns | quality-ts | changed | crap | 14.65 (14.65-14.65) | 2232 | 0 |
| date-fns | quality-ts | crap | crap | 18.61 (18.61-18.61) | 2154 | 1 |
| date-fns | quality-ts | full | all | 31.47 (31.33-31.63) | 2806 | 1 |
| date-fns | quality-ts | full | architecture | 4.22 (4.22-4.24) | 513 | 1 |
| date-fns | quality-ts | full | cohesion | 3.26 (3.26-3.34) | 505 | 1 |
| date-fns | quality-ts | full | dry-yagni | 4.43 (4.43-4.50) | 598 | 1 |
| date-fns | quality-ts | full | function | 12.09 (12.03-12.09) | 1751 | 1 |
| date-fns | quality-ts | full | types | 12.60 (12.52-12.69) | 1546 | 1 |
| quality-ts | fallow | changed | all | 0.42 (0.42-0.46) | 207 | 1 |
| quality-ts | fallow | crap | health | 0.34 (0.34-0.34) | 188 | 1 |
| quality-ts | fallow | crap | tests | 379.50 (379.50-379.50) | 3862 | 0 |
| quality-ts | fallow | full | all | 0.29 (0.28-0.51) | 171 | 0 |
| quality-ts | fallow | full | dead-code | 0.20 (0.20-0.20) | 157 | 1 |
| quality-ts | fallow | full | dupes | 0.15 (0.14-0.15) | 148 | 0 |
| quality-ts | fallow | full | health | 0.27 (0.27-0.27) | 171 | 1 |
| quality-ts | quality-ts | changed | all | 7.12 (7.08-7.12) | 1031 | 1 |
| quality-ts | quality-ts | changed | crap | 290.67 (290.67-290.67) | 3915 | 0 |
| quality-ts | quality-ts | crap | crap | 288.31 (288.31-288.31) | 3742 | 1 |
| quality-ts | quality-ts | full | all | 8.93 (8.93-8.95) | 1328 | 1 |
| quality-ts | quality-ts | full | architecture | 1.65 (1.63-1.66) | 381 | 1 |
| quality-ts | quality-ts | full | cohesion | 1.55 (1.55-1.56) | 357 | 0 |
| quality-ts | quality-ts | full | dry-yagni | 1.80 (1.80-1.81) | 498 | 1 |
| quality-ts | quality-ts | full | function | 4.25 (4.23-4.30) | 856 | 1 |
| quality-ts | quality-ts | full | types | 4.78 (4.78-4.81) | 744 | 1 |
| ts-pattern | fallow | changed | all | 0.20 (0.20-0.21) | 174 | 1 |
| ts-pattern | fallow | crap | health | 0.15 (0.15-0.15) | 156 | 1 |
| ts-pattern | fallow | crap | tests | 13.55 (13.55-13.55) | 3191 | 0 |
| ts-pattern | fallow | full | all | 0.15 (0.15-0.26) | 156 | 0 |
| ts-pattern | fallow | full | dead-code | 0.12 (0.12-0.12) | 147 | 1 |
| ts-pattern | fallow | full | dupes | 0.10 (0.09-0.10) | 128 | 0 |
| ts-pattern | fallow | full | health | 0.14 (0.14-0.15) | 161 | 1 |
| ts-pattern | quality-ts | changed | all | 3.02 (3.02-3.05) | 621 | 1 |
| ts-pattern | quality-ts | changed | crap | 16.51 (16.51-16.51) | 3450 | 0 |
| ts-pattern | quality-ts | crap | crap | 14.72 (14.72-14.72) | 3016 | 1 |
| ts-pattern | quality-ts | full | all | 3.27 (3.26-3.36) | 675 | 1 |
| ts-pattern | quality-ts | full | architecture | 1.33 (1.33-1.34) | 296 | 1 |
| ts-pattern | quality-ts | full | cohesion | 1.26 (1.25-1.27) | 282 | 1 |
| ts-pattern | quality-ts | full | dry-yagni | 1.67 (1.65-1.70) | 391 | 1 |
| ts-pattern | quality-ts | full | function | 1.91 (1.91-1.93) | 452 | 1 |
| ts-pattern | quality-ts | full | types | 2.03 (2.03-2.06) | 421 | 1 |
| zod | fallow | changed | all | 0.70 (0.69-0.72) | 291 | 0 |
| zod | fallow | crap | health | 0.47 (0.47-0.47) | 191 | 1 |
| zod | fallow | crap | tests | 74.01 (74.01-74.01) | 1790 | 0 |
| zod | fallow | full | all | 0.51 (0.50-0.63) | 209 | 0 |
| zod | fallow | full | dead-code | 0.29 (0.29-0.30) | 156 | 1 |
| zod | fallow | full | dupes | 0.18 (0.18-0.18) | 135 | 0 |
| zod | fallow | full | health | 0.45 (0.44-0.46) | 192 | 1 |
| zod | quality-ts | changed | all | 63.03 (62.67-64.75) | 3793 | 1 |
| zod | quality-ts | changed | crap | 14.96 (14.96-14.96) | 1248 | 2 |
| zod | quality-ts | crap | crap | 207.67 (207.67-207.67) | 1956 | 2 |
| zod | quality-ts | full | all | 87.38 (86.71-87.73) | 4093 | 1 |
| zod | quality-ts | full | architecture | 2.51 (2.50-2.52) | 309 | 1 |
| zod | quality-ts | full | cohesion | 3.30 (3.30-3.33) | 439 | 1 |
| zod | quality-ts | full | dry-yagni | 2.72 (2.69-2.74) | 620 | 1 |
| zod | quality-ts | full | function | 18.77 (18.73-18.77) | 2590 | 1 |
| zod | quality-ts | full | types | 57.80 (57.33-58.57) | 3497 | 1 |
| zustand | fallow | changed | all | 0.29 (0.28-0.29) | 173 | 0 |
| zustand | fallow | crap | health | 0.21 (0.21-0.21) | 164 | 1 |
| zustand | fallow | crap | tests | 8.86 (8.86-8.86) | 953 | 0 |
| zustand | fallow | full | all | 0.24 (0.24-0.45) | 162 | 0 |
| zustand | fallow | full | dead-code | 0.21 (0.21-0.21) | 153 | 1 |
| zustand | fallow | full | dupes | 0.14 (0.14-0.14) | 140 | 0 |
| zustand | fallow | full | health | 0.21 (0.21-0.21) | 156 | 1 |
| zustand | quality-ts | changed | all | 6.40 (6.35-6.42) | 880 | 1 |
| zustand | quality-ts | changed | crap | 10.05 (10.05-10.05) | 1225 | 0 |
| zustand | quality-ts | crap | crap | 10.37 (10.37-10.37) | 1242 | 1 |
| zustand | quality-ts | full | all | 7.12 (6.96-7.74) | 986 | 1 |
| zustand | quality-ts | full | architecture | 1.63 (1.61-1.64) | 290 | 1 |
| zustand | quality-ts | full | cohesion | 1.63 (1.63-1.64) | 302 | 0 |
| zustand | quality-ts | full | dry-yagni | 2.28 (2.23-2.31) | 410 | 1 |
| zustand | quality-ts | full | function | 3.59 (3.56-3.64) | 627 | 1 |
| zustand | quality-ts | full | types | 4.40 (4.32-4.41) | 560 | 1 |

### Mutation

Sum h adds the wall time of every shard: the runner time. Slowest shard h is the wall time with every shard in parallel.

#### macOS arm64 (macos-15)

| Repo | Tool | Shards run | Sum h | Slowest shard h | Timeouts | Peak MB | Exit |
|---|---|---|---|---|---|---|---|
| date-fns | fallow | 1 of 16 | 0.05 | 0.05 | 0 | 2544 | 0 |
| quality-ts | fallow | 1 of 8 | 5.67 | 5.67 | 1 | 3028 | timeout |
| quality-ts | quality-ts | 1 of 8 | 0.00 | 0.00 | 0 | 2283 | 2 |
| ts-pattern | quality-ts | 1 of 1 | 0.20 | 0.20 | 0 | 3635 | 0 |
| zod | quality-ts | 1 of 24 | 0.01 | 0.01 | 0 | 905 | 2 |
| zustand | fallow | 1 of 1 | 0.09 | 0.09 | 0 | 1024 | 0 |
| zustand | quality-ts | 1 of 1 | 0.07 | 0.07 | 0 | 2186 | 0 |

#### Linux x64 (ubuntu-24.04)

| Repo | Tool | Shards run | Sum h | Slowest shard h | Timeouts | Peak MB | Exit |
|---|---|---|---|---|---|---|---|
| date-fns | fallow | 16 of 16 | 6.10 | 0.66 | 0 | 11089 | 0 |
| quality-ts | fallow | 8 of 8 | 11.91 | 5.67 | 1 | 8412 | 0,timeout |
| quality-ts | quality-ts | 8 of 8 | 0.02 | 0.00 | 0 | 2747 | 2 |
| ts-pattern | quality-ts | 1 of 1 | 0.13 | 0.13 | 0 | 12243 | 0 |
| zod | quality-ts | 24 of 24 | 0.13 | 0.01 | 0 | 931 | 2 |
| zustand | fallow | 1 of 1 | 0.11 | 0.11 | 0 | 1037 | 0 |
| zustand | quality-ts | 1 of 1 | 0.05 | 0.05 | 0 | 2590 | 0 |

Per-shard wall time of fallow on the quality-ts repo (Linux), to show the uneven file shards:

| Shard | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Wall s | over 20,400 | 3,203 | 10,181 | 1,762 | 2,242 | 476 | 3,128 | 1,496 |
| Mutants | not reported | 787 | 798 | 787 | 786 | 786 | 826 | 792 |
| Score | not reported | 0.88 | 0.86 | 0.91 | 0.87 | 0.92 | 0.89 | 0.90 |

## Gaps and failures

| Gap | Cause | Effect on the numbers |
|---|---|---|
| quality-ts mutation on the quality-ts repo | Stryker stops: "There were failed tests in the initial test run". The reason has no test names, so the bench cannot remove them. | No measured number. Estimate from [Task: Stryker on TypeScript 7 spike](https://github.com/mquesada02/qualbar/issues/17): about 41 h at concurrency 1 on 2 cores. |
| quality-ts mutation on zod | The Stryker sandbox fails: `EISDIR` when it copies `.codex/skills`, and "Projects definition references a non-existing file ... vitest.compile.config.ts". | No number. |
| quality-ts mutation on date-fns | quality-ts refuses TypeScript 7 and Vitest 5. | Not run. |
| fallow mutation on ts-pattern and zod | fallow mutation is Vitest-only (ts-pattern uses Jest). fallow 3.35.0 cannot load zod's Vitest file-based projects. | Not run. |
| fallow mutation on date-fns | Same file-based project limit at the repo root. | Runs from `pkgs/core` only (7,241 of the repo's mutants). |
| fallow mutation on the quality-ts repo, shard 1 | The shard hit the 340 min limit (20,400 s) on Linux and on macOS. Files are not split, so one shard can hold slow files. | The Linux sum (11.91 h) is a lower bound. Shard 1 has no counts. |
| quality-ts CRAP on zod | quality-ts exits 2 on both OSes (full and changed). The error reason is not in the public log. | No number. The bare test run takes 74 s on Linux. |
| macOS test run on the quality-ts repo | About 10 dependency-cruiser tests fail on macOS (a quality-ts portability issue). A failed test run writes no coverage. | No macOS CRAP number for either tool on the quality-ts repo (exit 2). |
| quality-ts static on zod, macOS | `types` aborts at the default V8 heap limit (exit 134, about 2.2 GB). | Extra `full-big-heap` and `changed-big-heap` runs with `--max-old-space-size=6144`: 120.75 s / 3,094 MB and 126.92 s / 2,906 MB. |
| Mutation peak memory on Linux | The runners have 16 GB, and the tools start one worker per core. | Linux mutation peaks (up to 12 GB) are higher than macOS peaks (3 vCPU, 7 GB). Compare peaks only on the same OS. |

Exit code 1 in the static tables is normal: it means the tool found issues.
