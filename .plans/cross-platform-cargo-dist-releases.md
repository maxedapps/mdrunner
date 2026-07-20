# Cross-platform `mdr` releases with cargo-dist

> **Status:** Ready for implementation; creating the first public tag still requires explicit owner publication approval
> **Planning memory:** Included in this plan

## Problems

- `Cargo.toml:2-7` still has version `0.0.0`, `publish = false`, and no repository/license metadata, so it is not ready to identify a public binary release.
- The repository has no `CHANGELOG.md`, release guide, Git tags, GitHub Releases, cargo-dist configuration, or `.github/**` workflow. Users cannot obtain prebuilt executables without building from source.
- `src/source.rs:51-67` and `src/lib.rs:15,65-70` support help but no `-V`/`--version`, so a downloaded executable cannot report which release it belongs to.
- Only macOS arm64 is currently native-qualified (`README.md:87-89`, `PROJECT.md:110-116`). Building four artifacts must not be documented as proof that all four browser-integrated runtimes are qualified.
- Active project language currently rejects hosted CI and custom release orchestration (`PROJECT.md:12,84,96`). The user's new distribution requirement intentionally supersedes that constraint, but active documentation must be reconciled without rewriting historical plans/reviews.
- `README.md:12-36` currently contains Cargo build/test instructions for repository contributors. The owner has now defined README's audience as tool users only: it must explain the product, installation, usage, behavior, and supported downloads while moving developer/release material to `PROJECT.md` and `RELEASING.md`.

## Implementation summary

- Establish a `0.1.0` release identity under the MIT License, human-curated changelog, maintainer release guide, and exact CLI version output first.
- Pin cargo-dist `0.32.0`; keep `dist-workspace.toml` as repository-owned configuration and let `dist init` own `.github/workflows/release.yml`; produce four target archives, shell/PowerShell installers, SHA-256 checksums, and host-phase GitHub attestations.
- Keep `publish = false`; explicitly include `mdr` in dist rather than enabling crates.io publication.
- Add a separate minimal native CI workflow because cargo-dist packages applications but does not run the Rust test suite.
- Rewrite README for end users only, with generated no-Rust installation commands, practical usage, visible capabilities/limits, and honest platform status; keep all contributor and release-operation instructions elsewhere.
- Validate all four hosted builds on a setup PR without creating a public release. Preserve a strict distinction between **artifact available** and **native-qualified**. Publishing `v0.1.0` remains an explicit owner action after changelog, artifact, and qualification review.

## Conducted research and relevant sources

