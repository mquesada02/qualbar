# Spike: Stryker on TypeScript 7

Ticket: [Task: Stryker on TypeScript 7 spike](https://github.com/mquesada02/qualbar/issues/17), on the map [Wayfinder map: qualbar v1 spec](https://github.com/mquesada02/qualbar/issues/2).
Date: 2026-10-18. Facts only. The decision is on the ticket.

## Setup

- Linux x64, Node 22.23.3, shared PC (8 cores, load about 2). quality-ts runs pinned to 2 cores (`taskset -c 0-1`), Stryker `concurrency` 2 or 1.
- Stryker 10.0.0 (`@stryker-mutator/core`, `vitest-runner`, `jest-runner`), the latest on npm.
- TypeScript 7.0.2 (`typescript`), TypeScript 6 copy `@typescript/typescript6@6.0.2` (reports version 6.0.3).
- Vitest 5.0.5 and 4.1.12, Jest 30.5.2 with `@swc/jest`.
- quality-ts at its last commit `dd95c66` (191 source files, 11,353 lines, 108 test files, 1,486 tests, Vitest 4.1.11, TypeScript 6.0.3).

## Result

| Step | Result |
| --- | --- |
| 1. Stryker 10.0.0 on a TypeScript 7 project | Crash on both runners: `TypeError: ts.parseConfigFileTextToJson is not a function` |
| 2. Workaround: own Stryker install with TypeScript 6 | Completes on both runners. Jest: correct. Vitest 4: correct. Vitest 5: completes with wrong results (stryker-js#6210), correct with a 2-line patch |
| 3. quality-ts measurements | Static mutants 24.6%, about 98% of the estimated time; 58 s per static mutant; Oxc estimate within 3.2% on every file, total −0.03% |

Pass criterion on the ticket: "Stryker completes on both runners, with or without the workaround." Stryker completes on both runners with the workaround.

## Step 1: Stryker on a TypeScript 7 project

Fixture: one source file (`src/math.ts`, 27 mutants) and one test file, `tsconfig.json` with `strict`, `tsc -p .` from TypeScript 7.0.2 passes. Two copies: Vitest 5.0.5 (ESM) and Jest 30.5.2 (`@swc/jest` transform). Stryker config: `coverageAnalysis: "perTest"`, `concurrency: 2`.

Both runners crash before the dry run, in 0.6 s:

```
ERROR Stryker Unexpected error occurred while running Stryker TypeError: ts.parseConfigFileTextToJson is not a function
    at TSConfigPreprocessor.rewriteTSConfigFile (.../@stryker-mutator/core/dist/src/sandbox/ts-config-preprocessor.js:46:39)
```

Cause: `ts-config-preprocessor.js` does `await import('typescript')` and calls `ts.parseConfigFileTextToJson`. TypeScript 7 has no such JavaScript API. This is [stryker-js#6111](https://github.com/stryker-mutator/stryker-js/issues/6111), still open (last update 2026-08-21). The bare `import('typescript')` resolves from the location of `@stryker-mutator/core`.

The preprocessor only rewrites `extends`, `references`, `include`, `exclude` and `files` paths that point outside the sandbox. It is skipped when `inPlace` is true or when `tsconfigFile` names a file that is not in the project. With `"tsconfigFile": "does-not-exist.json"` the crash also goes away (tested on the Vitest fixture). That option breaks projects whose tsconfig extends or references a file outside the project directory.

## Step 2: workaround with a TypeScript 6 copy

A separate install directory (the "host"), not in the project:

```json
{ "dependencies": {
    "@stryker-mutator/core": "10.0.0",
    "@stryker-mutator/vitest-runner": "10.0.0",
    "@stryker-mutator/jest-runner": "10.0.0",
    "typescript": "npm:@typescript/typescript6@6.0.2" } }
```

Run from the project directory: `node <host>/node_modules/@stryker-mutator/core/bin/stryker.js run`. The project keeps `typescript@7.0.2`.

| Project | Exit | Score | Tests per mutant | Wall |
| --- | --- | --- | --- | --- |
| Jest 30.5.2 + TS 7 | 0 | 92.59% (25 killed, 2 survived) | 2.44 | 1.7 s |
| Vitest 5.0.5 + TS 7 | 0 | 3.70% (1 killed, 26 survived) | 0.04 | 2.7 s |
| Vitest 4.1.12 + TS 7 (in-project install, `tsconfigFile` skip) | 0 | 92.59% | 1.41 | — |
| Vitest 5.0.5 + TS 7, host with separator patch | 0 | 92.59% | 1.41 | 3.0 s |

Facts:

- The host loads the project's own test framework. `vitest-wrapper.js` resolves `vitest/node` with `createRequire(path.join(process.cwd(), 'package.json'))` and falls back to its own copy. The Jest run worked with no `jest` in the host. A host run on the Vitest 4 project used the project's Vitest 4.
- **Vitest 5 gives wrong results with Stryker 10.0.0, with or without TypeScript 7.** The in-project install (no host) gives the same 3.70%. `coverageAnalysis` `"off"` and `"all"` also give 3.70%. Cause: [stryker-js#6210](https://github.com/stryker-mutator/stryker-js/issues/6210), open. Vitest 5 matches `testNamePattern` against the name chain joined with `' > '`, the runner joins with `' '`, so no test runs for a covered mutant and the mutant survives. Fix PR [stryker-js#6214](https://github.com/stryker-mutator/stryker-js/pull/6214) is open, not merged.
- Patch tested (both copies of `collectTestName`, in `dist/src/test-helpers.js` and `dist/src/stryker-setup.js`):
  ```js
  return nameParts.map((part) => part.trim()).filter((part) => part !== '').join(' > ');
  ```
  It fixes Vitest 5 (92.59%) and breaks Vitest 4 (the same host on the Vitest 4 project gives 3.70%). A correct patch must choose the separator from the Vitest major version, as #6214 does.

## Step 3: quality-ts measurements

### Getting Stryker to run on quality-ts

The initial test run failed three times before it passed. Each cause is a Stryker behavior that qualbar has to handle:

1. `disableTypeChecks` default (`{test,src,lib}/**/*.{js,ts,...}`) adds a `// @ts-nocheck` line to every TS file under `test/`, including the quality-ts fixtures. Line numbers in the fixtures shift, and 2 fixture tests fail (Knip adapter, type-coverage adapter). Fix: `"disableTypeChecks": "src/**/*.ts"`.
2. The Vitest runner forces `pool: 'threads'` (`vitest-test-runner.js`), so `process.chdir()` throws `process.chdir() is not supported in workers`. One quality-ts test (`dependency-cruiser.integration.test.ts:494`) fails. Known: [stryker-js#6236](https://github.com/stryker-mutator/stryker-js/issues/6236), [stryker-js#6223](https://github.com/stryker-mutator/stryker-js/issues/6223). For this spike, that one test is `it.skip` in a throwaway clone.
3. After these two changes, the dry run passes.

Config used:

```json
{ "testRunner": "vitest", "coverageAnalysis": "perTest", "concurrency": 2,
  "mutate": ["src/**/*.ts"], "disableTypeChecks": "src/**/*.ts", "timeoutMS": 600000 }
```

quality-ts is a TypeScript 6 project, so the TypeScript 6 workaround is not needed here. The host install was used, with the unpatched runner (Vitest 4.1.11).

To get the plan without the full run (about 40 h on 2 cores), the host's `mutant-test-planner.js` got a temporary dump: after `makePlan`, it writes every mutant (id, file, location, mutator, `static`, net time) to JSON and stops.

### Static mutant share

| Measure | Value |
| --- | --- |
| Mutants | 9,746 |
| Static mutants | 2,397 (24.6%) |
| Dry run (all tests, net) | 179.0 s, 1,330 tests, wall 219 s |
| Stryker planner estimate, static | 119.2 h (179.0 s each = one full test run) |
| Stryker planner estimate, runtime mutants | 2.37 h (about 1.2 s each) |
| Static share of estimated time | 98.1% |

Stryker's own warning: `Detected 2397 static mutants (25% of total) that are estimated to take 98% of the time running the tests!`

Static mutants by mutator: StringLiteral 1,098, ConditionalExpression 282, ObjectLiteral 261, ArrayDeclaration 211, BlockStatement 133, EqualityOperator 112, BooleanLiteral 103, LogicalOperator 67, ArrowFunction 41, Regex 32, others 57. Top files: `src/domain/catalog.ts` 388, `src/domain/explain-catalog/dry-yagni.ts` 149, `explain-catalog/architecture.ts` 137, `explain-catalog/function.ts` 135, `src/domain/gate.ts` 112. These are module-level data (rule catalogs) that run at import time.

### Wall time per static mutant

Stryker run with `mutate` on three lines with static mutants (`crap-analyzer.ts:120`, `catalog.ts:385`, `threshold.ts:12`), `concurrency: 1`, 2 cores. Result: 6 mutants, all static.

| Phase | Time |
| --- | --- |
| Dry run | 141 s (906 tests: the runner runs only tests related to the mutated files) |
| Mutation phase, 6 static mutants | 350 s → **58 s per static mutant** |

| Mutant | Status | Tests completed |
| --- | --- | --- |
| BooleanLiteral | Killed | 8 |
| StringLiteral | Killed | 709 |
| ConditionalExpression | Killed | 178 |
| ConditionalExpression | Survived | 723 |
| EqualityOperator | Killed | 178 |
| StringLiteral | Survived | 723 |

Each static mutant reloads the Vitest environment (`reloadEnvironment`) and runs every related test until the first failure. A survived static mutant runs all related tests. Projection for the full quality-ts run at 58 s: 2,397 × 58 s ≈ 38.6 h of runner time for static mutants, against about 2.4 h for the 7,349 runtime mutants (planner estimate). The planner's own static estimate (179 s each) is about 3× the measured mean, because it ignores bail on the first failing test.

### Oxc-based mutant estimate

Script: [`stryker-ts7-spike/estimate.mjs`](stryker-ts7-spike/estimate.mjs) (oxc-parser 0.154.0, the Node binding of the Oxc parser, `preserveParens: false`). It walks the AST once per file and counts the nodes each Stryker 10.0.0 mutator mutates, with Stryker's skip rules: `TSAsExpression`, `TSInterfaceDeclaration`, `TSTypeAnnotation`, `TSTypeAliasDeclaration`, `TSEnumDeclaration`, `TSDeclareFunction`, `TSTypeParameterInstantiation`, `TSTypeParameterDeclaration`, imports, decorators, `declare` statements, plus the per-mutator exclusions (string literals in import/export, property keys, `require()`/`Symbol()` arguments; arithmetic on strings; invalid constructor blocks). Regex mutants use a rough count of anchors, quantifiers and classes instead of weapon-regex. Comparison: [`stryker-ts7-spike/compare.mjs`](stryker-ts7-spike/compare.mjs).

| Measure | Value |
| --- | --- |
| Total, real vs estimate | 9,746 vs 9,743 (−0.03%) |
| Files exact | 185 of 191 |
| Per-file absolute error | median 0.0%, p90 0.0%, max 3.2% |
| Files within ±5% | 191 of 191 |
| Estimate time, 191 files | 0.13 s |

Per mutator (real/estimate): ArithmeticOperator 92/92, ArrayDeclaration 575/575, ArrowFunction 356/356, AssignmentOperator 17/17, BlockStatement 1,022/1,022, BooleanLiteral 503/503, **CallExpression 114/108**, ConditionalExpression 2,168/2,168, EqualityOperator 853/853, LogicalOperator 484/484, MethodExpression 199/199, ObjectLiteral 846/846, OptionalChaining 73/73, **Regex 62/65**, StringLiteral 2,376/2,376, UnaryOperator 6/6.

The 6 files with a difference:

| File | Real | Estimate | Cause |
| --- | --- | --- | --- |
| `src/entry/gate-commands.ts` | 93 | 90 | CallExpression |
| `src/adapters/mutation/mutation-analyzer.ts` | 153 | 155 | Regex |
| `src/adapters/eslint/eslint-analyzer.ts` | 174 | 175 | Regex |
| `src/entry/info-commands.ts` | 66 | 65 | CallExpression |
| `src/entry/mcp/tools.ts` | 97 | 96 | CallExpression |
| `src/entry/mcp-command.ts` | 47 | 46 | CallExpression |

- CallExpression (the new empty-statement mutator, with a `filter` that keeps the mutant only when it is the only mutant in the statement subtree): Stryker also keeps it on call chains that contain a function with a block body, for example `program.command("guard")....action(async (options) => { ... })`. The estimate drops these. The exact rule is not reproduced.
- Regex: the estimate does not run weapon-regex; it is off by 3 of 62.

On the TypeScript 7 fixture (`src/math.ts`) the estimate matches Stryker exactly: 27 of 27, the same split per mutator.

## Not measured

- macOS, arm64, Windows.
- A full quality-ts mutation run (about 40 h of runner time on 2 cores).
- Stryker's incremental mode, sharding (`mutate` ranges per shard) and the TypeScript checker plugin (`@stryker-mutator/typescript-checker` also needs the TypeScript API).
- Jest projects larger than the fixture; Vitest 5 on quality-ts.
- Monorepos and tsconfig files with `extends` or `references` outside the project, which the TypeScript 6 preprocessing exists for.

## Commands

```bash
# fixtures (one per runner)
npm i -D typescript@7.0.2 vitest@5.0.5 @stryker-mutator/core@10.0.0 @stryker-mutator/vitest-runner@10.0.0
npm i -D typescript@7.0.2 jest@30.5.2 @swc/core @swc/jest @types/jest @stryker-mutator/core@10.0.0 @stryker-mutator/jest-runner@10.0.0
npx stryker run                                   # step 1: crash
node <host>/node_modules/@stryker-mutator/core/bin/stryker.js run   # step 2: host with TS 6

# quality-ts
gh repo clone mquesada02/quality-ts && pnpm install --frozen-lockfile
pnpm exec vitest run --maxWorkers=2               # 1,486 tests, 197 s
STRYKER_SPIKE_PLAN=plan.json taskset -c 0-1 node <host>/.../stryker.js run stryker.spike.json
node estimate.mjs <qts> $(find src -name '*.ts' | sort) > est.json
node compare.mjs plan.json est.json <qts>
```
