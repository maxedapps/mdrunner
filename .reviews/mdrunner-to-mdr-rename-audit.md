# Rename audit: `mdrunner` → `mdr`

## Review constraints

| Axis | Selection |
|---|---|
| Target | Current repository, active product surfaces, Git metadata, tracked history, ignored local artifacts, and likely external rename boundaries |
| Baseline | User requirement that the project is now named `mdr` |
| Scope | Naming only: package/binary/crate, runtime paths, source/tests/docs/config, repository/branch/remote identity, release/package surfaces, historical artifacts, and compatibility |
| Invocation | Standalone audit |
| Output | Markdown report plus summary |
| Validation/tools | Full tracked/hidden searches, Cargo metadata, Git refs/config/history, two independent read-only scouts, official GitHub rename documentation, and Cargo gates |
| Writes/artifacts | Initial audit was read-only except for this report; the requested follow-up then fast-forwarded `main` and updated the local remote URL |

## Summary

The **active product rename is already complete**. The package, library, executable, CLI help, runtime cache namespace, source, tests, fixtures, README, and project contract consistently use `mdr`. No active product file contains `mdrunner`, `md_runner`, or `md-runner`.

The repository-level follow-up is also complete: the canonical `maxedapps/mdr.git` URL resolves successfully, `origin` now uses it, and `main` was fast-forwarded by 12 commits to the completed Rust migration. The historically named migration branch remains available for optional cleanup after the push.

Do **not** bulk-replace old-name occurrences in plans, progress, reviews, subagent logs, reflogs, or commit history. They describe the former product and its migration, and the migration plan explicitly says to preserve prior plans/progress as project history.

## Rename disposition

### Completed after the audit

| Surface | Audit evidence | Follow-up result |
|---|---|---|
| Hosted repository name | The initial local `origin` identified `maxedapps/mdrunner.git` | The canonical `git@github-mschwarzmueller:maxedapps/mdr.git` URL resolves to the repository and the same default-branch HEAD. |
| Local Git remote | Initial `.git/config:11-13` used the old URL | `origin` was updated to `git@github-mschwarzmueller:maxedapps/mdr.git`. |
| Default branch integration | `feat/migrate-mdrunner-to-rust` was clean, synced, complete, and 12 commits ahead of `main` | `main` was fast-forwarded from `ae7d1b1` to `bcdba9b`, replacing the prior Bun implementation with the completed Rust implementation. The old term in the feature-branch name remains historically accurate; delete the branch after the push if no longer needed. |

GitHub documents that web and Git operations generally redirect after a repository rename, but warns that redirects stop if the old repository name is reused. Calls to a GitHub Action hosted in a renamed repository are not redirected. This repository contains no `.github` workflow/action surface. Source: <https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository>

### Conditional on prior external users or releases

Repository evidence does not establish whether `mdrunner` was distributed outside this checkout. `Cargo.toml:7` has `publish = false`, version is `0.0.0`, no tags exist, and there are no release scripts, package-manager formulas, install scripts, completion files, manpages, badges, or download URLs.

If users did receive the old command:

1. Add a short README migration note: command changed from `mdrunner` to `mdr`; scripts and PATH references must be updated.
2. Decide deliberately whether to ship a time-bounded `mdrunner` compatibility wrapper. No alias exists today, and none is needed when there were no external users.
3. Do not migrate generated output. The namespace intentionally moved from `<tmp>/mdrunner/...` to `<tmp>/mdr/...`; outputs are reproducible cache files. Optionally delete stale old cache data.
4. Inventory out-of-repository consumers: other clones, shell scripts, aliases, Homebrew/package manifests, release automation, webhooks, badges, bookmarks, and documentation links.

A local old cache currently exists at the OS temp root under `mdrunner/` (40 KB, one generated `README.html`). It is residue, not an active application dependency; deletion is optional and was not performed.

### Preserve as historical evidence

Tracked old-name occurrences total 28 and are confined to these historical artifacts:

- `.plans/implement-mdrunner.md` — 13 references to the former TypeScript product, symbols, executable, and cache path.
- `.plans/simplify-mdrunner-codebase.md` — 5 references to the former product and implementation.
- `.plans/migrate-mdrunner-to-rust.md` — 1 title reference describing the migration source.
- `.plans/migrate-mdrunner-to-rust.progress.md` — 1 link to that migration plan.
- `.reviews/simplification-cleanup-review.md` — 4 references in a historical cleanup assessment.
- Four old-name plan filenames.

Ignored `.progress/**` and excluded `.subagents/**` also contain former names and absolute paths from earlier work. Git branch logs, reflogs, and commit messages naturally preserve the old name.

