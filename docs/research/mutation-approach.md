# Mutation approach for qualbar (issue #3)

Date: 2026-10-18. Sources: stryker-js master (cloned 2026-10-18, HEAD of 2026-10-10, v10.0.0), fallow master (HEAD d406a14, v3.34.1), quality-ts repo via `gh`.
Paths below are relative to those repos. Base URLs:
- S = https://github.com/stryker-mutator/stryker-js/blob/master/
- F = https://github.com/fallow-rs/fallow/blob/main/
- Q = https://github.com/mquesada02/quality-ts (private)

## 1. What quality-ts actually used

- Options passed: `testRunner: "vitest"`, `coverageAnalysis: "perTest"`, no `incremental`, no `ignoreStatic`, no `concurrency` (default). Source: Q `src/adapters/mutation/stryker-runner.ts` (the `new Stryker({...})` call).
- Vitest runner ignores `coverageAnalysis` and always uses perTest. S `docs/vitest-runner.md`, section "Limitations".
- Sharding in quality-ts was its own code: files balanced by line count, not mutant count. Q `src/adapters/mutation/shards.ts` (`selectShardFiles`, `assignShards(sized, ...)` on `lines`).
- Numbers: spec #103 says 9003 mutants, 1373 tests, > 6h50m on 4 cores. Coordinator note on #43 says shards 2-8 gave 7502/8683 killed (86.4 %) and shard 1 ran > 6 h. The user gave 11h45m for the unsharded run.
- Derived: 11h45m = 42 300 s over 9004 mutants = 4.7 s wall per mutant, 18.8 core-seconds per mutant on 4 workers.
- Derived: shards 2-8 hold 8683 mutants. So shard 1 held about 320 mutants (9003 - 8683) and still ran > 6 h. That is > 67 s per mutant. This is an inference from the two numbers; the 8683 may exclude ignored or compile-error mutants.
- `src/domain/catalog.ts` is 531 lines, 331 quoted strings. Q `src/domain/catalog.ts`. It is top-level data.
- quality-ts tests are heavy: `testTimeout: 120_000`, `hookTimeout: 600_000`, a `globalSetup`, and fixture/e2e tests. Q `vitest.config.ts`.

## 2. Stryker (StrykerJS 10.0.0)

### Mechanism (mutant schemata)
- The instrumenter writes all mutants into the code once. A runtime variable picks the active mutant, so there is no recompile per mutant. Active mutant is passed to the vitest worker through `inject('activeMutant')`. S `packages/vitest-runner/src/stryker-setup.ts`.
- Mutators in the instrumenter: 18 files incl. BlockStatement, ObjectLiteral, ArrayDeclaration, ArrowFunction, MethodExpression, Regex. S `packages/instrumenter/src/mutators/`. This is why Stryker makes more mutants than fallow (12 operators).

### Per-test coverage (perTest)
- Doc: perTest finds, in the dry run, which tests cover each mutant. Only those run. "This performance optimization does not influence the resulting mutation testing score". Tests must run independently and in any order. S `docs/configuration.md`, section `coverageAnalysis`.
- Static mutants (run while the file loads, not inside a test) cannot be tied to a test. With `ignoreStatic: false` (default) they run ALL tests. S `docs/configuration.md` section `ignoreStatic`; S `packages/core/src/mutants/mutant-test-planner.ts` (branch "Static ... ignoreStatic is off -> run all tests").
- Static mutants also force a full environment reload: `canHotSwap = !!testFilter && isStatic === false`, `reloadEnvironment: !canHotSwap`. Same file.
- Stryker itself warns when static mutants are > 40 % of estimated time (`warnAboutSlow`, same file).
- `ignoreStatic: true` marks them `Ignored` ("Static mutant (and ignoreStatic was enabled)"). They leave the score. That weakens a strict gate. Same file.

