# TypeScript-Go timing spike (qualbar issue #15)

Date measured: 2026-10-18. This file records facts only. It makes no decision.

## Short answer

- A full `any` count with TypeScript-Go (typescript@7.0.2, `unstable/sync`) on quality-ts took 1.4 to 2.5 s wall time. type-coverage-core 2.30.2 on TS 6.0.3 took 3.5 to 4.5 s on the same code. Both ran on 2 cores.
- Peak memory: TypeScript-Go about 450 MB (Node 135 MB + Go child 315 MB). type-coverage-core about 535 MB (one Node process).
- The `any` counts are the same on quality-ts (0 and 0) and on a copy with 2540 injected `any` sites (2540 and 2540). The identifier sets differ by 30 nodes (see section 5).
- One trap: `getTypeAtLocation` returns the error type for a type name such as `A` in `let x: A` (where `type A = any`). A plain port misses those `any`. The fallback `getTypeFromTypeNode(parent)` fixes it (section 6).
- `getContextualType` has no batch form in 7.0.2. It cost 0.57 to 1.06 s for 59,017 single calls. Skipping it for nodes whose type is not `any` saves that time and gave the same counts (section 7).

## 1. Setup

Machine: Intel Core Ultra 7 258V, 8 logical CPUs, 31 GB RAM, Linux 7.0.0-34-generic, Node v22.23.3. The PC was shared: load average was about 5 during the runs, so times vary by up to 2x between runs. Every run was pinned with `taskset -c 0-1`. One heavy command ran at a time.

Corpus: quality-ts at commit a3a7b9c (`git status --short` showed 0 changed files). The read-only checkout was copied, without `.git`, `node_modules`, `coverage` and `dist`, to `/tmp/claude-1000/qualbar-task-15/repo`. Then `node_modules` was copied with `cp -a` (it holds the pnpm symlinks, so the TS 6.0.3 install is the real one).

```sh
cd /home/mquesada/orca/workspaces/quality-ts/t43-dogfood
tar --exclude=./node_modules --exclude=./coverage --exclude=./dist --exclude=./.git -cf - . | tar -xf - -C /tmp/claude-1000/qualbar-task-15/repo
cp -a node_modules /tmp/claude-1000/qualbar-task-15/repo/node_modules
```

- 422 `.ts` files and 29,921 lines in `src`, `test`, `scripts` (`find ... | xargs wc -l`). The tsconfig program holds 376 own files (the `tsconfig.json` excludes `test/fixtures`). Files under `node_modules` are skipped, as type-coverage-core does.
- Baseline tool: `type-coverage-core@2.30.2` with `typescript@6.0.3` (from `package.json`). It runs with the options of the quality-ts adapter (`src/adapters/type-coverage/type-coverage-analyzer.ts`): `strict: true, absolutePath: true, enableCache: false, fileCounts: true`.
- TypeScript-Go: `npm install --save-exact typescript@7.0.2` in `/tmp/claude-1000/qualbar-task-15/ts7`. It installs `@typescript/typescript-linux-x64` (27 MB; binary `lib/tsc`, 24 MB). `node_modules/typescript` is 3.6 MB.
- Sanity check: `tsc --noEmit -p tsconfig.json` exits 0 on the copy. TypeScript-Go `program.getSemanticDiagnostics()` returns 0 diagnostics (it took 678 ms for the whole program). Config, program and global diagnostics are also 0.

## 2. What the TypeScript-Go script does

Script: `tsgo.mjs` (full text in the appendix). Steps, each timed with `performance.now()`:

1. `new API({ cwd, collectTiming: true })`, then `api.updateSnapshot({ openProject })` (spawns the Go child, reads the config, creates the program).
2. `program.getSourceFile(name)` for every file not under `node_modules` (fetches and decodes the binary AST).
3. A walk with `node.forEachChild` that collects every `Identifier`, `PrivateIdentifier` and `ThisKeyword` node.
4. `checker.getTypeAtLocation(nodes)`, with 2,000 nodes per batch.
5. `checker.getContextualType(node)`, one call per node.
6. The type-coverage-core rule: a node counts when it has a type or a contextual type; it is `any` when every collected type has `flags === TypeFlags.Any` and `intrinsicName === "any"`.

