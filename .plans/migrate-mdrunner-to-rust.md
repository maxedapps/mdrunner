# Migrate mdrunner to a lean Rust CLI

> **Status:** Ready for implementation
> **Planning memory:** Included in this plan

## Problems

- The current product is a standalone Bun/TypeScript executable whose runtime path is simple, but packaging still depends on Bun, Sätteri's platform N-API addon, a custom 306-line build script, and JavaScript renderer dependencies.
- A Rust rewrite must preserve the visible file/stdin → finished HTML → `file://` browser flow without recreating the current plugin framework, dependency-injection seams, SVG validators, final-document validator, or cross-target build machinery.
- Syntax highlighting and Mermaid rendering will intentionally change implementations. Exact Expressive Code/Shiki markup and beautiful-mermaid SVG are therefore unsuitable compatibility targets; the migration needs semantic tests for the user-visible result.
- The current repository has no Cargo project. Rust must coexist with the working Bun implementation until the release binary passes the representative contract, then replace the old toolchain in one explicit cutover.

## Implementation summary

- Add a synchronous Rust 2024 binary named `mdr`, pinned to Rust 1.91 because Lumis 0.12 requires it.
- Keep the runtime linear: read source → parse/prepare Comrak AST → render code with Lumis and Mermaid with `mermaid-rs-renderer` → assemble one inline-CSS HTML document → atomically persist it → print the path → open its `file://` URL with `webbrowser` → exit.
- Use one AST preparation pass and a small code-block renderer. Do not introduce async, a plugin framework, a web server, a watcher, runtime JavaScript, generic sanitizers, XML/SVG parsing, or speculative portability abstractions.
- Keep the Bun implementation available through Phases 1–2 as the behavioral reference. Remove it only after Rust source tests, representative rendering, release build, and manual local-file browser validation pass.

## Conducted research and relevant sources

