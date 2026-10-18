# Affected tests and coverage (qualbar issue #7)

Date: 2026-10-18. Source checkouts read: vitest `de5af29` (main), jest `61050e9` (main).
Tags: [S] = quoted or read from a primary source. [A] = my analysis, not in a source.
Short names for source files: V = github.com/vitest-dev/vitest/blob/main/packages/vitest/src/node/..., J = github.com/jestjs/jest/blob/main/packages/...

## 1. How each runner selects related tests

### Vitest
- `vitest related <files>` runs "only tests that cover a list of source files". It "works with static imports", not dynamic ones like `import(filepath)`. Pass `--run` or it enters watch mode. [S] https://vitest.dev/guide/cli.html (section `related`)
- `--changed [since]` runs tests "affected by the changed files". Changed files come from git by default (`experimental.vcsProvider`). [S] https://vitest.dev/guide/cli.html ; https://vitest.dev/config/experimental
- Code path: `--changed` calls `vcs.findChangedFiles`, stores them as `config.related`, then `filterTestsBySource` runs. [S] V `specifications.ts` lines 123-160 (`filterTestsBySource`).
- If no related file is found and not in watch mode, it runs zero tests. [S] same file, "don't run anything if no related sources are found".
- Run-all triggers: a changed file matching `forceRerunTriggers`; a change to the Vite config file or its dependencies; a change to `.env` files; a change to a global setup file, setup file, custom environment, runner, snapshot serializer. [S] V `specifications.ts` and V `affected-modules.ts` (`AffectedModulesResolver.resolve`, `findAffectedInProject`, `findAffectedInEnvironment`)
- Graph source: it uses Vite's transform of each file (`transformed.deps` plus `transformed.dynamicDeps`) and Vite's `moduleGraph.importedModules`. So it is the real Vite resolution (aliases, tsconfig paths, plugins) and not a text scan. [S] V `affected-modules.ts` `transformModule`
- Mocks: it is mock-aware. `vi.mock` targets are removed from the graph for that test, `vi.importActual` adds an edge. [S] V `affected-modules.ts` (`getStaticMocks`, `resolveStaticMocks`, `reachesChange`)
- Snapshots: a changed snapshot file selects its spec. [S] V `affected-modules.ts` `getSnapshotFile`
- Side effect: it transforms every test's module graph before each run (cost). [S] https://vitest.dev/config/experimental (`recordDependencies`)
- `experimental.recordDependencies` (5.0.4+): reads dependency records from the previous run (`dependencies.json` in Vite `cacheDir`). Test files with no record always run. Limits: modules replaced by a `vi.mock` factory record no imports; dynamic imports in functions the test never called are not recorded; files read with `fs` are not recorded. [S] https://vitest.dev/config/experimental
- Not in the graph: runtime `fs` reads, non-literal dynamic imports, `import.meta.glob` effects (not checked by me), browser/typecheck pools (always run in the recorded mode). [S] partly (above); the rest [A]

### Jest
- `--findRelatedTests <files>`: "Find and run the tests that cover a space separated list of source files". Can combine with `--coverage`; "no duplicate `--collectCoverageFrom` arguments needed". [S] https://jestjs.io/docs/cli
- `--onlyChanged`: needs git or hg and "requires a static dependency graph (ie. no dynamic requires)". `--changedSince <ref>` is similar; if the branch diverged, only local changes are tested. `--lastCommit` uses the last commit only. [S] https://jestjs.io/docs/cli
- Graph source: `jest-haste-map` reads raw source text and extracts dependencies with regexes. It strips comments, then matches `import/export ... from '...'` (skips `import type`), `require('...')`, `import('...')` with a string literal, and `jest.requireActual/requireMock/createMockFromModule('...')`. [S] J `jest-haste-map/src/lib/dependencyExtractor.ts` ; `worker.ts` (reads file content, no transform)
- Resolution: each extracted specifier is resolved with Jest's resolver (`moduleNameMapper`, `modulePaths`, `skipNodeResolution`). Unresolvable specifiers fall back to mock lookup. [S] J `jest-resolve-dependencies/src/index.ts` `resolve`
- The inverse closure from the changed files to test files is the answer (`resolveInverse`). [S] J `jest-core/src/SearchSource.ts` `findRelatedTests`
- Customizable: `dependencyExtractor` config replaces the regex extractor. [S] https://jestjs.io/docs/configuration (`dependencyExtractor`)
- Misses: non-literal `require(x)` and `import(x)`; template literals with `${}` (the string regex excludes quotes/backticks only partly, so treat as missed [A]); specifiers added by transformers (the scan sees the pre-transform source) [A, follows from worker.ts reading raw content]; changes to setup files, config, `globalSetup` do not trigger run-all (I found no such code in `SearchSource.ts`/`jest-resolve-dependencies`) [A]; files read with `fs`.
- TypeScript: Jest does not do type-only elision here beyond `import type`. `import { T } from './types'` where T is only a type still counts as an edge (over-selection, safe). [A]

