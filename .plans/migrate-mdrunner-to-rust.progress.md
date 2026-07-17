# Implementation Progress

- **Template loaded from:** `implement-plan/assets/progress-tracker-template.md`
- **Plan:** `.plans/migrate-mdrunner-to-rust.md`
- **Status:** `Complete`
- **Updated:** `2026-07-17T14:48:01Z`
- **Completion:** every requirement is `Verified` or user-approved `Descoped`; reconciliation, validation, and final review pass; no material issue remains open.

## Coverage

| ID | Plan reference and requirement | Dependencies | Status | Acceptance check | Evidence / notes |
|---|---|---|---|---|---|
| T1.1 | Phase 1: Rust 2024/Cargo/MSRV project, lean CLI, strict file/stdin source acquisition and help/errors | — | Verified | `cargo test source`; fmt; clippy | Parent inspected `8b8b402`; fmt/clippy and 16 Rust tests passed; source tests cover required cases. |
| T1.2 | Phase 1: one-pass Comrak GFM/frontmatter render, title/headings/links, inert HTML, complete static shell/CSP/CSS | T1.1 | Verified | `cargo test render`; semantic shell assertions | Parent verified GFM/frontmatter/title/links/inert HTML/static shell; M01 no material findings. |
| T1.3 | Phase 1: deterministic portable cache path, atomic persist, file URL/browser boundary, print/open ordering | T1.1–T1.2 | Verified | `cargo test output`; complete Rust and Bun phase gate | Parent verified output/browser code; Rust 16/16 and Bun 204/204 passed; real opener deferred to T3.1. |
| T2.1 | Phase 2: curated Lumis highlighting and bounded title/line metadata with trusted static generated HTML | Phase 1 | Verified | focused code tests; clippy | Parent inspected `78e08ad`; curated features/parser/static output tests passed; M02 complete. |
| T2.2a | Phase 2: native strict Mermaid SVG with source-aware failures and no SVG validation | T2.1 | Verified | six-family and malformed Mermaid tests | Representative fixture produced six SVGs; renderer-native malformed case is source-aware; no SVG validator dependency/path. |
| T2.2b | Phase 2: contained local image embedding/data URIs and safe remote passthrough | T2.1 | Verified | focused asset/path tests for all formats and bases | Five formats, nested encoded paths, stdin base, passthrough, containment and source-context tests passed. |
| T2.3 | Phase 2: representative semantic suite, final product-owned responsive/light/dark/print styles, malformed-input boundary | T2.1–T2.2b | Verified | `cargo test`; fmt; clippy; release build; Bun check | Parent reran fmt/clippy, Rust 30/30, release build, Bun 204/204; M02 found no material findings. |
| T3.1 | Phase 3: native release file/stdin smoke outside repo and agent-browser `file://` inspection; record only tested target | Phase 2 | Verified | retained HTML paths, prompt exit, visual/network/console evidence, binary hash/size | macOS arm64 release 30,459,840 bytes, SHA-256 `fc0d7345…`; outside-repo file 0.76s and stdin 0.21s, exact retained paths, no mdr process. Agent-browser exact `file://`: 6 visible SVGs, local images loaded, light/dark/mobile responsive, print rule, 0 scripts/console/page errors, no localhost requests. |
| T3.2a | Phase 3: remove Bun/TypeScript/N-API runtime, build/config/tests, obsolete artifacts/selectors while retaining fixtures/history | T3.1 | Verified | legacy/dependency search; intentional Git inventory | `50cf300` deleted 40 legacy files; parent removed untracked legacy `dist/` and `node_modules/`; active legacy/.ts/obsolete path counts zero; fixtures/styles/history retained. |
| T3.2b | Phase 3: update README/PROJECT/.gitignore for Rust workflow, behavior, cache/browser/no-server policy and tested target | T3.1 | Verified | documentation inspection plus final checks | Parent inspected README/PROJECT/.gitignore; Cargo behavior/policies and only macOS arm64 qualification documented; M03 complete. |
| V1 | Final validation: fmt, clippy, tests, release build, file/stdin smoke, browser/manual evidence, legacy search, clean residue | T3.2a–T3.2b | Verified | all exact final gates pass | Post-cutover fmt/clippy, Rust 30/30, release build, file/stdin smoke (1.02s/0.38s), 0 mdr processes, exact `file://` mobile/dark browser check, 6 SVGs, 2 loaded local images, print rule, 0 scripts/errors/localhost, all legacy counts zero, target/smoke/output artifacts removed, Git clean. |
| V2 | Final reconciliation and fresh plan-backed full read-only review; disposition every finding | V1 | Verified | no open rows/findings/decisions; tracker complete | Full plan reread found no missed row; fresh MF `run-mrp1vz8e-5dd2a5dccc` found no material S2+ findings, 24/24 complete, no unsupported row/missed requirement, and four pass verdicts. |

