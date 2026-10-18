# TypeScript-Go for type coverage (qualbar issue #4)

Date checked: 2026-10-18. Sources were read from npm tarballs and shallow clones in /tmp/claude-1000/research-tsgo/. Nothing was built or run.

## Short answer

Yes, the data needed is there. The sync API has `getTypeAtLocation`, `getContextualType`, `isTypeAssignableTo`, `getTypeArguments` and `TypeFlags.Any`. So the type-coverage-core algorithm can be ported. But the API is explicitly unstable, and the next release (7.1) already changes its shape. Pin an exact version and isolate it behind your own protocol, as fallow does.

## 1. What the API exposes

Package exports in typescript@7.0.2: `./unstable/sync`, `./unstable/async`, `./unstable/proto`, `./unstable/fs`, `./unstable/ast/*`.
Source: https://registry.npmjs.org/typescript/7.0.2 (package.json `exports`).

Checker methods, from `dist/api/sync/api.d.ts` in typescript@7.0.2 (class `Checker`, lines 207-330):
- `getTypeAtLocation(node | nodes[])` returns `Type | undefined` (line 231). Array form batches calls.
- `getContextualType(node: Expression)` (line 239).
- `isTypeAssignableTo(source, target)` (line 246).
- `getTypeFromTypeNode(node)` (line 242).
- `getSymbolAtLocation`, `getTypeOfSymbol`, `getPropertiesOfType`, `getSignaturesOfType`, `getTypeArguments(type)` (line 327), `typeToString`.
- `getSyntacticDiagnostics`, `getSemanticDiagnostics` on `Program` (lines 173-205).

Type flags: `Type.flags: TypeFlags` (`dist/api/sync/types.d.ts` line 22). `TypeFlags.Any = 1`, `Unknown = 2` (`dist/enums/typeFlags.js` lines 5-6). `IntrinsicType.intrinsicName` exists (types.d.ts, "Intrinsic types" block). `ObjectType.objectFlags` exists. Intrinsic names are `any`, `unknown`, `string`, and so on.

AST: the client gets source files as a binary-decoded AST (`typescript/unstable/ast`, with `is*` guards in `ast/is`). Fallow's sidecar uses these (`tools/type-aware-sidecar/src/semantic.mjs` imports `typescript/unstable/ast/is`).
https://github.com/fallow-rs/fallow/blob/main/tools/type-aware-sidecar/src/semantic.mjs

## 2. Stability and version policy

- The TypeScript 7.0 announcement says: "While TypeScript 7.0 is here, it does not ship with an API." and "TypeScript 7 does not yet expose a stable programmatic API". It says: "We expect TypeScript 7.1 to ship with a new (and different) API". https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- 7.0.2 was published 2026-07-08 (`npm view typescript time`). Cadence per the announcement: "new featureful versions published every 3-4 months".
- The 7.0 exports are named `unstable/*`. The microsoft/typescript-go README (repo now closed, to be archived Sept 2026) lists "API | not ready". https://github.com/microsoft/typescript-go/blob/main/README.md
- Evidence of churn: `typescript@next` (7.1.0-dev.20261018.1) already drops the `unstable/` prefix (`./sync`, `./async`), and changes the class shape. `Checker` methods become getters with `.gen()` generator forms, `API.batch()` is added, and `getTypeAtLocation` now "Always returns a type" with `Type.isErrorType`. Read from the tarball `typescript@next` `dist/api/sync/api.d.ts` lines 76-110, 878-885. So code written for 7.0.2 will need a port for 7.1.
- No written semver promise for the unstable API was found in primary sources. Treat every release as breaking.
- Compatibility option: `@typescript/typescript6@6.0.2` re-exports the old TS 6.0 JS API (`ts.createProgram`). https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ ; `npm view @typescript/typescript6`. This is slower (JS), but it is the API type-coverage-core already uses.

## 3. Size and platforms