### Accuracy summary [A, from the above]
- Both are static and under-select when a test loads code dynamically or through `fs`, config, env, fixtures or snapshots (Vitest handles snapshots and config; Jest does not handle config).
- Both over-select slightly (type-only imports, barrel files). Over-selection is safe for a gate.
- Vitest's Vite-based graph matches runtime resolution better than Jest's regex scan. Jest's scan is cheap and needs no transform.

## 2. Coverage from only the selected tests

### Vitest
- `vitest related <files> --run --coverage`. With `--changed`, coverage is restricted to changed files: `coverage.changed` "Collect coverage only for files changed since a specified commit or branch", default inherits `test.changed`. [S] https://vitest.dev/config/coverage ; V `coverage.ts` lines 188-190 and 379-395 (`changedFiles` filter; with `related` it uses `config.related`)
- Without `--changed`, `coverage.include` default is "files imported during the run". [S] https://vitest.dev/config/coverage
- Coverage dir is deleted before the run when `coverage.clean` is true (default). Set `--coverage.clean=false` or use a separate `--coverage.reportsDirectory` per run to keep old output. [S] https://vitest.dev/config/coverage ; V `coverage.ts` `clean()`
- Merging: Vitest merges blob reports with `--merge-reports`; its coverage code merges coverage maps via `coverageMap.merge` (`mergeReports`). The docs page for reporters does not say coverage is merged. [S] V `coverage.ts` line 709 ; https://vitest.dev/guide/reporters.html (silent on it)
- `--shard=i/n` exists (not with watch). [S] https://vitest.dev/guide/cli.html

### Jest
- `jest --findRelatedTests a.ts b.ts --coverage`. When coverage is on, `findRelatedTests` sets `collectCoverageFrom` to only the changed files that the selected tests depend on. So the report holds the changed files, not all dependencies. [S] J `jest-core/src/SearchSource.ts` lines 177-243
- `--coverageDirectory` per run (config `coverageDirectory`) keeps runs apart. [S] https://jestjs.io/docs/configuration
- v8 provider merges per-process V8 results with `mergeProcessCovs` (@bcoe/v8-coverage), then converts with v8-to-istanbul. [S] J `jest-reporters/src/CoverageReporter.ts` lines 465-540

### Merging with earlier coverage (both) [A, using sources below]
- Istanbul JSON can be merged: `FileCoverage.merge` adds hit counts for items with the same location key. [S] github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-lib-coverage/lib/file-coverage.js (`mergeProp`, `merge`)
- Danger: merge is only valid when the source of the file is unchanged. If a file changed, its old entry is stale (locations shift). Rule: for every file in the changed set, drop the old entry and take only the new run. Keep old entries only for files whose content hash is unchanged. [A]
- A changed file may also be covered by tests that were not selected. That cannot happen if the selection is correct (the inverse closure includes every test importing it). With under-selection, the result is under-covered, which fails safe (higher CRAP). [A]
- Store the content hash per file with the cached coverage. Istanbul JSON has a per-file `hash` field. [S] https://github.com/istanbuljs/istanbuljs/blob/master/docs/raw-output.md (404 on fetch of `master` path in my tool; the raw-output page was read via that URL and listed `_coverageSchema` and `hash`)

### Per-test coverage
- Neither runner offers per-test coverage as a documented feature. Vitest JSON reporter has a `coverageMap` at report level only. [S] https://vitest.dev/guide/reporters.html . I found no per-test code in vitest `coverage.ts` or in coverage-v8/istanbul `src` (grep for per-test, testName: no hits). [S]
- Possible workaround: run one test file per process with its own `reportsDirectory`/`coverageDirectory`. That gives per-test-file coverage at the cost of N runs. [A]
- Jest keeps per-test-file coverage in memory (`testResult.coverage`) before merge, but only exposes the merged result in reporters. [A, from CoverageReporter structure; not proven]

## 3. Coverage formats and per-function data (CRAP needs it)