## Batches and evidence

| Batch / rows | Owner and delegation rationale | Scope / dependencies / join | Ownership / isolation / overlap | Acceptance and review checkpoint | Parent verification / terminal evidence / cleanup |
|---|---|---|---|---|---|
| B01 / T1.1–T1.3 | Isolated worker `run-mrozoihu-66dec80e27`; bounded additive Rust foundation benefited from focused implementation while parent retained tracker/integration | Phase 1 CLI/source → render → output/browser, joined after complete handoff | Worker owned eight additive Rust/Cargo files in isolated worktree; existing TS/CSS retained; commit `962dc499`, cherry-picked as `8b8b402` | Focused tests, fmt, clippy, full Cargo and Bun phase gates; M01 | Parent inspected complete diff and reran fmt/clippy/Rust 16/Bun 204; M01 no findings. Worktree cleanup retry blocked by absent terminal snapshot; retained live=false. |
| B02 / T2.1–T2.3 | Isolated worker `run-mrp0815a-7d60cad964`; rows shared Comrak code-block formatting, assets, styles, and representative tests | Phase 2 static code → Mermaid/images → semantic suite on verified Phase 1 | Worker owned ten Cargo/Rust/CSS/test files; child `73361b88`, parent `78e08ad`; no tracker/legacy edits | Focused tests, fmt, clippy, full Cargo, release build, Bun check; M02 | Parent inspected complete diff and reran fmt/clippy/Rust 30/release/Bun 204/audits; M02 no findings. Worktree cleanup retry blocked by absent terminal snapshot; retained live=false. |
| B03 / T3.1–T3.2b | Parent owned T3.1 real browser/process smoke; isolated writer `run-mrp1ass0-e76df7b6f5` owned legacy cleanup/docs after release evidence | T3.1 passed before destructive T3.2 cutover | Writer changed docs/ignore and deleted legacy files only; child `e4846f1`, parent `50cf300`; Rust/Cargo/styles/fixtures/history unchanged | Release/manual gate, final Rust checks, legacy search, M03 | Parent inspected diff, removed obsolete untracked legacy directories, reran Cargo 30/release and zero-count searches; M03 no findings. Writer worktree cleanup blocked by absent terminal snapshot; retained live=false. |
| B04 / V1–V2 | Parent final gates/reconciliation plus mandatory fresh read-only final reviewer | Full-plan reconciliation after cutover | Read-only reviewer; tracker parent-owned; no source writer overlap | Complete final gate and MF | Parent reran all post-cutover gates, cleaned owned artifacts, reread full plan; MF `run-mrp1vz8e-5dd2a5dccc` no findings/24 of 24 complete. |

## Reviews and dispositions

