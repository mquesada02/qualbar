# Fallow code inventory for qualbar (issue #5)

Source: shallow clone of https://github.com/fallow-rs/fallow at commit d406a14e4aeb4d093222907d605647da0cd3f671 (2026-10-18), workspace version 3.34.1. Clone is in /tmp/claude-1000/research-fallow/src/. Nothing was built or run.
Paths below are relative to that repo: URL form is https://github.com/fallow-rs/fallow/blob/main/<path>.
Line counts are `.rs` lines (wc -l). "No tests" excludes files named tests / *_tests and tests dirs. Unit tests are often large (e.g. extract/src/visitor/tests.rs is 16,996 lines).
crates.io metadata comes from https://crates.io/api/v1/crates/<name>.

## 1. Toolchain, Oxc pins, licence facts

- Licence of the whole repo: MIT, "Copyright (c) 2026 Bart Waardenburg". Source: LICENSE. Every crate uses `license = "MIT"` (Cargo.toml `[workspace.package]`). crates.io shows MIT for fallow-extract, fallow-graph, fallow-license, fallow-cli 3.34.1.
- Copy rule: keep the LICENSE text and copyright line (MIT condition).
- Rust: `rust-version = "1.96"`, edition 2024 (Cargo.toml). Toolchain pinned to 1.99.0 (rust-toolchain.toml). CI has an "MSRV (1.96)" job (.github/workflows/ci.yml line 1449).
- Oxc pins (Cargo.toml `[workspace.dependencies]`): oxc_allocator, oxc_ast, oxc_ast_visit, oxc_parser, oxc_semantic, oxc_span, oxc_str, oxc_syntax all "0.152"; oxc_resolver "11" with feature `yarn_pnp`; oxc_coverage_instrument "0.14.0".
- Locked versions (Cargo.lock): oxc_* 0.152.0, oxc_resolver 11.24.3, oxc_coverage_instrument 0.14.0, oxc_coverage_v8 0.4.2, oxc_coverage_types 0.4.1.
- crates.io now has oxc_parser 0.154.0 (needs Rust 1.97.0) and oxc_resolver 11.24.3 (Rust 1.95.0). So qualbar can pin newer Oxc, but copied code then needs API fixes (Oxc breaks AST APIs at each 0.x minor).
- deny.toml: allowed licences are MIT, MIT-0, Apache-2.0, BSD-2/3, ISC, Unicode, Zlib, BSL-1.0, MPL-2.0, CC0, CDLA-Permissive-2.0. It bans two versions of oxc_allocator/ast/parser/semantic/span.
- Not MIT-family dependencies to note:
  - `lightningcss =1.0.0-alpha.72` is MPL-2.0 (crates.io). It is used only for CSS extraction in fallow-extract. Avoid it for a TS/JS-only tool.
  - `rmcp` (MCP server SDK) is Apache-2.0 (crates.io).
  - `ed25519-dalek` is BSD-3-Clause (license crate only).
- `oxc_coverage_instrument` (MIT) lives at https://github.com/fallow-rs/oxc-coverage-instrument, a separate repo by the fallow authors. `fallow-cov-protocol` 0.8.0 is "MIT OR Apache-2.0" at https://github.com/fallow-rs/fallow-cov-protocol.

### Paid or closed parts: do NOT copy