Not implemented (so not measured): the strict-mode rules (`Object`, `{}`, `any` inside type arguments, unsafe assertions), `ignore-line` comments, catch variables, evolving-`any` writes, and the type-coverage-core walker. The script walks every identifier in the whole AST.

## 3. Timing results (quality-ts, 59,017 identifier nodes)

Command pattern (one run at a time):

```sh
/usr/bin/time -f "WALL=%e" taskset -c 0-1 node scripts/tc6.mjs /tmp/claude-1000/qualbar-task-15/repo out/tc6.json
taskset -c 0-1 node scripts/tsgo.mjs /tmp/claude-1000/qualbar-task-15/repo tsconfig.json out/b.json full 2000
taskset -c 0-1 node scripts/tsgo.mjs /tmp/claude-1000/qualbar-task-15/repo tsconfig.json out/b.json ctx-if-any 2000
FALLBACK=1 taskset -c 0-1 node scripts/tsgo.mjs /tmp/claude-1000/qualbar-task-15/repo tsconfig.json out/b.json full 2000
```

Wall time of the whole process, three runs each, in seconds (`/usr/bin/time`):

| Run | type-coverage-core on TS 6.0.3 | TS-Go, contextual for all nodes | TS-Go, contextual only if type is `any` | TS-Go, all nodes + fallback |
|---|---|---|---|---|
| 1 | 3.52 | 1.45 | 0.85 | 1.60 |
| 2 | 4.47 | 1.87 | 1.11 | 1.66 |
| 3 | 4.09 | 2.48 | 1.55 | 3.13 |

The first three runs of type-coverage-core (a separate batch, load not recorded) gave 3.91, 4.88 and 5.44 s. Runs with the position-trace patch gave 5.8 to 8.5 s. The patched runs are not used for timing.

Time split inside the TypeScript-Go script, run 1 of "contextual for all nodes" (ms): snapshot (spawn, config, program) 179; AST fetch 37; walk 57; `getTypeAtLocation` 449; `getContextualType` 645; counting 13; total 1383. Over the three runs: snapshot 179 to 282; types 449 to 761; contextual 645 to 1060.

- Cold program setup (spawn, config, program creation): 160 to 540 ms over all TypeScript-Go runs. The first single `getTypeAtLocation` took 1 to 2 ms (the checker work is lazy: the full check cost lands in the batch calls).
- Batch size, one run each, whole script in ms: 100 per batch gave 1970 (types 800); 2,000 gave 1383 to 2303 (types 449 to 761); 20,000 gave 2308 (types 713). The noise is larger than the difference. No batch size showed a clear win.
- Memory is the peak resident set (`VmHWM` in `/proc/<pid>/status`, read before `api.close()`):

| Process | Peak RSS |
|---|---|
| type-coverage-core (one Node process, `/usr/bin/time` max RSS) | 534 to 539 MB |
| TS-Go: Node client | 134 to 135 MB |
| TS-Go: Go child | 281 to 326 MB (all modes) |
| TS-Go: sum of both peaks (upper bound, peaks may not coincide) | 416 to 461 MB |

The `USER` and `SYS` columns of `/usr/bin/time` are not reported: for the Go child they were inconsistent between runs.

## 4. Count results on quality-ts

| | type-coverage-core strict | type-coverage-core non-strict | TS-Go script |
|---|---|---|---|
| Counted identifiers (`total`) | 58,987 | 58,987 | 59,017 |
| `any` (uncovered) | 0 | 0 | 0 |

(Commands: `TC_TRACE=1 node scripts/tc6trace.mjs /tmp/claude-1000/qualbar-task-15/repo out/tc6trace.s1.json 1` and `... s0.json 0`; the patch is in the appendix.)

quality-ts has no `any`, so this corpus cannot show an `any` miss. Section 5 adds a corpus with `any`.

## 5. Count comparison with `any` present

Two extra corpora. Both were compared node by node, with the key `file:end offset` of the identifier. Both tools gave the same offsets for every node that both counted.

