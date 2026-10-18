# Research: build, release and CI limits for qualbar (issue #8)

Date: 2026-10-18. Sources are primary only. Tool state was read through `gh api` and WebFetch.
Note: `gh issue view` fails here (Projects classic error). I used `gh api repos/mquesada02/qualbar/issues/8`.

## 1. GitHub-hosted runner limits (public repo, Free plan owner)

| Item | Value | Source |
|---|---|---|
| Standard runners in public repos | Free and unlimited | https://docs.github.com/en/actions/reference/runners/github-hosted-runners ("free and unlimited on public repositories"); https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions |
| Job time | 6 hours per job | https://docs.github.com/en/actions/reference/limits |
| Workflow run time | 35 days | same |
| Concurrency, Free plan | 20 jobs total, 5 macOS jobs | same |
| Matrix | 256 jobs per run | same |
| Cache | 10 GB per repo; entries unused for 7 days are removed; oldest-access-first eviction when over | https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching |
| Cache scope | Branch reads own branch, then default branch. PR caches are scoped to the merge ref and only that PR re-runs can use them. Sibling branches and tags are isolated. | same |
| Cache API rate | 200 uploads, 1,500 downloads per minute per repo | same |

Consequences:
- The 6 h job cap matches the map decision "mutation sharded so each job stays under 6 h". Set `timeout-minutes` explicitly (default is 360; the runner docs page does not state it).
- 5 concurrent macOS jobs. A PR matrix with 2 macOS jobs is fine. A release with 2 macOS jobs is fine. Several PRs at once can queue macOS jobs.
- 10 GB cache is shared by all branches. Rust `target/` dirs are large. Cache only `~/.cargo` registry and use a small key set, or use sccache-free builds. Release builds should not rely on cache (oxc says: "No Rust cache is provided, to avoid cache poisoning attack", oxc-release_apps.yml).

### Runner labels (standard, free in public repos)

From https://docs.github.com/en/actions/reference/runners/github-hosted-runners and https://github.com/actions/runner-images (README table):

| Platform | Label | Size |
|---|---|---|
| Linux x64 | `ubuntu-latest` / `ubuntu-24.04` / `ubuntu-26.04` / `ubuntu-22.04` | 4 vCPU, 16 GB |
| Linux arm64 | `ubuntu-24.04-arm`, `ubuntu-22.04-arm`, `ubuntu-26.04-arm` | 4 vCPU, 16 GB |
| macOS Intel | `macos-15-intel`, `macos-26-intel` | 4 vCPU, 14 GB |
| macOS arm64 | `macos-latest`, `macos-15`, `macos-26` (also `macos-14`) | 3 vCPU (M1), 7 GB |

Warnings:
- `-large`, `-xlarge` suffixes (`macos-15-large`, `macos-26-xlarge`) are larger runners. They are always billed, even in public repos (billing doc, quoted: "Larger runners are always charged for, even when used by public repositories"). Do not use them.
- Linux arm64 was announced free for public repos in Jan 2025 as a public preview: https://github.blog/changelog/2025-01-16-linux-arm64-hosted-runners-now-available-for-free-in-public-repositories-public-preview/ . The current runners doc lists it as a standard runner. I did not find the GA date (open item).

### macOS Intel: still exists, with an end date