The governing migration plan states at `.plans/migrate-mdrunner-to-rust.md:381-385` to update active docs while keeping prior plans/progress as history. Therefore:

- keep migration plans, trackers, review reports, commit messages, and reflogs unchanged;
- never bulk search/replace generated subagent transcripts;
- if a lean repository is desired, archive/delete obsolete plans and local orchestration artifacts as a separate history-cleanup decision rather than rewriting their content;
- `.reviews/simplification-cleanup-review.md:60-63` already identifies selective deletion/cleanup candidates, but the newer migration authority favors preservation unless explicitly requested.

## Confirmed complete active surfaces

| Surface | Evidence |
|---|---|
| Cargo package, implicit library, and executable | `Cargo.toml:2`; `Cargo.lock:736`; `cargo metadata` reports `mdr` library and binary targets |
| Built artifact | `target/release/mdr` is a macOS arm64 executable; no `mdrunner` path exists under `target/` |
| Runtime CLI name | `src/lib.rs:15`; manual `target/release/mdr --help` printed only `mdr` |
| Binary/library linkage | `src/main.rs:4` calls `mdr::run()` |
| Runtime output namespace | `src/output.rs:41-45` writes under `<tmp>/mdr/...` |
| Public docs and command examples | `README.md:1-19,77-85`; `PROJECT.md:1-9,68-84` |
| Tests and fixtures | `tests/render.rs:6`; `tests/fixtures/documents/complete.md:34`; no active old-name match |
| Generated HTML/CSS identifiers | `src/render.rs`, `src/code.rs`, and `src/styles.css` consistently use `mdr` prefixes |
| Local checkout directory | Repository directory basename is `mdr` |
| Neutral configuration | `.editorconfig`, `.gitignore`, and `rust-toolchain.toml` contain no old product name |
| Publishing/CI/release extras | No `.github/**`, package publication, release script, badges, repository URLs in docs, completions, manpage, or installer to rename |

## Findings

No material product-code findings. The active application and repository remote are consistently named `mdr`; only optional branch cleanup and a compatibility decision remain.

## Context-dependent concerns

- **Old command compatibility:** material only if `mdrunner` was previously distributed or automated externally. If not, no alias or migration layer should be added.
- **GitHub Pages/external integrations:** no repository evidence of Pages or Actions exists, but hosted settings and third-party integrations were not accessible. Check them during the GitHub rename if they exist.
- **Old GitHub name reuse:** do not create a new `maxedapps/mdrunner` repository if old URL redirects should remain valid.

## Validation

- **Run:** exhaustive case-insensitive tracked search for `mdrunner`, `md_runner`, and `md-runner` — 28 matches, all historical; zero in active code/docs/config/tests.
- **Run:** hidden/ignored search — old references occur in ignored progress and generated subagent history, not product surfaces.
- **Run:** Cargo metadata — package/library/binary targets are all `mdr`.
- **Run:** `cargo fmt --check` — passed.
- **Run:** `cargo clippy --all-targets -- -D warnings` — passed.
- **Run:** `cargo test` — 31 passed, 0 failed, 0 ignored.
- **Run:** `cargo build --release` — passed; produced `target/release/mdr`.
- **Run:** `target/release/mdr --help` — printed only the `mdr` command.
- **Run:** post-validation `git status --short` — clean before this report was created.
- **Run:** canonical `maxedapps/mdr.git` `ls-remote` probe — resolved successfully to the same repository HEAD as the redirected old URL.
- **Run:** `git merge --ff-only feat/migrate-mdrunner-to-rust` on `main` — fast-forwarded 12 commits from `ae7d1b1` to `bcdba9b` without conflicts.
- **Independent coverage:** two read-only scouts separately audited active code/build/runtime and docs/Git/history surfaces; both reached the same conclusion. Their runs were stopped cleanly with no retained resources.

## Limitations and caveats

- The canonical post-rename Git URL was verified, but hosted GitHub settings, Pages settings, webhooks, and private external consumers were not authenticated or inspected.
- Git object history was not rewritten or exhaustively content-scanned because historical occurrences are expected and should remain immutable.
- No real browser render smoke was repeated because the audit concerns naming; the full build/test gate and executable help surface were validated.

## Next steps

1. Optionally delete the merged local/remote migration branch after the `main` push is confirmed.
2. Confirm whether any external `mdrunner` users/releases existed; only then add migration documentation or a temporary compatibility wrapper.
3. Optionally remove the local old temp cache and separately decide whether obsolete planning/orchestration history should be archived or deleted—not rewritten.