**Mutated copy** `/tmp/claude-1000/qualbar-task-15/repo-any`: the quality-ts copy with `sed -E 's/: string\b/: any/g; s/: number\b/: Array<any>/g'` applied to every `.ts` file in `src` (579 lines contain `: any` afterwards).

| | type-coverage-core (non-strict) | TS-Go script |
|---|---|---|
| Counted identifiers | 59,184 | 59,214 |
| `any` | 2,540 | 2,540 |
| Nodes where the `any` flag differs | 0 of 59,184 shared nodes | |

The mode "contextual only if type is `any`" gave the same 2,540 and the same total. (Command: `node scripts/diff.mjs out/any.tc6.json out/any.ctx.json`.)

**The 30 extra nodes in TypeScript-Go** (in both corpora) are identifiers named `constructor` (3), `valueOf` (25) and `toString` (2); type-coverage-core never counts them. Cause, from the installed code: `checkNode` does `if (context.catchVariables[node.escapedText]) return;` (`dist/checker.js:170`), and `catchVariables` is a plain object `{}` (`dist/core.js:107`). A lookup of `constructor`, `valueOf` or `toString` finds the inherited `Object.prototype` member, which is truthy, so the node is skipped. A port that wants the same totals must copy this, or use a `Set`/`Map` and accept the difference.

**Hand-written fixture** `/tmp/claude-1000/qualbar-task-15/fixture/src/a.ts` (19 lines: `any` aliases, `Array<any>`, `any[]`, `Map<string, any>`, catch variable, generics, evolving `let`, `as any`, `!`, `this.v`, `JSON.parse`, `Object`, `{}`, `<string>`).

| | Count | `any` |
|---|---|---|
| type-coverage-core non-strict | 52 | 19 |
| type-coverage-core strict | 55 (52 identifiers + 3 assertions) | 30 |
| TS-Go, no fallback | 52 | 17 |
| TS-Go, with fallback (section 6) | 52 | 19, flags equal on all 52 nodes |

Without the fallback, the 2 missed `any` are the identifier `A` in `x: A` and in `r: A` (`type A = any`). The strict-mode numbers for TypeScript-Go were not measured.

## 6. Error type for type names

Fact: in TypeScript-Go 7.0.2, `checker.getTypeAtLocation(identifier)` returns a type with `flags === 1` (Any) and `intrinsicName === "error"` when the identifier is the name inside a type reference (`Record` in `Record<string, number>`, `NumericRuleId` in `ruleId: NumericRuleId`). type-coverage-core on TS 6.0.3 returns the real type there (for `A` it returns `any`).

- quality-ts: identifiers with an error type: TS 6 gives 230 (179 `error`, 51 `unresolved`). TypeScript-Go gives 3,014 (all `error`).
- The error type is not counted as `any` by the rule `intrinsicName === "any"`. So the quality-ts count is unaffected, but an alias to `any` is missed (section 5).
- Fix tested: if the node has the error type, its parent is a `TypeReference`, and `parent.typeName === node`, use `checker.getTypeFromTypeNode(node.parent)`. It needed 2,713 extra calls on quality-ts (49 to 182 ms) and left 301 error-typed identifiers (305 on the mutated copy). It gave 19 of 19 on the fixture. `getTypeAtPosition` also returned the error type. `getSymbolAtLocation` plus `getDeclaredTypeOfSymbol` returned `any` for `A` (tested on the fixture only, not timed).
- The remaining difference in error-typed identifiers (301 vs 230 on quality-ts; on the mutated copy 122 TS-Go error nodes have no TS 6 error node) was not analyzed. They did not change any `any` flag in the two corpora.
- This answers the open question of issue #4: the TS7 error type has `intrinsicName "error"` through the API.

## 7. `getContextualType`

- Signature in 7.0.2 (`dist/api/sync/api.d.ts:239`): `getContextualType(node: Expression): Type | undefined`. There is no array overload, unlike `getTypeAtLocation` (lines 231-232).
- 59,017 single calls (every identifier, any position, including declaration names and type names) threw no error. They took 570 to 1,060 ms (about 10 to 18 µs per call).
- The type-coverage-core rule counts a node as `any` only if every collected type is `any`. So a node whose type is not `any` is covered whatever its contextual type is. The mode `ctx-if-any` calls `getContextualType` only when the type is `any` (3,014 calls on quality-ts, 5,999 on the mutated copy). It kept the same totals and the same `any` counts in both corpora. It saved about 0.5 to 1.0 s of the 1.4 to 2.5 s (the 3,014 calls took 39 to 93 ms).
- Whether the contextual type values equal TS 6 values was not compared. Only the `any` decisions were compared.

