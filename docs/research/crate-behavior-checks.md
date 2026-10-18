# Crate and behavior checks

Ticket: mquesada02/qualbar#16 (map: #2). Date of the runs: 2026-10-18.
This file records facts. It decides nothing.

## Summary

| # | Question | Result |
|---|----------|--------|
| 1 | Does the `fta` 3.1.0 crate give the same scores as fta-cli 3.0.1? | Yes on 418 quality-ts files: 0 differences, bit-exact `f64` scores. |
| 2 | Are the jscpd 5.4.1 Rust crates published? Licence? Oxc version? | Yes. `jscpd` 5.4.1, `cpd-core` 0.1.21, `cpd-tokenizer` 0.1.20 are on crates.io. Licence `MIT`. They use Oxc `0.153.0`. |
| 3 | Do `\|\|` and `??` add to sonarjs 4.2.2 cognitive complexity? | No. Confirmed by running ESLint on 17 functions. Only `&&` runs add. |
| 4 | Which crate evaluates tsconfig `include`/`exclude`/`files` like tsc? | `oxc_resolver` 11.24.3 does it in `TsconfigDiscovery::Auto` mode only. 24 of 27 test cases match TypeScript 6.0.3. 3 differ (see section 4). No other crate found does it. |

## Environment

- Machine: Linux 7.0.0-34-generic, x86_64. Every heavy command ran under `taskset -c 0-1`. One heavy command at a time.
- Rust: installed with rustup into `/tmp/claude-1000/qualbar-task-16/` (`CARGO_HOME=.../cargo`, `RUSTUP_HOME=.../rustup-home`, `--no-modify-path`, profile `minimal`). `cargo 1.99.1 (5f94df478 2026-08-27)`, `rustc 1.99.1 (58cf8f9c3 2026-10-13)`.
- Node: `v22.23.3`.
- quality-ts code: `/home/mquesada/orca/workspaces/quality-ts/t43-dogfood`, commit `a3a7b9c`. Read-only. Used only to read `node_modules` and to copy `src/` and `test/`.
- Versions read from the quality-ts `node_modules`: `eslint-plugin-sonarjs` 4.2.2, `eslint` 10.11.0, `typescript-eslint` 8.71.0, `typescript` 6.0.3, `fta-cli` 3.0.1.
- All throwaway files are in `/tmp/claude-1000/qualbar-task-16/`. They are not deleted.

## 1. `fta` crate 3.1.0 against fta-cli 3.0.1

### Method

1. Copy `src/` and `test/` of quality-ts to `/tmp/claude-1000/qualbar-task-16/corpus/`. This gives 448 files, 419 of them with an FTA extension (418 are scored; one is `test/support/provided-context.d.ts`, which FTA skips).
2. Write the quality-ts FTA config (from `src/adapters/fta/config.ts`) to `fta.json`:
   ```json
   {"exclude_under":0,"include_comments":false,"extensions":[".ts",".tsx",".mts",".cts",".js",".jsx",".mjs",".cjs"],"exclude_directories":["/node_modules"]}
   ```
3. Copy the fta-cli 3.0.1 Linux binary out of the quality-ts `node_modules`:
   ```sh
   cp .../node_modules/fta-cli/binaries/fta-x86_64-unknown-linux-musl/fta ftabin/fta-3.0.1
   sha256sum ftabin/fta-3.0.1   # 7e870adcb5a6a5314472d61ec645121e958aac9cfc9e0695813de90f114cff3b
   ftabin/fta-3.0.1 --version   # fta 3.0.1
   taskset -c 0-1 ftabin/fta-3.0.1 corpus --json -c fta.json > fta-cli-3.0.1.json
   ```
4. Build a Rust program (`fta-probe`) that depends on `fta = "=3.1.0"` and calls the public functions `fta::parse::parse_module(&src, use_tsx, false)` and `fta::analyze_file(&module, line_count)`. It copies the CLI behavior: same extension list, skip `.d.ts`/`.min.js`/`.bundle.js`, retry the parse with the opposite `tsx` flag on a parse error.
   ```sh
   taskset -c 0-1 cargo build --release     # 1m06s from a cold cache
   taskset -c 0-1 fta-probe/target/release/fta-probe corpus > fta-crate-3.1.0.json
   ```