### Vitest runner
- Runs vitest in-process via `createVitest`, one worker per Stryker worker (`maxWorkers: 1`), `bail: 1`, no coverage. S `packages/vitest-runner/src/vitest-test-runner.ts` (`init`, `#getVitestPoolConfig`).
- Test filter: a regex of covering test names plus the covering test files. Same file, `run()`.
- `vitest.related` (default true) restricts a run to test files that import the mutated file, via Vitest `related`. For a static mutant the filter is the related files only. Same file, `mutantRun`; S `docs/vitest-runner.md`.
- Consequence: if `catalog.ts` is imported by most test files, every catalog mutant selects most of the suite, with or without Stryker. Static ones also reload.
- Limits: threads pool only; no browser mode; `coverageAnalysis` ignored. S `docs/vitest-runner.md` "Limitations".

### Jest runner
- Supports perTest by hooking the Jest test environment and the Jest test runner (jest-circus or jasmine2). A custom test runner is not supported for perTest. `jest.enableFindRelatedTests` option. S `docs/jest-runner.md`, "Coverage analysis".
- ESM needs `testRunnerNodeArgs: ["--experimental-vm-modules"]`. Same doc.

### Incremental mode
- `--incremental` writes `reports/stryker-incremental.json`. It reuses a result when: killed and the killing test still exists unchanged; or not killed and no new/changed test covers it. Git-like diff of mutated files and tests. The dry run still runs. S `docs/incremental.md`.
- Limits (same doc): changes in non-mutated, non-test files, dependencies, env vars, snapshots are NOT detected. Static mutants get no test-change detection. Use `--force` for a re-check. Vitest and Jest give full test reporting.
- New in 10.0.0: partial results are saved on interrupt. Q `docs/research/r3-stryker-programmatic.md` (release notes) and S `docs/incremental.md` "Interrupted runs".
- quality-ts did not enable it.

### Sharding / parallelism
- No built-in sharding. `grep -ri shard` over S finds nothing. Parallelism is only local worker processes (`concurrency`, default cores, or cores-1 when > 4 cores). S `docs/parallel-workers.md`, `docs/configuration.md`.
- Manual sharding is possible: `--mutate file:startLine-endLine` is documented and can balance by mutant count. S `docs/incremental.md` ("--mutate src/app.js:5-7"). Merge: `mutation-testing-report-schema` JSON; incremental file keeps out-of-scope files (same doc).
- Reference design from another engine: cargo-mutants `--shard k/n`, `--sharding slice|round-robin`. https://mutants.rs/shards.html