| Review / covered rows | Boundary and scope | Method / run / evidence | Finding | Disposition and rationale | Fix or validation / rerun / one focused follow-up | Status |
|---|---|---|---|---|---|---|
| M01 / T1.1–T1.3 | Phase 1 public CLI/render/output contract | Fresh read-only `run-mrp045io-7025c43807`; full changed source/config, plan, tracker, legacy contracts, parent gates | No material S2+ findings; 14/14 implementation matrix requirements complete | Reject none; no findings required disposition. Administrative tracker row completed here. | No fixes; parent gates already passed. Real browser remains correctly deferred to T3.1. | Resolved |
| M02 / T2.1–T2.3 | Phase 2 renderer/security boundary and representative parity | Fresh read-only `run-mrp10z1j-39d962e8dc`; all changed code/config/CSS/tests, authority, fixtures, legacy references, parent gates | No material S2+ findings; 16/16 applicability requirements complete | No finding dispositions required. Public test renderer noted as broader than strictly necessary but below material gate. | No fixes; parent fmt/clippy/Rust 30/release/Bun 204 and audits passed. | Resolved |
| M03 / T3.1–T3.2b | Release cutover and cleanup boundary | Fresh read-only `run-mrp1pcd0-37a8fbf2fc`; current Rust-only tree, authority, docs/config/runtime/tests/fixtures, parent smoke/Cargo/search evidence | No material S2+ findings; 20/20 applicability requirements complete | No findings required disposition; reviewer noted non-material self-contained/remote-image wording is clarified nearby. | No fixes; parent had independently inspected diff and rerun gates. | Resolved |
| MF / all | Final full plan and complete current tree | Fresh read-only `run-mrp1vz8e-5dd2a5dccc`; full authority/tracker/source/tests/Cargo/docs/config/fixtures and final parent evidence | No material S2+ findings; 24/24 Complete; no unsupported tracker row or missed actionable requirement; all four verdicts Pass | No findings required disposition; malformed-fixture deviation explicitly validated as compliant. | No fixes/follow-up; final gate already passed. | Resolved |

## Human-decision queue

| ID / source | Decision needed | Evidence and options | Scope / risk / complexity impact | Recommendation | Status / human answer |
|---|---|---|---|---|---|

## Deviations

| Plan reference | Deviation / fallback | Reason and impact | Approval needed / received | Evidence |
|---|---|---|---|---|
| T2.3 malformed fixture wording | Existing `tests/fixtures/documents/malformed-mermaid.md` is accepted by `render_strict` 0.3.1; use a different renderer-native malformed Mermaid input in `tests/render.rs` instead of adding a compatibility preflight. | Preserves the explicit native-renderer/no-preflight decision while still proving source-aware failure before persistence. No user-visible contract loss. | No approval needed; follows higher-specificity renderer-native decision in plan. | `tests/render.rs::malformed_mermaid_reports_the_fence_line_before_any_persistence_boundary`; 30 tests pass. |

## Final reconciliation

- [x] Reread the full original plan; every actionable requirement maps to coverage rows.
- [x] No row is `Pending`, `In progress`, or `Blocked`; each `Verified`/`Descoped` row has required evidence/approval.
- [x] Every non-trivial batch records delegation consideration, ownership, dependencies/join, isolation/overlap, checks, and checkpoint.
- [x] Parent inspected delegated diffs/claims and reran applicable checks. All runs are stopped/live=false; three integrated writer worktrees are retained because Herdr safe cleanup lost their terminal snapshots, and are explicitly reported rather than unsafely removed.
- [x] Automated, integration, migration, browser/manual, rollout, and acceptance checks passed.
- [x] Fresh reviews cover each major coherent boundary and the final full plan.
- [x] Every review returned no material finding; no fix/follow-up disposition was required.
- [x] Human decisions, the malformed-Mermaid deviation, skips, confidence limits, and retained workflow resources are explicit.
- [x] Every change and added test directly supports a plan requirement; unnecessary legacy/validator/build complexity was removed.
- [x] `Complete` is used only after all implementation gates and reviews passed with no material issue or decision open.