### Istanbul JSON (`coverage-final.json`, reporter `json`)
- Per file: `statementMap`, `fnMap`, `branchMap`, `s`, `f`, `b`. `fnMap[i]` has `name`, `line`, `decl{start,end}`, `loc{start,end}` (function body span). `s`, `f`, `b` are hit counters by index. [S] https://github.com/istanbuljs/istanbuljs/blob/master/docs/raw-output.md
- Per-function coverage is not stored. It is derived: take statements and branches whose `loc` lies inside `fnMap[i].loc`. [A]
- This is the best format for CRAP: exact spans, no line approximation. Both Vitest (v8 and istanbul) and Jest (babel and v8) can write it (`json` reporter is in both default lists). [S] https://vitest.dev/config/coverage (default `['text','html','clover','json']`) ; https://jestjs.io/docs/configuration (`["clover","json","lcov","text"]`)

### LCOV (`lcov.info`)
- Records: `TN`, `SF`, `FN`/`FNDA` (old) or `FNL`/`FNA` (new), `FNF/FNH`, `DA`, `LF/LH`, `BRDA`, `BRF/BRH`, `end_of_record`. [S] https://github.com/linux-test-project/lcov/blob/master/docs/man/geninfo.rst (section "Tracefile format"; man page `man/geninfo.1` path no longer exists in repo)
- Function start line only; the end line is optional ("generated only if the toolchain is recent enough"). [S] same file
- `BRDA` has a line number and block/branch ids; it is not tied to a function. [S] same file
- The Istanbul `lcovonly` reporter writes `FN:<decl start line>,<name>` with no end line, and `BRDA:<line>,<branchIndex>,<i>,<hits>`. [S] github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-reports/lib/lcovonly/index.js
- Result: with LCOV from these runners you cannot get exact function spans. Mapping lines to functions needs the function end from another source (qualbar's own Oxc parse gives it). Anonymous functions are named `(anonymous_N)`-style by Istanbul, so match by start line, not by name. [A; the naming is not verified]
- Conclusion: use Istanbul JSON, not LCOV, for CRAP. [A]

### V8 coverage
- Node writes `coverage-*.json` with `result: ScriptCoverage[]` when `NODE_V8_COVERAGE=dir`; it adds a `source-map-cache` key (experimental) with parsed source maps. [S] https://nodejs.org/api/cli.html#node_v8_coveragedir
- `ScriptCoverage` -> `functions: FunctionCoverage[]` -> `{functionName, ranges: CoverageRange[{startOffset,endOffset,count}], isBlockCoverage}`. Offsets are in the generated script. [S] https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/js_protocol.json (Profiler domain, types `ScriptCoverage`, `FunctionCoverage`, `CoverageRange`)
- V8 gives per-function data natively (function range plus block ranges). But it is in generated-code offsets and needs a source-map step. [S] + [A]
- Vitest converts V8 to Istanbul with `ast-v8-to-istanbul` (needs the generated code and an AST). Jest uses `v8-to-istanbul`. [S] vitest `packages/coverage-v8/src/provider.ts` lines 230-250 ; J `jest-reporters/src/CoverageReporter.ts` (import `v8-to-istanbul`)
- Vitest docs: since v3.2.0 V8 uses AST-based remapping with "identical coverage reports to Istanbul". [S] https://vitest.dev/guide/coverage.html
- Accuracy differences between providers: v8 is block-based on generated code; istanbul counts statements/branches from instrumented source. Numbers can differ. [S] https://vitest.dev/guide/coverage.html (summary) ; detail [A]

### Source maps for TypeScript
- Source map v3 fields: `sources`, `sourcesContent`, `mappings` (base64 VLQ), `names`, `ignoreList`. [S] https://tc39.es/ecma426/
- Vitest: both providers remap to source files. `coverage.excludeAfterRemap` re-applies excludes after remap (default false). Without it, include/exclude globs apply to the generated/transformed module id. [S] https://vitest.dev/config/coverage
- Vitest V8 path takes the Vite transform result and its map (`transformResult.map`) and passes `code`, `sourceMap` and the AST to `ast-v8-to-istanbul`. It ignores Vite SSR helper statements (`__vite_ssr_import_*`). [S] vitest `coverage-v8/src/provider.ts` lines 230-275 and 389-400
- Jest babel provider: instruments the transformed output and remaps using `istanbul-lib-source-maps`. Jest v8: uses `v8-to-istanbul` with the transformer's source map file. [S] J `jest-reporters/src/CoverageReporter.ts` lines 65-75, 473-540
- Risk: esbuild/Vite TS transforms strip types and may move or merge spans. Function boundaries after remap can differ slightly from the Oxc spans of the original `.ts`. Matching coverage functions to qualbar's functions should use start line plus a tolerance, or the declaration position. [A]
- Always run with `include` covering the source dir so uncovered files appear; otherwise a changed file never imported has no entry (it then has 0% coverage, which must be treated as 0, not missing). [S] https://vitest.dev/config/coverage (default include = files imported) ; https://jestjs.io/docs/configuration (`collectCoverageFrom` "even if no tests exist")

## 4. Using qualbar's own Oxc module graph to pick tests

Pros [A]
- Runner-independent: one implementation for Vitest, Jest and any later runner.
- No transform cost (Vitest transforms every test graph) and no haste-map build (Jest). Reuses the graph that qualbar already builds for static metrics.
- Can be exact where the runners are not: type-only imports can be dropped; barrel re-exports handled; config/setup files can be modelled as "run all" triggers for both runners.
- Can run before the runner starts, so the runner is called with explicit test file paths (`vitest run <files>`, `jest <files>` or `--runTestsByPath`). Runner docs for `--runTestsByPath`/file filters were not fetched by me.

Cons [A]
- Must reproduce each runner's resolution: Vite aliases and plugins (`resolve.alias`, `vite-tsconfig-paths`), Jest `moduleNameMapper`, `modulePaths`, `roots`, mocks (`__mocks__`, `vi.mock`, `jest.mock` with factory). Oxc resolver covers tsconfig paths and package exports but not Vite plugin aliases.
- Must reproduce which files are tests (`include`, `testMatch`, workspaces/projects).
- Must reproduce runtime-only edges the runners know: `vi.mock` hoisting, setup files, `globalSetup`, snapshot files, `.env` files.
- Same blind spots as the runners for dynamic imports and `fs` reads.
- Extra maintenance when runner versions change behaviour (Vitest changed its algorithm recently: mocks, snapshots, recordDependencies).

Middle path [A]: ask the runner to list candidates (`jest --listTests`, `vitest list`) and use the runner's own `related`/`findRelatedTests` for selection; use the Oxc graph only as a cross-check or as a widening step (union). Union is safe because over-selection only costs time.

## 5. Recommendation

1. For v1, delegate selection to the runner: `vitest related --run <changed files>` or `--changed <ref>`; `jest --findRelatedTests <files>`. Reason: matches real resolution, mocks, config; no re-implementation. [A]
2. Collect coverage with the same command: `--coverage` with reporter `json` (Istanbul JSON), a qualbar-owned output dir, and for Vitest `--coverage.clean=false` if merging. Jest `--findRelatedTests --coverage` already limits `collectCoverageFrom` to the changed files. [S]+[A]
3. Use Istanbul JSON as the only coverage input. Skip LCOV. Derive per-function coverage from `fnMap[i].loc` and the statement/branch spans; join to qualbar's Oxc functions by start position with tolerance. [A]
4. Merge rule: per file, if its content hash is unchanged use cached coverage; otherwise use the new run only. Do not sum counts across different file versions. Store the hash next to the cached JSON. [A]
5. Safety net (strict policy): treat "run-all" triggers as qualbar's own rule: config files, setup files, lockfile/package.json, tsconfig changes -> full run. Vitest does this for some; Jest does not. Also treat a changed source file with no selected test as 0% coverage and let CRAP fail, per "never estimated coverage". [A]
6. Optional later: add the Oxc-graph union as a widening check once fixtures show misses. [A]

## 6. Open uncertainties
- Does `vitest related --coverage` honour `coverage.include` when it also filters by `config.related`? Code shows both filters; behaviour with uncovered changed files not tested (I did not run anything).
- Whether Vitest `--merge-reports` is meant to merge coverage in the blob flow, and how it behaves for coverage across shards (code calls `mergeReports`; docs silent).
- Jest: no run-all on config/setup change was found in `SearchSource.ts`; I did not read all of `jest-core`. Could exist elsewhere.
- Whether Jest's regex extractor treats `import x = require('y')` (TS) and `export * from` correctly (second looks handled by IMPORT_OR_EXPORT_RE; first not checked).
- Per-test coverage: no official feature found in either runner. Not proven absent in plugins/experimental flags.
- The exact `FN` naming for anonymous functions in Istanbul output (not verified).
- Jest `coverageProvider: v8` vs babel accuracy and which one qualbar should force. Not compared.
- Vitest `coverage.changed` with a user-set `include` containing non-TS files: not checked.
- `--runTestsByPath` / Vitest file filter semantics for the Oxc-graph option: docs not fetched.