- `typescript@7.0.2` JS part: 2.50 MB unpacked (`npm view typescript@7.0.2 dist.unpackedSize`).
- Native binary is an optional dependency per platform. Unpacked sizes (`npm view @typescript/typescript-<p>@7.0.2 dist.unpackedSize`): linux-x64 27.9 MB, linux-arm64 26.7 MB, darwin-arm64 27.5 MB, darwin-x64 28.8 MB.
- Platforms in `optionalDependencies`: linux (x64, arm64, arm, ppc64, s390x, loong64, riscv64, mips64el), darwin (x64, arm64), win32 (x64, arm64), freebsd, netbsd, openbsd, aix, sunos. This covers qualbar's four targets (Linux and macOS, x64 and arm64).
- The install per user is about 30 MB. This is much smaller than the 7.1-dev JS part (4.2 MB), which is still minor.
- Node: `engines.node >=16.20.0` for typescript. Fallow's sidecar needs Node >=20 (its package.json). So type coverage needs Node on the user machine.

## 4. How a client talks to it

- `new API({ cwd, tsserverPath? })` spawns the native `tsc` binary as a child process (`dist/api/options.d.ts`, `ClientSpawnOptions`). The "sync" API talks over the child's stdio pipes with a MessagePack-based tuple protocol, using blocking `readSync`/`writeSync` (`dist/api/syncChannel.js` header, lines 5-12, 125-137). On Windows it uses a named pipe.
- Async API: `unstable/async`. LSP mode: `API.fromLSPConnection` connects to an API pipe of a running LSP server (`api.d.ts` lines 31-35).
- Flow: `api.updateSnapshot({openProject: tsconfig})` gives a `Snapshot`, then `Project`, `Program`, `Checker`. Objects are handles; each method is a round trip (batch with array overloads).
- Hard requirement for qualbar: qualbar is a Rust binary. It would either (a) spawn Node plus a JS sidecar that spawns the Go binary (fallow's model), or (b) speak the msgpack pipe protocol to the Go binary directly. Option (b) was not examined: the protocol is internal (`unstable/proto`), so it would be the most fragile.

## 5. How type-coverage-core computes coverage

Source: https://github.com/plantain-00/type-coverage (packages/core/src/checker.ts, core.ts, interfaces.ts, ignore.ts; commit a5216ed, 2026-10-14).

Algorithm:
1. Create a program, `ts.createProgram(rootNames, options)` (core.ts `lintSync`). For every source file (minus `ignoreFiles` globs), call `sourceFile.forEachChild(node => checkNode(node, ctx))`.
2. `checkNode` (checker.ts) is a manual walk over node kinds. It descends into declarations, types, expressions, statements. It skips tokens, literals, punctuation (`createSkippedNodeKinds`, checker.ts line 684+). It acts only on Identifier, PrivateIdentifier and `this` via `collectData`. Type assertions are handled separately in strict mode.
3. `collectData(node)` (checker.ts lines 41-60): `type = checker.getTypeAtLocation(node)` and `contextualType = checker.getContextualType(node)`. If any exist, `totalCount++`. The node is "any" only if EVERY collected type is any (`types.every(...)`). So an identifier whose contextual type is not any is covered.
4. `typeIsAnyOrInTypeArguments(type, anyInTypeArgs)` (checker.ts lines 66-110):
   - `type.flags === ts.TypeFlags.Any` (exact equality) and `intrinsicName === 'any'`. This excludes the error type (intrinsicName "error") and `unknown`.
   - Strict only: object type whose symbol name is `Object` counts as any (unless `ignoreObject`).
   - Strict only: empty anonymous type `{}` counts as any (no properties, no call/construct signatures, symbol flags `Transient | TypeLiteral`, no members) (unless `ignoreEmptyType`).
   - Strict (and not `ignoreNested`): for `type.flags === Object`, recurse into `typeArguments`; any `any` inside (`any[]`, `Promise<any>`) counts. Result kind is `containsAny`, otherwise `any`.
5. Strict-only assertions (`checkTypeAssertion`, lines 120-160): `foo as T`, `<T>foo`, `foo!` are counted as uncovered, except `as any`/`<any>`-style handled as any, `as const`, `as unknown`, and any assertion where `isTypeAssignableTo(exprType, targetType)` is true. Each counted one adds to totalCount. Options `ignoreAsAssertion`, `ignoreTypeAssertion`, `ignoreNonNullAssertion` switch them off.
6. Other options (interfaces.ts, README "Options"): `ignoreCatch` (skips catch-clause variable names, by name within the clause), `ignoreUnreadAnys` (skips writes to implicit-any "evolving" variables, `isEvolvingAssignment`), `ignoreFiles`, `reportSemanticError` (each semantic diagnostic counts as uncovered), `reportUnusedIgnore` (on by default in strict), `// type-coverage:ignore-line` and `ignore-next-line` comments, `files` (check only listed files).
7. Coverage = `correctCount / totalCount`. Per-file results are cacheable by file hash (cache.ts).
8. Version warning: core.ts `assertCompilerApi()` (lines 234-240) throws if `ts.createProgram` is missing, which is true for typescript@7. It tells users to use `@typescript/typescript6`. TS7 support is open issue https://github.com/plantain-00/type-coverage/issues/147 ("TS7/tsgo ... API is not ready", Dec 2025). So type-coverage-core cannot run on TS7 as is.
9. Quirk: the counting basis is "identifiers (and `this`) in all nodes incl. type positions", not "expressions". A port must copy the walker exactly to get equal numbers.

## 6. Is the same possible through TypeScript-Go?

Mostly yes, with these gaps to check:
- Per-identifier call: `getTypeAtLocation` and `getContextualType` exist, so step 3 maps directly. `getContextualType` needs an Expression node; the original passes any node cast to Expression, so behavior on non-expression nodes must be tested in 7.0.2.
- `type.flags === Any` plus `intrinsicName`: both exist. Need to confirm that the TS7 error type has `intrinsicName "error"` (likely, as the Go checker mirrors TS 6; "Same types as TS 6.0" per the typescript-go README table). In 7.1-dev the explicit `isErrorType` is added.
- Strict `Object` check uses `type.symbol.escapedName` and `{}` check uses `symbol.flags`, `members.size`, `getProperties`, signatures. The sync API has `Type.getSymbol()`, `Symbol.getMembers()`, `Symbol.flags`, `Checker.getPropertiesOfType`, `getSignaturesOfType`, `ObjectType.objectFlags`. All present in 7.0.2.
- Type arguments: `Checker.getTypeArguments(TypeReference)` exists (line 327).
- Walker: an AST walker over the decoded AST with `unstable/ast` guards is possible. Alternatively, qualbar walks with Oxc and sends positions to the checker: `getTypeAtPosition(file, positions[])` exists (line 235). That avoids decoding the TS AST, but node positions and the identifier set must match exactly (tsc's identifier set vs Oxc's). Needs a parity test.
- `ignore-line` comments: done on your side (Oxc comments).
- `isEvolvingAssignment`, catch variables: pure syntax, doable in Oxc.
- Result: exact equality with type-coverage-core numbers is not guaranteed, because TS 6 and TS 7 differ in "types printback" and in details. README says "Same types as TS 6.0". Plan a differential test against type-coverage-core on `@typescript/typescript6`.

## 7. How fallow's sidecar and protocol work

Sources: https://github.com/fallow-rs/fallow/blob/main/docs/type-aware-analysis.md ; crates/api/type-aware-protocol.json ; tools/type-aware-sidecar/README.md, package.json, src/.

- It is optional and opt-in: `--type-aware`. The sidecar is a Node package `fallow-type-aware` (MIT, v3.34.1) that pins `typescript` exactly at `7.0.2` and imports `typescript/unstable/sync`.
- Wire contract: one versioned JSON request on stdin, one JSON response on stdout (sidecar README). Manifest `type-aware-protocol.json`: `wire_protocol_version: 7`, `semantic_schema_version: 3`, backend `typescript-go` `7.0.2`, session envelope types `analyze` and `shutdown`, operations `symbol-use`, `symbol-trace`, `api-surface`, `symbol-impact`, `type-coupling`, plus `mutant-typecheck`. Note: the prose doc says "version 6" while the manifest says 7. The manifest is the owner of the value, so the doc is stale.
- Exact version checks: package, protocol and backend versions are validated independently (README). A preflight (`src/backend-preflight.mjs`) fails with a clear message if the resolved `typescript` is below the pinned major.
- Fail-closed: five per-candidate outcomes (`confirmed-used`, `contract-preserved`, `confirmed-no-static-references`, `retained-unresolved`, `retained-abstained`). On any doubt, keep the syntactic finding. Config, program, syntax or bind diagnostics make a project abstain. `--type-aware-require complete` turns incomplete results into an error; default `best-effort` keeps them advisory. Evidence limit 40 per query (10,000 for type-coupling).
- Process hygiene: the binary path is never searched in `node_modules/.bin` or PATH. It comes from `FALLOW_TYPE_AWARE_BIN`, an npm wrapper that resolves the version-matched package, or a sibling file. The child gets a minimal environment, bounded output, whole process group killed on timeout. Default time limit is 2 minutes per request (`FALLOW_TYPE_AWARE_TIMEOUT_SECS`).
- Lifecycle: one Program per selected tsconfig per command. No disk cache, no shared daemon (explicitly "Deferred scope"). Editor sessions keep a Program and update it incrementally.
- Cost fallow reports: median marginal overhead 92 ms, p95 2294 ms, on their corpus of 559 candidates (benchmarks/type-aware-corpus-summary.md). This measures a targeted candidate query, not a full identifier scan, so it does not predict type-coverage cost.
- Fallow does not use it for "any" counting at all. It uses symbol identity. For type coverage, qualbar would need its own operation (for example `type-coverage` over a file list).
- Fallow's sidecar can be copied under MIT (license kept), mainly the pinning, preflight, session and fail-closed ideas.

## 8. Estimated cost per run, about 30k lines (estimate, not measured)

No primary benchmark exists for a full `getTypeAtLocation` scan through the API. Inputs I have:
- Native check speed: VS Code (about 1.5M lines) full build 10.6 s, versus 125.7 s on TS 6 (announcement). Scaled by size, a 30k-line project is about 0.2 s of checking, plus program setup and lib.d.ts load. Estimate: 0.5-1.5 s to build the program and check.
- Node start plus child spawn: about 0.1-0.3 s.
- Identifier queries: a 30k-line repo has roughly 100k-250k identifier nodes (my guess, about 4-8 per line). With the batch array overload, round trips are few but the payload is large (type objects returned as handles with msgpack). My estimate is 1-5 s. Per-call without batching could be tens of seconds. This is the main uncertainty. Mitigation: query by positions in batches of 1-5k.
- Total: about 2-7 s cold, one process, memory perhaps 300-800 MB (guess). With TS 6 JS: roughly 10x slower per the announcement ratio, so 20-60 s.
- Changed-only mode: the checker needs the whole program anyway, so only the walk shrinks. Fallow also has no program cache.
These must be measured in a spike before committing to a performance target.

## 9. Recommendation

Use a TypeScript-Go sidecar for type coverage, as already decided, but with these conditions:
1. Pin `typescript` to an exact version (7.0.2 today). Do not use a range. Name the unstable subpath in one module only.
2. Write a versioned qualbar-to-sidecar JSON protocol (copy fallow's shape: manifest file, generated constants, exact version check, bounded I/O, timeout, process-group kill, minimal env). Keep the sidecar a small Node package shipped as an exact-version optional npm dependency.
3. Fail closed: if the sidecar is missing, wrong version, or the program has config errors, report type coverage as "unavailable" (and fail the gate in strict mode). Never fall back to a guess.
4. Copy type-coverage-core's counting rules exactly, as a spec, and build a differential test against type-coverage-core on `@typescript/typescript6` over fixtures.
5. Plan the 7.1 port: the API shape changes (drop `unstable/`, generator-style methods, `isErrorType`). Treat the sidecar as replaceable. Re-evaluate when 7.1 final ships.
6. Fallback if the TS7 API proves too unstable: sidecar on `@typescript/typescript6` (JS API, same code as type-coverage-core, much slower). This is a real option and keeps numbers identical to quality-ts.

## 10. Open uncertainties

- Real cost of a full-scan on 30k lines (needs a spike; numbers above are estimates).
- Whether `getContextualType` on non-expression nodes behaves like TS 6 in the Go port.
- Whether the TS7 error type reports `intrinsicName "error"` through the API (affects the `any` test). In 7.1-dev it has `isErrorType`.
- Whether Oxc identifier positions match tsc's identifier set exactly (if qualbar drives the walk with positions).
- Exact release date and final API of 7.1 (secondary sources said about October 2026; unconfirmed in primary sources).
- No documented semver or deprecation policy for the unstable API.
- Fallow docs say protocol version 6, manifest says 7 (doc drift; low impact).
- The typescript-go README is stale ("API not ready") while 7.0.2 ships the `unstable/*` API. The blog post is the newer authority.