| Source or artifact | Material finding | Plan impact |
|---|---|---|
| `Cargo.toml:1-37`, `rust-toolchain.toml:1-4` | Single Rust 1.91 binary, version `0.0.0`, committed lockfile, `publish = false`, no release metadata. | T1.1 sets release identity while retaining non-publication to crates.io. |
| `src/lib.rs:15,44-78`, `src/source.rs:51-67,171-204` | Help is a successful non-rendering selection; version output is absent and can reuse that narrow control flow. | T1.2 adds `Version` without a parser framework or subcommands. |
| `tests/render.rs`, `src/browser.rs`, `PROJECT.md:98-116` | Portable semantic tests exist, but automated tests intentionally do not invoke a browser; full qualification is manual/native. | T2.2 runs tests natively; T3.2/T3.3 keep browser qualification separate. |
| `README.md:1-89`, `PROJECT.md:82-116` | README mixes user behavior with developer Cargo commands; PROJECT holds the development gate and macOS arm64 qualification. | T2.3 makes README user-only and keeps development/release operations in PROJECT/RELEASING. |
| [cargo-dist 0.32.0](https://github.com/axodotdev/cargo-dist/releases/tag/v0.32.0) and [Rust quickstart](https://axodotdev.github.io/cargo-dist/book/quickstart/rust.html) | Current release is 0.32.0; `dist init` generates release config/workflow and should be rerun on updates. | T2.1 pins 0.32.0 and treats generated CI as dist-owned. |
| [cargo-dist configuration](https://axodotdev.github.io/cargo-dist/book/reference/config.html) | Current config supports an explicit package allowlist, four requested triples, installers, PR modes, checksums, and attestations. | T2.1 uses a narrow `dist-workspace.toml` contract. |
| [cargo-dist CI](https://axodotdev.github.io/cargo-dist/book/ci/index.html) and [customization](https://axodotdev.github.io/cargo-dist/book/ci/customizing.html) | GitHub CI performs plan/build/host/announce; default runners cover the requested targets; cargo-dist does not run project tests. | T2.2 adds ordinary CI; T3.2 uses `pr-run-mode = "upload"` only for setup validation. |
| [shell/PowerShell installers](https://axodotdev.github.io/cargo-dist/book/installers/index.html), [checksums](https://axodotdev.github.io/cargo-dist/book/artifacts/checksums.html), [attestations](https://axodotdev.github.io/cargo-dist/book/supplychain-security/attestations/github.html) | Dist can select and install the correct archive without Rust, emit SHA-256 files, and attest hosted artifacts for this public repository. | T2.1/T2.3 expose simple no-Rust installation and verification. |
| [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and [SemVer 2.0.0](https://semver.org/) | Changelogs are human-curated, newest-first, dated, grouped by user impact; package/tag versions must be immutable once released. | T1.3 and T3.3 define the release-note/version workflow. |
| [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) | Draft-first publication permits validation before locking tag and assets. | T3.3 makes immutability an owner setting after the dry run and before the first final release. |
| [OSI MIT License text](https://opensource.org/license/mit) | MIT permits use, modification, distribution, sublicensing, and sale while requiring preservation of the copyright/permission notice and disclaiming warranties. | T1.1 adds `license = "MIT"` and the canonical license text with the repository owner's copyright notice. |

- **Exploration/research lanes:** Local scout `run-b4e3345c-7ec9-4772-b1dd-f28113fb56b4` mapped manifests, CLI flow, tests, docs, historical constraints, and qualification boundaries. External researcher `run-d4273efb-bd72-4bd3-af7d-131529220632` verified cargo-dist 0.32.0 config ownership, targets, installers, checksums, attestations, changelog parsing, PR validation, and release limits.
- **Parent verification:** Confirmed the repository is public at `https://github.com/maxedapps/mdr`, `main` is the default branch, no local tags or GitHub Releases exist, `dist` is not installed locally, and the working tree was clean before this plan. Verified current cargo-dist 0.32.0 release/docs and resolved the local scout's legacy config uncertainty in favor of `dist-workspace.toml` generated by pinned `dist init`. Applied the owner's later decisions to use MIT and make README exclusively user-facing.

## Scope and non-goals

- **In scope:** Release version/metadata; MIT `LICENSE`; `-V`/`--version`; `CHANGELOG.md`; `RELEASING.md`; a user-only README rewrite; cargo-dist 0.32.0; GitHub release workflow; native OS CI tests; four archives for Apple Silicon macOS, Intel macOS, x64 GNU/Linux, and x64 Windows; shell/PowerShell installers; SHA-256; host-phase GitHub attestations; install/support/release documentation; non-publishing cross-platform dry run.
- **Non-goals:** crates.io publication; Homebrew/Scoop/WinGet/AUR/apt/rpm; MSI; universal macOS binary; Linux musl or ARM; Windows ARM; auto-update; SBOM; macOS notarization; Windows Authenticode signing; renderer/output changes; a hidden `--no-open` test flag; browser automation abstractions; compatibility alias for `mdrunner`; rewriting historical `.plans/**` or `.reviews/**`; automatically pushing the first public tag.

## Decisions and constraints

| Approach or constraint | Result | Reason and consequence |
|---|---|---|
| cargo-dist 0.32.0 generated release pipeline | Chosen | It uses Cargo underneath while removing custom archive/installer/upload scripting. `dist init` remains the sole owner of generated release CI. |
| Four explicit release targets | Chosen | `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, and `x86_64-pc-windows-msvc` directly match the requested macOS/Linux/Windows desktop scope. |
| Shell and PowerShell installers | Chosen | They provide the requested no-Rust installation path and select the matching archive automatically. |
| Separate ordinary CI plus cargo-dist release CI | Chosen | cargo-dist proves build/package success, not project tests; source behavior must pass on native OS runners before release artifacts are trusted. |
| Keep `publish = false` and allowlist `mdr` in dist | Chosen | GitHub binary distribution is required; crates.io publication is not. |
| Initial version `0.1.0` | Chosen | No tags/releases exist, and pre-1.0 SemVer accurately signals an evolving public CLI contract. |
| MIT License | Chosen by owner | Add `license = "MIT"` and canonical MIT text with `Copyright (c) 2026 Maximilian Schwarzmüller`; include the notice in distributed archives. |
| README audience | Tool users only | README explains what `mdr` does, installation, usage, visible behavior/limits, platform availability, changelog, and license. Cargo development, CI, cargo-dist, and release-maintainer instructions belong in `PROJECT.md`/`RELEASING.md`, not README. |
| Build availability versus native qualification | Confirmed | Four archives may be produced after CI succeeds. Only platforms with the documented outside-repository file/stdin/default-browser smoke may be called native-qualified. |
| `pr-run-mode = "plan"` normally, temporary `"upload"` for setup | Chosen | Normal PRs stay cheaper; the setup PR must prove all four archive builds before returning config to `plan`. |
| SHA-256 plus host-phase GitHub attestations | Chosen | Checksums catch corruption; attestations add build provenance. Neither replaces platform code signing. |
| Unsigned first pipeline | Reversible | Signing/notarization needs paid credentials and platform-specific operations. Document possible trust prompts and handle signing in a later decision if required. |
| Immutable GitHub Releases | Owner setting after dry run | Immutability improves integrity but prevents repairing a published tag/assets. Enable only after setup artifacts and procedure are verified. |
| No public `v0.1.0` during implementation | Confirmed | Pipeline setup is reversible; publication is externally visible and immutable. T3.3 prepares an exact handoff and requires explicit owner approval. |
| Historical no-CI/no-release decisions | Superseded only in active contract | The new user request is the observed release requirement those plans said would justify a separate design. Update `PROJECT.md`; retain historical evidence unchanged. |

## Plan review

- **Reviewer:** Fresh read-only scout `run-c197ad37-152b-4ffd-bcf8-bfd19223e58a` reviewed scope, local evidence, config/workflow ownership, dependencies, validation feasibility, and publication safety.

| Finding | Parent evaluation | Disposition | Plan change or user decision |
|---|---|---|---|
| License dependencies blocked all setup despite status saying only publication was blocked. | Confirmed during review. The user subsequently chose MIT, removing the gate entirely. | Accept | T1.1 now adds MIT metadata/text with release identity; T3.3 requires only ordinary publication approval. |
| T1.3 depended backward on T2.1 while Phase 2 required Phase 1 complete. | Confirmed circular phase dependency. | Accept | T1.3 now creates the changelog and tool-neutral guide skeleton; T2.3 reconciles generated names/commands. |
| Exact four-architecture ordinary CI duplicated cargo-dist build jobs and could make setup depend on Apple Silicon runner availability. | Confirmed: ordinary CI must test portable behavior by OS; T3.1 owns exact four-target build/package proof. | Accept | T2.2 now requires Linux, Windows, and macOS native OS tests, with architecture gaps recorded rather than blocking setup. |
| `dist-workspace.toml` was described as generated output rather than repository-owned config input. | Confirmed wording defect. | Accept | Ownership language now distinguishes editable config from generated `.github/workflows/release.yml`. |
| Focused follow-up found T3.3's task dependency still blocked handoff preparation on license/approval, despite those being publication-only gates. | Confirmed: commands and evidence can be prepared safely before the owner authorizes the irreversible tag push. The later MIT choice removes the license part. | Accept | T3.3 depends only on T3.1-T3.2; explicit approval remains the sole conditional gate for tag/publication steps. |

- **Focused follow-up:** Completed by the same reviewer on the four accepted changes. It confirmed three were resolved and identified the remaining T3.3 dependency wording above; that final issue was accepted and corrected without reopening broad review. After review, the owner resolved the license as MIT and narrowed README to tool users; those authority changes were applied directly without changing task IDs or release architecture.

## Phase 1 — Establish a versioned public release contract

### Problems addressed

- The package has placeholder version/metadata and no committed MIT license.
- Users and release checks cannot identify an executable's version.
- There is no human-readable change history or repeatable release procedure.

### Implementation summary

- Prepare `0.1.0` metadata while retaining `publish = false`.
- Add one narrow non-rendering version selection and black-box CLI assertions.
- Add a Keep-a-Changelog file and a maintainer release guide before configuring automation.

### Tasks

#### T1.1 — Set release identity and MIT licensing

**Description**

- Change the package version to `0.1.0`; add `repository = "https://github.com/maxedapps/mdr"`, `homepage = "https://github.com/maxedapps/mdr"`, `readme = "README.md"`, and `license = "MIT"`.
- Add top-level `LICENSE` using the canonical OSI MIT text and `Copyright (c) 2026 Maximilian Schwarzmüller`. Preserve the notice in cargo-dist archives.
- Do not add deprecated Cargo `authors` metadata or speculative keywords/categories solely for completeness.
- Retain `publish = false`; let cargo-dist opt the package into binary distribution in T2.1.
- Regenerate only lockfile metadata caused by the root package version change and inspect the root `mdr` entry.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `Cargo.toml` — `[package]`: version, repository, homepage, readme, MIT license, and retained `publish = false`.
- `Cargo.lock` — root `mdr` package entry only.
- `LICENSE` — canonical MIT text and copyright notice.
- `README.md`, `PROJECT.md`: release identity references discovered during implementation.

**Dependencies**

- None.

**Contract or shape**

```toml
[package]
name = "mdr"
version = "0.1.0"
repository = "https://github.com/maxedapps/mdr"
homepage = "https://github.com/maxedapps/mdr"
readme = "README.md"
license = "MIT"
publish = false
```

**Acceptance and verification**

- Metadata is coherent — run `cargo metadata --locked --no-deps --format-version 1`; expect package version `0.1.0`, canonical repository URL, MIT license, one `mdr` binary, and no lockfile drift.
- Publication remains disabled — inspect Cargo metadata/manifest; expect `publish = []`/false semantics and no crates.io release task.
- License is exact — compare `LICENSE` with the canonical OSI MIT text, verify the copyright line, and confirm cargo-dist plans to include it in every archive.

**Task-local risks**

- Altering the standard MIT grant/disclaimer or omitting the notice from distributed archives creates a legal metadata defect. Compare exact text and inspect a generated archive before release.

#### T1.2 — Add exact CLI version output

**Description**

- Extend `SourceSelection` with a version selection recognized only for one `-V` or `--version` argument, parallel to help and before file parsing.
- Source the value from `env!("CARGO_PKG_VERSION")`; print exactly `mdr <version>` to stdout and return success without reading stdin, rendering, writing output, or opening a browser.
- Preserve current help, file precedence, argument-count errors, and no-subcommand design.
- Add focused selector tests and a black-box integration test using Cargo's built executable path; do not add `clap`, `assert_cmd`, dependency injection, or a hidden browser-suppression flag.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `src/source.rs` — `SourceSelection`, `read_markdown_source`, and `help_and_argument_count_are_strict`.
- `src/lib.rs` — `run`, usage/version constants, and non-rendering output branch.
- `tests/cli.rs` — new process-level help/version stdout, stderr, and exit-status assertions.
- `src/main.rs` — verify error/exit behavior remains unchanged.

**Dependencies**

- T1.1.

**Contract or shape**

```text
mdr -V        -> stdout: "mdr 0.1.0\n", stderr empty, exit 0
mdr --version -> stdout: "mdr 0.1.0\n", stderr empty, exit 0
```

**Acceptance and verification**

- Run `cargo test source`; expect help/version selectors and strict extra-argument behavior to pass.
- Run `cargo test --test cli`; expect exact help/version process output, empty stderr, and success without an output/browser side effect.
- Run `cargo run --quiet -- --version`; expect `mdr 0.1.0` and prompt exit.

**Task-local risks**

- Reading stdin before dispatch could hang `--version` in automation. Keep help/version selection before any stdin read and protect it with a process-level timeout/check.

#### T1.3 — Add changelog and release operating guide

**Description**

- Add top-level `CHANGELOG.md` in Keep a Changelog format with an `Unreleased` section containing curated user-visible initial-release and distribution changes. Do not manufacture historical versions or copy commit subjects.
- Define the future `0.1.0` heading shape, ISO date, change categories, and comparison links. Move `Unreleased` entries into the dated section only during the approved release preparation in T3.3.
- Add a tool-neutral `RELEASING.md` skeleton as the maintainer source of truth for version/changelog synchronization, local/hosted checks, tag format, qualification status, release notes, recovery, and explicit owner approval. T2.3 must reconcile exact generated cargo-dist commands/artifact names after `dist init`.
- State that cargo-dist reads the matching `CHANGELOG.md` version section for GitHub release prose; autogenerated commit lists are supplementary, not authoritative.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `CHANGELOG.md` — new human-curated release history.
- `RELEASING.md` — new operator checklist and recovery rules.
- `PROJECT.md` — link to the maintainer release guide without duplicating it; README's user-facing changelog/license links are finalized in T2.3.

**Dependencies**

- T1.1. Generated cargo-dist details are intentionally finalized later in T2.3.

**Contract or shape**

```markdown
# Changelog

## [Unreleased]

### Added

- ...

## [0.1.0] - YYYY-MM-DD
```

**Acceptance and verification**

- Changelog is parseable and human-focused — inspect headings/categories/links and later run `dist plan --tag=v0.1.0`; expect cargo-dist to select the `0.1.0` notes after release preparation.
- Release-guide skeleton is internally coherent — dry-read its tool-neutral steps; expect version, tag, changelog, approval, verification, and failure recovery boundaries with no obsolete Bun commands. T2.3 later validates exact generated cargo-dist commands/names.
- No public release is implied — expect `git tag` and `gh release list` to remain empty during pipeline implementation.

**Task-local risks**

- A release heading added too early can drift from the shipped state. Keep changes under `Unreleased` until T3.3 finalizes the approved release commit.

### Risks, safeguards, and recovery

- **Risk:** Version, MIT metadata/text, changelog, and binary output disagree.
- **Safeguard:** Derive CLI version from Cargo metadata; verify canonical MIT text/archive inclusion; make the release guide require version equality and changelog parsing before tagging.
- **Recovery:** Before publication, correct metadata/changelog and rerun Phase 1 checks. After publication, never move the tag or replace assets; prepare a new patch release.

### Phase validation and review

- **Checks:** `cargo metadata --locked --no-deps --format-version 1`; focused source/CLI tests; `cargo fmt --check`; `cargo clippy --all-targets -- -D warnings`; full `cargo test --locked`; manual changelog/release-guide inspection.
- **Review focus:** T1.1 legal/metadata consistency, T1.2 no-side-effect version path, T1.3 changelog parse shape and operator safety.
- **Exit and rerun:** Resolve all metadata/license/version/release-note findings; rerun focused tests then the full phase gate.

## Phase 2 — Generate and document the cross-platform release pipeline

### Problems addressed

- No process builds or packages the requested targets.
- Users lack no-Rust installers and artifact verification.
- cargo-dist release builds alone would not run project tests.
- Active docs still prohibit the now-requested release automation.

### Implementation summary

- Generate the minimal dist 0.32.0 GitHub release pipeline for four targets and two installers.
- Add an independently owned native test workflow.
- Update active user/project docs to explain installation, generated workflow ownership, and support evidence.

### Tasks

#### T2.1 — Initialize pinned cargo-dist release generation

**Description**

- Install cargo-dist 0.32.0 for the implementing developer from its official prebuilt release; do not add it as an application dependency.
- Run `dist init` and retain the current generated `dist-workspace.toml` plus `.github/workflows/release.yml` shape. Do not hand-edit dist-owned workflow output; express supported settings in dist config and rerun `dist init`.
- Allowlist `mdr` despite `publish = false`; configure exactly four targets, GitHub CI/hosting, shell and PowerShell installers, explicit SHA-256 checksums, normal `pr-run-mode = "plan"`, and host-phase GitHub attestations.
- Keep release archives/tool-managed installer names as generated; do not add custom build scripts, Homebrew, MSI, npm, updater, alternate hosts, or additional targets.
- Inspect generated workflow triggers and permissions. Expect tag-driven release creation plus PR planning, least privileges compatible with release upload and attestations, pinned cargo-dist version, Rust 1.91 from the repository toolchain, and native runner mapping for all four targets.
- Run `dist init` again after the final config and confirm generated files are current/idempotent.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `dist-workspace.toml` — new repository-owned release configuration, initially emitted and subsequently validated by `dist init`.
- `.github/workflows/release.yml` — dist-generated output; inspect but do not independently customize.
- `Cargo.toml` — release profile or metadata changes generated by `dist init`.
- `.gitignore` — generated local dist artifacts only if `dist init` requires an update.
- Cargo-dist 0.32.0 official docs/source — resolve any emitted schema difference in favor of the pinned tool's output.

**Dependencies**

- T1.1.

**Contract or shape**

```toml
[workspace]
members = ["cargo:."]

[dist]
cargo-dist-version = "0.32.0"
ci = ["github"]
packages = ["mdr"]
installers = ["shell", "powershell"]
targets = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
]
pr-run-mode = "plan"
checksum = "sha256"
github-attestations = true
github-attestations-phase = "host"
```

**Acceptance and verification**

- Run `dist plan`; expect one `mdr` release with exactly four target archives, shell/PowerShell installers, SHA-256 artifacts, manifest, GitHub hosting, and no excluded `publish = false` package.
- Run `dist build`; expect current-host archive/checksum output under dist's generated artifact directory, containing `mdr`, README/changelog/license as configured, with no source-tree residue.
- Rerun `dist init` followed by `git diff --exit-code` for generated files after committing/staging comparison in the implementation workflow; expect no drift.
- Inspect `.github/workflows/release.yml`; expect only generated behavior, no broad secret access, and no release trigger that can publish untagged `main` commits.

**Task-local risks**

- Official pages contain legacy Cargo-embedded config examples. Use the pinned 0.32.0 `dist init` output and current `dist-workspace.toml` schema; do not mix formats.

#### T2.2 — Add native project CI independent of cargo-dist

**Description**

- Add a small repository-owned CI workflow for pull requests and `main` pushes. Keep release publication exclusively in cargo-dist's generated workflow.
- Run formatting and clippy once on Linux. Run `cargo test --locked`, a release build, and the CLI's `--help`/`--version` smoke on available native Linux, Windows, and macOS runners. Exact four-target build/package proof belongs to cargo-dist T3.1 rather than a duplicate CI architecture matrix.
- Use repository-pinned Rust 1.91.0 and committed `Cargo.lock`. Keep permissions read-only, use bounded timeouts, and avoid third-party caches/services until build time demonstrates a need.
- Do not invoke a real browser in hosted CI, weaken the existing browser contract, or add production seams solely for CI. Existing semantic tests plus native release-binary help/version smoke are the automated boundary.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `.github/workflows/ci.yml` — new repository-owned quality/native test matrix.
- `rust-toolchain.toml` — authoritative toolchain/components.
- `tests/cli.rs`, `tests/render.rs`, `src/**` unit tests — behavior executed by the matrix.
- `.github/workflows/release.yml` — confirm responsibilities do not duplicate publication.

**Dependencies**

- T1.2, T2.1.

**Acceptance and verification**

- Validate workflow syntax and inspect the expanded matrix; expect at least one native Linux, Windows, and macOS job, with runner labels supported by GitHub at implementation time.
- Push the implementation branch/PR; expect formatting/clippy and all available native OS tests/release help/version smokes to pass, with the Unix-only symlink test intentionally absent on Windows through existing `cfg(unix)`.
- Confirm workflow token permissions are read-only and no job uploads/publishes a release.

**Task-local risks**

- Hosted runner labels and availability can change. Use current supported native OS runners and record architecture gaps; T3.1 remains authoritative for the four configured artifact builds.

#### T2.3 — Rewrite README for tool users and reconcile maintainer documentation

**Description**

- Rewrite README as a user-facing product page, not a repository development guide. Organize it around: what `mdr` does; installation on macOS/Linux and Windows; manual release download/verification; file and stdin usage; `--help`/`--version`; generated output/browser behavior; visible rendering capabilities; important input/security limitations; available downloads/support status; changelog; and MIT license.
- Use cargo-dist's generated shell and PowerShell commands and exact platform/artifact names from `dist plan`/T3.1. Explain that prebuilt installs require no Rust, while the full flow requires a graphical/default browser; Linux desktop opening depends on an available browser opener.
- Remove Cargo build/test commands, dependency/toolchain details, CI/cargo-dist setup, release-maintainer procedure, and internal qualification evidence from README. Keep those details in `PROJECT.md` and `RELEASING.md`; README may expose only concise user-relevant platform status.
- Keep **artifact available/build-tested** separate from **native-qualified** in a plain-language download/support table. Do not mark Windows, Linux, or Intel macOS qualified until T3.2 evidence exists.
- Preserve useful user-facing behavior currently documented under generated documents, code fences, images, and output flow, but shorten or reorganize implementation-heavy wording where it does not help installation or use.
- Update `PROJECT.md` so standard Cargo remains the local build/test interface while cargo-dist/GitHub Actions is the single release orchestration exception justified by this request. Replace active no-CI/no-release contradictions; retain historical plans/reviews untouched.
- Finalize `RELEASING.md` with exact generated commands/artifact names, repository-owned dist config versus generated workflow ownership, and the four-target scope. Link README only to user-relevant `CHANGELOG.md` and `LICENSE`; do not direct ordinary users through maintainer instructions.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `README.md` — user-only product overview, installation, usage, behavior/limits, downloads/support, changelog, and MIT license.
- `PROJECT.md` — development/build/test contract, CLI contract including version, release automation boundary, validation, target evidence, and product principles.
- `CHANGELOG.md`, `LICENSE` — user-facing release history and legal terms linked from README.
- `RELEASING.md` — maintainer-only release process and generated cargo-dist details.
- `dist-workspace.toml`, `dist plan` output — authoritative installer/artifact names and commands.

**Dependencies**

- T1.1-T1.3, T2.1-T2.2.

**Contract or shape**

```text
README audience and order:
1. Product purpose
2. Install on macOS/Linux, Windows, or manually
3. Use file/stdin/help/version
4. Understand output, features, and user-relevant limitations
5. Choose a platform download / understand support status
6. Changelog and MIT license

Excluded from README: Cargo development commands, tests, CI, cargo-dist configuration,
release tagging, maintainer checklists, dependency internals, and implementation evidence.
```

**Acceptance and verification**

- Follow README install/verify/usage commands as a new user against generated artifacts where hosting permits; expect correct OS/architecture selection, successful `mdr --version`, and no prerequisite Rust instructions.
- Search README for `cargo build`, `cargo test`, `cargo clippy`, `dist init`, workflow/PR/tag instructions, and contributor-oriented dependency/toolchain details; expect zero matches unless a narrowly justified user-facing source-build link was separately approved (none is planned).
- Confirm README answers what the tool does, how to install it, how to use file/stdin input, where output goes, why a browser is needed, what content is supported, and which downloads/statuses are available.
- Search active project docs for contradictory claims (`no GitHub Actions`, `only build interface`, `only macOS arm64`); expect historical matches only, while PROJECT/RELEASING own development/release details and README contains only user-facing status.
- Confirm no documentation claims signing/notarization, crates.io, package-manager support, or extra targets.

**Task-local risks**

- Installer URLs are invalid before the first hosted release. Label them as release-available commands and verify exact generated filenames during T3.1; do not fabricate URLs from memory. Moving developer content must not delete it—retain the authoritative gate in PROJECT/RELEASING.

### Risks, safeguards, and recovery

- **Risk:** Generated workflow drift, excessive token permissions, or an accidental tag publishes incomplete assets.
- **Safeguard:** Pin cargo-dist, keep release workflow generated, use `plan` by default, inspect permissions/triggers, run native CI separately, and prohibit tag creation during implementation.
- **Recovery:** Before publication, fix dist config and rerun `dist init`. If a workflow draft fails, delete only the incomplete draft release/artifacts after confirming no immutable release was published; never move a published tag.

### Phase validation and review

- **Checks:** Phase 1 gate; `dist init`; `dist plan`; current-host `dist build`; generated-file drift check; workflow syntax/permission/trigger review; hosted native CI; active-doc contradiction search; clean Git status excluding intentional plan/implementation files.
- **Review focus:** T2.1 package allowlist/targets/installers/attestation/ownership, T2.2 native coverage without browser test seams, T2.3 install accuracy and support-status honesty.
- **Exit and rerun:** Fix config rather than generated workflow, rerun `dist init`/`dist plan`, then native CI and documentation verification. Do not proceed to hosted artifact validation with generated drift or failed native tests.

## Phase 3 — Prove the release process without publishing, then hand off `v0.1.0`

### Problems addressed

- Local planning/building cannot prove all four hosted artifacts compile and package.
- cargo-dist does not automatically establish native browser behavior or support claims.
- A first immutable release needs a reviewed, recoverable operator boundary.

### Implementation summary

- Use cargo-dist's PR upload mode once to build all artifacts without a public release.
- Inspect/download the outputs and linkage evidence, then restore normal plan mode.
- Record qualification gaps and prepare—but do not push—the exact first-release handoff.

### Tasks

#### T3.1 — Run one non-publishing four-target cargo-dist dry run

**Description**

- On the setup PR only, change `pr-run-mode` from `plan` to `upload`, rerun `dist init`, and let GitHub build/upload the complete artifact bundle without creating a GitHub Release.
- Require the separate native CI workflow to pass first or in parallel; cargo-dist upload success never substitutes for tests.
- Inspect the cargo-dist plan and every build job, including macOS/Linux linkage reports and installer/global artifact jobs. Record exact archive names, sizes, target mappings, checksums, installer names, and skips.
- Download `artifacts.zip`; verify it contains exactly the four target archives, expected `mdr`/`mdr.exe`, shell/PowerShell installers, checksums, manifest, and no unrelated binaries/secrets.
- Return `pr-run-mode` to `plan`, rerun `dist init`, and require the final PR head to pass plan/native CI before merge.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `dist-workspace.toml` — temporary upload mode, final plan mode.
- `.github/workflows/release.yml` — regenerated at each mode change.
- GitHub Actions setup-PR runs and downloadable `artifacts.zip` — hosted evidence.
- `README.md`, `RELEASING.md` — exact artifact/installer names confirmed from evidence.

**Dependencies**

- Phase 2 complete; implementation branch pushed as a PR.

**Acceptance and verification**

- Setup PR upload run succeeds for all four targets; retain job URLs, target/result matrix, linkage summaries, and artifact inventory.
- Verify each `.sha256`/`sha256.sum` entry against downloaded files; expect no mismatch.
- Inspect archives; expect `mdr` on macOS/Linux and `mdr.exe` on Windows plus intended metadata only.
- Final committed config is `pr-run-mode = "plan"`; rerun `dist plan` and final PR checks successfully.

**Task-local risks**

- Upload mode is compute-heavy and PR artifacts are not a public installer host. Use it once for bootstrap/major release changes, do not document its temporary URLs for users, and restore plan mode before merge.

#### T3.2 — Record build-tested versus native-qualified targets

**Description**

- Treat successful native CI and cargo-dist packaging as **build-tested artifact availability** for the four configured targets.
- Preserve the existing full qualification gate: outside-repository file and stdin execution, representative fixture/assets, generated HTML inspection, actual default-browser `file://` opening, prompt exit, and no server/localhost behavior on the matching native desktop.
- Reuse existing macOS arm64 qualification evidence only after confirming the final release candidate has not materially changed runtime behavior; rerun when the release artifact or platform boundary changes.
- Perform available native desktop checks for Intel macOS, GNU/Linux x64, and Windows x64. Where access is unavailable, record the target as build-tested but unqualified in README/PROJECT/changelog/release handoff rather than blocking pipeline setup or claiming support.
- Inspect Linux linkage/glibc evidence and record the actual minimum compatible baseline; do not infer broad Linux compatibility from the target triple alone.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `tests/fixtures/documents/complete.md` and `tests/fixtures/documents/assets/**` — representative native smoke input.
- `README.md`, `PROJECT.md`, `CHANGELOG.md`, `RELEASING.md` — status/evidence records.
- cargo-dist/native CI job logs and downloaded artifacts — build-tested evidence.
- Platform-native browser/manual evidence — qualification boundary.

**Dependencies**

- T3.1.

**Acceptance and verification**

- Every configured target has a recorded build/test/package result and artifact checksum.
- Every target called qualified has matching native desktop file/stdin/browser evidence; unrun targets are explicitly labeled build-tested/unqualified.
- Linux documentation states the evidenced glibc/runtime baseline or leaves it unqualified; no unsupported distro claim remains.

**Task-local risks**

- Cross-platform compilation can create false confidence. Keep qualification wording evidence-based and make unsupported status visible in both user docs and the first release notes.

#### T3.3 — Prepare the first-release handoff and immutable-release gate

**Description**

- Update `CHANGELOG.md` for the approved release commit by moving relevant `Unreleased` entries into `## [0.1.0] - YYYY-MM-DD`; leave a fresh empty `Unreleased` section and correct comparison links.
- Run the release guide from a clean `main` candidate: all Cargo gates, exact CLI version, native CI, `dist plan --tag=v0.1.0`, generated drift check, artifact/qualification matrix, and changelog extraction review.
- Prepare the exact annotated-tag commands and expected GitHub release title/body/installers/artifacts. Do not create or push the tag until the owner approves the release notes, target statuses, and unsigned-artifact caveats.
- After a successful dry run and owner approval, enable GitHub immutable releases immediately before the first final publication if desired. Confirm cargo-dist's draft/upload/publish sequence remains compatible with the current setting.
- The eventual tag push must target the reviewed release commit. After cargo-dist publishes, verify all assets/checksums/installers, host-phase attestations with `gh attestation verify`, changelog-derived release prose, target status, and installer commands. If any final gate fails before publish, fix the release commit and use a new tag/version; never reuse a published immutable version.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `CHANGELOG.md`, `Cargo.toml`, `Cargo.lock` — exact `0.1.0` identity.
- `RELEASING.md` — complete operator checklist and commands.
- `dist-workspace.toml`, `.github/workflows/release.yml` — final current generated release path.
- GitHub repository release/immutability settings — owner-controlled operation.

**Dependencies**

- T3.1-T3.2. Explicit publication approval is a conditional hard gate for executing the tag/publish steps, not for preparing the handoff.

**Contract or shape**

```bash
git tag -a v0.1.0 -m "Release 0.1.0"
git push origin v0.1.0
```

**Acceptance and verification**

- Before any tag push, `Cargo.toml`, `Cargo.lock`, `mdr --version`, changelog heading, `dist plan --tag=v0.1.0`, and proposed tag all resolve to `0.1.0`.
- Owner approves release notes, qualification table, and unsigned-platform caveats in recorded implementation evidence; MIT metadata/text already passed T1.1.
- If publication is separately authorized, GitHub Release contains exactly the dry-run-approved artifact set, valid SHA-256 files, installer hints, changelog notes, and verifiable attestations; `main` and tag point to the reviewed commit.
- If publication is not authorized during implementation, deliver a clean ready-to-tag commit and exact remaining operator steps; no tag/release is created.

**Task-local risks**

- Immutable publication cannot be repaired in place. Treat owner approval and pre-tag equality/artifact checks as hard gates; recover with a new patch version, never by moving the tag.

### Risks, safeguards, and recovery

- **Risk:** Hosted builds pass while one desktop/browser flow fails, or a permanent release is published before evidence is complete.
- **Safeguard:** Separate build-tested/qualified states, use a non-publishing PR upload, require owner approval, and validate equality/artifacts before the tag.
- **Recovery:** Keep failed targets unqualified and fix forward. Before publication, regenerate/retest freely; after publication, issue a new SemVer patch and changelog entry.

### Phase validation and review

- **Checks:** Successful setup-PR native CI and cargo-dist upload; downloaded artifact/checksum inventory; final plan-mode regeneration; available native desktop smokes; exact `0.1.0` equality/changelog extraction; optional attestation/immutable-release verification only after explicit publication approval.
- **Review focus:** T3.1 no-publication dry run and artifact completeness, T3.2 evidence-backed support language, T3.3 irreversible publication gates and recovery.
- **Exit and rerun:** Disposition every failed target/artifact/installer/qualification check. Rerun affected hosted jobs and final full gate; do not weaken status language or reuse a published version.

## Final validation and review

- **Checks:** `cargo metadata --locked --no-deps --format-version 1`; `cargo fmt --check`; `cargo clippy --all-targets -- -D warnings`; `cargo test --locked`; `cargo build --release --locked`; exact help/version process tests; `dist init`; `dist plan --tag=v0.1.0`; current-host `dist build`; generated-file drift check; native CI matrix; one setup-PR upload run; downloaded archive/checksum inventory; documentation link/command/status review; `git diff --check`; clean residue/status review.
- **Review focus:** Full diff against this plan; license/version/tag/changelog consistency; no crates.io path; four exact targets; generated workflow ownership/permissions; CI versus dist responsibilities; installers/checksums/attestations; active-doc reconciliation; build-tested versus qualified evidence; no accidental release.
- **Evidence:** Complete diff, MIT metadata/text verification, cargo/dist outputs, native CI and cargo-dist job URLs, artifact/checksum/linkage inventory, available manual browser evidence, generated drift result, skipped qualification targets, release handoff, and explicit publication status.
- **Exit and rerun:** Fix accepted findings, rerun focused checks, regenerate dist-owned files, then rerun all repository/hosted gates affected. A fresh final review is required before any separately authorized immutable publication.

## Definition of Done

- Package metadata identifies `mdr` version `0.1.0`, the canonical repository/readme, `license = "MIT"`, and retained non-publication; canonical `LICENSE` text and copyright notice are included in release archives.
- `mdr -V` and `mdr --version` report the Cargo package version exactly and have no render/output/browser side effects.
- `CHANGELOG.md` and `RELEASING.md` provide human-curated release notes and a complete, recoverable maintainer process.
- Repository-owned cargo-dist 0.32.0 config and its generated workflow produce exactly four requested archives, shell/PowerShell installers, SHA-256 files, a manifest, and host-phase attestations; final PR mode is `plan` and generated workflow output has no drift.
- Native CI runs project tests and release help/version smoke on available Linux, Windows, and macOS runners independently of cargo-dist's exact four-target packaging.
- README is a user-only product/install/use guide with no developer or release-maintainer commands. PROJECT/RELEASING own development and release automation details; all active docs preserve unsigned-artifact caveats and distinguish build-tested from native-qualified platforms.
- One non-publishing setup-PR upload proves all configured hosted builds and artifact contents/checksums; every failure or skip is explicit.
- No public tag or GitHub Release is created without owner approval. The final handoff either verifies an explicitly authorized `v0.1.0` release or leaves a clean, exact ready-to-tag commit and operator checklist.
- Every task, decision, source-driven requirement, and accepted review finding is complete or explicitly deferred; code signing, package managers, extra targets, and unavailable native qualification remain named follow-ups rather than implied support.

# Implementation Progress

- **Template loaded from:** `implement-plan/assets/progress-tracker-template.md`
- **Plan:** `.plans/cross-platform-cargo-dist-releases.md`
- **Status:** `Complete`
- **Updated:** `2026-07-20T10:06:46Z`
- **Completion:** every requirement is `Verified` or user-approved `Descoped`; reconciliation, validation, and final review pass; no material issue remains open.

## Coverage

| ID | Plan reference and requirement | Dependencies | Status | Acceptance check | Evidence / notes |
|---|---|---|---|---|---|
| T01 | T1.1: set `0.1.0` package/repository/readme/MIT metadata while retaining `publish = false` | — | Verified | Locked Cargo metadata reports the exact contract | Parent inspected worker diff; metadata reports 0.1.0, canonical URLs, MIT, `publish=[]`, one `mdr` binary; no lock drift |
| T02 | T1.1: add canonical MIT `LICENSE`, update only root lock metadata, and ensure archive inclusion | T01 | Verified | License comparison, lock diff, built-archive inspection | Canonical text/copyright; root-only lock diff; final current-host archive byte-matches LICENSE/README/CHANGELOG and has only those plus `mdr` |
| T03 | T1.2: implement exact no-side-effect `-V`/`--version` selection without parser/dependency changes | T01 | Verified | Focused selector tests and manual command | Parent source inspection; unreadable-stdin selector test; exact `cargo run --quiet -- --version` output; no dependencies/seams |
| T04 | T1.2: add black-box help/version/strict-argument process coverage | T03 | Verified | `cargo test --test cli` verifies status/stdout/stderr | Parent full locked test rerun: 35 passed including 3 exact process tests; stderr/status/strict extra arg covered |
| T05 | T1.3: add human-curated Keep-a-Changelog structure and release comparison links | T01 | Verified | Heading/category/link inspection and tagged dist plan | Empty Unreleased plus dated 0.1.0 Added/status/caveats and links verified; tagged plan extracts exact human notes/title/install section |
| T06 | T1.3: add safe maintainer release-guide skeleton and link it from active project docs | T01 | Verified | Dry-read covers sync, gates, approval, recovery, and no obsolete commands | Final guide now owns exact dist/config/workflow/artifact/CI/upload/tag/attestation/recovery commands and retains explicit owner gate |
| T07 | T2.1: initialize pinned cargo-dist 0.32.0 config/generated workflow for exact package, targets, installers, checksums, attestations, and plan PR mode | T01 | Verified | Repeated `dist init`, workflow/config inspection, no generated drift | Official prebuilt 0.32.0 installed; exact four-target plan; shell/PowerShell/SHA-256/GitHub host attestations; repeated init hashes stable; `dist generate --check` passes; final PR mode plan |
| T08 | T2.1: prove local dist plan/build contents, archive metadata/license inclusion, and absence of source residue | T02,T07 | Verified | `dist plan --tag=v0.1.0`, current-host build, checksum/archive inventory | Plan has 4 archives/4 sidecars/2 installers/unified checksum/source assets; Mac arm build/linkage passed; sidecars verify; archive byte-matches metadata and `mdr 0.1.0`; only ignored target residue |
| T09 | T2.2: add read-only native Linux/macOS/Windows CI for fmt/clippy/tests/release help/version smoke without publication/browser invocation | T04,T07 | Verified | Workflow syntax/matrix/manual inspection and hosted checks when available | Earlier runs exposed/fixed Unix-only fixtures and a real Windows verbatim-path containment mismatch. Final CI run 29733175046 passed read-only quality plus locked tests/release/help/version on Linux, macOS, Windows; no browser/publication |
| T10 | T2.3: rewrite README exclusively for users with generated installers, manual verification, usage/behavior/limits, honest download qualification, changelog/license | T05,T08,T09 | Verified | Audience/content/contradiction searches and command review | Isolated worker `run-0fc93634-14a2-47d6-9c7b-b38ef791e3ca`; parent full read confirms exact commands/names, unpublished labels, no-Rust/browser/security/status truth, user-only audience; forbidden search clean |
| T11 | T2.3: reconcile PROJECT/RELEASING with Cargo development, generated release ownership, exact commands/artifacts, four targets, and superseded active constraints | T06,T07,T09 | Verified | Active-doc contradiction and ownership/command inspection | PROJECT owns Cargo/CI/dist exception and evidence states; RELEASING owns exact operations; active contradiction search clean; historical files untouched |
| T12 | T3.1: run one non-publishing setup-PR upload, inspect all hosted artifacts/checksums/linkage, then restore plan mode and regenerate | T08-T11 | Verified | Hosted run URLs/inventory plus final plan-mode diff and checks | PR #1 upload run 29732047224 passed 4 target/global jobs; host/announce skipped. Downloaded artifacts; sidecars/unified checksum, sizes/hashes, binaries+metadata, installer host/no-secret patterns verified. Final mode plan; run 29733175275 passed plan with build/host/announce skipped |
| T13 | T3.2: record build-tested versus native-qualified evidence for each target and Linux baseline without unsupported claims | T12 | Verified | Per-target build/package/checksum and native-desktop evidence matrix | README/PROJECT/CHANGELOG/RELEASING mark all 4 build-tested; only Mac arm qualified via reusable unchanged runtime evidence; others unqualified. Linux manifest: glibc 2.35 and system libc/libgcc_s/libm; no older baseline claim |
| T14 | T3.3: prepare exact `v0.1.0` changelog/tag/release handoff, equality checks, unsigned caveats, approval gate, and recovery; do not publish | T12,T13 | Verified | Clean-candidate release-guide run and ready-to-tag commands; no tag/release | Cargo/lock/CLI/changelog/tag plan all 0.1.0; title/body/installers/status/caveats extracted; annotated tag/recovery/approval documented; clean candidate head fe48803 and PR #1 checks pass; no tag/release exists |
| T15 | Final validation/reconciliation: run all local/hosted/manual gates, inspect complete diff/residue, and complete independent boundary/final reviews | T01-T14 | Verified | All applicable gates pass; every finding disposed; no pending/blocking row | Local/hosted/dist/artifact/doc gates pass; workflow residue cleaned; M01-M03 and final M04 found no material issues; 15/15 rows verified |

## Batches and evidence

| Batch / rows | Owner and delegation rationale | Scope / dependencies / join | Ownership / isolation / overlap | Acceptance and review checkpoint | Parent verification / terminal evidence / cleanup |
|---|---|---|---|---|---|
| B01 / T01-T06 | Isolated worker `run-0fb125e0-7385-4a61-bae7-d674dd486df6`; bounded coherent Phase 1 files/tests justified fresh-context implementation | Release identity, CLI contract, changelog, guide; foundational join before release automation | Herdr isolated worktree; worker owned Cargo/license/CLI/tests/changelog/guide/minimal PROJECT; parent edited only tracker until handoff, then byte-compared integration | Metadata; fmt; clippy; 35 locked tests; exact version; diff check; fresh review `run-f93db309-9a3a-4a69-a8a2-b7dce15b1a37` | Parent inspected full diff and reran all checks successfully; child handoff archived; clean worker worktree removed via Herdr; generated branch retained |
| B02 / T07-T09 | Researcher `run-6d21584b-f710-4893-9b58-fc921a327ed2` established 0.32.0 source contract; parent owned coupled config/generation/CI because first-run schema feedback and generated output required immediate iteration | cargo-dist generation plus separate CI after Phase 1 | Researcher read-only; parent sequentially owned dist config/Cargo generated profile/generated release workflow/repository CI; no writer overlap | Source evidence; init/generate/plan/build/archive/YAML checks; Phase 2 review | Parent inspected handoff and pinned output; generation stable; local upload/restore simulation passed; researcher cleaned; hosted CI remains T12 |
| B03 / T10-T11 | README-only worker `run-0fc93634-14a2-47d6-9c7b-b38ef791e3ca`; parent owned tightly coupled PROJECT/RELEASING integration against generated outputs | User and maintainer docs after exact plan/build | Worker owned only README in isolated worktree; parent concurrently owned non-overlapping PROJECT/RELEASING; byte-compared integration | Forbidden/contradiction/link/command/status checks; Phase 2 review | Parent read full README and guide/project diffs; child archived; clean worktree removed; generated branch retained |
| B04 / T12-T14 | Parent ownership: remote credentials, sequential upload→inspect→restore flow, status/doc integration, and publication gates are unsafe to delegate; user approved H02 | Hosted non-publishing proof, qualification evidence, ready-to-tag handoff after verified Phase 2 | Parent branch `chore/cross-platform-cargo-dist-releases`, PR #1; no tag/publication | Hosted native/upload evidence, artifact inventory, qualification update, fresh Phase 3 review | Run 29732047224 passed artifacts; CI exposed/fixed Unix literals and Windows URL containment. Final CI 29733175046 and plan run 29733175275 pass; redundant upload canceled; plan restored; M03 passed |
| B05 / T15 | Parent integration ownership (full-plan reconciliation cannot be safely partitioned) | Whole diff, all evidence, final cleanup and gate | Sequential fresh read-only final reviewer; tracker parent-only | Fresh full plan-backed review `run-7cbc3146-9e8a-42de-8b03-8fe5a281e8ab` | Parent reread plan, reconciled 15/15 rows, inspected diff/status, cleaned target/distrib and downloaded temp artifacts, verified all run/decision/review evidence; final reviewer recommended Complete with no material finding |

## Reviews and dispositions

| Review / covered rows | Boundary and scope | Method / run / evidence | Finding | Disposition and rationale | Fix or validation / rerun / one focused follow-up | Status |
|---|---|---|---|---|---|---|
| M01 / T01-T06 | Phase 1 public release identity/CLI/legal/operator contract | Fresh read-only code-review scout `run-f93db309-9a3a-4a69-a8a2-b7dce15b1a37`; authority matrix and four verdicts | None; no material S2+ finding or context concern | No disposition required; reviewer marked T02/T05 partial only for planned later evidence | Parent independently reran metadata/fmt/clippy/35 tests/version/diff; browser correctly N/A | Resolved |
| M02 / T02,T05-T11 | Phase 2 delivery/config/CI/documentation boundary | Fresh read-only code-review scout `run-b99d173c-387e-424e-9d3f-d6ed0395518d`; full config/generated workflow/docs and four verdicts | None; no material S2+ finding or context concern | No disposition required; T05/T09 correctly partial for dated notes/hosted execution | Parent independently ran dist/YAML/archive/search checks; reviewer confirmed publication gating and no scope creep | Resolved |
| M03 / T09,T12-T14 | Phase 3 hosted proof/qualification/handoff boundary | Fresh read-only code-review scout `run-a510724d-79e1-4300-acc1-348bd0dac669`; final code head fe48803 and four verdicts | None; no material S2+ finding or context concern | No disposition required; reviewer rated all Phase 3 rows complete | Parent supplied hosted/local/artifact evidence; reviewer checked Windows containment security, support language, plan restoration and owner gate | Resolved |
| M04 / T01-T15 | Final full-plan authority/quality/validation review | Fresh read-only code-review scout `run-7cbc3146-9e8a-42de-8b03-8fe5a281e8ab`; full diff, tracker, prior dispositions, local/hosted evidence | None; no material S2+ finding or context concern | No disposition required; reviewer approved 15/15 complete and all C01-C05/deviations proportional | Four verdicts pass at high confidence with explicit platform/publication limits; only administrative tracker reconciliation requested and completed | Resolved |
| C01 / PR review | Copilot comment 3613320860: upload mode would persist | GitHub PR review on temporary upload commit | Configuration concern | Reject as outdated: final `dist-workspace.toml` and generated workflow are restored to plan mode | Final plan run 29733175275 passed; build/host/announce skipped | Resolved |
| C02 / PR review | Copilot comment 3613320884: generated workflow root `contents: write` | GitHub PR review of cargo-dist output | Permission concern | Reject for this plan: pinned cargo-dist owns the workflow and exposes no supported config to narrow built-in jobs; hand-editing would violate generated ownership. Fork tokens are read-only, checkout credentials are not persisted, and host alone adds attestation/id-token scopes | `dist generate --check`; Phase 2/3 reviewers accepted generated permission/publication gates | Resolved |
| C03 / PR review | Copilot comment 3613320904: process test hardcodes 0.1.0 | GitHub PR review | Maintenance concern | Reject: exact 0.1.0 is an intentional release-identity equality gate; future releases must synchronize test/manifest/changelog/tag per RELEASING | Exact black-box tests pass all native OSes | Resolved |
| C04 / PR review | Copilot comment 3613320930: Unix CI smoke hardcodes 0.1.0 | GitHub PR review | Maintenance concern | Reject: exact candidate identity is intentional and must fail until a future release updates all coupled release artifacts | Linux/macOS final smoke passed | Resolved |
| C05 / PR review | Copilot comment 3613320956: Windows CI smoke hardcodes 0.1.0 | GitHub PR review | Maintenance concern | Reject: same intentional release-identity gate as C04, not an evergreen behavioral assertion | Windows final smoke passed | Resolved |

## Human-decision queue

| ID / source | Decision needed | Evidence and options | Scope / risk / complexity impact | Recommendation | Status / human answer |
|---|---|---|---|---|---|
| H01 / T3.3 | Whether to create/push `v0.1.0` and publish the first GitHub Release | Plan explicitly permits a ready-to-tag handoff when publication approval is absent | Irreversible public/possibly immutable release | Prepare handoff only during implementation | Resolved for this implementation: no publication approval requested or provided; no tag/release will be created |
| H02 / T3.1 | Authorization to push an implementation branch/open or update a setup PR for hosted upload validation | Local implementation, Phase 1/2 reviews, full Cargo gate, dist plan/build, local upload/restore simulation all pass; hosted four-target evidence still requires GitHub | External branch/PR mutation and CI compute; workflow is proven PR-nonpublishing; no tag/release | Approve branch push and setup PR so T09/T12-T14 can finish | Approved by user: “yes, go ahead” |

## Deviations

| Plan reference | Deviation / fallback | Reason and impact | Approval needed / received | Evidence |
|---|---|---|---|---|
| T2.1 config shape | Retain `packages = ["mdr"]` and also add generated-tool-required `[package.metadata.dist] dist = true` | Pinned 0.32.0 rejected the actual `publish = false` package with only the documented allowlist and explicitly instructed package opt-in; crates.io remains disabled and scope is unchanged | No; pinned-tool output is plan authority for schema differences | Initial `dist init`/verbose plan failure; success after opt-in; final plan selects only mdr |
| T3.1 artifact download wording | Inspect granular `artifacts-*` workflow downloads rather than assume one literal `artifacts.zip` | Generated 0.32.0 workflow uploads multiple named artifacts; PR remains non-publishing | No; generated names are authoritative | Version-matched template research, run artifact API, downloaded plan/local/global artifacts |
| T3.1 one-time upload | A test-fix push briefly queued a redundant second upload run; cancel it and restore plan immediately | First upload already passed; avoiding unnecessary compute preserves the one-time intent without losing evidence | No; operational cleanup | Release run 29732418171 canceled; final config/workflow regenerated in plan mode |

## Final reconciliation

- [x] Reread the full original plan; every actionable requirement maps to coverage rows.
- [x] No row is `Pending`, `In progress`, or `Blocked`; each `Verified`/`Descoped` row has required evidence/approval.
- [x] Every non-trivial batch records delegation consideration, ownership, dependencies/join, isolation/overlap, checks, and checkpoint.
- [x] Parent inspected delegated diffs/claims, reran applicable checks, resolved terminal states, and safely cleaned workflow resources.
- [x] Automated, integration, migration, browser/manual, rollout, and acceptance checks passed, or scope-relevant failures block.
- [x] Fresh reviews cover each major coherent boundary and the final full plan, or a direct fallback and limitation is recorded.
- [x] Every finding has a disposition; fixes/validation/reruns and at most one focused follow-up are recorded.
- [x] Human decisions, deviations, skips, confidence limits, and unrelated pre-existing failures are explicit.
- [x] Every change and added test directly supports a plan requirement; unnecessary complexity and adjacent scope were removed.
- [x] `Complete` is used only when all gates pass and no material issue or decision remains open.
