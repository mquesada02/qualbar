# Metric parity map: quality-ts rules to qualbar (issue #6)

Date: 2026-10-18. Nothing was built or run, except `node dist/cli.js explain` in the quality-ts checkout. I also shallow-cloned two upstream repos (read only).

## 0. Sources and short names

- QT = /home/mquesada/orca/workspaces/quality-ts/t43-dogfood (quality-ts, commit a3a7b9c). NM = QT/node_modules.
- FW = /tmp/claude-1000/research-fallow/src/crates (fallow d406a14, v3.34.1).
- FTA = /tmp/claude-1000/research-parity/fta (clone of https://github.com/sgb-io/fta, commit 812bd55, crate 3.1.0; QT pins fta-cli 3.0.1).
- JSCPD = /tmp/claude-1000/research-parity/jscpd/rust (clone of https://github.com/kucherenko/jscpd, commit 9685516, v5.4.1; QT pins 5.4.0).
- RES = /tmp/claude-1000/-home-mquesada-Documents-Projects-quality-ts/5e53f61a-ed08-41eb-ae36-f1cb3d12e1b7/scratchpad/research (earlier findings files).
- Map decisions used: qualbar#2 (map), #4 (TypeScript-Go), #5 (fallow inventory). Mutation engine choice is in #3 and RES/mutation-approach.md.

## 1. The real count

`node dist/cli.js explain --list` prints 37 rules. The count is right. Split:

- 34 scored rules in QT/src/domain/catalog/catalog.ts (function 8, types 2, crap 1, architecture 8, cohesion 4, dry-yagni 9, mutation 2).
- 1 gate rule, `baseline/warning-count` (QT/src/domain/explain-catalog/baseline.ts; logic in QT/src/domain/gate/baseline.ts:94-105).
- 2 rules that are never scored, `principle/ocp` and `principle/lsp` (QT/src/domain/explain-catalog/principle.ts).

The question names 7 modules. The explain list has 9 (it adds `baseline` and `principle`).

## 2. Facts that hold for many rules

1. File set. Every adapter takes the files that `tsconfig.json` resolves (QT/src/adapters/shared/target-files.ts:50-80: `ts.parseJsonConfigFileContent`, extensions `.[cm]?[jt]sx?`, `.d.ts` kept). qualbar needs its own tsconfig `include/exclude/files/extends` evaluator. I did not check whether oxc_resolver evaluates `include`. Fallow does not use tsconfig include; it walks the tree (RES/fallow-code-inventory.md 3.1).
2. Test files. `judgesTests: false` rules drop measurements on files that match `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `**/test/**`, `**/tests/**` (QT/src/domain/catalog/is-test-file.ts:3). `judgesTests` is false for lines-per-function, params, fta-score, crap, cohesion/*, architecture/*, mutation/* (QT/src/domain/catalog/catalog.ts, field `judgesTests`).
3. ESLint rules run at threshold 0 (lines: 1), so every function reports its value. The Gate applies the real threshold (QT/src/adapters/eslint/flat-config.ts:27-35). qualbar can do the same: measure everything, gate later.
4. Symbols. Same-name results get `#2`, `#3` in source order (QT/src/adapters/eslint/eslint-analyzer.ts `suffixSymbols`; QT/src/adapters/eslint/scopes.ts: `<anonymous#n>`, `<field-init:x>`, `<static-block>`, `get x`/`set x`). This only matters if qualbar wants the same finding names. Config and baseline are new in qualbar, so it probably does not.
5. Ratio rules (types/coverage, dry-yagni/duplication, mutation/score) sum counts per package and compare `count*100 >= threshold*total` (QT/src/domain/gate/ratio-gate.ts:34-37, 60-72). A value equal to the threshold passes.
6. Exclusive bounds: cohesion/lcom96b and cohesion/methods-per-class fail at the bound itself (QT/src/domain/catalog/catalog.ts:193-222).

Parity risk scale: None = same by construction. Low = small known edge cases. Medium = known differences that a port must fix. High = result will differ unless a specific algorithm is copied. Cannot be exact = depends on an external engine we do not link.

## 3. Main table (37 rows)

"Needs" = type information (TS-Go) or test runs. "Fallow" = already in fallow, with path under FW.

| Rule | Definition and default in quality-ts | Tool | Rust algorithm for qualbar | Needs | Fallow has it? | Parity risk |
|---|---|---|---|---|---|---|
| function/lines-per-function | Physical lines from first to last line of each function; blank and comment lines count. Skips IIFEs. Methods and accessors use the whole method node. Default <= 50. [F1] | ESLint 10.11.0 `max-lines-per-function` | Oxc visitor over Function and Arrow nodes. `end_line - start_line + 1`. Skip a function that is the callee of a call. For methods, take the method span, not the inner function span. | No | Partly: `line_count` in extract/src/complexity.rs (pop_function) and types/src/extract.rs:1293. It uses the function span and does not skip IIFEs. | Low |
| function/params | `params.length` of each function. Rest counts 1, a destructured parameter counts 1, parameter properties count, `this` counts unless typed `void`. Default <= 3. [F1] | ESLint `max-params` | Count `FormalParameters.items` plus rest; add `this_param` when its type is not `void`. | No | Partly: `param_count` (extract/src/complexity.rs:392). It never counts `this`. | Low |
| function/nesting-depth | Per function, depth of nested statements: if (not else-if), switch, try, while, do-while, for, for-in, for-of, with. Plain blocks do not count. Max depth reached is the value. Default <= 4. [F1] | ESLint `max-depth` | Visitor with a depth stack that resets at each function, arrow, static block and at Program. Keep the max per scope. | No | No (I found no depth metric; `nesting_level` in complexity.rs is internal to cognitive). | Low |
| function/cyclomatic | McCabe, ESLint "classic" variant. 1 + catch, ?:, `&&` `\|\|` `??`, for, for-in, for-of, if, while, do-while, default value (AssignmentPattern), `case` with a test, `&&=` `\|\|=` `??=`, every `?.` link. Class field initializers and static blocks are their own units. Default <= 10. [F2] | ESLint `complexity` | Port the list above on the Oxc AST. | No | Yes, close: `cyclomatic` in extract/src/complexity.rs. Three differences (see [F2]). | Medium |
| function/cognitive-complexity | SonarJS S3776 value per function, each function scored alone (nesting restarts at 0 in a nested function). Default <= 15. `\|\|` and `??` add nothing; only `&&` runs add. [F3] | eslint-plugin-sonarjs 4.2.2 | Write from the public algorithm and match the plugin by differential tests. Do not copy plugin code (license, see [F3]). | No | Yes, close: `cognitive` in extract/src/complexity.rs. It counts `\|\|` and `??`. | High until `\|\|` is decided |
| function/identical-functions | In one file, a later function whose body has the same token sequence as an earlier one. Only FunctionDeclaration, and function or arrow values of a VariableDeclarator or MethodDefinition. Body (without outer braces) spans >= 3 lines. Default <= 0. [F4] | eslint-plugin-sonarjs S4144 | Collect candidate functions in source order. Compare Oxc lexer token kinds and texts of the body, skipping comments. Pairwise, first match wins. | No | No | Medium |
| function/duplicated-branches | `if / else if / else` chains and `switch` cases with the same code. A branch must span > 1 line. Compared by node type and token text. Default <= 0. [F4] | eslint-plugin-sonarjs S1871 | Same token compare as above. Chains are collected from the head `if`. | No | No | Medium |
| function/fta-score | FTA score of a whole file: 100 - (171 - 5.2 ln(vocab) - 0.23 cyclo - 16.2 ln(factor)) * 100 / 171, clamped at 0. Default <= 60. [F5] | fta-cli 3.0.1 (Rust, SWC) | Best: link the `fta` crate (3.1.0, MIT OR Apache-2.0). Alternative: port to Oxc (high risk). | No | No. Fallow has a different maintainability index (engine/src/health/scoring.rs:2396-2430), no Halstead. | High on Oxc port; None if the crate is linked |
| types/coverage | Share of identifiers (and `this`) whose type is not `any`, in strict mode. Default >= 99 %. [F6] | type-coverage-core 2.30.2 on TypeScript 6.0.3 | TypeScript-Go sidecar (decision #4). Port the walker and rules. | Yes: type information | No (fallow's sidecar does no `any` counting; RES/typescript-go-type-coverage.md section 7) | Cannot be exact (see section 5) |
| types/unsafe-any | One finding per site that counts as unsafe: `any`, contains-`any`, unsafe `as`, unsafe `<T>x`, unsafe `!`. Plus one finding per `type-coverage:ignore` comment. Default <= 0. [F6] | type-coverage-core 2.30.2 | Same sidecar run as types/coverage. Ignore comments are found with Oxc comments. | Yes | No | Cannot be exact |
| crap/score | CRAP = CC^2 * (1 - cov)^3 + CC per function row. CC and rows from crap-ts, not from ESLint. cov = hit lines / executable lines, over the lines of the function range in the coverage report. Missing coverage counts as 0 %. Default <= 15. [F7] | @mquesada02/crap-ts 0.9.0 + the project's own test run | Port crap-ts: its row extraction and its CC. Take line coverage from Istanbul JSON as Istanbul's LCOV writer does. | Yes: test run with coverage | Partly: formula and Istanbul reader (engine/src/health/scoring.rs:851, 424). Different CC and different coverage method. | High if fallow's method is used; Low if crap-ts is ported |
| architecture/unassigned-file | A source file that matches no component glob. Default <= 0. [F8] | quality-ts domain code (files from tsconfig) | Glob match per file; port `assignComponents`. | No | Partly: boundary coverage (core/src/analyze/boundary_coverage.rs, `coverage.require_all_files`). First match wins there. | Low |
| architecture/layer-violation | A distinct file edge between two components where the target component is not in `allowedDependencies[from]`. Default <= 0. [F8] | quality-ts domain code + dependency-cruiser 18.4.0 edges | Port `crossEdges` and `forbiddenEdges` (about 30 lines). Edges from the Oxc graph. | No | Yes, other model: zone rules (core/src/analyze/boundary.rs, config/src/config/boundaries.rs:1447 first-match zone). | Low (given the same edges) |
| architecture/cycle | A file cycle that dependency-cruiser finds, where no edge of the cycle is `import type` or `export type`. One finding per distinct cycle after rotation. Default <= 0. [F9] | dependency-cruiser 18.4.0 | Port dependency-cruiser's `getCycle` DFS and its dependency order. Do not use SCC enumeration. | No | Yes, different: `find_cycles` Tarjan SCC then elementary cycles on runtime edges (graph/src/graph/cycles.rs:36-103). | High unless `getCycle` is ported |
| architecture/sdp | For each pair of components with an import edge: finding when I(target) > I(source), strictly. Default <= 0. [F8] | quality-ts domain code | Port `sdpMeasurements`, exact fraction compare. | No | No | Low |
| architecture/distance | D = abs(A + I - 1) per component that has at least one counted declaration. Default <= 0.5. [F8] | quality-ts domain code + Oxc declaration count | Port `distance`, `abstractness`, `countDeclarations`. | No | No (only fan-in/fan-out: graph/src/graph/fan_io.rs) | Low |
| architecture/instability | I = Ce / (Ca + Ce). Per-component min/max range from config, no default. [F8] | quality-ts domain code | Port `componentMetrics`, `instability`. | No | No | Low |
| architecture/efferent-coupling | Ce = number of distinct target files in other components that the component's files import. Default <= 20. [F8] | quality-ts domain code | Same as above. | No | No | Low |
| architecture/abstractness | A = abstract / (abstract + concrete) exported top-level declarations. Report only. [F8] | quality-ts domain code | Same as above. | No | No | Low |
| cohesion/lcom96b | Mean over instance fields of the share of methods that do not touch the field. 0 if methods <= 1 or no fields. Default < 0.3 (exclusive). [F10] | quality-ts own code (TypeScript AST) | Port `lcom96b`, `classParts`, `thisAccesses` to Oxc. | No | No | Low |
| cohesion/methods-per-class | Count of instance methods, accessors and function-valued properties. Default < 20 (exclusive). [F10] | quality-ts own code | Same port. | No | No | Low |
| cohesion/fields-per-class | Count of instance fields plus constructor parameter properties. Report only. [F10] | quality-ts own code | Same port. | No | No | Low |
| cohesion/methods-per-interface | Distinct named method signatures plus function-typed properties plus computed ones, per interface. Report only. [F10] | quality-ts own code | Same port. | No | No | Low |
| dry-yagni/duplication | Share of lines that are in clones, per package: union of clone line ranges / total lines. Default <= 5 %. [F11] | jscpd 5.4.0 (Rust) + quality-ts line math | Link or copy jscpd's `cpd-tokenizer` and `cpd-core`; port the line union. | No | Yes, other algorithm: engine/src/duplication_detector (suffix array). | High with fallow's engine; Low with jscpd's |
| dry-yagni/clone | One finding per side of each clone pair, min 5 lines and 50 tokens, same file format only. Default <= 0. [F11] | jscpd 5.4.0 | Same as above. | No | Yes, other algorithm (same file set). | High with fallow's engine; Low with jscpd's |
| dry-yagni/unused-file | A project file that no entry point reaches. Default <= 0. [F12] | Knip 6.39.0 | Reachability on the Oxc module graph from entries (package.json, config, scripts). | No | Yes: core/src/analyze/unused_files.rs; entries from plugins (core/src/plugins, 156 files). | High (entry detection) |
| dry-yagni/unused-export | An export that no other file uses. Default <= 0. [F12] | Knip | Graph walk with re-export propagation. | No | Yes: core/src/analyze/unused_exports.rs:408. | Medium-High |
| dry-yagni/unused-type | An exported type or interface that no other file uses. Default <= 0. [F12] | Knip | Same walk, type exports only. | No | Yes: `unused_types` (types/src/results.rs:254; `is_type_only` at 2164). | Medium-High |
| dry-yagni/unused-member | An unused enum member or namespace member. Class members are not reported. Default <= 0. [F12] | Knip | Member access tracking for enums and namespaces. | No | Yes: `MemberKind::EnumMember` and `NamespaceMember` (types/src/extract.rs:2293-2301). Fallow also reports class members (not wanted). | Medium |
| dry-yagni/unused-dependency | A package.json dependency or devDependency that no code or tool config uses. Default <= 0. [F12] | Knip | Import and script scan plus tool-config awareness. | No | Yes: core/src/analyze/unused_deps.rs:1341 (peer closure at 128-168 per RES/fallow-code-inventory.md 4.3). | High (tool configs) |
| dry-yagni/unlisted-dependency | A package or binary that code or a script uses but package.json does not list. Default <= 0. [F12] | Knip | Import scan plus script/binary parse. | No | Yes: core/src/analyze/unused_deps.rs:2503. | Medium-High |
| dry-yagni/unresolved-import | An import that does not resolve. Default <= 0. [F12] | Knip (oxc-resolver 11.24.2) | oxc_resolver with tsconfig paths. | No | Yes: core/src/analyze/unused_deps.rs:2909; resolver setup graph/src/resolve/specifier.rs:94-135. | Low-Medium |
| mutation/score | (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage), per package. Default >= 80 %. [F13] | Stryker 10.0.0 (vitest or jest runner) | Drive Stryker (decision in #3). Rust reads its JSON and sums the same way. | Yes: test runs | Own engine exists (crates/mutation), different score (NoCoverage left out), no Jest. Not used. | Cannot be exact (needs Stryker) |
| mutation/survived | One warning per Survived or NoCoverage mutant; symbol `mutator: replacement`, cut at 60 characters. Report only. [F13] | Stryker | Same as above. | Yes: test runs | See above | Cannot be exact |
| baseline/warning-count | Count of findings with severity warning per package; fails if above the recorded value. [F14] | quality-ts gate code | Pure logic. Depends on the later baseline design (strict policy: baseline never exempts). | No | No | None (or drop) |
| principle/ocp | No score. Explain text only. [F14] | none | Keep as a static explain entry or drop. | No | No | None |
| principle/lsp | No score. Explain text only. [F14] | none | Same. | No | No | None |

## 4. Evidence by rule group

### F1. lines-per-function, params, nesting-depth (ESLint core rules)

- Config: `max-lines-per-function` max 1, `max-params` 0, `max-depth` 0 (QT/src/adapters/eslint/flat-config.ts:27-32). Messages are parsed with regexes (QT/src/adapters/eslint/messages.ts:12-33).
- lines: NM/eslint/lib/rules/max-lines-per-function.js. Counts every physical line from `node.loc.start.line` to `node.loc.end.line` (lines 150-160 region); `skipComments` and `skipBlankLines` default false; IIFEs skipped when option `IIFEs` is false (default); a method or accessor value uses its parent MethodDefinition or Property as the node (`isEmbedded`). Listens to FunctionDeclaration, FunctionExpression, ArrowFunctionExpression only (end of file).
- params: NM/eslint/lib/rules/max-params.js. `effectiveParamCount = node.params.length`; the `this` parameter is subtracted only when its type is `void` (default `countThis: "except-void"`). Listens to FunctionDeclaration, ArrowFunctionExpression, FunctionExpression, TSDeclareFunction, TSFunctionType. The adapter drops the type-level ones (QT/src/adapters/eslint/resolve-scope.ts, type-level.ts).
- nesting-depth: NM/eslint/lib/rules/max-depth.js. Stack starts at Program, FunctionDeclaration, FunctionExpression, ArrowFunctionExpression, StaticBlock. `pushBlock` on IfStatement (not else-if), SwitchStatement, TryStatement, DoWhile, While, With, For, ForIn, ForOf. Reports each block deeper than 0; the adapter keeps the max per function (QT/src/adapters/eslint/eslint-analyzer.ts `measureFile`). A report can fall at module level (QT/src/adapters/eslint/resolve-scope.ts `MAY_BE_MODULE_LEVEL`).
- Unverified: where Oxc starts the span of a method's inner `Function` (key or parenthesis). Check this for lines-per-function; ESLint counts from the method key (and its modifiers).

### F2. cyclomatic

- Source: NM/eslint/lib/rules/complexity.js (variant "classic" by default). Increments: CatchClause, ConditionalExpression, LogicalExpression, For, ForIn, ForOf, If, While, DoWhile, AssignmentPattern, `SwitchCase[test]`, logical assignment operators, `MemberExpression.optional`, `CallExpression.optional`. Base is 1. Units: functions, class field initializers, class static blocks; program is not reported. Reports only when the value is above the threshold (0 here).
- Fallow (FW/extract/src/complexity.rs): same list except these differences.
  1. No AssignmentPattern increment (no code for default values; grep finds none).
  2. `?.` is counted once per chain at most: `visit_chain_expression` (line 873) checks only the outer element's `optional` flag. ESLint counts each optional link. `a?.b?.c` is 2 in ESLint and 1 in fallow. `a?.b.c` is 1 in ESLint and 0 in fallow.
  3. A class field initializer or static block is not its own unit. Fallow also emits a `<module>` unit (pop_module_frame) that must be dropped.
- Note that CRAP uses a third CC (F7).

### F3. cognitive-complexity

- Source: NM/eslint-plugin-sonarjs/cjs/S3776/rule.js (v4.2.2).
- Per-function value: each function has its own `functionOwnComplexity` and `functionOwnControlFlowNesting` (lines 109, 202). Nested functions do not add to the outer function and do not inherit its nesting.
- Increments: if (+1 + nesting), else if (+1), else (+1), for/for-in/for-of/while/do-while (+1 + nesting), switch (+1 + nesting, cases deepen nesting), catch (+1 + nesting), ternary (+1 + nesting, both branches deepen), labeled break and continue (+1). Logical expressions: lines 307-325. Only a new run of `&&` adds +1; the condition `current.operator !== '||' && current.operator !== '??'` (lines 319-321) means `||` and `??` never add.
- Fallow (extract/src/complexity.rs:445 `handle_logical_operator`): +1 for every change of logical operator, including `||` and `??`. So `a || b` is 1 in fallow and 0 in quality-ts. The rest of the structure (if, else, loops, switch, catch, ternary, labeled jumps, nesting restart per function) matches. React folding (hook density, prop count) in fallow must be removed (header of complexity.rs; RES/fallow-code-inventory.md 3.5).
- I did not run ESLint to confirm the `||` behavior. Confirm with a differential test before relying on it.
- License warning. Every plugin source file carries the "Sonar Source-Available License Version 1" header (NM/eslint-plugin-sonarjs/cjs/S3776/rule.js:2-16; license text in NM/eslint-plugin-sonarjs/LICENSE, which restricts "Competing" use). package.json:13 says `LGPL-3.0-only`. The two disagree. Do not copy or port plugin code line by line into an MIT tool. Implement from behavior and test against the plugin as a black box.

### F4. identical-functions, duplicated-branches

- S4144 (NM/eslint-plugin-sonarjs/cjs/S4144/rule.js): `DEFAULT_MIN_LINES = 3` (line 59). Candidates are FunctionDeclaration, and function or arrow expressions whose parent is a VariableDeclarator or a MethodDefinition (lines 72-78). Object-literal members and class property arrows are not candidates. `isBigEnough` takes the body tokens without the outer `{ }` and needs `lastLine - firstLine + 1 >= 3` (lines 113-126). Pairwise compare in order; the later function is reported once (`break`).
- S1871 (NM/eslint-plugin-sonarjs/cjs/S1871/rule.js): handles IfStatement chains (head only, line 78) and SwitchStatement. A branch needs `hasRequiredSize` (> 1 line of tokens, line 122). Equality is `areEquivalent`: same node `type` and same token values (NM/eslint-plugin-sonarjs/cjs/helpers/equivalence.js). So quote style, semicolons, parentheses and type annotations matter. An AST-hash compare would find more matches than quality-ts. Use the lexer token sequence (Oxc can return tokens; JSCPD/crates/cpd-tokenizer/src/javascript.rs:8 uses `TokensParserConfig`).
- Both rules sit at module level too (ESLint reports `duplicated-branches` there; QT/src/adapters/eslint/resolve-scope.ts).

### F5. FTA

- Config (QT/src/adapters/fta/config.ts:8-14): `exclude_under: 0`, `include_comments: false`, all 8 extensions, extra excluded dirs `/node_modules` and the Stryker sandbox. Defaults still apply: exclude `.d.ts .min.js .bundle.js` and dirs `/dist /bin /build` (FTA/crates/fta/src/config/mod.rs:46-70). FTA walks the tree with gitignore on (FTA/crates/fta/src/lib.rs `analyze`). The adapter keeps only rows for tsconfig files (QT/src/adapters/fta/fta-analyzer.ts:36-45).
- Score: FTA/crates/fta/src/lib.rs:26-47. `factor = 1` if `ln(cyclo) < 1`, else `lines / ln(cyclo)`. `score = 100 - (171 - 5.2 ln(vocab) - 0.23 cyclo - 16.2 ln(factor)) * 100 / 171`, minimum 0.
- cyclo (FTA/crates/fta/src/cyclo/mod.rs): 1 + `&&` + `||` + if + every switch case (default included) + for + while + do-while + for-in + for-of + catch + `?:`. No `??`, no `?.`.
- lines (FTA/crates/fta/src/parse/mod.rs:18-50): non-blank lines minus leading-comment lines (trailing comments are not counted).
- vocab: Halstead unique operators + unique operands from SWC AST visitors (FTA/crates/fta/src/halstead/mod.rs:1-461). The rules are specific to SWC node shapes. For example `visit_expr` counts `Expr::Ident` and `visit_ident` counts again; template strings and `TsAs` have special cases; type annotations add operators.
- Parse: tsx flag from extension; on failure retried with the flag flipped; a file that still fails is skipped without error (lib.rs `process_entry`).
- Version: QT pins 3.0.1. The 3.0.0 changelog says the swc upgrade changed scores; 3.0.1 and 3.1.0 only upgraded internal Rust dependencies (FTA/CHANGELOG.md:1-14). Whether 3.1.0 gives identical scores to 3.0.1 is not verified.
- crates.io: `fta` 3.1.0, `license = "MIT OR Apache-2.0"`, `analyze_file` and `parse::parse_module` are `pub` (FTA/crates/fta/src/lib.rs:1-30; https://crates.io/api/v1/crates/fta).

### F6. types

- Run: `lint(tsconfig, { strict: true, absolutePath: true, fileCounts: true })` (QT/src/adapters/type-coverage/type-coverage-analyzer.ts:94-99). TypeScript is 6.0.3 (QT/package.json).
- Files: all program source files whose path has no `node_modules`, then those inside the package root (QT/src/adapters/type-coverage/type-coverage-analyzer.ts `ownFile`). This includes files that tsconfig imports but does not list, and project `.d.ts` files. It is not the same set as the ESLint rules.
- Count: NM/type-coverage-core/dist/checker.js `collectData` (lines 30-60): for each Identifier, PrivateIdentifier or `this`, take `getTypeAtLocation` and `getContextualType`; `total++`; it is "any" only if all collected types are any. `typeIsAnyOrInTypeArguments` (lines 62-97): `flags === Any` and `intrinsicName === 'any'`; strict: symbol named `Object`, or empty anonymous `{}`; strict and not ignoreNested: recursion into type arguments (`containsAny`).
- Assertions in strict mode (checker.js `checkTypeAssertion`, lines 119-160): `x as T`, `<T>x`, `x!` count as unsafe, except `as const`, `as unknown`, and any assertion where `isTypeAssignableTo(exprType, targetType)` holds. `as any` always counts.
- Ignore comments (NM/type-coverage-core/dist/ignore.js): `type-coverage:ignore-line` and `ignore-next-line` hide a site; quality-ts reports the comment itself as a finding (QT/src/adapters/type-coverage/ignore-comments.ts, type-coverage-analyzer.ts:61-70).
- Site kinds accepted: 1 to 5 only (QT/src/adapters/type-coverage/type-coverage-analyzer.ts:18). Strict mode can also produce kind 7 (unused ignore directive, core.js lines 126-140); the adapter turns an unknown kind into a module error.
- Port plan and open questions: RES/typescript-go-type-coverage.md sections 5, 6, 9, 10.

### F7. crap

- QT does not use ESLint complexity here. It runs the project's `tests.coverageCommand`, then `analyze({ root, lcovPath, files })` of crap-ts (QT/src/adapters/crap/crap-analyzer.ts:101-117).
- Rows (NM/@mquesada02/crap-ts/dist/functions.js): named function declarations; `let/var/const` bindings to arrow or function expressions; class constructors, methods, accessors; object-literal methods, accessors and function-valued properties; assignments of a function to an identifier or property. Anonymous callbacks are not rows; their branches count in the enclosing row. Files with a parse error throw.
- CC (functions.js `complexityOf`, `isDecisionPoint`): 1 + if, for, for-in, for-of, while, do, every CaseClause and DefaultClause, catch, `?:`, `&&` `\|\|` `??`, `&&=` `\|\|=` `??=`, every optional link `?.`. Nested own-row functions are skipped. This differs from ESLint (default clause counts; default values do not).
- Coverage (dist/coverage.js `coverageForLines`): over the LCOV `DA:` lines whose line number is in [startLine, endLine] of the row: hit / executable * 100. Nested function lines are inside the range and count. `undefined` if the file is missing from LCOV or no executable line is in range.
- Value: `crap ?? complexity^2 + complexity` (QT/src/adapters/crap/crap-analyzer.ts:48-50). So missing coverage is treated as 0 %.
- Skips: `.d.ts`/`.d.mts`/`.d.cts`; path segments `node_modules dist build coverage .git target`; names with `.test.` or `.spec.` and `__tests__` dirs (NM/@mquesada02/crap-ts/dist/discover.js:55-80).
- Istanbul link: the LCOV writer prints `DA:` lines from `fc.getLineCoverage()` (NM/.pnpm/istanbul-reports@3.2.0/node_modules/istanbul-reports/lib/lcovonly/index.js `onDetail`). That function takes, for each statement, the start line and the max hit count (NM/.pnpm/node_modules/istanbul-lib-coverage/lib/file-coverage.js:221-238). qualbar can rebuild identical `DA` data from Istanbul JSON `statementMap` and `s`. This keeps parity with decision #7 (Istanbul JSON).
- Fallow's method differs: statements are owned by the innermost `fnMap` function, and a function with no owned statements falls back to its hit count (FW/engine/src/health/scoring.rs:2295-2363). Its fallback to estimated coverage must not be used (RES/fallow-code-inventory.md 3.7).

### F8. architecture (domain code, no external metric)

- Everything except the edge list is quality-ts's own pure code in QT/src/domain/architecture/: `assignComponents` (assign-components.ts:35: picomatch with `dot: true`; longest literal glob base wins; two equal components for one file is a config error), `crossEdges`/`forbiddenEdges` (edges.ts), `componentMetrics` (metrics.ts:28-38: `ce` = distinct target files of edges leaving the component; `ca` = distinct target files, inside this component, of edges entering it), `instability` (metrics.ts:40), `abstractness` (46), `distance` (52, exact fractions), `sdpMeasurements` (measure.ts:56: strict `I(to) > I(from)` for each distinct component pair with an edge, allowed or not).
- Abstract and concrete counts: QT/src/adapters/dependency-cruiser/declarations.ts. Only exported top-level statements count. Interface and type alias: abstract. Abstract class: abstract. Class, enum: concrete. Each variable in a `export const` statement: concrete. Function with body: concrete; overloads and `declare function` count once per name. Re-exports, namespaces and default expressions do not count.
- Source set: tsconfig files without test files and without files outside the root (QT/src/adapters/dependency-cruiser/architecture-analyzer.ts:25-31).
- Edges: dependency-cruiser with `tsPreCompilationDeps: true`, `exportsFields: ["exports"]`, node_modules excluded, only edges between source-set files (QT/src/adapters/dependency-cruiser/cruise.ts:20-60). `import type` edges are kept. Oxc graph needs the same extraction (imports, exports-from, dynamic import with a string, require, import-equals). Resolution: oxc_resolver is the same family as dependency-cruiser's resolver; check tsconfig `paths` and `exports` cases.
- Fallow: zone model with first-match classification (FW/config/src/config/boundaries.rs:1447-1475), not longest-base. Do not reuse its classification if the longest-base rule is kept.

### F9. cycles

- Rule: forbidden `circular: true` with `viaOnly: { dependencyTypesNot: ["type-only"] }` (QT/src/adapters/dependency-cruiser/cruise.ts:20-26). So a cycle is reported only if none of its edges has the `type-only` type.
- `type-only` is syntactic: an `import type`/`export type` statement (NM/dependency-cruiser/src/extract/tsc/extract-typescript-deps.mjs:82, 106). An import that TypeScript elides but is not written `import type` is not type-only.
- Which cycle: `getCycle` is a depth-first search that returns the first path found, not the shortest (NM/dependency-cruiser/src/graph-utl/indexed-module-graph.mjs:195-247). It runs per dependency edge (NM/dependency-cruiser/src/analyze/derive/circular.mjs:30-45). The `viaOnly` check is applied after the path is chosen (NM/dependency-cruiser/src/validate/matchers.mjs:162-190). So when the first path found has a type-only edge, the cycle is dropped even if another path of runtime edges exists. This is the "hide" the explain text admits.
- Order: dependencies are sorted with `localeCompare` on a key `module moduleSystem typeOnlyFlag` (NM/dependency-cruiser/src/extract/extract-dependencies.mjs:126-140), so DFS order depends on that sort.
- Normalization after the tool: drop cycles with a file outside the source set, rotate to the smallest file, deduplicate (QT/src/domain/architecture/edges.ts `normalizeCycles`).
- Fallow's `find_cycles` drops type-only and non-loading edges first, runs Tarjan, then enumerates elementary cycles (FW/graph/src/graph/cycles.rs:36-103, 70-103). It will find runtime cycles that quality-ts hides, and it enumerates differently.

### F10. cohesion (quality-ts own code, QT/src/adapters/cohesion/)

- LCOM96b (lcom.ts:6-10): `sum_j (m - used_j) / (f * m)`; 0 when `m <= 1` or `f == 0`. Example check: QT/docs/research/r2-archunitts-programmatic.md and scores-reference.md.md (line 43) give 0.5833 for m=4, f=3, which this formula reproduces ((2+2+3)/(3*4)). Computed key names count as used by no method.
- Members (declarations.ts:72-90 `classParts`): skip static members and ambient classes (`declare`, `.d.ts`); fields are non-static property declarations whose initializer is not an arrow or function expression, plus constructor parameter properties (only when the constructor has a body); methods are non-overload methods (abstract ones count), get and set accessors, and function-valued properties.
- `this` access (this-accesses.ts:85-108): `this.x`, `this["x"]`, `const { x } = this`, `({ x } = this)`. Parentheses, `!`, `as`, `<T>` and `satisfies` around `this` are unwrapped. Nested `function`, method, accessor, constructor and class bodies are not walked (they rebind `this`); arrow functions are.
- Interfaces (declarations.ts:117-135): method signatures and property signatures with a function type, deduplicated by literal key; each computed key counts 1.
- Port note: Oxc keeps `ParenthesizedExpression` only with `preserve_parens` (default on); numeric key text may be normalized differently by TypeScript (`1.0` becomes `1`). Both are rare.

### F11. duplication (jscpd)

- Settings: minLines 5, minTokens 50, mode "mild", no gitignore, explicit file list (QT/src/adapters/jscpd/config.ts:2-3, 16-27).
- Only files of one format are compared. `.ts`, `.tsx`, `.js`, `.jsx` are four formats (QT/src/adapters/jscpd/jscpd-analyzer.ts comment; JSCPD/crates/cpd-tokenizer/src/formats.rs:352-367, 709-724).
- Engine (JSCPD/crates/cpd-core/src/detect.rs:58-139 and 387-450): format groups, rolling hash over a window of `min_tokens` tokens, clones rejected under `min_lines`. Tokens: Oxc lexer tokens for JS and TS (JSCPD/crates/cpd-tokenizer/src/javascript.rs:8); whitespace dropped in mild mode (JSCPD/crates/cpd-tokenizer/src/tokenizer.rs:219-225); no comment tokens are produced by the Oxc path (grep of javascript.rs found no Comment kind).
- Three or more copies: each later copy is paired with the first one (explain text for dry-yagni/clone).
- Metrics (quality-ts code, not jscpd): per file `count` = union of clone line ranges on that file, `total` = file line count (`\n`-based, QT/src/adapters/jscpd/lines.ts); per clone side one finding (QT/src/adapters/jscpd/measure.ts:69-100).
- The Rust jscpd crates use Oxc 0.153 (JSCPD/crates/cpd-tokenizer/Cargo.toml). Fallow copies are at Oxc 0.152 and fallow's deny.toml bans two Oxc versions (RES/fallow-code-inventory.md section 1). Decide one Oxc version.
- Fallow (FW/engine/src/duplication_detector/): defaults 50 tokens and 5 lines too (FW/config/src/config/duplicates_config.rs:8-14) and mode mild, but with AST tokens, normalization, suffix array and clone families (RES/fallow-code-inventory.md 3.6), and no per-format grouping. Clone boundaries and counts will differ from jscpd's.
- crates.io lists `cpd-core` and `cpd-tokenizer` (https://crates.io/api/v1/crates/cpd-core), but the clone's Cargo.toml has `publish = false` and `license.workspace`; the repo license is MIT (JSCPD/../LICENSE). Verify the published crate version and licence before depending on it.

### F12. dead code (Knip)

- Config: Knip run with `include` limited to files, exports, types, enumMembers, namespaceMembers, dependencies, devDependencies, unlisted, binaries, unresolved; `ignoreExportsUsedInFile` unset; root workspace gets the `knip.entry` and `knip.project` of the quality-ts config (QT/src/adapters/knip/config.ts:60-65; mapping QT/src/adapters/knip/parse.ts:12-24).
- Knip 6.39.0 parses with oxc-parser and resolves with oxc-resolver 11.24.2 (NM/knip/package.json dependencies). Same Oxc family as fallow. It has 193 plugin directories (NM/knip/dist/plugins) that add entry files and config-referenced packages. It also parses shell scripts for binaries (`unbash` dependency).
- Fallow has the same finding types (FW/types/src/results.rs:236-300). Entry detection in fallow is its plugin layer, which decision #5 says not to copy (RES/fallow-code-inventory.md 3.2). So entry-file and tool-config coverage will differ. This is the largest source of different results for unused-file, unused-export, unused-type and unused-dependency.
- unused-member: Knip keys `enumMembers` and `namespaceMembers` only; Knip 6.39 does not report class members (explain text for dry-yagni/unused-member).
- The three known fallow false positives on QT are fixed in fallow 3.32 (RES/fallow-code-inventory.md section 4).

### F13. mutation

- Score: `DETECTED = Killed, Timeout`; `UNDETECTED = Survived, NoCoverage`; other statuses (CompileError, RuntimeError, Ignored, Pending) are left out (QT/src/adapters/mutation/map-mutants.ts:5-10, 50-62). Per file `count/total`, summed per package by the Gate. Default 80 %; baseline tolerance 2 points (QT/src/domain/catalog/catalog.ts:385-395).
- Survived warnings: symbol `${mutatorName}: ${replacement}` with whitespace collapsed, cut at 60 (map-mutants.ts:12-14, 65-84).
- Scope: all source files of the package, not tests and not `.d.ts` (QT/src/adapters/mutation/mutation-analyzer.ts:26-31). Stryker options: vitest, `coverageAnalysis: "perTest"` (RES/mutation-approach.md section 1).
- Decision state: issue #3 moved the engine choice to a grilling ticket. RES/mutation-approach.md recommends driving Stryker in v1. Fallow's own engine (NoCoverage excluded from the score, no Jest) gives a different number.

### F14. baseline and principle

- baseline/warning-count: QT/src/domain/gate/baseline.ts:94-105 counts findings whose severity is `warning` per package. Warnings are report-only rules without a configured threshold: survived mutants, abstractness, fields-per-class, methods-per-interface, plus unset bounded ones (QT/src/domain/gate/gate.ts `severityOf`). The map's strict policy (#2: "the baseline never exempts a finding") may replace this rule. Needs a decision in the config or baseline ticket.
- principle/ocp, principle/lsp: no code; explain text only (QT/src/domain/explain-catalog/principle.ts).

## 5. Rules that are hard or impossible to reproduce exactly

1. types/coverage and types/unsafe-any. The reference runs on TypeScript 6.0.3 (JS API). The plan uses TypeScript-Go 7.0.2. Open points from #4: `getContextualType` on non-expression nodes, error-type reporting, identifier positions. The walker (`checkNode` and its helpers, in the 852-line NM/type-coverage-core/dist/checker.js) must be ported exactly. Exact numbers only with the fallback sidecar on `@typescript/typescript6`. With TS-Go expect small differences; a differential test must set the allowed gap.
2. dry-yagni/unused-file, unused-export, unused-type, unused-member, unused-dependency, unlisted-dependency. They depend on Knip's 193 plugins and entry rules. Fallow's plugin layer is out of scope. Exact parity cannot be reached; the realistic goal is "same findings on a defined corpus plus a list of known gaps".
3. mutation/score, mutation/survived. The value is defined by Stryker's mutators and runner. Only driving Stryker gives the same number. A Rust engine gives a different number by design.
4. function/fta-score. Halstead counts depend on SWC node shapes and visitor order. A port on Oxc is a rewrite with hand-matched quirks. Exact only by linking the `fta` crate (adds the SWC parser to the binary).
5. architecture/cycle. Exact only by porting dependency-cruiser's DFS and its dependency order, including the locale sort. Any SCC-based method finds different cycles. Whether to keep the "hide" behavior is a product decision.
6. function/cognitive-complexity. Reachable, but the `||`/`??` rule must be confirmed and copied, and the plugin source cannot be copied (license).
7. dry-yagni/clone and dry-yagni/duplication. Exact only with jscpd's own tokenizer and window algorithm; fallow's detector gives other clone boundaries.
8. crap/score. Exact only if crap-ts is ported (rows, CC, coverage method). It also needs the same coverage data, so provider differences (v8 or Istanbul instrumentation) show up in both tools alike; a fixed seed corpus avoids that.

Everything else (lines, params, nesting-depth, cyclomatic, identical-functions, duplicated-branches, all cohesion, all architecture metrics except cycle, unresolved-import, baseline, principle) can be matched exactly by a port, given the same file set and the same import edges.

## 6. Recommendation

1. Define parity as "same definition, proven by a differential test", not as bit-equal output. Keep a ledger of every deliberate difference.
2. Group the work by how parity is reached.
   - Port from quality-ts code (exact, small): cohesion (4), architecture metrics (7 rules; edge list needed), nesting-depth, params, lines, cyclomatic (ESLint list, fix the three fallow deltas), crap (crap-ts port plus Istanbul `DA` rebuild).
   - Port from upstream behavior with token compare: identical-functions, duplicated-branches.
   - Link upstream Rust crates for exactness: `fta` crate for fta-score, jscpd crates for clone and duplication. Both are MIT or MIT/Apache; the cost is a second parser (SWC) for FTA and an Oxc version choice for jscpd (0.153 vs fallow's 0.152).
   - Copy fallow with changes: complexity.rs (cognitive base), graph and dead-code logic. Do not use fallow's cycle method, boundary classification, CRAP coverage method or duplication engine for parity rules.
   - Accept as non-exact: types (TS-Go), dead-code family (no plugin layer), mutation (Stryker).
3. Build the oracle first. Pin quality-ts at a commit, run it on a fixture set and on 3 to 5 real repos, store per-rule per-symbol values, and compare qualbar rule by rule. Do this before writing each rule, as ticket zero. The fallow extractor tests are a good corpus for the dead-code family (RES/fallow-code-inventory.md section 5).
4. Ask the user (grilling) about quirks that look like accidents in quality-ts, because they decide the target value:
   - Cognitive complexity ignores `||` and `??`. Keep, or count them like the Sonar paper?
   - Cycles are hidden when the first DFS path has a type-only edge. Keep, or report runtime cycles fully?
   - CRAP treats "no coverage data" as 0 % (also for a function with no executable lines). Keep?
   - `baseline/warning-count` and the principle rules: keep or drop under the strict policy?
5. Spikes needed before the spec is final: (a) TS-Go full-scan time and equality on 2 repos (#4 open items); (b) `fta` crate score equality with fta-cli 3.0.1; (c) licence and version check of the jscpd crates; (d) ESLint black-box check of the cognitive `||` rule and of method line spans in Oxc; (e) tsconfig `include` evaluation in Rust.

## 7. Not verified

- I did not run ESLint, the sonarjs plugin, FTA, jscpd, Knip or dependency-cruiser. All behavior is read from source. The cognitive `||` rule, the cycle outcomes and the FTA version equality need a run.
- Oxc span for method functions; oxc_resolver tsconfig `include`; Knip entry defaults beyond the plugin list; published state of the jscpd crates.
- Cost and timing of every Rust algorithm are not measured.