- crates/license (1,041 lines, lib.rs). Offline Ed25519 JWT check: "public-binary side of fallow's paid-feature gating" (crates/license/src/lib.rs line 1-5; Cargo.toml description). It is MIT-licensed code, but it is the paywall. Not needed. Its wiring is in crates/cli/src/license/mod.rs and crates/cli/src/coverage/mod.rs (`Feature::RuntimeCoverage`).
- Runtime-coverage analysis is closed source. crates/v8-coverage/src/lib.rs lines 25-27: "The closed-source cross-reference, combined scoring, hot-path heuristics and verdict generation live in `fallow-cov` (private) and consume the CLI's remapped function output via the `fallow-cov-protocol` envelope." The CLI downloads a `fallow-cov` sidecar (`@fallow-cli/fallow-cov`, crates/cli/src/coverage/mod.rs lines 174-176). Env vars: docs/environment-variables.md lines 70, 89-90. The sidecar source is not in the repo. `fallow-cov-protocol` is only the message types.
- Other tools/ sidecars (tools/type-aware-sidecar, tools/similar-code-sidecar, tools/mutation-runner) are MIT-licensed in-repo (each has a LICENSE). Not paid, but not needed.
- Result: no non-MIT Rust source found in the repo. The paid/closed parts are (a) the license crate and its call sites, (b) the private `fallow-cov` binary, which is absent. Check anything that touches `fallow_license::`, `Feature::`, `fallow_cov_protocol` before copying.

## 2. Crate map and sizes (src only, with inline tests)

| Crate | Lines | Role |
|---|---|---|
| types | 35,671 | shared DTOs, serde paths |
| config | 37,792 | config types, workspaces, plugin config, boundaries config |
| extract | 124,444 (88,357 no tests) | Oxc parse, visitors, complexity, SFC/CSS/MDX |
| graph | 46,992 (about 38,000 no tests) | resolver + module graph |
| core | 211,538 total with tests | plugins, entry points, dead-code detectors |
| engine | 123,084 | health, duplication, CRAP, orchestration |
| output | 35,704 | report DTOs, SARIF, CodeClimate |
| api | 76,122 | facade |
| mcp | 34,780 | MCP server |
| cli | 295,347 | binary |
| v8-coverage | 468 | V8 dump types |
| license | 1,041 | paid gating |

