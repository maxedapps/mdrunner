# Code review: simplification and cleanup

## Review constraints

| Axis             | Selection                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Target           | Current committed repository at `7e8ed52`                                                                        |
| Baseline         | User-stated product: standalone Bun CLI, Markdown file or stdin, generate HTML, open it, exit; no GitHub Actions |
| Scope            | Simplicity, maintenance, tests, build tooling, and local orchestration residue                                   |
| Invocation       | Standalone cleanup review                                                                                        |
| Output           | Markdown report plus chat summary                                                                                |
| Dimensions       | Simplicity, tests, package/configuration, runtime boundaries                                                     |
| Validation/tools | Static inspection, tracked-file inventory, line counts, ignored/local artifact inventory                         |
| Writes/artifacts | Report only; no product changes                                                                                  |

## Summary

The runtime product is already small: `src/cli.ts` is 24 lines and `src/main.ts` is 51 lines. Most repository complexity is outside that path: 3,237 lines of tests, a 392-line multi-target build system, roughly 1,100 lines of planning/product specification, and retained subagent artifacts/worktrees.

The safest cleanup can remove planning/orchestration residue, redundant scripts/tests, unused renderer return metadata, and cross-target developer build behavior without changing the user-facing file/stdin workflow. The rich renderer itself should only be reduced after deciding whether Mermaid, static syntax highlighting, embedded local images, and strict SVG handling remain product requirements.

## Coverage

### Inspected

- All tracked-file names and current Git/worktree state.
- `package.json`, `bunfig.toml`, `tsconfig.json`, `.gitignore`.
- CLI/orchestration/browser/render/document/error boundaries.
- Source and test line-count distribution.
- Local `.plans`, `.progress`, `.subagents`, and mdrunner Herdr worktrees.

### Skipped or partial

- No source edits or post-cleanup runtime validation were performed.
- Rich renderer plugins were not reimplemented with `Bun.markdown`; removing those features requires an explicit product decision.

## Findings

### S2 Medium — Multi-target build surface exceeds the newly stated native-only product need

- **Dimension / authority:** Simplicity and package tooling; current user scope excludes CI and asks for a simple standalone Bun CLI.
- **Location:** `scripts/build.ts` (392 lines), `tests/unit/build.test.ts` (253 lines).
- **Impact:** Target selection, eight target mappings, libc detection, package metadata validation, and cross-platform replacement logic add a large maintenance surface unrelated to the visible CLI workflow.
- **Evidence:** The build subsystem is 645 lines plus tests; the only native-qualified artifact is Darwin arm64. Explicit target selection is not a product command.
- **Confidence:** C3 Confirmed.
- **Condition:** Deterministic under the newly stated scope, if releases only need native builds on the machine performing the build.
- **Smallest safe fix / validation:** Make `bun run build` native-only, retain only the literal Sätteri-addon bootstrap and staged output replacement, remove explicit target arguments/cross-build behavior, and validate one native standalone file/stdin smoke.

## Confirmed-good areas

- `src/cli.ts` and `src/main.ts` keep the user flow direct and server-free.
- Source validation, atomic output, opener argv safety, authored-content safety, and final static-document validation protect real boundaries and should not be deleted merely to reduce line count.
- No GitHub Actions files are committed on `main`.

## Cleanup candidates

### Safe without changing product behavior

1. Delete the unintegrated GitHub Actions/compiled-test draft in retained run `run-mrot6ggh-cb97f8c03a`.
2. Delete tracked `.plans/implement-mdrunner.md` after scope reconciliation.
3. Replace `PROJECT.md` with a concise README, then delete `PROJECT.md`.
4. Delete local `.progress/` and `.subagents/` after retaining any evidence still wanted.
5. Remove mdrunner-specific retained Herdr worktrees/branches after proving their integrated changes exist on `main`; do not force-delete dirty worktrees without that proof.
6. Reduce package scripts to the public/dev essentials: `dev`, `build`, `test`, `check`, and optionally `format`.
7. Remove coverage configuration/script if the user does not want coverage as a maintained gate.
8. Remove product-unused `RenderedMarkdown.frontmatter`, `RenderedMarkdown.data`, and `copyFrontmatter`; continue parsing frontmatter only if it should remain hidden from output.
9. Delete or consolidate redundant tests:
   - `tests/security/output-contract.test.ts` largely duplicates authored-content, orchestration, and no-server behavior.
   - `tests/integration/render-pipeline.test.ts` overlaps the representative complete-document and focused plugin suites.
   - Consolidate overlapping shell assertions between `tests/integration/document.test.ts` and `tests/integration/complete-document.test.ts`.
   - Reduce `tests/unit/main.test.ts` to ordering, success, pre-write failure, and post-write opener failure.

### Requires a feature decision

- If Mermaid, static highlighting, embedded local images, and strict SVG support remain required, keep the plugin/security modules and their focused adversarial tests.
- If the intended product is only Markdown-to-HTML, switch to Bun's built-in Markdown renderer and remove Sätteri, `satteri-expressive-code`, `beautiful-mermaid`, `fast-xml-parser`, `src/assets.ts`, and most `src/plugins/**`. This is the largest simplification but changes features and security behavior, so it should not happen implicitly.

## Limitations and caveats

- Eleven mdrunner Herdr worktrees are registered; most writer worktrees are dirty because changes were copied to `main` rather than committed in those worktrees. Cleanup must verify integration before removal.
- Other unrelated Herdr worktrees exist under the shared parent directory and must not be touched.

## Next steps

1. Confirm whether the rich rendering features remain required.
2. Apply zero-behavior cleanup first: discard the CI draft, remove planning/subagent residue, simplify scripts/docs/tests.
3. Simplify `scripts/build.ts` to native-only and rerun source plus standalone file/stdin smoke tests.
4. If rich features are out, replace the renderer in a separate, explicit simplification change.