### Known risks
- core and runners must be the same exact version (peer `"10.0.0"`). Q `docs/research/r3-stryker-programmatic.md`.
- TypeScript 7.x crashes core 10.0.0 when a tsconfig exists (stryker-js#6111, per the same doc; not re-verified here).
- Stryker copies the project into `.stryker-tmp/sandbox-*` per run (same doc, `cleanTempDir`).
- Needs Node >= 22. It is a Node dependency of the user's repo, not part of our binary.

### Score formula
- detected = Killed + Timeout; valid = detected + Survived + NoCoverage; score = detected / valid. Ignored, CompileError, RuntimeError, Pending excluded. Q `docs/research/r3-stryker-programmatic.md` section "Scores" (read from `calculateMetrics.js`, mutation-testing-metrics 3.8.4).

## 3. fallow `mutation` (v3.34.0, released 2026-10-17)

Maturity: the command is one day old at the cloned HEAD (CHANGELOG `## [3.34.0] - 2026-10-17`, F `CHANGELOG.md`). The repo has 5175 stars and was created 2026-03-17, but this feature has no track record. Stryker: 3238 stars, years of releases. (GitHub API, 2026-10-18.)

### Design (all from F `docs/mutation-testing.md` unless noted)
- Generation: Rust crate `crates/mutation` (2277 src lines + ~1900 test lines), Oxc parse, 12 operators (arithmetic, relational, logical, negate-condition, unary, update, removed-call, return-value, boolean, string, optional-chaining, regex). F `crates/mutation/src/lib.rs`, F `docs/mutation-testing.md` "Operators".
- No AST reprint. The output is a text splice over the original, with a source map back. F `crates/mutation/src/lib.rs` module doc.
- Schemata: the instrumented file calls `__fallow_m_a(id)` before each mutated branch, and `__fallow_m_c(id)` to record a hit. Same file, constants `ACTIVE_FUNCTION`, `HIT_FUNCTION`. Same idea as Stryker.
- Run: Rust orchestrator talks JSON over stdio to a Node "companion" (`tools/mutation-runner`, ~2100 lines JS + ~1700 test lines). Vitest adapter uses `createVitest` and a Vite overlay plugin that serves the instrumented copies. F `tools/mutation-runner/src/adapters/vitest.mjs`.
- Test selection: a dry run records which test ids hit which mutant. A mutant run selects those test ids. A test covers a mutant if it hits it, "or when its file loads the module of a mutant that the module load hits". Section "Score and coverage".
- Self-check: a control run guards against a runner API change that makes every mutant look killed (Vitest 4.0 had this bug). Section "Run-path self-check".
- Retries: survived or timeout gets one retry in a new process; changed result is `flaky` and leaves the score. Section "Retries".
- Cache: `results.json`, keyed on mutant id, mutated file content, covering tests, test files and their static import reach, setup files, lockfile, runner config, tsconfig chain. Known gaps listed (dynamic imports, files tests read, nested configs). Section "Result cache".
- Scope: default is changed code vs base ref; `--all`; paths; `--max-mutants` and `--time-budget` give a partial run. No sharding flag (grep found none).
- Safety: refuses dirty worktree; prunes mutants near fs/process/network/db calls and framework config. Section "Safety boundary".

### Runner support
- Vitest 4.1 to 5 (4.0 refused), `node:test` (Node 22.18 to 26), `bun test` (1.4+). **No Jest.** (grep "jest" in F `docs/mutation-testing.md` and `ROADMAP.md` finds nothing.) Section "Runners".
- Vitest type tests (`typecheck.enabled`) are not run (note `typecheck-not-run`).

### Score differences vs Stryker
- fallow: score = (killed + timeout) / (killed + timeout + survived), executed mutants only. `no_coverage` is reported apart as `coverage`, never in the score. Section "Score and coverage".
- Stryker: NoCoverage counts as not detected, in the denominator.
- So a number from one engine is not comparable to the other. A strict gate must define both values.

### Speed evidence
- I found no published speed numbers for `fallow mutation` (BENCHMARKS.md and ROADMAP.md have none for mutation). Any speed claim for fallow is unmeasured.

## 4. Effort to build our own Rust engine

Measured on fallow (a working reference we may copy, MIT):
- Generation + splice: 2277 Rust lines (+ tests ~1900).
- Plan, rank, reach, run scheduling, report, cache, CLI, output: `crates/{engine,api,cli,output}` mutation files = 14 547 lines in total with tests (wc -l over `crates/api/src/mutation`, `crates/engine/src/mutation`, `crates/cli/src/mutation*`, `crates/output/src/mutation.rs`).
- Node companion: ~2100 lines JS + ~1700 test lines for 3 runners.
- Jest adapter: not in fallow. We would write it (Jest environment/runner hooks like S `packages/jest-runner`). Estimate: same size as the Vitest adapter (616 lines) or more; unmeasured.
- Maintenance: the cost is runner-API drift. Fallow already had a false-100 % bug on Vitest 4.0 and pins version ranges per runner. Our team is agent-maintained and does not know Rust, so each runner break costs more.
- Copying fallow's crate directly cuts generation work, but the scheduler/companion still need porting and tests.

## 5. Expected speed and score correctness

| Item | Stryker 10 + Vitest | Stryker 10 + Jest | fallow engine | Own engine (fallow-like) |
|---|---|---|---|---|
| Mutant gen | JS, fast enough | same | Rust, faster, not the bottleneck | same as fallow |
| Test selection | per-test (+ vitest related) | per-test | per-test id from dry run | same |
| Static (load-time) mutants | all tests, env reload (default) | all tests | tests whose file loads the module | same as fallow |
| Hot swap | yes, for non-static | yes | runner process reused; Vitest reload `noop` when isolate on | same |
| Result reuse | incremental file | same | content-keyed cache | same |
| Sharding | none built in; use `--mutate` ranges | same | none | we build it |
| Runners | Vitest, Jest, others | | Vitest, node:test, bun | choose |
| Maturity | years | years | 1 day | zero |

Reasoning on speed, with the numbers we have:
1. Per-mutant cost is test time, not generation time. quality-ts: 18.8 core-seconds per mutant. Generation of 9004 mutants by Oxc takes seconds (fallow crate is a pure parse + splice).
2. The slow part is mutants whose covering set is most of the suite. `catalog.ts` is imported by most tests, and its mutants are load-time (static) in Stryker. Stryker then runs all 1373 tests with a reload per mutant. The ~320-mutant shard 1 taking > 6 h fits this (inference, not measured: nobody counted `static: true` mutants).
3. fallow's design reduces tests only to "files that load the module". For a module imported by most tests that is still most test files. So the Rust engine would not remove this cost either. It saves the Stryker sandbox copy and the extra mutators, not the test time.
4. Correctness of both is the same class: schemata switch, per-test coverage, bail on first failure. Equivalent mutants are not detected by either. Timeouts: Stryker `timeoutFactor * netTime + timeoutMS + overhead`; fallow retries once.

## 6. Recommendation

**Drive Stryker in v1. Do not build an engine now.**

Why, with numbers:
- Jest + Vitest are both required (issue #3). Stryker has both with perTest. fallow has Vitest/node:test/bun and no Jest. A Rust engine means writing the Jest adapter ourselves (the 616-line Vitest adapter is the size reference).
- Own engine = about 2.3k lines generation + 12k lines orchestration/report/cache + 3.8k lines JS companion (fallow's actual size, with tests). Stryker integration in quality-ts was one 150-line runner plus mapping. The speed gain is unproven: no fallow benchmarks exist, and the dominant cost (test time per mutant, 18.8 core-s) is the same for both.
- Score correctness: Stryker's formula is fixed and documented; our gate can use it unchanged. A new engine needs its own definition of no-coverage and equivalent mutants.

How to make the Stryker path fast (to test in the first ticket, because it is not measured):
1. Count static mutants in a quality-ts-like run (`static: true` in the report). If they are large, test `ignoreStatic: true` but report the ignored count as a separate value. That keeps the strict rule: no hidden exemption. (Needs user approval, because it changes the score meaning.)
2. Shard by mutant count with `--mutate file:start-end` ranges, not by file lines. Quality-ts split by lines and one shard held ~320 mutants that took > 6 h.
3. Use `incremental` plus a cached incremental file in CI. Run `--force` when config or dependencies change (the doc says these are not detected).
4. Set `concurrency` to the runner cores. Keep `vitest.related` on.
5. Keep the quality-ts TypeScript 7 / exact-version-lockstep guards.

Revisit an own engine in v2 only if: (a) fallow's mutation has several releases and benchmarks, and (b) a measured quality-ts-like run shows Stryker overhead (sandbox copy, reload) above ~30 % of wall time. Also consider reusing fallow's `crates/mutation` splice code later (MIT) to drive the same Vitest companion.

## 7. Open uncertainties

1. Share of static mutants in quality-ts and their time share. Not measured. This decides if ignoreStatic or re-structuring `catalog.ts` imports is the fix.
2. Whether shard 1 really had ~320 mutants. Derived from two numbers in issues #103 and #43; valid-mutant counts may differ from total.
3. Wall time of one full quality-ts test run, and test-time share of the per-mutant cost. Not found in the repo.
4. No speed benchmarks for fallow mutation exist in its repo. Its claimed behavior is from docs, not from a run (I did not build or run anything).
5. Stryker Jest runner behaviour with ESM and Jest 30 at scale: docs only, not exercised here.
6. Stryker 10 vitest hot-swap: for Vitest each run calls `ctx.start()` with a fresh `resetContext()`; the real cost of that per mutant is not measured.
7. Whether the TypeScript 7 crash (stryker-js#6111) is fixed. Taken from quality-ts research doc, not rechecked on GitHub (search API gave 404).
8. Stryker score counts NoCoverage as undetected; fallow's does not. The qualbar gate must choose one definition. Needs a decision ticket.
9. Time to build fallow's mutation feature is unknown (the repo clone is shallow, one commit).