Dependency chain (from each crates/*/Cargo.toml): extract -> types; graph -> types, config; core -> config, extract, graph, security, types; engine -> config, core, extract, graph, mutation, output, security, types.

## 3. Per-part findings

Coupling scale: Low = can lift with small edits; Medium = needs the shared types and config; High = tied to fallow's data model.

### 3.1 Module resolver setup
- Path: crates/graph/src/resolve/specifier.rs, fn `build_resolve_options` (line 94-135) and `create_resolver`; Yarn PnP probe (`find_yarn_pnp_manifest_dir`, lines 137-170).
- What it does: `ResolveOptions` with `extension_alias` (.js -> .ts/.tsx/.gts/.js/.gjs/.d.ts, .mjs -> .mts, .cjs -> .cts, .jsx -> .tsx), `main_fields module,main`, `TsconfigDiscovery::Auto`, `yarn_pnp` only when `.pnp.cjs` exists. Falls back to a plain resolve when a tsconfig is broken (`is_tsconfig_error`).
- Size: the function is about 40 lines. The whole resolve dir is 15,573 lines (12,596 no tests): specifier.rs 3,894; fallbacks.rs 3,280; mod.rs 798; types.rs 757.
- Deps: oxc_resolver 11 (MIT), dunce, rayon, dashmap, globset, rustc-hash, fixedbitset. Internal: fallow-types (18 imports), fallow-config (`PackageJson` 28 uses, `WorkspaceInfo`, tsconfig output map, `JsxImportSourceRule`).
- Coupling: the options builder is Low (takes `root`, plugin names, conditions). The rest of resolve/ is Medium-High: `ResolveAllImportsInput` takes fallow's `ModuleInfo`, `WorkspaceInfo`, plugin results. `build_extensions(active_plugins)` and `build_condition_names` depend on fallow plugin names.
- Practical: copy `build_resolve_options` + PnP probe + tsconfig-error retry idea (about 100 lines). Write the rest fresh, or copy `fallbacks.rs`/`upgrades.rs` ideas only for specific cases (output-dir to source mapping, react-native, auto-imports are framework-specific, skip).

### 3.2 Entry points and framework plugins
- Paths: crates/core/src/plugins/ (156 files, 67,502 lines; 63,700 no tests; mod.rs 3,029, config_parser.rs 6,214); crates/core/src/discover/entry_points.rs (3,678); crates/core/src/scripts/ (12,089; package.json script parsing and CLI flag credits).
- Deps: fallow-config (96 uses), fallow-types (34), fallow-extract (9), fallow-graph (4), `crate::resolve` (134 uses; core re-exports graph resolve), plus oxc_* parsers for config files, regex, glob, toml, serde.
- Coupling: High. Each plugin implements a trait and reads `PackageJson`, `PluginResult`, config enums from fallow-config; `config_parser.rs` evaluates JS config files with an Oxc-based static evaluator. 100+ plugins are data about tools (jest, vite, next...).
- Practical: do NOT copy wholesale. Copy the idea and the minimal set that qualbar needs for TS/JS-only: package.json `main/module/exports/bin/types` entry mapping, scripts parsing, vitest/jest/eslint/tsdown config entries. docs/plugin-authoring.md describes the trait. Write fresh with a small plugin trait; lift individual small plugin files as data (e.g. core/src/plugins/vitest.rs-style files) after trimming imports.

### 3.3 AST extraction
- Path: crates/extract/src/ (parse.rs 2,900; visitor/ 52,270 with tests, 35,274 without; visit_impl.rs 6,589; visit_impl_dynamic_imports.rs 823; helpers.rs 3,631; binding_references.rs; inventory.rs 1,010; flags.rs 2,402).
- Deps: oxc_allocator/ast/ast_visit/parser/semantic/span/str 0.152, rayon, regex, xxhash-rust, sha2, rustc-hash, bitcode (cache), tracing, plus lightningcss + cssparser (MPL-2.0, CSS only), fallow-cov-protocol. Internal: fallow-types only (32 uses in parse.rs).
- Coupling: Medium. The crate depends only on fallow-types, which is good. But the visitor is one very large `ModuleInfoExtractor` (React, Vue/Svelte/Astro SFC, Angular, Playwright, security sinks, Effect, factory properties). Output type is `ModuleInfo` from types/src/extract.rs.
- Practical: the core of imports/exports/dynamic imports/require/re-exports (visit_impl.rs plus helpers) is useful but entangled with framework visitors. Best: copy the crate's TS/JS subset by deleting sfc*, astro, mdx, css*, glimmer, react*, security_sinks, component_contracts, template_*, and cut `fallow-cov-protocol` and `lightningcss`. Expect days of pruning. Alternative: write a fresh, smaller extractor and use fallow's visitor and its tests (src/tests/js_ts/*, e.g. dynamic_imports.rs 2,370 lines) as a behaviour reference/oracle.

### 3.4 Module graph
- Path: crates/graph/src/graph/ (29,720 with tests; 25,016 no tests). Key files: mod.rs 2,807; reachability.rs 2,388; narrowing.rs 2,369; build.rs 1,861; effective_exports.rs 1,848; re_exports/ (propagate 1,752, mod 1,393); namespace_re_exports.rs 1,677; cycles.rs 1,641; types.rs 1,293; plus cache/ 1,564 (postcard on-disk cache).
- Deps: fallow-types (267 uses), fallow-config, oxc_resolver, oxc_span, rayon, globset, fixedbitset, dashmap, postcard, serde. All permissive.
- Coupling: Medium-High. Built from `ResolvedModule`/`ModuleInfo` of fallow-types; reachability and effective exports encode fallow's rules (re-export chains, namespace aliases, framework entry weight).
- Practical: cycles.rs and re_exports propagation are good standalone algorithms (Tarjan SCC, barrel propagation) and well tested (re_exports/tests.rs 4,704 lines). Copy those with the type definitions they need. Write the graph struct fresh around qualbar's own ModuleInfo, since Martin metrics (fan-in/out, instability) need fresh code anyway (fan_io.rs 418 lines is a small start).

### 3.5 Cyclomatic and cognitive complexity
- Path: crates/extract/src/complexity.rs (2,423 lines, incl. tests) + complexity_names. 
- Method: single Oxc visitor pass, function scope stack. Cyclomatic counts if/for/while/do/case/catch/?:/&&/||/??/&&=/||=/??=/`?.`. Cognitive follows SonarSource; `?.` is not counted (file header, lines 1-20).
- Deps: oxc_ast, oxc_ast_visit, oxc_semantic (ScopeFlags), oxc_span. Internal: fallow-types (11 uses: `FunctionComplexity`, etc.) and fallow-cov-protocol (1).
- Coupling: Low-Medium. Has React/Effect additions folded into cognitive (HookDensity, PropCount, Effect span names, lines 17-30). These change the numbers versus plain SonarSource, which matters for quality-ts parity.
- Practical: best candidate to copy. Strip React/Effect folding and swap the output struct. About 1,500 lines of logic.

### 3.6 Duplication detection
- Path: crates/engine/src/duplication_detector/ (17,791 with tests; 12,194 no tests). Files: detect/suffix_array.rs 660, detect/rolling.rs 951, detect/filtering.rs 871, detect/extraction.rs 602, tokenize/*, normalize.rs 563, near.rs 984, families.rs 667, deepdive.rs 1,125, cache.rs 929, mod.rs 1,521, token_visitor.rs 902. Also extract/src/similar_code.rs 942 (semantic similar-code; sidecar based).
- Method: tokenise with Oxc, normalise, suffix array + LCP (own implementation, no external crate), rolling hash, clone families, optional near-clone.
- Deps: oxc_*, rayon, xxhash, fallow-extract (14 uses), fallow-config (15), fallow-types (6), `crate::duplicates` (32 uses, engine-level result types).
- Coupling: Medium. It sits in `fallow-engine` and reads engine modules (discover, suppress, baseline, results).
- Practical: copy `detect/` (suffix_array, lcp, rolling, ranking, statistics, filtering, extraction, about 3,000 lines no tests) + tokenize + normalize + token_visitor, then rewrite the glue (mod.rs, cache). Alternatively keep qualbar's jscpd-equivalent semantic via fresh code; fallow's algorithm is the sound base.

### 3.7 CRAP and coverage parsing (LCOV, Istanbul, V8)
- CRAP formula: crates/engine/src/health/scoring.rs lines 845-853: `CC^2 * (1 - cov/100)^3 + CC`. Threshold const `CRAP_THRESHOLD = 30.0` (line 271). scoring.rs is 8,914 lines (large, includes file health scores and many tests).
- Istanbul: `IstanbulCoverage`, `load_istanbul_coverage`, matching functions by name/line/column with drift limits (scoring.rs lines 855-905, 1545-1700). Parsing types come from external crate `oxc_coverage_instrument::FileCoverage` (MIT, fallow-rs/oxc-coverage-instrument).
- V8: crates/v8-coverage/src/lib.rs (468 lines, serde types + UTF-16 `LineOffsetTable`); crates/engine/src/health/coverage_v8/mod.rs (770) + mapped.rs (317): turns `NODE_V8_COVERAGE` dumps into Istanbul records using `oxc_coverage_instrument`, with source-map remap (srcmap-sourcemap, url crates).
- LCOV: NOT supported. grep for "lcov" finds only a glob in config/src/config/resolution.rs line 2257 (`coverage/lcov-report/index.js`) and fallow's own CI (.github/workflows/coverage.yml). There is no LCOV parser to copy.
- Fallow does not run tests itself for CRAP; it reads a coverage file you provide, and falls back to "static estimates" (scoring.rs line 558 `compute_crap_scores_estimated`, `INDIRECT_TEST_COVERAGE_ESTIMATE`). This conflicts with the qualbar rule "never estimated coverage". Do not copy the estimated path.
- Deps: engine health imports `crate::discover`, `crate::source`, fallow-graph, fallow-output, fallow-types (see counts for scoring.rs: discover 122, types 90, source 72, graph 56, output 42).
- Coupling: High for scoring.rs, Low for v8-coverage (only serde).
- Practical: copy crates/v8-coverage (468 lines) as is. Copy the `crap_formula` idea (3 lines) and the Istanbul function-matching logic (extract about 600-800 lines, replacing the types). Use `oxc_coverage_instrument` as a dependency instead of copying it (MIT, 0.14.0, Rust 1.96). Write LCOV fresh (small format). Write the test runner part fresh.

### 3.8 Boundaries (architecture rules)
- Paths: crates/config/src/config/boundaries.rs (3,623 lines: zones, rules, presets such as `BoundaryPreset`, validation); crates/core/src/analyze/boundary.rs (939) and boundary_coverage.rs, boundary_calls/mod.rs (220).
- Deps: fallow-config, fallow-types, `crate::graph`, globset.
- Coupling: Medium. Zone-based import rules (zone -> allowed zones) checked on the graph edges.
- Practical: copy the zone/rule model and the checker (about 1,000 lines after trimming presets for frameworks); write config parsing fresh for qualbar's new config format. Note: this is a rule engine, not Martin metrics. Martin metrics are not in fallow; write fresh.

### 3.9 Dead-code detection
- Path: crates/core/src/analyze/ (50,755 with tests; 40,200 no tests). Core ones: unused_exports.rs 4,161; unused_files.rs 391; unused_deps.rs 2,983 (+ unused_deps_tests/); mod.rs 3,391; re_export_cycles.rs; package_cycles.rs. Many are framework-specific (Vue/Svelte/Angular/React/route trees), skip them.
- Deps: fallow-config, fallow-types, fallow-graph, fallow-extract, oxc_*, ignore, glob, globset, regex.
- Coupling: Medium-High: needs `ModuleGraph`, `ResolvedConfig`, plugin-provided "used exports" and "tooling deps".
- Practical: copy unused_files (reachability from entries), unused_exports (graph walk + member usage), and the unused_deps logic including peer closure; write the glue fresh. Maybe 8,000 lines relevant. Use fallow's CHANGELOG as a list of known edge cases.

### 3.10 JSON output types
- Paths: crates/output/src (35,704) and crates/types/src (35,671); docs/output-schema.json; schema.json. `schemars` 1.x derives JSON Schema (optional feature `schema`).
- Deps: serde, serde_json, schemars (MIT), rustc-hash, bitcode in types.
- Coupling: Low in structure (plain DTOs) but the shape is fallow's: findings with `actions`, SARIF, CodeClimate, GitHub annotations, audit_* envelopes.
- Practical: do not copy the schema; qualbar needs its own contract (quality-ts parity). Copy only the SARIF and CodeClimate emitters (analysis_sarif.rs, codeclimate.rs, dead_code_sarif.rs) if wanted.

### 3.11 MCP server
- Path: crates/mcp (34,780 lines incl. tests; src 21,969: params.rs 2,174, resources.rs 422, tool_guides.rs 303, nearest.rs 201, lib.rs 129). Uses `rmcp 3.1` (Apache-2.0) with `transport-io`, `rquickjs 0.14` (MIT; embeds a JS engine), tokio, schemars, fallow-api (the 76k-line facade) and fallow-process.
- Coupling: High to fallow-api types. rquickjs is a heavy dependency.
- Practical: write fresh. A thin MCP server with rmcp (or a plain stdio JSON-RPC) over qualbar's own JSON output is a few hundred lines. Copy only tool descriptions/guide text style.

## 4. The three false positives on quality-ts

Context: I could not run fallow (no build, no cargo). I read HEAD (3.34.1). I could not find which fallow version produced the quality-ts reports: quality-ts has no fallow file or note. Findings below are from the code and CHANGELOG.md. All three shapes appear in the CHANGELOG as fixed in 3.32.0 (2026-10-06, CHANGELOG.md line 1917 header; entries at lines 2443, 2578, 2602). So the likely cause is an older fallow than 3.32.0, and HEAD should no longer report them. This is an inference, not a test.

### 4.1 `(await import('./x.js')).name` reported unused
- quality-ts shape: src/entry/mcp-command.ts lines 16 and 24: `(await import("./mcp/stdio.js")).serveStdio(parts)`.
- Cause in the old code: the dynamic import was visited as a plain `ImportExpression`. A member read on the awaited value was not tied to the import, so no named export was credited and `serveStdio` looked unused. CHANGELOG.md line 2602: "Before, fallow did not credit an export in code such as `(await import('./loader')).run()` ... Thus it reported each export of the target file as unused."
- Fix at HEAD: crates/extract/src/visitor/visit_impl_dynamic_imports.rs `record_awaited_dynamic_import_member` (lines 233-253). It strips parentheses, requires `AwaitExpression` of an `ImportExpression`, collects the static specifiers, and pushes a dynamic import that names the member. It is called from `visit_static_member_expression` (visit_impl.rs line 5124) and `visit_computed_member_expression` (line 5208).
- Remaining gaps (from the code): it needs a static string specifier (`collect_static_import_specifiers`); `const m = await import(core.url)` style (stryker-runner.ts line 90) has no static specifier. Binding the namespace first (`const m = await import('./x.js'); m.name`) is handled by a different path (`record_loader_call_declaration`, line 445).
- Lesson for qualbar: handle member access on a parenthesised await-import in the extractor from the start; keep a test for it.

### 4.2 `new URL('./x.js', import.meta.url)` reported as unresolved import
- quality-ts shape: src/entry/composition-root.ts line 39: `fileURLToPath(new URL("./stryker-runner.js", import.meta.url))`. The file does not exist in src/entry/. It exists only in the build output: tsdown.config.ts builds `src/adapters/mutation/stryker-runner.ts` to `dist/stryker-runner.js`. So the path is valid only after the bundle moves the code to dist/, never in the source tree.
- Cause: `new_url_import_source` (crates/extract/src/visitor/visit_impl_helpers.rs line 732) treats any `new URL("./..." | "../...", import.meta.url)` as a module reference, as a worker/asset detector. `visit_new_expression` (visit_impl.rs lines 4851-4880) pushes it as a `DynamicImportInfo`. The resolver then resolves relative to the source file, finds nothing, and reports `unresolved-import`.
- Fix at HEAD: `is_speculative` is true when (a) the specifier has no extension (issue #840), or (b) the `new URL` is a direct argument of a call whose name is in `FILESYSTEM_PATH_CALLEES` (visit_impl_helpers.rs lines 746-780, includes `fileURLToPath`, `readFileSync`, `existsSync`, etc.; set by `record_filesystem_path_new_url_arguments`, visit_impl_dynamic_imports.rs lines 20-31). A speculative reference credits the target if it resolves and is silently dropped if not. CHANGELOG.md line 2578. The quality-ts call is a direct `fileURLToPath(...)` argument, so HEAD should stay silent.
- Remaining gaps: `new Worker(new URL("./w.js", import.meta.url))` with a build-output-only file is still reported by design (comment in visit_impl.rs lines 4857-4866). The check is by callee name only (no import proof), and an intermediate variable (`const u = new URL(...); fileURLToPath(u)`) or a wrapper function is not recognised.
- Lesson for qualbar: model "path relative to build output" explicitly. Treat `new URL(lit, import.meta.url)` as an asset reference that never raises unresolved-import when the file has an extension unknown to the build map, or resolve it through the tsdown/tsc output map.

### 4.3 Peer dependency (hono for @modelcontextprotocol/node) reported unused
- quality-ts shape: package.json lists `hono 4.13.13` and `@modelcontextprotocol/node 2.1.0`. node_modules/@modelcontextprotocol/node/package.json has `peerDependencies: { hono: "^4.11.4", "@modelcontextprotocol/server": ... }` and `peerDependenciesMeta.hono.optional = true`. No source file imports hono (the node package loads it itself). The node package is imported in src/entry/mcp/http.ts lines 9-10.
- Cause in the old code: only required peers of used packages were credited. CHANGELOG.md lines 2443-2450: "An optional peer of a used dependency is no longer reported as an unused dependency ... so it reported such an optional peer as unused. Now fallow credits required and optional peers alike."
- Fix at HEAD: crates/core/src/analyze/unused_deps.rs `PeerDependencyResolver::peer_dependency_closure` (lines 128-168). It reads each used package's installed `peerDependencies` (from node_modules) and records every peer, required or optional, in `hosts_by_peer`. An optional peer passes credit onward only if the project lists it (`!peer.optional || listed.contains(...)`, line 158). Seeds are only used packages, so peers of unused packages stay reported.
- Remaining gaps: the credit depends on the host being installed in node_modules (it reads the installed package.json), so a run before `pnpm install` would still report it. Also the host must count as used by an import.
- Lesson for qualbar: crediting must read installed peer metadata, both required and optional, and only from used hosts.

## 5. Recommendation

Copy (keep the MIT notice with Bart Waardenburg's copyright, note the commit d406a14 in each file header):
1. crates/v8-coverage (468 lines) nearly as is.
2. extract/src/complexity.rs, minus React/Effect folding (about 1,500 logic lines). Check that numbers match quality-ts before keeping it.
3. `build_resolve_options` and the Yarn PnP probe (about 100 lines) from graph/src/resolve/specifier.rs.
4. duplication_detector/detect/* (suffix array, rolling hash, filtering, extraction), tokenize, normalize, token_visitor (about 5,000 lines no tests); write the glue fresh.
5. The CRAP formula and the Istanbul function matcher from scoring.rs (about 700 lines extracted), using `oxc_coverage_instrument` 0.14 as a dependency.
6. Algorithms from graph: cycles.rs, re-export propagation, reachability, with their tests.
7. Boundary zone/rule checker (core/src/analyze/boundary.rs) and the peer-dependency closure and unused_deps/unused_exports/unused_files logic.
8. Fallow's JS/TS extractor tests (extract/src/tests/js_ts/*, visitor tests) as a behaviour corpus, so the three false positives above are fixed from day one.

Write fresh:
- Config format and loader (the config crate is tied to fallow's schema and ureq).
- Output/JSON contract (own schema; keep SARIF emitters only if needed).
- Module graph struct and the Martin metrics (fallow has none).
- LCOV parser (fallow has none), and the test-running coverage step (fallow reads provided files and falls back to estimates, which qualbar forbids).
- A small plugin/entry-point layer (do not copy the 156 plugin files and 6k-line config evaluator).
- MCP server (small, over qualbar's own JSON).
- Extractor core: either prune fallow's crate (framework and CSS code, about 50% of 88k lines, plus lightningcss MPL-2.0 and fallow-cov-protocol) or write a smaller one. I lean to writing a smaller one and copying only pieces, because the visitor is one 6,589-line `visit_impl.rs` entangled with React/Vue/security features.

Never copy: crates/license, anything gated by `Feature::RuntimeCoverage`, fallow-cov sidecar glue (cli/src/coverage/*), lightningcss-based CSS code.

Version choice: pin Oxc to one release line for every copied file (fallow uses 0.152; crates.io has 0.154). Copy first at 0.152 so the code compiles unchanged, then upgrade in one separate step. Rust 1.96 minimum for oxc_coverage_instrument 0.14.