5. Compare per file: `cyclo`, `vocabulary_size`, `line_count`, `fta_score` (exact `f64` equality).

### Result

```
cli 3.0.1 rows 418 crate 3.1.0 rows 418
only in cli []
only in crate []
common 418 different 0 max abs score diff 0
```

- 418 of 418 files are identical, including the `f64` score.
- Corpus extensions: 417 `.ts`, 1 `.js`. No `.tsx`/`.jsx` file was in the corpus.
- `fta` 3.1.0 manifest: `license = "MIT OR Apache-2.0"`, `edition = "2021"`, no `rust-version`. Parser: `swc_ecma_parser` 21.0.1 and `swc_ecma_visit` 14.0.0 (resolved by cargo).
- `fta::analyze_file` and `fta::parse::parse_module` are `pub`. The structs module is private. `HalsteadMetrics.vocabulary_size` is readable.

### Limits of this check

- The CLI used was 3.0.1, not a 3.1.0 CLI. The crate was compared to the CLI, as asked.
- No `.tsx`/`.jsx` file and only one `.js` file in the corpus. The `tsx` flag path is not covered by this corpus.
- The probe does its own file walk. It does not call `fta::analyze` (that function needs the private `FtaConfigResolved`).

## 2. jscpd 5.4.1 Rust crates

### Commands

```sh
curl -s -A "qualbar-research" https://crates.io/api/v1/crates/jscpd
curl -s -A "qualbar-research" https://crates.io/api/v1/crates/jscpd/5.4.1/dependencies
curl -s -A "qualbar-research" https://crates.io/api/v1/crates/cpd-tokenizer/0.1.20/dependencies
```

Then a throwaway crate `jscpd-probe` with `cpd-core = "=0.1.21"` and `cpd-tokenizer = "=0.1.20"`, and `cargo tree`.

### Result

| Crate | Latest | Published | Licence | `rust-version` | Edition |
|-------|--------|-----------|---------|----------------|---------|
| `jscpd` | 5.4.1 | 2026-10-09 | MIT | 1.97 | not read |
| `cpd-core` | 0.1.21 | 2026-10-09 | MIT | 1.97 | 2024 |
| `cpd-tokenizer` | 0.1.20 | 2026-10-09 | MIT | 1.97 | 2024 |