## 8. Open uncertainties

- Strict-mode rules on TypeScript-Go were not run (`Object`, `{}`, `any` in type arguments, unsafe assertions). Costs for `getTypeArguments`, `getPropertiesOfType`, `getSignaturesOfType` and `isTypeAssignableTo` are unknown.
- One repo of 30k lines. Larger repos were not tried. The only any-rich corpora are a text-mutated copy and a 20-line fixture.
- Times vary up to 2x on this shared PC. Medians are not reliable with 3 runs.
- Oxc identifier positions vs TypeScript-Go: not tested. Both tools were compared with the TypeScript-Go AST walk, not an Oxc walk.
- The walker of type-coverage-core was not ported. The script visits every identifier. It matched except for the 30 prototype-name nodes. Skipped kinds in other code (decorators, JSDoc, other syntax) may differ in a repo that has them.
- The remaining error-typed identifiers (section 6) were not explained.
- Linux x64 only. No macOS or arm64 run.
- The API is unstable. 7.1-dev changes it (see issue #4). These numbers are for 7.0.2 only.

## Appendix A: reproduction scripts

Layout: `$W` is `/tmp/claude-1000/qualbar-task-15`; `/tmp/claude-1000/qualbar-task-15/repo` (quality-ts copy); `/tmp/claude-1000/qualbar-task-15/repo-any`, `/tmp/claude-1000/qualbar-task-15/fixture` (each with `node_modules -> ../repo/node_modules`); `/tmp/claude-1000/qualbar-task-15/ts7` (`typescript@7.0.2`); `/tmp/claude-1000/qualbar-task-15/scripts`.

### Patch for the type-coverage-core position trace (copy only)

In `/tmp/claude-1000/qualbar-task-15/repo/node_modules/type-coverage-core/dist/checker.js`, in `collectData`, before `context.typeCheckResult.totalCount++;`, add (active only when the environment variable `TC_TRACE` is set):

```js
if (process.env.TC_TRACE) { (globalThis.__tcTrace ??= []).push([context.file, node.end, node.kind === ts.SyntaxKind.ThisKeyword ? 'this' : 'id', types.every((t) => typeIsAnyOrInTypeArguments(t, false, context)) ? 1 : 0, (type && type.flags === ts.TypeFlags.Any && type.intrinsicName !== 'any') ? 1 : 0, type ? String(type.intrinsicName) : '']); }
```

### tc6.mjs (baseline timing)

```js
// Baseline: type-coverage-core 2.30.2 on TS 6.0.3, same options as quality-ts adapter.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const repo = process.argv[2];
const outFile = process.argv[3];
const require = createRequire(path.join(repo, "package.json"));
const { lint } = require("type-coverage-core");
const ts = require("typescript");
const t0 = performance.now();
const result = await lint(path.join(repo, "tsconfig.json"), { strict: true, absolutePath: true, enableCache: false, fileCounts: true });
const t1 = performance.now();
let correct = 0, total = 0;
const files = {};
for (const [f, c] of result.fileCounts) { correct += c.correctCount; total += c.totalCount; files[path.relative(repo, f)] = [c.correctCount, c.totalCount]; }
const anys = result.anys.map(a => ({ file: path.relative(repo, a.file), line: a.line + 1, character: a.character, kind: a.kind }));
fs.writeFileSync(outFile, JSON.stringify({ files, anys }));
console.log(JSON.stringify({ ts: ts.version, lintMs: Math.round(t1 - t0), correct, total, uncovered: total - correct, anys: anys.length, files: result.fileCounts.size, maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024) }));
```

### tc6trace.mjs (position trace)

```js
// type-coverage-core with position trace (env TC_TRACE=1). Args: repo out.json strict(0|1)
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const [repo, outFile, strict] = process.argv.slice(2);
const require = createRequire(path.join(repo, "package.json"));
const { lint } = require("type-coverage-core");
const t0 = performance.now();
const result = await lint(path.join(repo, "tsconfig.json"), { strict: strict === "1", absolutePath: true, enableCache: false, fileCounts: true });
const ms = Math.round(performance.now() - t0);
let correct = 0, total = 0;
for (const [, c] of result.fileCounts) { correct += c.correctCount; total += c.totalCount; }
fs.writeFileSync(outFile, JSON.stringify({ trace: (globalThis.__tcTrace ?? []).map(([f, e, k, a, err, nm]) => [path.relative(repo, f), e, k, a, err, nm]) }));
console.log(JSON.stringify({ strict: strict === "1", ms, correct, total, uncovered: total - correct, anys: result.anys.length, files: result.fileCounts.size, traced: (globalThis.__tcTrace ?? []).length }));
```

### tsgo.mjs (TypeScript-Go count and timing)

```js
// TypeScript-Go (typescript@7.0.2, unstable/sync) full `any` count.
// Args: repo tsconfig out.json mode(full|ctx-if-any) batchSize
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const [repo, tsconfig, outFile, mode, batchArg] = process.argv.slice(2);
const batch = Number(batchArg ?? 2000);
const ts7 = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../ts7/package.json");
const req = createRequire(ts7);
const { API, TypeFlags } = await import(pathToFileURL(req.resolve("typescript/unstable/sync")).href);
const { SyntaxKind } = await import(pathToFileURL(req.resolve("typescript/unstable/ast")).href);
const T = {}; const mark = (k) => (T[k] = performance.now());
const rss = (pid) => { try { return Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))[1]) / 1024; } catch { return NaN; } };

mark("start");
const api = new API({ cwd: repo, collectTiming: true });
const snapshot = api.updateSnapshot({ openProject: path.join(repo, tsconfig) });
mark("snapshot");
const project = snapshot.getProject(path.join(repo, tsconfig));
const program = project.program, checker = project.checker;
const names = program.getSourceFileNames().filter((f) => !f.includes("node_modules"));
mark("project");
const files = names.map((n) => program.getSourceFile(n)).filter(Boolean);
mark("ast");
const nodes = []; // {file, node}
const isIdent = (k) => k === SyntaxKind.Identifier || k === SyntaxKind.PrivateIdentifier || k === SyntaxKind.ThisKeyword;
for (const sf of files) {
  const rel = path.relative(repo, sf.fileName);
  const visit = (n) => { if (isIdent(n.kind)) nodes.push([rel, n]); n.forEachChild(visit); };
  sf.forEachChild(visit);
}
mark("walk");
// First query alone: forces lib load and the first checks.
checker.getTypeAtLocation(nodes[0][1]);
mark("firstQuery");
// Types, batched.
const types = new Array(nodes.length);
for (let i = 0; i < nodes.length; i += batch) {
  const res = checker.getTypeAtLocation(nodes.slice(i, i + batch).map((x) => x[1]));
  for (let j = 0; j < res.length; j++) types[i + j] = res[j];
}
mark("types");
// FALLBACK=1: error-typed names inside a type reference get the type of the whole reference.
let fallbackCalls = 0;
if (process.env.FALLBACK === "1") {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i][1];
    if (types[i] && types[i].flags === TypeFlags.Any && types[i].intrinsicName === "error" && n.parent.kind === SyntaxKind.TypeReference && n.parent.typeName === n) {
      types[i] = checker.getTypeFromTypeNode(n.parent) ?? types[i]; fallbackCalls++;
    }
  }
}
mark("fallback");
// Contextual types: single-node API only (no array overload in 7.0.2).
const ctx = new Array(nodes.length);
let ctxCalls = 0;
for (let i = 0; i < nodes.length; i++) {
  if (mode === "ctx-if-any" && !(types[i] && types[i].flags === TypeFlags.Any)) continue;
  ctx[i] = checker.getContextualType(nodes[i][1]); ctxCalls++;
}
mark("contextual");
const isAny = (t) => t.flags === TypeFlags.Any && t.intrinsicName === "any";
let total = 0, anyCount = 0, errorTypeAnys = 0;
const trace = [];
for (let i = 0; i < nodes.length; i++) {
  const ty = [types[i], ctx[i]].filter(Boolean);
  // In ctx-if-any mode a non-any type already decides the node (covered), so ctx absence is safe.
  if (ty.length === 0) continue;
  total++;
  const a = ty.every(isAny);
  if (a) anyCount++;
  if (types[i] && types[i].flags === TypeFlags.Any && types[i].intrinsicName !== "any") errorTypeAnys++;
  trace.push([nodes[i][0], nodes[i][1].end, nodes[i][1].kind === SyntaxKind.ThisKeyword ? "this" : "id", a ? 1 : 0, (types[i] && types[i].flags === TypeFlags.Any && types[i].intrinsicName !== "any") ? 1 : 0, types[i] ? String(types[i].intrinsicName) : ""]);
}
mark("count");
const timing = api.getTimingInfo();
const childPid = Number(execSync(`pgrep -P ${process.pid}`).toString().trim().split("\n")[0]);
const goRssMB = Math.round(rss(childPid)), nodeRssMB = Math.round(process.resourceUsage().maxRSS / 1024);
api.close();
fs.writeFileSync(outFile, JSON.stringify({ trace }));
const ms = (a, b) => Math.round(T[b] - T[a]);
console.log(JSON.stringify({
  mode, batch, files: files.length, identifierNodes: nodes.length, fallbackCalls, ctxCalls, total, correct: total - anyCount, anys: anyCount, errorTypeAnys,
  ms: { snapshot: ms("start", "snapshot"), project: ms("snapshot", "project"), astFetch: ms("project", "ast"), walk: ms("ast", "walk"), firstQuery: ms("walk", "firstQuery"), types: ms("firstQuery", "types"), fallback: ms("types", "fallback"), contextual: ms("fallback", "contextual"), count: ms("contextual", "count"), total: ms("start", "count") },
  peakRssMB: { node: nodeRssMB, goChild: goRssMB, sum: nodeRssMB + goRssMB },
  apiTiming: { requests: timing.totals?.requests ?? timing.requestCount, keys: Object.keys(timing) },
}));
```

### diff.mjs (node by node comparison)

```js
import fs from "node:fs";
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")).trace);
const key = (t) => `${t[0]}:${t[1]}`;
const A = new Map(a.map((t) => [key(t), t])), B = new Map(b.map((t) => [key(t), t]));
const onlyA = [...A.keys()].filter((k) => !B.has(k)), onlyB = [...B.keys()].filter((k) => !A.has(k));
const anyDiff = [...A.keys()].filter((k) => B.has(k) && A.get(k)[3] !== B.get(k)[3]);
console.log(JSON.stringify({ A: a.length, B: b.length, onlyA: onlyA.length, onlyB: onlyB.length, anyFlagDiffers: anyDiff.length, anyA: a.filter(t=>t[3]).length, anyB: b.filter(t=>t[3]).length }));
const byFile = (arr) => { const m = {}; for (const k of arr) { const f = k.slice(0, k.lastIndexOf(":")); m[f] = (m[f] ?? 0) + 1; } return m; };
console.log("onlyA(tc6) by file", JSON.stringify(byFile(onlyA)));
console.log("onlyB(tsgo) by file", JSON.stringify(byFile(onlyB)));
console.log("anyDiff sample", anyDiff.slice(0, 10));
const errA = a.filter(t=>t[4]), errB = b.filter(t=>t[4]);
const EA = new Set(errA.map(key));
const nm = (arr)=>{const m={};for(const t of arr){m[t[5]]=(m[t[5]]??0)+1}return m};
console.log("error-type ids: A", errA.length, "B", errB.length, "B-only", errB.filter(t=>!EA.has(key(t))).length);
console.log("A names", JSON.stringify(Object.entries(nm(errA)).sort((x,y)=>y[1]-x[1]).slice(0,5)), "B names", JSON.stringify(Object.entries(nm(errB)).sort((x,y)=>y[1]-x[1]).slice(0,5)));
```