| Source or artifact | Material finding | Plan impact |
|---|---|---|
| `src/cli.ts:14-25` | Current control flow is read → render → write → print → open. The completed path is printed before opener failure. | Preserve this exact linear order in `main.rs`; no orchestration framework. |
| `src/source.ts` and `tests/unit/source.test.ts` | File input wins over redirected stdin; input is strict UTF-8; file paths are canonical; no-argument interactive input and empty stdin fail. | Port these visible input rules with `std::io::IsTerminal` and direct filesystem/stdin reads. |
| `src/render.ts`, `src/plugins/*`, and `src/document.ts` | The current pipeline provides GFM/frontmatter, title/headings, local assets, code, Mermaid, and a complete static shell. | Replace the plugin chain with one Comrak AST pass plus bounded code-block rendering. |
| `src/output.ts`, `src/browser.ts`, and their unit tests | Output identity is deterministic and completed before opening; the CLI opens a local file and never starts a server. | Use `tempfile::NamedTempFile::persist`, `Url::from_file_path`, and `webbrowser::open`. |
| `tests/integration/complete-document.test.ts` and `tests/fixtures/documents/complete.md` | One representative fixture already crosses the important product behavior. | Reuse the fixture and port semantic assertions instead of snapshotting renderer-owned HTML/SVG. |
| `tests/security/authored-svg.test.ts`, `tests/security/mermaid.test.ts`, and `tests/integration/document.test.ts` | Much of the current test/code surface protects SVG and final-output validators that are explicitly out of scope for the rewrite. | Delete those validators and their validator-specific tests at cutover; retain only observable static-output assertions. |
| [Comrak 0.54](https://docs.rs/comrak/0.54.0/comrak/) | Mutable AST, GFM/frontmatter options, source positions, code-block info strings, safe HTML rendering, and custom formatter hooks are available. `SyntaxHighlighterAdapter` alone does not receive fence metadata. | Disable default features; use an AST pass and a small code-block formatter rather than the Syntect adapter. |
| [Lumis 0.12](https://docs.rs/lumis/0.12.0/lumis/) | Static multi-theme HTML, explicit language feature flags, plaintext fallback, line formatting, and custom formatter support are available. All languages are enabled by default. | Disable defaults, enable a curated language list, use GitHub light/dark themes, and locally parse only the supported fence metadata. |
| [mermaid-rs-renderer 0.3.1](https://docs.rs/mermaid-rs-renderer/0.3.1/mermaid_rs_renderer/) | `render_strict` synchronously returns SVG or a parse error; default features include unneeded CLI/PNG support. | Disable defaults, call `render_strict`, wrap its error with the Markdown fence location, and trust the returned SVG without another validation pass. |
| [tempfile `NamedTempFile::persist`](https://docs.rs/tempfile/latest/tempfile/struct.NamedTempFile.html#method.persist) | A named file created in the destination directory can atomically replace the destination. | Replace the custom Bun/Windows publication code with write-all → persist; do not add crash-durability fsync machinery. |
| [webbrowser](https://github.com/amodm/webbrowser-rs) and [`Url::from_file_path`](https://docs.rs/url/latest/url/struct.Url.html#method.from_file_path) | `webbrowser` directly invokes the platform browser for local files; it exposes no server/listener. Its `hardened` feature rejects `file://`. | Keep `hardened` disabled, open the absolute output URL, and exit immediately after successful invocation. |

- **Exploration/research lanes:** Read-only local lane `run-mroyqj8f-486c3f9683` mapped current source, tests, fixtures, build targets, and the minimal migration sequence. Read-only external lane `run-mroyql66-1f6e9eae08` verified current crate versions, MSRV, Comrak code-fence boundaries, Lumis features, Mermaid APIs, atomic persistence, and browser behavior.
- **Parent verification:** The parent rechecked the current source/configuration, confirmed Git was clean before planning, and ran `bun run check`: formatting, lint, typecheck, and all 204 Bun tests passed. The parent rejected the research lane's suggestion to retain generated-SVG validation because the user explicitly excluded it, and rejected socket-inspection tooling as disproportionate to a CLI whose selected APIs contain no server path.

## Scope and non-goals

- **In scope:** Rust Cargo project; file/stdin CLI; strict UTF-8; GFM and hidden YAML/TOML frontmatter; deterministic title/headings; inert authored HTML; safe local/remote links; local image data URIs; Lumis static code with light/dark themes, titles, and line markers; native Mermaid SVG; complete inline-CSS HTML; deterministic atomic temp output; direct `file://` browser opening; release binary tests; documentation; removal of Bun/TypeScript after parity.
- **Non-goals:** Exact byte/DOM parity with Sätteri, Expressive Code, Shiki, or beautiful-mermaid; SVG validation or sanitization; final-document re-parsing/validation; image magic-byte checks or TOCTOU/no-follow machinery; server/watch/live-reload modes; runtime JavaScript; generic plugin/DI frameworks; configurable themes/language packs; hosted CI; release signing/notarization; custom cross-compilation/build orchestration.

## Decisions and constraints

| Approach or constraint | Result | Reason and consequence |
|---|---|---|
| Semantic compatibility, not renderer-markup compatibility | Chosen | Rust renderers necessarily produce different spans/SVG. Tests protect visible behavior and static output, not third-party serialization. |
| `comrak = 0.54`, `default-features = false` | Chosen | Mutable AST and formatter hooks fit the small number of structural transforms without an event-state machine or bundled Syntect. |
| `lumis = 0.12`, `default-features = false` | Chosen | It is actively maintained and directly supports static light/dark HTML. Rust 1.91 becomes the project MSRV. |
| Curated Lumis languages | Chosen | Enable Bash, C, C++, C#, CSS, Go, HTML, Java, JavaScript, JSON, Python, Ruby, Rust, SQL, TOML, TSX, TypeScript, and YAML. Explicit unknown labels render as plaintext; do not auto-detect them. |
| Minimal fence metadata grammar | Chosen | Support `title="..."`, `{line-ranges}`, and `ins={line-ranges}` where ranges are comma-separated numbers or `N-M`. Do not support additional Expressive Code syntax. |
| `mermaid-rs-renderer::render_strict` with native capabilities | Chosen | Do not maintain the old six-family parser gates. Keep the six existing fixtures as regressions, allow other renderer-supported families, and use renderer-native errors wrapped with source location. |
| No SVG validation | Confirmed | Authored SVG stays in an `<img>` data URI; dependency-generated Mermaid SVG is trusted inline output. Remove `quick-xml`/XML policy and associated tests. |
| Simple image containment | Chosen | Canonicalize the source base and target and require the target to remain under the base. Do not add signature sniffing, repeated metadata checks, or no-follow platform code. |
| Comrak-owned heading anchors where practical | Chosen | Prefer Comrak's deterministic anchorizer/header IDs. Preserve title precedence, but do not recreate byte-exact legacy slug suffixes unless a user-visible failure demands it. |
| `tempfile::persist` instead of custom replacement code | Chosen | It provides completed-file atomic visibility with far less code. Crash-durability synchronization is out of scope. |
| Simple portable output names | Chosen | Replace forbidden/control characters, trim trailing dots/spaces, and fall back to `document` for empty or Windows-reserved stems. Preserve Unicode; omit NFC normalization and byte-length truncation unless an observed platform failure requires them. |
| `webbrowser::open(file://...)` | Confirmed | It invokes the default browser without a server. No custom macOS/Linux/Windows opener layer is needed. |
| Standard Cargo builds only | Chosen | Build natively with `cargo build --release`. Do not recreate the eight-target Bun mapping or add cross-build tooling; qualify only release targets on which the release smoke is actually run. |
| Keep Bun until Rust release smoke passes | Chosen | The existing implementation remains a working rollback/reference during migration; removal is delayed to the final phase. |

## Plan review

- **Reviewer:** Fresh read-only run `run-mroz9a9z-fc62a24033` reviewed the full draft, current runtime/output/browser code, representative tests, existing plans, and the stated simplicity constraints.

| Finding | Parent evaluation | Disposition | Plan change or user decision |
|---|---|---|---|
| Add a black-box Rust CLI suite with platform opener shims to protect print/open/error ordering. | The lifecycle matters, but `webbrowser` uses macOS Launch Services and Windows association APIs rather than the current PATH-invoked commands. Portable interception would require a production opener seam or platform-specific test machinery. The six-line orchestration is already covered by focused component tests and the required real release smoke. That extra abstraction conflicts with the explicit lean goal. | Reject | Keep component tests plus T3.1's actual browser/open/exit validation; do not add dependency injection solely for tests. |
| Define portable deterministic output-name behavior rather than leaving `<portable-name>` ambiguous. | Confirmed by `src/output.ts` and `tests/unit/output.test.ts`. Raw stems can be invalid on Windows, but exact NFC/byte-truncation parity is unnecessary. | Accept | Decisions and T1.3 now specify a small Windows-safe sanitizer and focused cases without legacy hash/snapshot coupling. |

- **Focused follow-up:** Not needed. The accepted change is a narrow contract clarification and does not alter architecture or reopen scope.

## Phase 1 — Working synchronous Rust CLI and core Markdown document

### Problems addressed

- There is no Rust project or executable path.
- Input, Markdown, output, and browser behavior need a small end-to-end foundation before renderer-specific work.

### Implementation summary

- Add a Cargo binary beside the still-working TypeScript implementation.
- Deliver a complete but initially unenhanced GFM document through the real cache and `file://` path.
- Keep modules limited to boundaries with distinct behavior: source, render, output, and browser.

### Tasks

#### T1.1 — Add the minimal Cargo project and source acquisition

**Description**

- Add `Cargo.toml`, committed `Cargo.lock`, and `rust-toolchain.toml` pinned to Rust 1.91. Use package/binary name `mdr` and edition 2024.
- Add `src/main.rs` with direct argument handling and a small error type/display path. Accept `-h`/`--help`, exactly one case-insensitive `.md` path, or redirected stdin. A file argument wins over stdin.
- Add `src/source.rs` with strict UTF-8 decoding, canonical file context, stdin current-directory context, regular-file checks, and empty/interactive-stdin failure. Do not add Clap or async.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `package.json` — current command name and input behavior reference.
- `src/cli.ts`, `src/source.ts` — current orchestration/source contract.
- `tests/unit/source.test.ts`, `tests/cli/cli.test.ts` — cases to port semantically.
- Create `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `src/main.rs`, `src/source.rs`, and focused Rust tests.

**Dependencies**

- None.

**Contract or shape**

```text
mdr <file.md>  → canonical file source
cat file.md | mdr → stdin source rooted at current directory
mdr with terminal stdin → concise usage error; never wait indefinitely
```

**Acceptance and verification**

- Input behavior — run `cargo test source`; expect help, argv, extension, strict UTF-8, file precedence, symlink/canonical path, empty stdin, and error-format cases to pass.
- Toolchain — run `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`; expect zero findings on the new Rust surface.

**Task-local risks**

- Rust and TypeScript share `src/`; Cargo ignores `.ts`, so coexistence is safe. If module naming becomes unclear, move only Rust implementation to `src/` and leave TypeScript untouched until cutover rather than creating a workspace.

#### T1.2 — Render the core GFM document with Comrak

**Description**

- Configure Comrak 0.54 without default features for tables, task lists, strikethrough, autolinks, footnotes, and YAML/TOML frontmatter selected from the leading delimiter.
- Parse once, traverse once to capture the first H1 title and rewrite local links relative to the source base, then format with authored raw HTML escaped. Use first H1 → file stem → `Markdown document` title precedence.
- Use Comrak-owned heading anchors unless implementation evidence shows they collide with generated footnote IDs; solve only an observed collision.
- Add `src/render.rs` and assemble the complete HTML5 shell with `include_str!("styles.css")`, escaped title, viewport metadata, CSP, and semantic `<main>`. Do not add a final validator.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `src/render.ts`, `src/plugins/safety.ts`, `src/plugins/headings.ts`, `src/document.ts`, `src/styles.css` — current behavior and reusable CSS.
- `tests/integration/markdown.test.ts`, `tests/integration/document.test.ts` — semantic cases to port and validator-only cases to omit.
- Create `src/render.rs` and Rust render/document tests; retain `src/styles.css` as the embedded stylesheet.

**Dependencies**

- T1.1.

**Contract or shape**

```text
Markdown → one Comrak AST → one preparation pass → one HTML fragment → fixed inline-CSS shell
```

**Acceptance and verification**

- Markdown behavior — run `cargo test render`; expect GFM, hidden YAML/TOML frontmatter, first-H1/fallback title, deterministic heading IDs, inert authored HTML, local/remote links, and deterministic output assertions to pass.
- Static shell — assert doctype, metadata, CSP, inline CSS, light/dark/print rules, and absence of scripts/runtime imports; do not snapshot the full document.

**Task-local risks**

- Comrak heading IDs differ from the old slugger. Treat deterministic usable anchors as the contract; only add custom slug code if representative Markdown demonstrates a material regression.

#### T1.3 — Persist and open the finished local file

**Description**

- Add `src/output.rs` with the current cache shape: `<temp>/mdr/<sha256>/<portable-name>.html`; hash canonical file path for file input and cwd + NUL + Markdown for stdin.
- Derive `<portable-name>` with one small cross-platform sanitizer: replace control characters and `<>:\"/\\|?*`, trim trailing dots/spaces, and use `document` when the result is empty or a case-insensitive Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`). Preserve other Unicode; do not add normalization or byte-truncation logic.
- Create the destination directory, write the complete HTML to `NamedTempFile::new_in`, then `persist` over the deterministic destination. Do not add fsync, backup/restore, queues, or platform-specific filesystem abstractions.
- Add `src/browser.rs` that converts the absolute output path with `Url::from_file_path` and calls `webbrowser::open` with `hardened` disabled.
- Wire `main.rs`: render → persist → print path → open browser. Failures before persist print no path; opener failure retains the already printed file.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `src/output.ts`, `src/browser.ts`, `tests/unit/output.test.ts`, `tests/unit/browser.test.ts` — deterministic-path and ordering reference.
- Create `src/output.rs`, `src/browser.rs`, and focused Rust tests.

**Dependencies**

- T1.1 and T1.2.

**Contract or shape**

```text
render fully → write sibling temp → persist destination → stdout path → webbrowser::open(file://...) → exit
```

**Acceptance and verification**

- Output — run `cargo test output`; expect stable paths, forbidden/control replacement, trailing-dot/space trimming, Windows-device fallback, Unicode preservation, complete replacement, stdin identity changes, and no leftover temporary sibling after success.
- Browser boundary — unit-test absolute path → encoded `file://` conversion. Real browser opening is reserved for final manual validation to avoid test-only opener abstractions.
- Phase gate — run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test`; expect all Rust checks green while `bun run check` still passes unchanged.

**Task-local risks**

- `persist` does not guarantee crash durability. That is explicitly out of scope; the prior complete file remains the rollback reference until a successful persist.

### Risks, safeguards, and recovery

- **Risk:** Early Rust behavior diverges while the renderer is incomplete.
- **Safeguard:** Keep the Bun CLI untouched and test Rust semantics independently against existing fixtures.
- **Recovery:** Remove/revert the additive Cargo/Rust files; the existing Bun executable remains operational.

### Phase validation and review

- **Checks:** `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and `bun run check`. Expect both implementations green and no generated release artifacts committed.
- **Review focus:** T1.1–T1.3 linear control flow, absence of async/server/framework code, strict input, Comrak safe rendering, deterministic cache, print-before-open ordering, and dependency minimality.
- **Exit and rerun:** Fix material findings only; rerun the focused affected test plus both complete Rust and Bun phase gates.

## Phase 2 — Static code, Mermaid, images, and semantic parity

### Problems addressed

- The core Rust document does not yet provide the product's static code presentation, diagrams, or local-image embedding.
- Third-party output differs from the Bun implementation and needs a deliberately semantic compatibility contract.

### Implementation summary

- Extend the same AST pass rather than adding plugins.
- Render every code fence before final formatting: Mermaid through `render_strict`; known languages through Lumis; unknown languages as escaped plaintext.
- Reuse the representative fixture and port only distinct behavior tests.

### Tasks

#### T2.1 — Add Lumis highlighting and bounded fence metadata

**Description**

- Add Lumis 0.12 without default features and enable only the language list in Decisions and constraints.
- Parse each code-block info string into authored language plus the bounded metadata grammar. Mermaid is reserved for T2.2; known labels map explicitly to Lumis languages; unknown labels map directly to plaintext without content auto-detection.
- Use GitHub light and dark themes with static multi-theme HTML. Add a small formatter/wrapper for escaped title, preserved `data-language`, numbered lines, `{...}` mark classes, and `ins={...}` classes. Do not recreate other Expressive Code features.
- Keep generated code HTML trusted at the narrow code-block formatter boundary; authored raw HTML remains escaped by Comrak.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `src/plugins/expressive-code.ts`, `tests/integration/code.test.ts`, `tests/fixtures/documents/complete.md` — behavior reference, not markup target.
- `src/styles.css` — replace Expressive Code-specific selectors with product-owned Lumis/frame selectors.
- Create a small `src/code.rs` only if keeping this logic in `render.rs` would obscure the AST pass.

**Dependencies**

- Phase 1 complete.

**Contract or shape**

````text
```<language> [title="..."] [{1,3-5}] [ins={2}]
known label → Lumis; explicit unknown label → plaintext; no label → plaintext
````

**Acceptance and verification**

- Run focused Rust code tests; expect known TypeScript/JavaScript tokens, both theme values, title/frame markup, mark/insert line classes, escaped unknown code, preserved authored language label, and zero scripts/buttons/runtime modules.
- Run `cargo clippy --all-targets -- -D warnings`; expect the metadata parser and formatter to remain bounded and warning-free.

**Task-local risks**

- Lumis 0.x output/API may change. Pin 0.12 in `Cargo.lock`, assert semantic classes/content, and avoid full generated-markup snapshots.

#### T2.2 — Add native Mermaid and lean local-image embedding

**Description**

- Handle `mermaid` before ordinary code. Call `mermaid_rs_renderer::render_strict` with default features disabled, wrap returned SVG in `<figure class="mermaid-diagram" role="img">`, and report failures using the Comrak fence source line plus renderer detail.
- Trust renderer-produced SVG. Do not parse, rewrite, sanitize, or validate it and do not preserve the old family-specific preflight gates.
- For images, preserve remote HTTP(S) URLs. For relative local images, remove query/fragment, decode the path, canonicalize it under the canonical source base, require a regular file with one of PNG/JPEG/GIF/WebP/SVG extensions, read bytes, and emit a standard padded Base64 data URI from the extension's fixed MIME mapping.
- Reject authored `data:`, `file:`, protocol-relative, absolute, escaping, missing, and unsupported local image references with concise source context. Do not inspect image signatures or SVG structure.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `src/plugins/mermaid.ts`, `src/plugins/images.ts`, `src/assets.ts` — current behavior to simplify substantially.
- `tests/integration/mermaid.test.ts`, `tests/integration/images.test.ts`, `tests/security/image-paths.test.ts` — semantic cases to port selectively.
- `tests/security/authored-svg.test.ts`, `tests/security/mermaid.test.ts` — validator-specific cases to delete at cutover.
- Create `src/assets.rs` only if image code would otherwise make `render.rs` difficult to read.

**Dependencies**

- T2.1.

**Acceptance and verification**

- Mermaid — run focused Rust diagram tests; expect the six representative families to produce inline SVG, source fences to disappear, malformed input to fail before persistence, and ordinary code to remain highlighted.
- Images — run focused Rust asset tests; expect all five extensions, nested Unicode/space paths, stdin/file bases, remote passthrough without fetching, containment failure, and escaped alt/title behavior.
- No-server boundary — inspect the direct dependency list and implementation; it must contain no HTTP server, async runtime, listener, watcher, or browser-rendering dependency.

**Task-local risks**

- Mermaid layout and supported syntax differ from beautiful-mermaid. Preserve native renderer behavior and source-aware failure; do not add a compatibility parser.

#### T2.3 — Port the representative behavior suite and finish styles

**Description**

- Add Rust integration tests around `tests/fixtures/documents/complete.md` and its assets. Assert semantics: GFM, hidden frontmatter, headings/title, known/unknown code, six Mermaid SVGs, embedded images, remote URL preservation, inert authored HTML, inline responsive/light/dark/print CSS, determinism, and no runtime scripts.
- Consolidate shell behavior into the representative suite plus focused unit/integration tests. Do not port validator matrices, Bun build tests, plugin-order tests, exact third-party markup, or full-document snapshots.
- Remove dead Expressive Code/beautiful-mermaid selectors from `src/styles.css` and keep only product-owned selectors emitted by the Rust renderer.
- Run the Rust renderer against malformed-input fixtures and verify that failures occur before output persistence/browser opening at the public orchestration boundary.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `tests/integration/complete-document.test.ts`, `tests/fixtures/documents/**` — primary behavior corpus.
- `tests/cli/cli.test.ts`, `tests/integration/{markdown,code,mermaid,images}.test.ts`, `tests/security/authored-content.test.ts` — distinct cases to port.
- Create top-level Rust integration tests such as `tests/render.rs` and `tests/cli.rs`; reuse fixture directories.

**Dependencies**

- T2.1 and T2.2.

**Acceptance and verification**

- Run `cargo test`; expect the complete semantic corpus and focused failures to pass without invoking a real browser.
- Run `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`; expect zero findings.
- Run `bun run check`; expect the reference implementation to remain green until cutover.

**Task-local risks**

- Over-porting tests would recreate old implementation coupling. Every migrated test must own a distinct visible contract; otherwise rely on the representative suite.

### Risks, safeguards, and recovery

- **Risk:** Young Lumis/Mermaid crates expose integration or target-build issues.
- **Safeguard:** Pin exact minor versions through `Cargo.lock`, disable broad defaults, keep a narrow language set, and validate representative output before cutover.
- **Recovery:** The Bun implementation remains intact. Revert only the affected Rust enhancement or hold cutover; do not add a compatibility framework.

### Phase validation and review

- **Checks:** `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo build --release`, and `bun run check`. Expect a release binary, all semantic Rust tests green, the old reference green, and no browser/server process started by automated tests.
- **Review focus:** T2.1–T2.3 dependency feature flags, fence metadata bounds, trusted-generated versus authored content, no SVG validators, simple image containment, test uniqueness, and no speculative abstractions.
- **Exit and rerun:** Fix material findings, rerun affected focused tests, then all phase checks. Do not proceed while the representative Rust fixture is incomplete.

## Phase 3 — Cut over to Rust and qualify the standalone user flow

### Problems addressed

- The repository still carries two implementations and the Bun/N-API build surface.
- The actual release binary and default-browser local-file flow require final manual evidence.

### Implementation summary

- Validate the Rust release executable first, then remove Bun/TypeScript and obsolete tests/configuration in one cleanup.
- Use standard Cargo builds and native smoke evidence; do not add a release framework or hosted CI.

### Tasks

#### T3.1 — Validate the release binary and local-file browser flow

**Description**

- Build `target/release/mdr` with standard Cargo and run it from outside the repository against a copied representative file/assets and equivalent stdin input.
- Confirm it prints one retained HTML path, opens that exact local file in the default browser, exits promptly, and leaves no mdr-owned server/listener/watcher/child process. Browser-owned processes are outside the CLI lifecycle.
- Inspect the generated `file://` page manually with agent-browser: visible GFM, code light/dark behavior, Mermaid diagrams, embedded local images, responsive layout, print stylesheet presence, no runtime script, and no product-initiated localhost request.
- Run the same native release smoke on each target that will be distributed. Do not claim an untested target and do not add cross-compilation tooling to this migration.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `README.md` and `PROJECT.md` — current standalone/target claims.
- `tests/fixtures/documents/complete.md` — release smoke input.
- `/Users/maximilianschwarzmuller/.agents/skills/agent-browser/SKILL.md` — required manual browser workflow instructions.

**Dependencies**

- Phase 2 complete.

**Acceptance and verification**

- `cargo build --release` succeeds; copied file and stdin runs both produce a complete retained HTML file, open it through `file://`, and terminate.
- Manual browser inspection records no page console errors caused by mdr and no localhost/server request; close browser automation after validation.
- Record native OS/architecture/libc evidence for every release target actually claimed.

**Task-local risks**

- Lumis Tree-sitter grammars include compiled parser sources. A target that cannot build/run natively remains unqualified; do not solve it with project-owned build orchestration unless distribution later requires a separate plan.

#### T3.2 — Remove the Bun implementation and update project documentation

**Description**

- After T3.1 passes, delete Bun/TypeScript runtime files, JavaScript dependencies/lockfile, N-API build script, Bun/Oxc/TypeScript configuration, old TypeScript tests, and obsolete generated distribution artifacts.
- Retain reusable fixtures and `src/styles.css`. Ensure Cargo owns the final `src/` and test surface without duplicate legacy code.
- Update `README.md` and `PROJECT.md` for Cargo build/test/use commands, Rust dependency choices, curated Lumis languages, native Mermaid behavior, simplified image policy, no SVG validation, deterministic cache path, direct `file://` opening, no server, and evidence-based target support.
- Keep prior plans/progress as project history unless the user separately requests repository-history cleanup.
- Inspect and update all coupled artifacts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- Remove `package.json`, `bun.lock`, `.bun-version`, `tsconfig.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `scripts/build.ts`, TypeScript files under `src/`, and TypeScript test files after confirming no retained consumer.
- Retain/move `tests/fixtures/**` as needed by Rust tests.
- Update `.gitignore`, `README.md`, and `PROJECT.md`; commit `Cargo.lock` for the binary.

**Dependencies**

- T3.1.

**Acceptance and verification**

- Search confirms no Bun, Sätteri, Expressive Code, Shiki, beautiful-mermaid, fast-xml-parser, N-API bootstrap, or `.ts` runtime/test dependency remains.
- Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and `cargo build --release`; expect all final gates green from the Rust-only checkout.
- `git status --short` contains only intentional migration changes and no generated HTML, temp, target, browser, or build residue.

**Task-local risks**

- Premature deletion removes the working fallback. Delete legacy files only after release/manual evidence; recover with Git revert if post-cutover packaging fails.

### Risks, safeguards, and recovery

- **Risk:** Cutover reveals a distribution-only issue after legacy removal.
- **Safeguard:** T3.1 validates the release binary outside the repository before deletion and records qualified targets.
- **Recovery:** Revert the cutover commit to restore the last Bun release while correcting the Rust build; do not maintain a permanent dual implementation.

### Phase validation and review

- **Checks:** Full Rust checks, release build, file/stdin native smoke, manual `file://` inspection, dependency/legacy search, and Git residue check. Expect one Rust implementation, one standalone binary, direct browser opening, prompt process exit, and no server.
- **Review focus:** T3.1–T3.2 user-visible parity, absence of legacy/runtime-server surfaces, documentation accuracy, release-target evidence, and whether cleanup left unnecessary abstractions or dependencies.
- **Exit and rerun:** Fix material findings, rerun focused checks, then the complete final gate and manual smoke before declaring migration complete.

## Final validation and review

- **Checks:** `cargo fmt --check`; `cargo clippy --all-targets -- -D warnings`; `cargo test`; `cargo build --release`; release binary file/stdin smoke outside the repository; agent-browser inspection of the produced `file://` page; legacy dependency search; `git status --short`.
- **Review focus:** Complete diff against this plan, direct runtime flow, dependency flags/MSRV, semantic renderer behavior, output/open ordering, removal of unnecessary validators/build machinery, no server/listener/watch path, and accurate target claims.
- **Evidence:** Cargo command output, Rust test inventory, release binary size/hash, representative generated HTML path, manual browser observations, qualified target list, deleted legacy inventory, and explicit deviations.
- **Exit and rerun:** Classify review findings by material user-visible impact. Fix accepted findings, rerun affected focused checks, then all final checks and the release smoke. Reject requests that reintroduce speculative frameworks or validator matrices without an observed defect.

## Definition of Done

- `mdr` is a synchronous Rust 2024 binary on Rust 1.91 with the agreed lean dependency set and no Bun/Node/N-API runtime or build dependency.
- File and stdin input produce one complete self-contained HTML file with GFM, hidden frontmatter, deterministic headings/title, inert authored HTML, usable links, curated Lumis highlighting, native Mermaid SVG, embedded local images, responsive light/dark/print CSS, and no runtime JavaScript.
- The CLI atomically persists the deterministic cache file, prints its path, opens its `file://` URL in the default browser, and exits without creating a server, listener, watcher, or daemon.
- SVG validation, final-document validation, image signature/TOCTOU machinery, generalized plugin/DI abstractions, and custom cross-target build code are absent.
- Focused Rust tests and one representative semantic suite pass; obsolete implementation-shape, validator, and third-party-markup tests are removed.
- The release binary passes file/stdin and manual browser smoke outside the repository. Only natively tested distribution targets are documented as qualified.
- Documentation describes the Rust workflow and intentional behavior changes; the repository contains no generated/temp residue or obsolete Bun implementation.