- All three are on crates.io, none is yanked. Repository field: `https://github.com/kucherenko/jscpd`.
- Other jscpd crates that `jscpd` 5.4.1 depends on: `cpd-finder ^0.1.21`, `cpd-reporter ^0.1.22`, `cpd-semantic ^0.1.2`, `cpd-similarity ^0.1.0`.
- `cpd-core` 0.1.21 dependencies: `rayon`, `rustc-hash`, `serde`, `xxhash-rust`. No Oxc.
- `cpd-tokenizer` 0.1.20 dependencies: `cpd-core ^0.1.21`, `log`, `oxc_allocator ^0.153`, `oxc_ast ^0.153`, `oxc_ast_visit ^0.153`, `oxc_parser ^0.153`, `oxc_span ^0.153`, `oxc_syntax ^0.153`, `regex`.
- `cargo tree` resolves all Oxc crates to `0.153.0` (`oxc_parser`, `oxc_ast`, `oxc_span`, `oxc_allocator`, `oxc_syntax`, `oxc_ast_visit`, `oxc_diagnostics`, and others).
- The `cpd-core` and `cpd-tokenizer` tarballs have no `LICENSE` file (the file list is `Cargo.lock`, `Cargo.toml`, `Cargo.toml.orig`, `README.md`, `src`, and `tests` for the tokenizer). The licence is in the manifest field `license = "MIT"`.
- Fallow (map #5) is on Oxc 0.152. The jscpd crates need 0.153. The rust-version of the jscpd crates (1.97) is above the fallow MSRV on the map (1.96).
- The quality-ts pin is `jscpd` 5.4.0 (npm). The Rust crates for 5.4.0 were not compared with 5.4.1.

### Limits

- The crates were resolved but not compiled or run in this check.
- Clone results of the crates against the npm `jscpd` 5.4.0 were not compared.

## 3. eslint-plugin-sonarjs 4.2.2: `||` and `??`

### Method

Run the real rule `sonarjs/cognitive-complexity` with threshold 0 (as quality-ts does in `src/adapters/eslint/flat-config.ts`). Each snippet function reports its value in the message `from N to the 0 allowed`. A function with no message has value 0.

Files (throwaway, in `/tmp/claude-1000/qualbar-task-16/sonar-probe/`): `snippet.ts` and `run.mjs` (see the appendix). The runner loads `eslint`, `eslint-plugin-sonarjs` and `typescript-eslint` from the quality-ts `node_modules` with `createRequire`. No install.

```sh
cd /tmp/claude-1000/qualbar-task-16/sonar-probe
taskset -c 0-1 node run.mjs $PWD
```

Versions: `eslint-plugin-sonarjs` 4.2.2, `eslint` 10.11.0, `typescript-eslint` 8.71.0.

### Output

```
0 (no report)	c01(a, b) { return a || b; }
0 (no report)	c02(a, b) { return a ?? b; }
0 (no report)	c03(a, b, c) { return a || b || c; }
0 (no report)	c04(a, b, c) { return a ?? b ?? c; }
1	c05(a, b) { return a && b; }
1	c06(a, b, c) { return a && b && c; }
1	c07(a, b, c) { return a && b || c; }
1	c08(a, b, c) { return a || b && c; }
1	c09(a, b) { if (a || b) { return 1; } return 0; }
2	c10(a, b) { if (a && b) { return 1; } return 0; }
1	c11(a, b) { if (a ?? b) { return 1; } return 0; }
0 (no report)	c12(a, b) { a ||= b; return a; }
0 (no report)	c13(a, b) { a ??= b; return a; }
0 (no report)	c14(a) { return a?.b?.c; }
1	c15(a, b, c) { if (a || b || c) { return 1; } return 0; }
2	c16(a, b, c, d) { return a && b || c && d; }
2	c17(a, b, c) { return a && b && c ? 1 : 0; }
```

(Type annotations are cut from this listing. The full lines are in `snippet.ts` in the appendix.)

### Facts from the output

- `||` and `??` add 0 (c01 to c04, c09 against c10, c11, c15).
- A run of the same `&&` adds 1 (c06 = 1). Two `&&` runs split by `||` add 2 (c16 = 2). `a && b || c` adds 1 (c07). `a || b && c` adds 1 (c08).
- `if` adds 1 (c09, c11, c15). `if (a && b)` adds 2: 1 for `if` and 1 for the `&&` run (c10).
- A ternary adds 1 (c17: `?:` 1 + `&&` run 1 = 2).
- `||=`, `??=` and `?.` add 0 (c12, c13, c14).

### Limits

- Only 17 small functions. Nesting, loops, `catch`, `switch`, recursion and labeled jumps were not run here.
- Type-aware linting (`parserOptions.project`) was not used. The rule result does not need types in these snippets.

## 4. Which crate evaluates tsconfig `include`/`exclude`/`files`

### Candidates found

Search on crates.io (`q=tsconfig`, `tsconfig include exclude`, `oxc_resolver`, `tsconfig resolver`, `typescript tsconfig files`). Source read for each.

| Crate | Version | Evaluates `include`/`exclude`/`files` as tsc? |
|-------|---------|-----------------------------------------------|
| `oxc_resolver` | 11.24.3 | Yes, with `TsconfigDiscovery::Auto` and `Resolver::find_tsconfig`. Details below. |
| `tsconfig` | 0.3.1 | No. Parser only (one file, `lib.rs`, no glob code). Licence field: `license-file`. |
| `typescript_tsconfig_json` | 0.5.7 | No. Data shapes only. MIT. |
| `tsconfig-includes` | 5.0.3 | Exact mode runs `tsc --listFilesOnly` (needs Node and TypeScript). Estimate mode uses `globwalk`; its docs say it is "imprecise". `ISC OR Apache-2.0`. |
| `unrs_resolver`, `rspack_resolver` | 1.12.2, 0.102.9 | Forks of `oxc_resolver`. Not tested. |

### How `oxc_resolver` 11.24.3 does it

- Source: `src/tsconfig.rs` (`is_file_included_in_tsconfig`, `claims_ownership_of`) and `src/tsconfig_resolver.rs` (`find_tsconfig_auto`).
- The membership check is private. Public entry: `Resolver::find_tsconfig(path)` returns `Ok(Some(tsconfig))` for the nearest `tsconfig.json` that claims the file, walking up the directories. It returns `Ok(None)` if no config claims it.
- Order in the code: `files` first (wins over `exclude`), then reject extensionless and uncompiled `.js`-family paths, then `include` (default `**/*` when `include` is absent and `files` is absent), then `exclude`.
- Glob engine: `fast_glob::glob_match`. A directory pattern gets an implicit `/**/*`. A pattern that ends in `*` is limited to `.ts .tsx .mts .cts` (plus `.js .jsx .mjs .cjs` when `allowJs`).
- `TsconfigDiscovery::Manual` (a `config_file` path) does NOT check membership: it returns the config for every path (shown below).
- The file names must be absolute. A relative path makes `find_tsconfig` return `Ok(None)` (the code returns `None` for non-absolute paths).
- Paths inside `node_modules` always return `Ok(None)` (`inside_node_modules` check).
- The resolver only finds files named exactly `tsconfig.json` in `Auto` mode (`cv.path.join("tsconfig.json")`).

### Method of the comparison

1. `tsconfig-probe/gen/gen.mjs` creates 27 case directories under `/tmp/claude-1000/qualbar-task-16/tsconfig-cases/`. Each has the same 25 files (`.ts`, `.tsx`, `.mts`, `.cts`, `.d.ts`, `.js`, `.jsx`, `.mjs`, tests, `dist/`, `node_modules/`, `lib/`, `src/data.json`, `README.md`, `src/noext`) and its own `tsconfig.json`.
2. For each case it calls TypeScript 6.0.3 (the version that quality-ts pins): `ts.parseJsonConfigFileContent(config, ts.sys, dir, undefined, tsconfigPath).fileNames`. This is the call of `src/adapters/shared/target-files.ts` in quality-ts.
3. `tsconfig-probe/rs` (crate `oxc_resolver = "=11.24.3"`) walks every file of each case and calls `find_tsconfig(file)`. A file counts as included when the returned config path is the case `tsconfig.json`.
4. Compare the two file sets per case.

```sh
node tsconfig-probe/gen/gen.mjs /tmp/claude-1000/qualbar-task-16/tsconfig-cases
taskset -c 0-1 tsconfig-probe/rs/target/release/tsconfig-probe /tmp/claude-1000/qualbar-task-16/tsconfig-cases auto
taskset -c 0-1 tsconfig-probe/rs/target/release/tsconfig-probe /tmp/claude-1000/qualbar-task-16/tsconfig-cases manual
python3 -I cmp-ts.py
```

### Result (`Auto` mode): 24 of 27 cases identical

Identical cases cover: default `**/*`; `allowJs`; `include` as a directory, as `src/*.ts`, `src/x?.ts`, `src/**/gen/*.ts`, `**/t*.ts`, `.`, `./src`, an exact file, and `*.json` with `resolveJsonModule`; `exclude` as a glob, as a directory, with a trailing slash, as `**/__tests__`; `files` only; `files` + `include`; `files` + `include: []`; `exclude` beating `files`; `include` of `**/*`; `${configDir}`; JSONC comments and trailing commas; `extends` in the same directory.

Three cases differ:

| Case | TypeScript 6.0.3 | `oxc_resolver` 11.24.3 |
|------|------------------|------------------------|
| `c12_outDir_default_exclude`: `compilerOptions.outDir = "dist"`, no `exclude` | `dist/o.ts` is not included (outDir is a default exclude) | `dist/o.ts` is included. The default excludes are not applied. |
| `c17_include_explicit_node_modules`: `include: ["node_modules/**/*", "src"]` | `node_modules/pkg/index.ts` is included | Not included. Paths in `node_modules` always return `None`. |
| `c25_extends_in_subdir_pattern`: `tsconfig.json` has `extends: "./base/tsconfig.base.json"`; the base has `include: ["../src"]`, `exclude: ["../src/legacy"]` | 12 files of `src/` | 0 files. |

Cause of c25 (read with `resolve_tsconfig`): the inherited `include` is `["/tmp/claude-1000/qualbar-task-16/tsconfig-cases/src"]`. The path `../src` was resolved from the directory of the extending config (`c25.../`) instead of the directory of the base config (`c25.../base/`). The correct path is `.../c25.../src`. TypeScript resolves inherited `include`, `exclude` and `files` from the config that defines them. The same-directory variant (c27) matches.

In the default case (c01) both sides leave out `node_modules/pkg/index.ts`. This does not test the `oxc_resolver` default exclude, because it returns `None` for every `node_modules` path. `bower_components` and `jspm_packages` were not tested.

### Result (`Manual` mode): 0 of 27 cases identical

`Manual` mode returned every file in every case (including `README.md`, `src/data.json`, `src/noext` and excluded files). So `Manual` mode does not evaluate `include`/`exclude`/`files`.

### Limits

- `references` and solution-style tsconfigs were not tested. The source shows code for them (`resolve_tsconfig_solution`, `claims_ownership_of`).
- `extends` from a package in `node_modules` was not tested.
- Only the files of the fixed list were tested. No imports link the files, so the part of tsc that adds imported files was not exercised (`tsc` adds them; the globs do not).
- The probe depends on `find_tsconfig`, which is an indirect use of a private check. A future version can change this behavior.
- The `unrs_resolver` and `rspack_resolver` forks were not run.

## Open uncertainties

1. FTA: no `.tsx`/`.jsx` file in the corpus; one `.js` file only. The fta-cli 3.1.0 binary was not run.
2. jscpd crates: compiled output and clone results not compared with npm `jscpd` 5.4.0 or 5.4.1.
3. sonarjs: only 17 operator and `if` snippets. Other constructs were not run.
4. tsconfig: `references`, `extends` from packages and files added through imports were not tested. The three differences listed in section 4 are facts; whether they matter for qualbar is a decision for a later ticket.

## Appendix: probe sources

### `fta-probe/src/main.rs`

```rust
use std::{env, fs};
use walkdir::WalkDir;

fn main() {
    let root = env::args().nth(1).expect("root");
    let exts = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
    let mut rows = Vec::new();
    for e in WalkDir::new(&root).into_iter().filter_map(Result::ok) {
        let p = e.path();
        if !e.file_type().is_file() { continue; }
        let name = p.to_string_lossy().to_string();
        let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("");
        if !exts.contains(&ext) { continue; }
        if name.ends_with(".d.ts") || name.ends_with(".min.js") || name.ends_with(".bundle.js") { continue; }
        let Ok(src) = fs::read_to_string(p) else { continue };
        let tsx = ext == "tsx" || ext == "jsx";
        let (mut res, mut lines) = fta::parse::parse_module(&src, tsx, false);
        if res.is_err() {
            let r = fta::parse::parse_module(&src, !tsx, false);
            res = r.0; lines = r.1;
        }
        let Ok(module) = res else { eprintln!("parse failed: {name}"); continue };
        let (cyclo, h, score) = fta::analyze_file(&module, lines);
        let rel = p.strip_prefix(&root).unwrap().to_string_lossy().to_string();
        rows.push(format!("{{\"file_name\":{:?},\"cyclo\":{},\"vocabulary_size\":{},\"line_count\":{},\"fta_score\":{:?}}}", rel, cyclo, h.vocabulary_size, lines, score));
    }
    println!("[{}]", rows.join(","));
}
```

`Cargo.toml` dependencies: `fta = "=3.1.0"`, `walkdir = "2"`.

### `sonar-probe/run.mjs`

```js
import { createRequire } from "node:module";
const T = "/home/mquesada/orca/workspaces/quality-ts/t43-dogfood/node_modules/";
const require = createRequire(T + "x.js");
const { ESLint } = require("eslint");
const sonarjs = require("eslint-plugin-sonarjs");
const tseslint = require("typescript-eslint");
const eslint = new ESLint({
  cwd: process.argv[2],
  overrideConfigFile: true,
  overrideConfig: [{
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    plugins: { sonarjs },
    rules: { "sonarjs/cognitive-complexity": ["error", 0] },
  }],
});
const [res] = await eslint.lintFiles(["snippet.ts"]);
const src = (await import("node:fs")).readFileSync(process.argv[2] + "/snippet.ts", "utf8").split("\n");
const byLine = new Map(res.messages.map((m) => [m.line, m]));
src.forEach((text, i) => {
  if (!text.trim()) return;
  const m = byLine.get(i + 1);
  const n = m ? /from (\d+) to/.exec(m.message)[1] : "0 (no report)";
  console.log(`${n}\t${text.replace(/^export function /, "")}`);
});
```

### `sonar-probe/snippet.ts`

```ts
export function c01(a: boolean, b: boolean) { return a || b; }
export function c02(a: number | null, b: number) { return a ?? b; }
export function c03(a: boolean, b: boolean, c: boolean) { return a || b || c; }
export function c04(a: number | null, b: number | null, c: number) { return a ?? b ?? c; }
export function c05(a: boolean, b: boolean) { return a && b; }
export function c06(a: boolean, b: boolean, c: boolean) { return a && b && c; }
export function c07(a: boolean, b: boolean, c: boolean) { return a && b || c; }
export function c08(a: boolean, b: boolean, c: boolean) { return a || b && c; }
export function c09(a: boolean, b: boolean) { if (a || b) { return 1; } return 0; }
export function c10(a: boolean, b: boolean) { if (a && b) { return 1; } return 0; }
export function c11(a: number | null, b: number | null) { if (a ?? b) { return 1; } return 0; }
export function c12(a: boolean, b: boolean) { a ||= b; return a; }
export function c13(a: number | null, b: number) { a ??= b; return a; }
export function c14(a: { b?: { c?: number } }) { return a?.b?.c; }
export function c15(a: boolean, b: boolean, c: boolean) { if (a || b || c) { return 1; } return 0; }
export function c16(a: boolean, b: boolean, c: boolean, d: boolean) { return a && b || c && d; }
export function c17(a: boolean, b: boolean, c: boolean) { return a && b && c ? 1 : 0; }
```

### `tsconfig-probe/rs/src/main.rs`

```rust
use oxc_resolver::{ResolveOptions, Resolver, TsconfigDiscovery, TsconfigOptions, TsconfigReferences};
use std::path::PathBuf;
use walkdir::WalkDir;

// usage: tsconfig-probe <absolute-cases-dir> <auto|manual>
fn main() {
    let cases = PathBuf::from(std::env::args().nth(1).unwrap());
    let mode = std::env::args().nth(2).unwrap();
    let mut names: Vec<_> = std::fs::read_dir(&cases).unwrap().filter_map(Result::ok).filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().to_string()).collect();
    names.sort();
    let mut out = Vec::new();
    for name in names {
        let dir = cases.join(&name);
        let tsconfig_path = dir.join("tsconfig.json");
        let discovery = if mode == "auto" {
            TsconfigDiscovery::Auto
        } else {
            TsconfigDiscovery::Manual(TsconfigOptions { config_file: tsconfig_path.clone(), references: TsconfigReferences::Auto })
        };
        let resolver = Resolver::new(ResolveOptions { tsconfig: Some(discovery), ..ResolveOptions::default() });
        let mut files = Vec::new();
        for e in WalkDir::new(&dir).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()) {
            let rel = e.path().strip_prefix(&dir).unwrap().to_string_lossy().to_string();
            if rel.ends_with("tsconfig.json") || rel.ends_with("tsconfig.base.json") { continue; }
            match resolver.find_tsconfig(e.path()) {
                Ok(Some(ts)) if ts.path() == tsconfig_path => files.push(rel),
                Ok(_) => {}
                Err(err) => eprintln!("{name} {rel}: {err}"),
            }
        }
        files.sort();
        out.push(format!("{:?}:{:?}", name, files));
    }
    println!("{{{}}}", out.join(","));
}
```

### `tsconfig-probe/gen/gen.mjs` (case list)

The generator writes the 25 files into each case directory, writes the case `tsconfig.json`, and gets TypeScript's `fileNames`. All compilerOptions are `{"target":"es2022"}` plus the noted option. The 27 cases:

| Case | `tsconfig.json` content (besides target) |
|------|------------------------------------------|
| c01_default | none |
| c02_default_allowJs | `allowJs: true` |
| c03_include_dir | `include: ["src"]` |
| c04_include_dir_exclude_glob | `include: ["src"]`, `exclude: ["src/**/*.test.ts"]` |
| c05_files_only | `files: ["root.ts","lib/l.ts"]` |
| c06_files_and_include | `files: ["root.ts"]`, `include: ["src/*.ts"]` |
| c07_exclude_only | `exclude: ["src/legacy","dist"]` |
| c08_include_star_single | `include: ["src/*.ts"]` |
| c09_include_question | `include: ["src/x?.ts"]` |
| c10_include_dirs_mid | `include: ["src/**/gen/*.ts"]` |
| c11_exclude_testsdir_glob | `exclude: ["**/__tests__"]` |
| c12_outDir_default_exclude | `outDir: "dist"` |
| c13_include_exact_file | `include: ["src/a.ts","root.ts"]` |
| c14_include_empty_with_files | `files: ["root.ts"]`, `include: []` |
| c15_exclude_trailing_slash | `exclude: ["src/legacy/"]` |
| c16_include_explicit_all | `include: ["**/*"]` |
| c17_include_explicit_node_modules | `include: ["node_modules/**/*","src"]` |
| c18_allowJs_include_ext | `allowJs: true`, `include: ["src/**/*.js","src/**/*.mjs"]` |
| c19_include_dot_dir_pattern | `include: ["./src","./lib"]` |
| c20_configDir | `include: ["${configDir}/src"]`, `exclude: ["${configDir}/src/legacy"]` |
| c21_include_json_glob | `resolveJsonModule: true`, `include: ["src/**/*.json","src/a.ts"]` |
| c22_exclude_beats_files | `files: ["root.ts"]`, `exclude: ["root.ts"]` |
| c23_include_dstar_prefix | `include: ["**/t*.ts"]` |
| c24_include_parent_dot | `include: ["."]` |
| c25_extends_in_subdir_pattern | `extends: "./base/tsconfig.base.json"`; base: `include: ["../src"]`, `exclude: ["../src/legacy"]` |
| c26_jsonc | raw text with `//` and `/* */` comments and trailing commas; `include: ["src"]`, `exclude: ["src/legacy"]` |
| c27_extends_same_dir | `extends: "./tsconfig.base.json"`; base: `include: ["src"]`, `exclude: ["src/legacy"]` |

Per-case file counts (TypeScript / `oxc_resolver` Auto): all equal except c12 (17 / 18), c17 (14 / 13), c25 (12 / 0).