- Issue https://github.com/actions/runner-images/issues/13045: `macos-15-intel` "will be available from now until August 2027. This will be the last available x86_64 image from Actions, and after that date the x86_64 architecture will not be supported on GitHub Actions."
- `macos-13` deprecation began 2025-09-19 (same issue).
- `macos-14` / `macos-14-arm64`: deprecation 2026-07-06, retired 2026-11-02, with brownouts in October 2026 (https://github.com/actions/runner-images/issues/13518). Do not use `macos-14`.
- The runner-images README lists `macos-26-intel` as well (https://github.com/actions/runner-images/blob/main/README.md). The runners doc page does not mention an end date for it. Treat Intel as gone after August 2027 unless GitHub says otherwise.
- Rust: `x86_64-apple-darwin` is Tier 2 with host tools ("guaranteed to build"); `aarch64-apple-darwin` is Tier 1 (https://doc.rust-lang.org/nightly/rustc/platform-support.html).

## 2. How each project cross-compiles

Key finding: nobody needs an Intel Mac runner to build `darwin-x64`. Both biome and fallow build `x86_64-apple-darwin` on an arm64 macOS runner with `rustup target add`.

### fallow (https://github.com/fallow-rs/fallow, `.github/workflows/release.yml`)
- Build matrix, job `build` (timeout 150 min):
  - `x86_64-apple-darwin` on `macos-latest` (arm64 host, cross-target).
  - `aarch64-apple-darwin` on `macos-latest`.
  - `x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu` on `ubuntu-26.04`, inside a pinned `rust:1.97.1-bullseye` container (old glibc for compatibility). arm64 gnu uses `gcc-aarch64-linux-gnu` as linker (`CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER: aarch64-linux-gnu-gcc`). It is cross-compiled from x64, not a native arm64 runner.
  - `x86_64-unknown-linux-musl`: `musl-tools` and plain `cargo build`.
  - `aarch64-unknown-linux-musl`: `cargo-zigbuild==0.23.4` with `ziglang==0.16.0`, because the C code (mimalloc, QuickJS) cannot be linked by the glibc cross-gcc into a musl binary. Comment at lines ~549-558 of the workflow.
  - Also win32 x64 and arm64 (`windows-latest`, `windows-11-arm`).
- Trigger: `workflow_dispatch` with a `tag` input. Release tooling is `cargo-release` (`release.toml`: signed tag `v{{version}}`, `shared-version = true`, a `pre-release-hook` runs `scripts/sync-npm-versions.sh`).
- PGO is used for some targets (extra `pgo-profile` job). Not needed for v1.

### biome (https://github.com/biomejs/biome, `.github/workflows/release_cli.yml`)
- Matrix: `rustup target add ${{ matrix.target }}` then `cargo build -p biome_cli --release --target <t>` with `RUSTFLAGS='-C strip=symbols -C codegen-units=1'`.
- Targets: `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl` (musl-tools), `x86_64-apple-darwin` and `aarch64-apple-darwin` both on a macOS arm64 runner (`depot-macos-latest`), glibc `*-gnu` in a separate `build-gnu` job on native x64 and native arm64 runners. Runners are Depot (paid), but nothing in the steps needs them.
- Provenance: each job has `id-token: write`, `attestations: write` and runs `actions/attest-build-provenance` on the binaries.
- Release automation: `.github/workflows/release.yml` uses `changesets/action` on push to main. It opens a "ci: release" PR. Merging it changes `packages/@biomejs/biome/package.json`. `release_cli.yml` (comment: "emergency workflow") checks version change, builds, then `publish` job runs `node packages/@biomejs/biome/scripts/generate-packages.mjs` then `npm publish` for each package, on `ubuntu-24.04` ("Must be a GitHub hosted runner for provenance"), environment `npm-publish`, and creates tag `cli/v<version>`.

### oxlint (https://github.com/oxc-project/oxc, `.github/workflows/release_apps.yml`)
- Trigger: push to main touching `npm/oxlint/package.json` or `npm/oxfmt/package.json`, or manual. A weekly job `prepare_release_apps.yml` (cron Monday) opens the version/changelog PR using their own `cargo release-oxc`.
- Tools: `cross` (taiki-e/install-action) for gnu targets, `--use-napi-cross` for napi-rs builds, `cargo-zigbuild` + zig 0.13 for musl and riscv musl. macOS: both `x86_64-apple-darwin` and `aarch64-apple-darwin` on `macos-latest`.
- Note: oxlint ships a napi-rs addon plus the CLI. Packages are `@oxlint/binding-<triple>` created by `napi create-npm-dirs` and `napi pre-publish`. oxlint's `bin/oxlint` is a JS file: `import "../dist/cli.js"` (https://github.com/oxc-project/oxc/blob/main/npm/oxlint/bin/oxlint). This is a different model from biome and fallow (addon, not a spawned binary). Do not copy it for qualbar.
- Publish: `pnpm napi pre-publish` with trusted publishing (no token), `--provenance --access public`, `id-token: write`, environment `release`.

### Tool docs
- cargo-zigbuild (https://github.com/rust-cross/cargo-zigbuild): linux and macOS targets only. Use `--target aarch64-unknown-linux-gnu.2.17` to pin the minimum glibc. For static output use `*-musl`. macOS targets need an SDK (auto-detected on a macOS host). Install with `pip install cargo-zigbuild` (also installs `ziglang`).
- Rust platform support (https://doc.rust-lang.org/nightly/rustc/platform-support.html): linux-gnu x64/arm64 Tier 1 (glibc 2.17+); linux-musl x64/arm64 Tier 2 with host tools; apple x64 Tier 2, arm64 Tier 1.
- cargo-dist npm installer (https://axodotdev.github.io/cargo-dist/book/installers/npm.html): downloads the prebuilt archive at install time. It does not use per-platform optionalDependencies. This is a postinstall-style fetch. It conflicts with what the map says (npm, prebuilt) only if you want install without network at install time; also `ignore-scripts=true` setups break it. Not recommended.

## 3. npm per-platform package pattern

Common to biome and fallow (both read from source):
- One root package (`@biomejs/biome`, `fallow`) with `bin` pointing to a JS launcher, and `optionalDependencies` listing exact-version platform packages.
  - biome: https://github.com/biomejs/biome/blob/main/packages/@biomejs/biome/package.json (10 platform packages, exact versions equal to root).
  - fallow: https://github.com/fallow-rs/fallow/blob/main/npm/fallow/package.json (`@fallow-cli/<platform>`, exact versions).
- Each platform package has `os` and `cpu` fields, and for musl-vs-glibc a `libc` field (biome: `"libc": ["musl"]` in https://github.com/biomejs/biome/blob/main/packages/@biomejs/cli-linux-x64-musl/package.json). fallow's musl package has only `os` and `cpu` (https://github.com/fallow-rs/fallow/blob/main/npm/linux-x64-musl/package.json), so it relies on the launcher.
- npm/pnpm/yarn install only the optional package that matches the host. The launcher resolves the binary with `require.resolve("<pkg>/<binary>")` and runs it with `spawnSync`, `stdio: "inherit"`, `shell: false` (biome `bin/biome`).
- Libc detection in the launcher: biome runs `ldd --version` and looks for "musl" (https://github.com/biomejs/biome/blob/main/packages/@biomejs/biome/bin/biome). fallow uses the `detect-libc` dependency and falls back to the musl build if detection fails, since the musl binary is static and runs on glibc too (https://github.com/fallow-rs/fallow/blob/main/npm/fallow/scripts/run-binary.js).
- No postinstall in either. fallow ships `.npmrc` with `ignore-scripts=true` and moved its verify step from postinstall to lazy first-run (`run-binary.js` header comment: "postinstall verification was retired"). Biome has no install script.
- Exit code: forward the child exit code. Biome maps signal death to 128 + signal. fallow does the same. Copy this.
- Release order: publish all platform packages first, then the root (fallow `npm-publish` job; oxc waits with `wait-for-npm-packages.mjs` before publishing the root).

A single musl build for Linux is simpler than gnu plus musl: fallow comment says musl binaries are static and run on both. Biome and fallow still ship both because glibc builds are faster (allocator) and some native deps. For qualbar, one musl-static build per arch is enough if the allocator choice is fine; this needs a benchmark (open item).

## 4. Signing and provenance

- npm provenance (https://docs.npmjs.com/generating-provenance-statements): needs GitHub-hosted runner, `id-token: write`, npm >= 9.5.0, `repository` field matching the repo, and `npm publish --provenance` (or `publishConfig.provenance: true`; biome sets this in every package). First publish needs `--access public`.
- npm trusted publishing (https://docs.npmjs.com/trusted-publishers): npm CLI >= 11.5.1, Node >= 22.14.0, workflow file name must match exactly, `repository.url` must match exactly. No token. Provenance is automatic when repo and package are public. Self-hosted runners not supported. Config is not validated at save time; and a new config must make a first publish within 2 days. The page does not say whether the package must exist before the trusted publisher is configured (open item).
- Build provenance: biome uses `actions/attest-build-provenance` on each binary (release_cli.yml). Cheap and free for public repos.
- fallow adds its own Ed25519 signature per binary (`.github/scripts/sign-binary.mjs`, secret `ED25519_BINARY_SIGNING_PRIVATE_KEY`), shipped as `.sig` next to the binary and verified by the launcher on first run. It also stages the root publish for 2FA approval (`npm stage publish`). This is heavy. Not needed for v1.
- Hardening seen in all three: `permissions: {}` at top, per-job minimal permissions, a protected `environment` for the publish job, a separate publish job with no checkout of build code (fallow), `--ignore-scripts` on publish, pinned action SHAs.

## 5. Release automation

| Project | Version bump | Trigger of build/publish |
|---|---|---|
| biome | changesets PR (`changesets/action`) | push to main when package.json version changed; also manual |
| oxc | weekly cron PR via custom `cargo release-oxc` | push to main touching `npm/*/package.json` |
| fallow | `cargo-release` (`release.toml`), signed tag `v{{version}}` | manual `workflow_dispatch` with tag; tag is pushed after approval |

Options for qualbar: release-please (Rust + node, PR-based) or changesets or cargo-release. I did not read release-please docs in this pass (out of the listed scope); treat as open.

## 6. Recommended design for qualbar

Build (one workflow `release.yml`, matrix, `timeout-minutes: 90`, `fail-fast: false`):
1. `x86_64-unknown-linux-musl` on `ubuntu-24.04` with `musl-tools`.
2. `aarch64-unknown-linux-musl` on `ubuntu-24.04-arm` (native, free in public repo). Avoids zig. If the free arm runner proves unreliable, fall back to `cargo zigbuild` on x64 as fallow does.
3. `aarch64-apple-darwin` on `macos-latest`.
4. `x86_64-apple-darwin` on `macos-latest` using `rustup target add x86_64-apple-darwin` (as biome and fallow do). No Intel runner needed to build. For a smoke test of the x64 binary, run it on `macos-15-intel` while it exists (until August 2027) or under Rosetta on arm64 (`arch -x86_64`; not verified in a primary source).
5. Add glibc builds (`x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`) only if benchmarks show musl is slower or a native dependency needs it. Build them in an old-glibc container (fallow uses `rust:...-bullseye`) or with `cargo zigbuild --target x86_64-unknown-linux-gnu.2.17`.
- Release flags: `RUSTFLAGS='-C strip=symbols -C codegen-units=1'` (biome), `--locked`.
- Do not use cache in the release workflow. In PR CI use `~/.cargo` registry cache only, and watch the 10 GB repo limit.
- macOS PR CI: 1 job on `macos-latest` (arm64) per PR keeps us well under the 5 macOS concurrent job cap. Add one `macos-15-intel` job on `main` or nightly only, as it has an end date.

npm packaging:
- Root package `qualbar`: `bin` -> `bin/qualbar` JS launcher, `optionalDependencies` with exact versions of `@qualbar/<os>-<cpu>[-musl]`, `dependencies` none (use biome's `ldd` trick or `detect-libc` only if gnu and musl both ship). No postinstall. Forward exit code and signals.
- Platform packages: `os`, `cpu`, `libc` (when libc-specific), `files: [binary]`, same version, `publishConfig.provenance: true`.
- Generate the platform package.json files in CI from one template script (biome's `generate-packages.mjs` pattern). Publish platform packages first, then root.
- Org/scope: `@qualbar/*` requires owning the npm scope. Open item.

Provenance and signing:
- Publish via npm trusted publishing from a GitHub-hosted `ubuntu-24.04` job, `id-token: write`, protected `release` environment, `--provenance --access public --ignore-scripts`.
- Add `actions/attest-build-provenance` for each binary (as biome). Skip custom Ed25519 signing for v1.

Release automation:
- Pick one of changesets or release-please to open a version PR; merging it creates a tag; the tag triggers `release.yml`. Biome and oxc both gate the publish on a merged version-bump PR, which keeps agents from publishing by accident. Decision belongs to the spec.
- Keep the release workflow separate from PR CI. `concurrency: group: release, cancel-in-progress: false` (fallow).

## 7. Open uncertainties
- Linux arm64 free runners: preview announcement Jan 2025 found; GA date and whether queue times are stable not verified. 
- macOS Intel end date (August 2027) is from an issue body, not from the runners doc page. The doc page does not list a date.
- Whether a plain musl-static build is as fast as glibc for qualbar (allocator, TypeScript-Go sidecar spawn). Needs a benchmark. The sidecar (tsgo) is a separate binary per platform; its packaging is not covered here and affects the platform-package count.
- npm trusted publishing for a brand-new package or scope: docs do not say if the package must exist first. A first manual publish may be needed.
- Rosetta test of the x64 darwin binary on arm64: not confirmed in a primary source.
- release-please vs changesets vs cargo-release: not compared against their docs here.
- Cache hit rate on free 10 GB: not measured.
- Mutation sharding fits in 6 h per job (limit confirmed). Concurrency of 20 jobs total bounds the shard count per workflow.
