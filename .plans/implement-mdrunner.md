# Implement the mdrunner CLI

> **Status:** Ready for implementation
> **Planning memory:** `.progress/implement-mdrunner.md`

## Problems

- The repository has product decisions and pinned dependencies but no executable source, so users cannot render either a `.md` file or piped Markdown into a browser-ready document.
- The pinned Markdown stack is unsafe by default for this use case: Sätteri 0.9.5 passes authored raw HTML, `javascript:` links, and arbitrary `data:` image URLs through to HTML.
- Generation-time features require deliberate plugin ordering and adaptation: Sätteri does not add ordinary heading IDs, Expressive Code injects module scripts by default, and beautiful-mermaid emits external Google Fonts imports and does not reject every malformed statement.
- Cache output, strict UTF-8 input, local-asset containment, atomic replacement, and cross-platform browser opening are unimplemented, leaving correctness and local-file security boundaries undefined in code.
- Sätteri's platform N-API binary is selected dynamically and is not retained by a normal Bun standalone build; a compiled executable will fail unless the matching addon is embedded before Sätteri is imported.
- There is no test suite, compiled-artifact gate, CI workflow, or manual browser evidence for the high-value behavior and security contracts in `PROJECT.md`.

## Implementation summary

Implement a small dependency-injected core around a discriminated file/stdin source model, deterministic cache writer, platform browser adapter, and one Sätteri rendering pipeline. Run authored-content safety and asset transforms before trusted Mermaid and Expressive Code transforms; remove all renderer runtime scripts and external font imports; assemble a restrictive, responsive, self-contained HTML document; validate invariants before atomic write and browser launch. Then add a target-aware Bun build bootstrap that embeds exactly one Sätteri addon and prove source and compiled behavior with focused Bun unit, pipeline, security, CLI, PTY, native-binary, CI, and manual `file://` checks.

## Conducted research and relevant sources

| Source or artifact | Material finding | Implementation impact |
|---|---|---|
| `PROJECT.md` | Defines a flag-free file/stdin CLI, static generation, output caching, safety, supported Markdown/diagram behavior, and high-value test categories. | Treat it as the product baseline; update only clarified implementation boundaries and verified tooling claims. |
| `package.json` and `bun.lock` | Bun 1.3.14 and exact Sätteri/Expressive Code/beautiful-mermaid/Oxlint/Oxfmt versions are pinned. | Implement and test against these versions; avoid redundant CLI, opener, renderer, or test dependencies. |
| `node_modules/satteri/dist/compile.{d.ts,js}` and visitor/plugin declarations | `markdownToHtml` returns `{ html, frontmatter, data }`, becomes async with async visitors, and runs MDAST then HAST plugins in array order. Raw HTML and unsafe URLs pass through by default; nodes include source positions in the installed build. | Use ordered plugin factories, throw for fatal plugin failures, copy metadata rather than retaining nodes, and add explicit authored-content safety. |
| [Sätteri entry points](https://satteri.bruits.org/docs/entry-points/) and [plugins](https://satteri.bruits.org/docs/plugins/) | GFM/frontmatter defaults, result shape, filtered HAST visitors, `ctx.textContent`, and sequential plugin behavior are documented. | Use one compile, shared `data`, HAST filters, and per-document factories for title/slug state. |
| `node_modules/satteri-expressive-code/dist/index.{d.ts,js}` and [guide](https://satteri.bruits.org/docs/expressive-code/) | The async plugin emits static highlighted HAST/CSS and injects `jsModules` on the first code block; `customCreateRenderer` can replace the renderer result. | Delegate to `createRenderer` and return `jsModules: []`; assert that scripts are absent while styles/tokens remain. |
| `node_modules/beautiful-mermaid/src/` and [v1.1.3 API source](https://github.com/lukilabs/beautiful-mermaid/blob/v1.1.3/src/index.ts) | Six diagram families are supported and `renderMermaidSVG` is synchronous. Unsupported headers throw, but some parsers ignore malformed lines. XML/style escaping exists. Every SVG includes Google Fonts `@import`; class/ER may add JetBrains Mono. | Gate supported headers and minimum family content, wrap errors with source line, strip generated font imports, and reject active/external SVG content before trusted insertion. |
| [Bun stdin guide](https://bun.com/docs/guides/process/stdin), [file I/O](https://bun.com/docs/runtime/file-io), and [hashing](https://bun.com/docs/runtime/hashing) | `Bun.stdin` exposes bytes/streams; Bun supports Node filesystem APIs and cryptographic hashing. | Read complete bytes, fatal-decode UTF-8, use SHA-256 identities, and perform same-directory temp write plus rename. |
| [Bun child processes](https://bun.com/docs/runtime/child-process) | `Bun.spawn` uses argv arrays, supports stdin/PTY/timeouts, and exposes `exited`; Bun waits for referenced children. | Use injection for ordinary tests, argv-safe opener commands, bounded spawned tests, and a real PTY check for interactive stdin. |
| [Bun standalone executables](https://bun.com/docs/bundler/executables) and [loaders](https://bun.com/docs/bundler/loaders) | Standalone builds embed runtime/imports; `{ type: "file" }` embeds assets and `.node` addons, but dynamically located addons must be included directly. | Generate a target-specific bootstrap that sets `NAPI_RS_NATIVE_LIBRARY_PATH` before dynamically importing the CLI, then smoke-test natively. |
| [Bun test runtime](https://bun.com/docs/test/runtime-behavior), [coverage](https://bun.com/docs/test/code-coverage), and [configuration](https://bun.com/docs/test/configuration) | Default timeout is 5 seconds, unhandled failures affect exit status, tests share a process, and coverage/thresholds are built in. | Use explicit cleanup and bounded long-test timeouts, keep compiled checks separate, and use coverage as a guardrail rather than a substitute for boundary tests. |
| [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser), its [XML validator](https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/docs/v4%2Cv5/4.XMLValidator.md), and [security notes](https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/docs/v4%2Cv5/Security.md) | The pure-JS package validates well-formed XML, can preserve order/attributes for inspection, does not resolve external entities, and documents entity/DoS boundaries. | Add exact `fast-xml-parser@5.10.1` only for structurally validating authored SVG before data-URI embedding; reject DTD/entities and active/external constructs explicitly. |
| [MDN SVG as an image](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image) and [W3C SVG integration](https://www.w3.org/TR/svg-integration/) | SVG loaded through `<img>` has scripting/interactivity/external-resource restrictions unlike inline SVG. | Keep authored SVG base64-encoded behind `<img>` and CSP after structural rejection; never inline authored SVG markup. |
| `.progress/bun-markdown-cli-feasibility.md` | A no-server Sätteri/Expressive Code/beautiful-mermaid pipeline and target-specific Sätteri bootstrap were empirically validated from compiled executable through `file://`. | Reuse the validated architecture, but productionize safety, diagnostics, cache behavior, and tests. |

- **Research/delegation record:** Read-only researcher run `run-mron5lj6-8e4d052b82` inspected exact tagged/installed library implementations and Bun/Oxc contracts; its terminal handoff is captured at `.subagents/runs/run-mron5lj6-8e4d052b82/handoff.md`. Parent verification reproduced raw HTML/unsafe URL pass-through, node positions, Expressive Code script removal, Mermaid errors/CSS-variable SVG, and external font imports on Bun 1.3.14. The parent rejected the child claim that the installed Sätteri API requires a plugin `position` option because installed types omit it and an empirical plugin received positions without it.

## Scope and non-goals

- **In scope:** One CLI accepting a case-insensitive `.md` path or non-interactive stdin; strict UTF-8; `-h` / `--help`; GFM/frontmatter recognition; deterministic heading IDs/title; safe authored HTML/URLs; contained local image embedding; static beautiful-mermaid SVG; static Expressive Code/Shiki output; responsive light/dark/print CSS; deterministic atomic temp-cache output; default-browser opening; source and standalone execution; Bun tests, coverage, CI, docs, and manual `file://` validation.
- **Non-goals:** Server/watch modes, subcommands, output/theme/renderer flags, runtime JavaScript, official Mermaid/WebView, unsupported Mermaid families, math/KaTeX, TOC/toolbars/copy buttons, MDX, remote asset fetching, multi-file rendering/navigation, PDF/export modes, release publishing/signing/notarization, and package-manager distribution. Relative local anchors may be rewritten to their source files, but linked Markdown is not recursively rendered.

## Decisions and constraints

| Decision or constraint | Why | Status / consequence |
|---|---|---|
| A file argument wins when stdin is also redirected; no args reads stdin only when it is non-TTY. | Matches `PROJECT.md` and avoids another mode flag or indefinite terminal waits. | Confirmed; more than one argument and empty/invalid input fail with exit `1`; help exits `0`. |
| Decode file and stdin bytes with `TextDecoder("utf-8", { fatal: true })`. | `BunFile.text()` does not prove strict UTF-8 validation. | Confirmed; malformed UTF-8 is a source-aware input error. |
| Keep orchestration dependency-injected and the executable entry thin. | Tests can exercise real control flow without opening a browser or introducing hidden test flags. | Confirmed; subprocess tests use PATH shims where process behavior itself is under test. |
| Escape authored raw HTML and allow only safe URL forms before trusted generated markup. | Sätteri passes unsafe content through and the output runs from a local-file origin. | Confirmed; no broad sanitizer dependency is needed for the bounded Markdown AST/HAST surface. |
| Reject local image traversal and symlink escape outside the canonical file directory or stdin cwd. | Prevents untrusted Markdown from embedding arbitrary readable local files. | Inferred-reversible from `PROJECT.md` traversal requirements and prior research; document the boundary. |
| Rewrite safe contained relative anchor links to absolute `file://` URLs; preserve fragments and safe remote/mail/tel links. | Cache output would otherwise resolve relative links against the temp directory. | Inferred-reversible; do not render linked documents or permit explicit/relative local escape. |
| Use generated raw HAST only after renderer-specific validation. | A full post-render HTML sanitizer would either strip trusted SVG/highlighting or add avoidable complexity. | Confirmed; plugin order and final invariants are security contracts. |
| Use beautiful-mermaid only, with header/minimum-content preflight and error wrapping. | Keeps the product deterministic and browserless while acknowledging that upstream parsers may ignore some malformed statements. | Confirmed; tests cover unsupported families and known silent-acceptance cases without reimplementing Mermaid grammar. |
| Remove beautiful-mermaid's generated font `@import` declarations and reject remaining external SVG URLs. | External fonts violate self-contained output and would cause file-open network requests. | Confirmed by parent probe; only internal fragment paint references such as `url(#id)` remain allowed. |
| Validate authored SVG with exact `fast-xml-parser@5.10.1`, a conservative reject policy, `<img>` isolation, and CSP. | Supporting common README SVG assets without inventing a permissive sanitizer requires a structural, fail-closed boundary. | Confirmed after review; malformed XML, DTD/entities, active elements/attributes, ambiguous namespaces, CSS imports, and external references fail. |
| Configure Expressive Code through `customCreateRenderer(...jsModules: [])`. | Highlighting/CSS is static; copy-button modules violate the no-runtime-JS contract. | Confirmed and empirically validated. |
| Use full SHA-256 cache keys and unique same-directory temp files followed by rename. | Stable identities avoid collisions; same-directory rename gives atomic replacement semantics. | Confirmed; clean temp files on failure and test concurrent writers. |
| Keep Oxlint as AST correctness linting and use `tsc --noEmit` as the type gate. | Current Oxlint is not type-aware without another native dependency. | Confirmed; correct `PROJECT.md` wording rather than add `oxlint-tsgolint` without demonstrated value. |
| Embed one target-matching Sätteri addon before dynamic CLI import. | Static/dynamic package selection is not retained reliably by Bun compile. | Confirmed by docs and prior PoC; every release target needs a native smoke test. |

## Phase 1 — Reliable input, cache, and process orchestration

### Problems addressed

- File/stdin source selection, strict decoding, deterministic output, atomic replacement, browser launching, and error/exit behavior do not exist.
- System boundaries are not injectable, so naïve implementation would either open real browsers during tests or require hidden user-facing flags.

### Implementation summary

Create small typed modules for errors, source acquisition, cache persistence, browser command selection, and top-level orchestration. Keep rendering behind an injected async interface in this phase, allowing complete lifecycle tests without a placeholder production renderer. Establish test helpers, TypeScript/package gates, and stable stdout/stderr/exit contracts before adding library transforms.

### Tasks

#### T1.1 — Implement the strict Markdown source model

**Description**

- Add a discriminated `MarkdownSource` model and `readMarkdownSource` flow that treats `-h` and `--help` identically, accepts one `.md` argument or no-argument stdin, and rejects every other argv shape.
- Resolve and realpath file input, require a regular case-insensitive `.md` file, read bytes, and fatal-decode UTF-8. For stdin, check TTY before reading, collect bytes through the injected stdin boundary, fatal-decode, and reject empty/whitespace-only content.
- Record the canonical asset base, source label, title fallback, and stable identity material without reading assets yet.
- Add source-aware error codes/messages and copy only durable values into errors; do not expose stack traces for expected CLI failures.
- Inspect and add every coupled caller, test, fixture, configuration entry, schema, generated file, document, and downstream consumer discovered during implementation; the files below are starting points, not a closed allowlist.

**Relevant files — non-exhaustive starting points**

- Create `src/source.ts` — `MarkdownSource`, argv selection, TTY/stdin/file byte acquisition, strict decode, canonical context.
- Create `src/errors.ts` — expected error type, error codes, formatting, unknown-error normalization.
- Create `tests/unit/source.test.ts` — table-driven argv, extension, filesystem, UTF-8, whitespace, precedence, Unicode, and symlink behavior.
- Create `tests/helpers/temp-dir.ts` and narrow byte/stdin helpers — isolated setup and guaranteed cleanup.

**Dependencies**

- None.

**Contract or shape**

```ts
type MarkdownSource =
  | { kind: "file"; markdown: string; canonicalPath: string; assetBase: string; label: string }
  | { kind: "stdin"; markdown: string; cwd: string; assetBase: string; label: "stdin" };

type SourceSelection = { kind: "help" } | { kind: "render"; source: MarkdownSource };
```

**Acceptance and verification**

- File and stdin source objects carry the expected canonical context, and `-h` / `--help` return the identical usage selection without reading stdin — run `bun test tests/unit/source.test.ts`; expect all table cases to pass with no retained temp directories.
- Invalid UTF-8, empty stdin, TTY-without-path, directories, non-`.md` files, missing/unreadable files, and extra args return stable concise errors — assert code/message/exit mapping rather than snapshots of platform stack text.
- A file argument with redirected stdin selects the file without consuming stdin — verify through an injected stdin reader spy.

**Task-local risks**

- POSIX permission tests can be unreliable under privileged runners; test the abstraction deterministically and keep one platform-conditional real unreadable-file case with an explicit skip reason when the OS cannot enforce it.

#### T1.2 — Implement deterministic atomic output and browser adapters

**Description**

- Derive a full SHA-256 cache key from canonical file path, or cwd + NUL + stdin content; emit `<stem>.html` for files and `stdin.html` for stdin under `<tmp>/mdrunner/<digest>/`.
- Write a unique temporary file in the destination directory, flush/close through the selected API, rename over the stable destination, and remove the temporary file on every failure path. Handle Windows replacement semantics explicitly rather than assuming POSIX overwrite behavior.
- Map macOS, Linux, and Windows to argv-array browser commands; use a literal-safe PowerShell invocation on Windows. Await the launcher command, treat non-zero/spawn failure as an error after preserving/printing the output path, and never use interpolated shell strings.
- Rewrite browser/path code behind injected `writeOutput`, `print`, and `openBrowser` boundaries for orchestration tests.
- Inspect and add every coupled caller, test, fixture, configuration entry, schema, generated file, document, and downstream consumer discovered during implementation; the files below are starting points, not a closed allowlist.

**Relevant files — non-exhaustive starting points**

- Create `src/output.ts` — cache identity/path construction and atomic writer.
- Create `src/browser.ts` — platform command builder and `Bun.spawn` launcher.
- Modify `src/source.ts` — expose only the stable identity fields needed by output.
- Create `tests/unit/output.test.ts` and `tests/unit/browser.test.ts` — deterministic hashes, naming, replacement, cleanup, concurrency, argv safety, and failure mapping.

**Dependencies**

- T1.1.

**Contract or shape**

```text
file:  SHA-256(canonicalPath)                  → <tmp>/mdrunner/<digest>/<stem>.html
stdin: SHA-256(cwd + NUL + markdownContents)  → <tmp>/mdrunner/<digest>/stdin.html
write: mkdir → unique sibling temp → write/close → replace destination → cleanup temp
```

**Acceptance and verification**

- Repeated file input reuses one path; changed stdin content changes its path; same stdin/cwd reuses it — run `bun test tests/unit/output.test.ts` and expect exact path/hash assertions.
- Concurrent writes never expose a partial document and leave no sibling temp files — coordinate two writes in the test and assert the destination equals one complete candidate.
- `tests/unit/browser.test.ts` proves exact argv arrays for `darwin`, `linux`, and `win32`, including spaces, quotes, ampersands, percent signs, and Unicode in file URLs; unknown platforms and non-zero exits fail clearly.

**Task-local risks**

- Windows cannot always rename over an existing file identically to POSIX. Implement a bounded replace fallback that never deletes the last valid destination before a complete replacement exists, and prove it on the Windows CI runner.

#### T1.3 — Establish orchestration and high-value Bun test gates

**Description**

- Implement `runMdrunner` as an async orchestrator: select source → render through injected dependency → atomically write → print path → open browser. It returns an exit result and never calls `process.exit` internally.
- Guarantee no output write/open on input/render failure; guarantee the completed path is printed and retained if opening fails; normalize unexpected errors once at the executable boundary in a later phase.
- Add Bun test configuration/helpers with explicit per-test timeouts only where needed, coverage reporting, strict cleanup, and no global browser or filesystem mutation.
- Add `typecheck`, focused test, coverage, and aggregate `check` package scripts; keep compiled smoke outside the fast default gate until Phase 3.
- Correct `PROJECT.md` to describe Oxlint as correctness linting and TypeScript as the type-aware gate.
- Inspect and add every coupled caller, test, fixture, configuration entry, schema, generated file, document, and downstream consumer discovered during implementation; the files below are starting points, not a closed allowlist.

**Relevant files — non-exhaustive starting points**

- Create `src/main.ts` — injected orchestration contract and exit result.
- Create `tests/unit/main.test.ts` — ordered effects and every failure boundary.
- Create `bunfig.toml` — test root/coverage configuration using syntax validated against Bun 1.3.14.
- Modify `package.json`, `tsconfig.json`, `.oxlintrc.json`, and `PROJECT.md` — authoritative gates and accurate tooling statements.
- Create `tests/helpers/fakes.ts` only for true process/filesystem boundaries; keep parser/render tests real in Phase 2.

**Dependencies**

- T1.1 and T1.2.

**Contract or shape**

```ts
interface MdrunnerDependencies {
  readSource(...): Promise<SourceSelection>;
  render(source: MarkdownSource): Promise<string>;
  writeOutput(source: MarkdownSource, html: string): Promise<string>;
  printOutput(path: string): void;
  openBrowser(fileURL: string): Promise<void>;
}

runMdrunner(args, deps): Promise<{ exitCode: 0 | 1 }>;
```

**Acceptance and verification**

- `bun test tests/unit` passes and proves exact effect order, short-circuit behavior, retained output on opener failure, and no real browser launch.
- `bun run typecheck`, `bun run lint`, and `bun run format:check` exit `0`; Oxlint sees actual source rather than relying on `--no-error-on-unmatched-pattern` as the only success condition.
- `bun run test:coverage` produces a Bun coverage report and enforces the configured threshold after validating the exact Bun 1.3.14 configuration syntax; expected core line/function threshold is at least 90% without excluding difficult source branches.

### Risks, safeguards, and recovery

- **Material failure or migration risk:** Incorrect argv/TTY handling can hang interactive users; output replacement can destroy the prior valid page; opener tests can launch real applications.
- **Safeguard:** TTY gate before reads, bounded PTY tests, same-directory completed temp writes, injected process boundaries, and PATH shims only in isolated subprocess tests.
- **Rollback/recovery:** Each module is isolated and can be reverted independently. Atomic-write failures retain the prior destination and remove only the unique temp file; tests inspect cleanup before phase exit.

### Phase validation and review

- **Checks:** Run `bun test tests/unit`, `bun run test:coverage`, `bun run typecheck`, `bun run lint`, and `bun run format:check`; expect zero failures, no browser windows, coverage at/above the validated threshold, and no leaked temp artifacts/processes.
- **Review focus:** T1.1–T1.3 source precedence, strict decoding, path identities, Windows-safe replacement/opener argv, error semantics, dependency-injection boundaries, and test quality.
- **Baseline:** Phase 1 problems, the file/stdin and output contracts in `PROJECT.md`, decisions above, and every task acceptance criterion.
- **Evidence:** `.plans/implement-mdrunner.md`, implementation tracker, complete diff, focused/coverage/type/lint/format outputs, temp/process cleanup assertions, skips with OS reasons, and known platform constraints.
- **Exit and rerun:** Apply the current `code-review` authoritative finding and follow-up contract, disposition material findings, fix admitted work, and rerun all Phase 1 checks. Use one fresh read-only review for this checkpoint when safely available; otherwise record the concrete fallback reason and independence limitation. Deduplicate an aligned owning-workflow review.

## Phase 2 — Safe, polished, generation-time Markdown rendering

### Problems addressed

- No Markdown renderer or HTML shell exists, and the pinned stack's default output violates raw HTML, URL, runtime-script, external-font, and self-contained-output requirements.
- Headings, title metadata, local images/links, diagrams, highlighting, responsive styling, source diagnostics, and final-document invariants are unimplemented.

### Implementation summary

Build one ordered Sätteri HAST pipeline. First escape authored raw HTML and normalize links/images; then collect deterministic heading metadata; then replace Mermaid code blocks with validated static SVG; finally run Expressive Code on remaining code blocks with scripts removed. Wrap the fragment in inline product CSS and a restrictive CSP, validate final invariants, wire the real CLI entry, and prove behavior with real library integrations and adversarial fixtures.

### Tasks

#### T2.1 — Implement authored-content safety, links, headings, and metadata

**Description**

- Add an early HAST plugin factory that replaces authored `raw` nodes with text so Sätteri escapes them on render; never use string regex to sanitize arbitrary authored HTML.
- Normalize URL strings by removing leading/trailing whitespace and control-character obfuscation before scheme classification. Preserve fragments and `http:`, `https:`, `mailto:`, and `tel:` anchors; reject executable/unknown schemes, explicit `file:` input, protocol-relative ambiguity, and unsafe image schemes.
- Resolve safe relative anchors against the source asset base, enforce lexical containment, and rewrite them to absolute `file://` URLs while preserving query/fragment; leave remote links remote.
- Generate Unicode-aware normalized heading IDs with collapsed hyphens, `section` fallback, and `-2`, `-3` duplicate suffixes. Capture the first H1 text into Sätteri's data bag; use file stem/stdin fallback after compile.
- Keep heading attributes disabled so authored arbitrary attributes cannot bypass the policy.
- Add source-position-aware expected errors and do not rely on `ctx.report` for fatal failures.
- Inspect and add every coupled caller, test, fixture, configuration entry, schema, generated file, document, and downstream consumer discovered during implementation; the files below are starting points, not a closed allowlist.

**Relevant files — non-exhaustive starting points**

- Create `src/render.ts` — compile entry, feature options, metadata/data bag, and ordered plugin assembly.
- Create `src/plugins/safety.ts` — raw HAST and anchor/image URL policy.
- Create `src/plugins/headings.ts` — IDs and first-H1 metadata.
- Create `src/slug.ts` and `src/html.ts` only if pure escaping/slug helpers merit separate tests.
- Create `tests/unit/slug.test.ts`, `tests/integration/markdown.test.ts`, and `tests/security/authored-content.test.ts`.

**Dependencies**

- Phase 1 complete.

**Contract or shape**

```text
Authored HAST only:
raw HTML → text node → escaped by Sätteri
anchor URL → fragment | allowed remote scheme | contained relative file URL | rejected
heading → generated unique id; first h1 text copied to document data
```

**Acceptance and verification**

- Run `bun test tests/unit/slug.test.ts tests/integration/markdown.test.ts`; expect CommonMark/GFM tables, tasks, strikethrough, autolinks, footnotes, hidden frontmatter, deterministic IDs, duplicate/Unicode/fallback slugs, and title precedence to pass using real Sätteri.
- Run `bun test tests/security/authored-content.test.ts`; expect raw scripts/styles/event markup to render as inert text, obfuscated dangerous protocols to be absent from href/src attributes, safe remote/fragment/contained local links to remain usable, and no executable authored markup.
- Pin installed Sätteri position behavior with a source-line assertion; do not add undocumented plugin options.

**Task-local risks**

- URL normalization can over-block legitimate content or under-block encoded schemes. Use WHATWG URL parsing after control normalization, table-driven encoded/mixed-case fixtures, and fail closed on parse ambiguity.

#### T2.2 — Embed contained local images safely

**Description**

- In an async HAST image visitor, distinguish safe remote `http(s)` images from local relative images; never fetch remote content and reject authored `data:`, explicit `file:`, protocol-relative, and unknown schemes.
- Decode/resolve local paths from the file directory or stdin cwd, canonicalize the target, enforce realpath containment including symlink escape, require a regular supported image, and embed bytes as a base64 data URI with a trusted MIME allowlist.
- Support the documented PNG, JPEG, GIF, WebP, and SVG types. Add exact `fast-xml-parser@5.10.1` and use `XMLValidator.validate` plus an order/attribute-preserving parse with entity/value coercion disabled for SVG.
- Reject malformed XML, any DTD/DOCTYPE/entity declaration, processing instruction other than an optional leading XML declaration, multiple/non-`svg` roots, non-SVG or ambiguous namespaces, and boolean/duplicate attributes. Traverse the parsed structure and reject active/load-capable elements (`script`, `foreignObject`, `iframe`, `object`, `embed`, `audio`, `video`, `image`, `use`, `a`, `style`, `set`, `discard`, and every animation element), any `on*`, `href`, `xlink:href`, or `src` attribute, CSS `@import`/`expression`, and every non-fragment `url(...)`; allow only internal paint references matching `url(#<safe-id>)`.
- Keep original validated SVG bytes base64-encoded behind an `<img>` data URI and the document CSP, never inline or execute authored SVG markup. Preserve alt/title values through Sätteri escaping and report missing, unsupported, unreadable, directory, traversal, symlink, malformed XML, and rejected SVG failures with source label/line.
- Inspect and add every coupled caller, test, fixture, configuration entry, schema, generated file, document, and downstream consumer discovered during implementation; the files below are starting points, not a closed allowlist.

**Relevant files — non-exhaustive starting points**

- Create `src/plugins/images.ts` — async local asset resolver, containment, MIME policy, and data URI replacement.
- Create `src/assets.ts` — byte/MIME handling and the explicit authored-SVG structural reject policy.
- Modify `package.json` and `bun.lock` — pin `fast-xml-parser@5.10.1` as the sole added runtime security dependency.
- Create `tests/integration/images.test.ts`, `tests/security/image-paths.test.ts`, `tests/security/authored-svg.test.ts`, and minimal binary fixtures under `tests/fixtures/images/`.

**Dependencies**

- T2.1.

**Acceptance and verification**

- Run `bun test tests/integration/images.test.ts`; expect all five documented image types to become correct base64 data URIs for file and stdin sources, nested/space/Unicode paths to work, and remote URLs to remain unchanged without network access.
- Run `bun test tests/security/image-paths.test.ts tests/security/authored-svg.test.ts`; expect traversal, absolute paths, symlink escape, authored data URLs, directories, missing/unreadable files, malformed SVG, every enumerated active element/attribute/CSS/namespace/entity category, and external SVG references to fail before output write/open. Include safe SVG fixtures with internal `url(#id)` paint references to prevent over-blocking.
- Assert generated HTML contains no local filesystem image path and no product-added remote request; browser validation confirms accepted SVG remains in restricted `<img>` image mode.

**Task-local risks**

- Filesystem race exists between realpath/stat/read. Open/read through the canonical target and revalidate metadata where the platform permits; fail rather than follow a changed symlink. Document residual TOCTOU limitations for a local single-user CLI.

#### T2.3 — Render static Mermaid and syntax-highlighted code

**Description**

- Add a HAST `pre` plugin before Expressive Code that identifies exactly `pre > code.language-mermaid`, reads `ctx.textContent`, gates the six supported family headers and minimum meaningful family content, and calls synchronous `renderMermaidSVG` with trusted CSS-variable colors, transparent background, non-interactive output, and a system font.
- Wrap every diagram in semantic `<figure class="mermaid-diagram">` content with an accessible label/role. Convert upstream failures into source-label/line errors and abort the entire generation before write/open.
- Remove beautiful-mermaid's generated Google Fonts `@import` declarations with a narrow trusted-output transform; validate one SVG root and reject scripts, `foreignObject`, event attributes, external href/src, imports, and non-fragment `url(...)` before returning trusted raw HAST.
- Configure `satteri-expressive-code` after Mermaid with `github-light`/`github-dark`, a quiet product-owned logger, delegated `createRenderer`, and `jsModules: []`. Preserve known languages and frames/titles/markers; pin Expressive Code's readable `txt` fallback for unknown languages without leaking its upstream warning onto successful CLI stderr, while still propagating thrown renderer failures.
- Inspect and add every coupled caller, test, fixture, configuration entry, schema, generated file, document, and downstream consumer discovered during implementation; the files below are starting points, not a closed allowlist.

**Relevant files — non-exhaustive starting points**

- Create `src/plugins/mermaid.ts` — fence detection, preflight, render/error mapping, import removal, SVG invariants.
- Create `src/plugins/expressive-code.ts` — static renderer configuration.
- Modify `src/render.ts` — enforce Mermaid-before-Expressive ordering.
- Create `tests/integration/mermaid.test.ts`, `tests/security/mermaid.test.ts`, and `tests/integration/code.test.ts` with representative family/code fixtures.

**Dependencies**

- T2.1; T2.2 may proceed in parallel after T2.1 but both join in `src/render.ts`.

**Contract or shape**

```text
HAST order:
1. authored raw/URL safety
2. local image embedding
3. heading metadata
4. mermaid pre → validated trusted figure/SVG
5. Expressive Code on all remaining pre blocks, renderer jsModules=[]
```

**Acceptance and verification**

- Run `bun test tests/integration/mermaid.test.ts`; expect flowchart, state, sequence, class, ER, and XY fixtures to yield responsive inline SVG, source fences to disappear, theme variables to remain, and unsupported/empty/known malformed diagrams to fail with line-aware errors.
- Run `bun test tests/security/mermaid.test.ts`; expect label/style injection to remain escaped and every active/external SVG invariant, including Google Fonts `@import`, to be absent while internal `url(#...)` paint references remain allowed.
- Run `bun test tests/integration/code.test.ts`; expect static token markup/CSS, light/dark selectors, frames/titles/markers, readable unknown-language `txt` fallback with quiet successful stderr, zero `<script>`/module code, and no Mermaid block processed as ordinary code.

**Task-local risks**

- beautiful-mermaid may silently ignore syntax not represented in its public grammar. Do not reimplement Mermaid; enforce supported headers/minimum content and pin known silent cases, then document the renderer boundary in README/PROJECT.

#### T2.4 — Build the final HTML shell and executable CLI entry

**Description**

- Add a complete HTML5 shell with escaped title, language/charset/viewport, restrictive CSP, semantic main container, and product CSS imported as text so Bun inlines it in source and compiled builds.
- Implement polished system-font typography, accessible focus/contrast, task/table/footnote/code/diagram styling, responsive overflow/content width, automatic light/dark variables, and print overrides. Coordinate variables with Expressive Code and Mermaid output without JavaScript.
- Add a final document validator that rejects any script element, external product stylesheet/font/module, Mermaid runtime, unexpected generated raw active content, or missing required document structure before writing.
- Create the thin `src/cli.ts` boundary that passes `Bun.argv`, Bun stdin/TTY, real renderer/writer/opener dependencies into `runMdrunner`, prints expected errors once, and sets `process.exitCode` without calling `process.exit` during cleanup.
- Add development/production package scripts and, if useful for local linking, a package `bin` entry without changing the end-user standalone distribution goal.
- Inspect and add every coupled caller, test, fixture, configuration entry, schema, generated file, document, and downstream consumer discovered during implementation; the files below are starting points, not a closed allowlist.

**Relevant files — non-exhaustive starting points**

- Create `src/document.ts` — shell assembly, title escaping, CSP, final invariants.
- Create `src/styles.css` — inlined responsive/light/dark/print presentation.
- Create `src/cli.ts` — executable boundary only.
- Modify `src/render.ts`, `src/main.ts`, `package.json`, `tsconfig.json`, and `.gitignore`.
- Create `tests/integration/document.test.ts`, `tests/cli/cli.test.ts`, and complete fixture files under `tests/fixtures/documents/`.

**Dependencies**

- T2.1, T2.2, and T2.3.

**Acceptance and verification**

- Run `bun test tests/integration/document.test.ts`; expect doctype/metadata/title/CSP/main structure, inline product and highlighting CSS, light/dark/print rules, responsive classes, no required runtime JS, and deterministic identical output.
- Run `bun test tests/cli/cli.test.ts`; expect file and piped stdin success, stdout path, mocked/PATH-shimmed opener URL, help/TTY/error exit behavior, file precedence, no open on generation error, and path retention on open failure.
- Use a bounded Bun PTY test for no-arg interactive input; expect immediate usage/error rather than a hang, and ensure the terminal/process is closed in cleanup.
- `bun run dev -- tests/fixtures/documents/complete.md` writes a finished file, uses the opener shim in automated validation, and exits with no server/listener/child retained.

**Task-local risks**

- CSP and renderer inline styles can conflict. Test the exact meta policy through a real `file://` browser in Phase 3; do not weaken `script-src 'none'` to make optional enhancements work.

#### T2.5 — Complete adversarial and end-to-end source tests

**Description**

- Add a small representative complete document and adversarial corpus that crosses GFM, headings, links, every diagram family, known/unknown code, image types, raw HTML, encoded protocols, Unicode, and layout extremes.
- Prefer semantic assertions and compact reviewed snapshots only for stable product-owned shell fragments; do not snapshot entire Shiki or SVG output.
- Add no-network/no-server assertions: generated source contains no product external dependencies, tests observe no listener creation, and spawned CLI exits within bounded time.
- Add regression cases for every material upstream adaptation: plugin order, source positions, unknown language behavior, Mermaid silent-acceptance examples, font import removal, and Sätteri unsafe defaults.
- Inspect and add every coupled caller, test, fixture, configuration entry, schema, generated file, document, and downstream consumer discovered during implementation; the files below are starting points, not a closed allowlist.

**Relevant files — non-exhaustive starting points**

- Create or extend `tests/integration/complete-document.test.ts`, `tests/security/output-contract.test.ts`, `tests/cli/cli.test.ts`, and `tests/fixtures/documents/`.
- Modify `bunfig.toml` and `package.json` only where actual suite timing/coverage evidence requires it.
- Modify `PROJECT.md` to record verified renderer/path boundaries and remove claims disproved by implementation evidence.

**Dependencies**

- T2.4.

**Acceptance and verification**

- Run `bun test tests/unit tests/integration tests/security tests/cli`; expect zero failures, no broad third-party snapshots, no network/browser side effects, no leaked temp directories/processes, and explicit bounded timeouts for PTY/slow renderer cases.
- Run `bun run test:coverage`; expect the configured threshold to pass and inspect uncovered lines for missing risk behavior rather than immediately excluding them.
- Run `bun run check`; expect formatting, Oxlint, TypeScript, and the fast authoritative source test suite to succeed from a clean checkout.

### Risks, safeguards, and recovery

- **Material failure or migration risk:** Trusted raw SVG/highlighting can bypass authored-content safety; parser tolerance can produce incomplete diagrams; local asset resolution can disclose files; CSS/CSP can break `file://` rendering.
- **Safeguard:** Fixed plugin order, strict authored URL/raw transforms, realpath containment, SVG/final-document invariants, no renderer JS, negative fixtures, source-aware fail-before-write behavior, and real browser validation before completion.
- **Rollback/recovery:** Rendering failures leave the previous cached document untouched because write follows full validation. Individual plugin factories can be disabled/reverted without changing source/output contracts; retain failing fixtures as regressions rather than weakening safety silently.

### Phase validation and review

- **Checks:** Run `bun run check`, `bun run test:coverage`, and focused `bun test tests/security tests/integration tests/cli`; expect all gates green, threshold met, no scripts/external product assets, no temp/process leaks, and stable line-aware failures. Generate both file and stdin outputs with an opener shim and inspect their complete HTML invariants.
- **Review focus:** T2.1–T2.5 plugin order, trusted/raw boundary, URL/path containment, SVG import stripping/invariants, Expressive Code adaptation, CSP/shell escaping, CLI side effects, and whether tests protect behavior instead of libraries superficially.
- **Baseline:** Phase 2 problems, `PROJECT.md` output/security/features, pinned-library findings, decisions above, task criteria, and approved Phase 1 deviations.
- **Evidence:** Plan/tracker, complete diff, all focused/aggregate/coverage outputs, representative generated HTML, fixture inventory, opener/PTY cleanup evidence, skips, and documented renderer limitations.
- **Exit and rerun:** Apply the current `code-review` authoritative finding and follow-up contract, disposition material findings, fix admitted work, and rerun focused affected tests plus `bun run check` and coverage. Use one fresh read-only review for this checkpoint when safely available; otherwise record the concrete fallback reason and independence limitation. Deduplicate an aligned owning-workflow review.

## Phase 3 — Standalone packaging, native CI, and user validation

### Problems addressed

- Source execution is not the promised product: the Sätteri addon will be missing from a normal compiled executable.
- Cross-platform opener, native addon, atomic replacement, TTY, and direct `file://` presentation lack native-runner and browser evidence.
- Users have no installation/usage/limitations documentation for the completed tool.

### Implementation summary

Add a target-aware build script that emits a temporary literal bootstrap importing exactly one target addon, sets `NAPI_RS_NATIVE_LIBRARY_PATH`, and dynamically imports the CLI before compiling. Test the artifact natively, add a minimal OS CI matrix, document actual usage/limitations, and manually validate representative file/stdin output in a real browser without a server.

### Tasks

#### T3.1 — Build a target-aware standalone executable with Sätteri embedded

**Description**

- Implement a build target map for the supported Bun targets and exact `@bruits/satteri-*` package/addon filenames, including Linux glibc/musl distinctions and `.exe` naming.
- Resolve the selected addon's installed path, generate a temporary bootstrap with a literal `{ type: "file" }` import, set `NAPI_RS_NATIVE_LIBRARY_PATH`, then dynamically import `src/cli.ts`; compile with Bun 1.3.14, minification, sourcemap/bytecode only if empirically compatible, and one deterministic `dist/` artifact.
- Default `bun run build` to the native current target; allow build/CI target selection only as a developer build argument, not a product CLI flag. Fail early for unsupported/missing target packages.
- Always delete generated bootstrap/temp build material; never commit copied native binaries or generated source.
- Inspect and add every coupled caller, test, fixture, configuration entry, schema, generated file, document, and downstream consumer discovered during implementation; the files below are starting points, not a closed allowlist.

**Relevant files — non-exhaustive starting points**

- Create `scripts/build.ts` — target map, generated bootstrap lifecycle, Bun build invocation, diagnostics.
- Modify `package.json`, `.gitignore`, and `tsconfig.json` — build scripts/paths.
- Search `node_modules/@bruits/satteri-*/package.json` during implementation and verify every mapped package/main filename before encoding it.

**Dependencies**

- Phase 2 complete.

**Contract or shape**

```ts
// Generated per target; literal import is required for embedding.
import addonPath from "<target-addon>.node" with { type: "file" };
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = addonPath;
await import("<absolute-or-resolved-src/cli.ts>");
```

**Acceptance and verification**

- Run `bun run build`; expect one native `dist/mdrunner` (or `.exe`), no generated bootstrap left behind, and build diagnostics naming the selected Bun/addon target.
- Inspect the executable with a native smoke invocation and `Bun.isStandaloneExecutable`-observable test path where useful; expect Sätteri to load without installed Bun/Node/module lookup at runtime.
- Temporarily move or run outside `node_modules` in an isolated directory and verify the artifact still renders a fixture, proving dependencies/addon/styles are embedded.

**Task-local risks**

- Cross-compiling a binary is not proof its target addon loads. Build mapping is fail-closed, and only native-runner smoke evidence qualifies a target as supported.

#### T3.2 — Add native compiled-artifact tests and CI

**Description**

- Add a bounded serial compiled test that builds once, installs a PATH opener shim for the native OS, runs file and stdin fixtures, verifies exit/stdout/stderr, reads the generated HTML, and proves GFM, highlighting, static SVG, embedded images, no scripts/imports/server, and process exit.
- Add native cases for spaces/Unicode and platform opener argv. Keep large binary build outside the normal fast `bun test` loop but inside the release/CI gate with explicit timeout and cleanup.
- Add a minimal GitHub Actions matrix using the pinned Bun version on macOS, Ubuntu, and Windows: frozen install, format/lint/typecheck/source tests/coverage, native build, and compiled smoke. Add musl/arm targets only when native runners exist; do not claim support from cross-build success.
- Preserve logs/artifacts only on CI failure where useful and never upload generated Markdown contents containing local secrets.
- Inspect and add every coupled caller, test, fixture, configuration entry, schema, generated file, document, and downstream consumer discovered during implementation; the files below are starting points, not a closed allowlist.

**Relevant files — non-exhaustive starting points**

- Create `tests/compiled/standalone.test.ts` and native opener-shim helpers/fixtures.
- Create `.github/workflows/ci.yml` — pinned Bun native matrix and cache-safe gates.
- Modify `package.json` and `bunfig.toml` — `test:compiled`/`ci` scripts and bounded timeout handling.
- Modify `PROJECT.md` supported-release claims to match only runners that pass.

**Dependencies**

- T3.1.

**Acceptance and verification**

- Run `bun run test:compiled` on the development machine; expect the standalone binary to pass file/stdin/no-server/static-output assertions within the explicit timeout and remove its isolated dist/cache/shim resources.
- Trigger/inspect `.github/workflows/ci.yml`; expect every native matrix job to pass frozen install, source gates, native build, and compiled smoke. Any unsupported runner is removed from the documented support list rather than skipped silently.
- Confirm `git status --short` contains no generated bootstrap, executable, cache output, or test temp file after local gates.

**Task-local risks**

- A compiled test can consume significant time/disk. Build once per job, use a bounded timeout, clean in `finally`, and keep it separate from watch/fast local tests.

#### T3.3 — Document and manually verify the finished user experience

**Description**

- Add a concise README covering the one-command file/stdin usage, build/install-from-artifact workflow, output path behavior, supported GFM/Mermaid families, stdin asset base, local-path containment, remote-image policy, generated-file safety, browser-open failure recovery, and platform support proven by CI.
- Update `PROJECT.md` from design language to verified behavior where necessary, including beautiful-mermaid's supported-subset/parser tolerance and Oxlint/TypeScript roles; do not add flags or features during documentation.
- Generate a representative complete document from both source CLI and compiled binary, open its `file://` URL with the default browser and `agent-browser`, inspect responsive light/dark/print-relevant layout, console errors, DOM, and network requests, and retain screenshots/evidence useful for review.
- Stop/close browser automation and remove disposable generated files after evidence capture; no server should exist to stop.
- Inspect and add every coupled caller, test, fixture, configuration entry, schema, generated file, document, and downstream consumer discovered during implementation; the files below are starting points, not a closed allowlist.

**Relevant files — non-exhaustive starting points**

- Create `README.md` — actual user/developer documentation.
- Modify `PROJECT.md` — verified status/boundaries only.
- Reuse `tests/fixtures/documents/complete.md` and documented generated cache output for manual checks.
- Read `/Users/maximilianschwarzmuller/.agents/skills/agent-browser/SKILL.md` before executing browser automation during implementation.

**Dependencies**

- T3.2.

**Acceptance and verification**

- Run the source CLI and standalone executable with `tests/fixtures/documents/complete.md` and equivalent piped content; expect the default browser to open a finished file, the invoking process to exit, and all documented features to be visible.
- Use `npx -y agent-browser` according to its skill instructions to inspect the `file://` page at desktop and narrow viewports; expect no console errors, no mdrunner-owned network requests/font imports, one static SVG per diagram, highlighted static code, accessible headings/links/images, and no layout clipping. Capture paths to screenshots and close the browser session.
- Follow README from a clean isolated directory; expect frozen install/check/build/usage commands to be accurate and no undocumented runtime dependency.

**Task-local risks**

- Browser light/dark emulation and print inspection vary by engine. Record browser/version and exact checks, keep CSS assertions automated, and treat manual evidence as complementary rather than the sole gate.

### Risks, safeguards, and recovery

- **Material failure or migration risk:** Target/addon mismatch produces binaries that build but crash; CI can overclaim support; browser openers differ in quoting/process lifetime; generated artifacts can pollute the repository.
- **Safeguard:** Literal one-addon bootstrap, native matrix smoke tests, argv/path adversarial cases, fail-closed support documentation, bounded builds, generated-file ignores, and final clean-tree checks.
- **Rollback/recovery:** Source CLI remains runnable if packaging fails. Remove a failing platform from the supported matrix/docs while retaining source tests; delete only generated `dist`/bootstrap artifacts and rerun the native build after mapping fixes.

### Phase validation and review

- **Checks:** Run `bun install --frozen-lockfile`, `bun run check`, `bun run test:coverage`, `bun run build`, and `bun run test:compiled`; expect all exits `0`, threshold met, standalone rendering without `node_modules`, no scripts/imports/listeners, and a clean Git tree except intended source/docs. Complete agent-browser `file://` desktop/narrow/manual checks and close the session.
- **Review focus:** T3.1–T3.3 addon-before-import ordering, target maps, native evidence vs cross-build claims, opener safety/lifetime, CI timeouts/cleanup, README accuracy, and direct browser output quality.
- **Baseline:** Phase 3 problems, standalone/output contracts in `PROJECT.md`, Bun executable/N-API findings, all task acceptance criteria, and approved earlier deviations.
- **Evidence:** Plan/tracker, complete diff, build/native test logs, CI matrix URLs/results, generated HTML checks, screenshot paths, browser console/network observations, cleanup/clean-tree evidence, skips, and supported-platform limitations.
- **Exit and rerun:** Apply the current `code-review` authoritative finding and follow-up contract, disposition material findings, fix admitted work, and rerun affected native jobs plus the complete final gate. Use one fresh read-only review for this checkpoint when safely available; otherwise record the concrete fallback reason and independence limitation. Deduplicate an aligned owning-workflow review.

## Final validation and review

- Run `bun install --frozen-lockfile`, `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun test`, `bun run test:coverage`, `bun run build`, and `bun run test:compiled`; expect all commands to exit `0`, coverage threshold to pass, no unhandled errors, and no generated residue.
- Generate from both `.md` and piped stdin using source and standalone entrypoints; expect deterministic complete HTML, correct source-relative assets/links, output-path stdout, default-browser invocation, process exit, and no server/listener.
- Inspect representative and adversarial output for doctype/title/CSP, GFM, deterministic headings, static Expressive Code, six supported static diagram families, data-URI local images, responsive/light/dark/print CSS, escaped authored raw HTML, safe URLs, and absence of scripts, Mermaid runtime, external product assets/font imports, unsafe SVG, or partial writes.
- Complete native CI matrix and `agent-browser` `file://` desktop/narrow checks; justify unavailable runner/print-engine skips and align documented platform support with passing native evidence.
- Confirm `git status --short`, temp-cache test roots, child processes, browser automation, generated bootstrap, and `dist` cleanup are in the expected state; retain only intentional review artifacts.
- **Review focus:** the complete implementation, every changed/discovered coupled file, source-to-browser control flow, authored/trusted markup boundary, local filesystem containment, cache atomicity, native addon bootstrap, cross-platform process behavior, test materiality, and documentation truthfulness.
- **Baseline:** this full plan, `PROJECT.md`, inspected sources, decisions, acceptance criteria, Definition of Done, and approved deviations.
- **Evidence:** provide the plan and tracker/progress evidence, complete diff, callers/consumers, all focused/aggregate/coverage/build/native/CI/browser results, screenshots, cleanup status, skips, constraints, deviations, and known risks.
- **Exit and rerun:** Apply the current `code-review` contract. Default to a fresh read-only final reviewer when safely available; otherwise record an allowed concrete fallback and independence limitation. Resolve findings, rerun affected and final gates, and deduplicate any equivalent implementation-workflow final review.

## Definition of Done

- `mdrunner <file.md>` and piped Markdown both produce one deterministic, atomically replaced, complete HTML file, print its path, open its `file://` URL, and exit without a server or retained process; help and every documented failure have stable status/output behavior.
- The generated document visibly and semantically satisfies the documented CommonMark/GFM, title/heading, code, six-family diagram, local-image, remote-link/image, responsive, light/dark, and print contracts using generation-time output only.
- Authored raw HTML, dangerous/obfuscated URLs, local path traversal/symlink escape, active SVG, external generated font imports/resources, renderer scripts, partial writes, and opener argument injection are prevented by implementation and permanent adversarial tests.
- The standalone binary embeds the matching Sätteri addon and all product assets, runs without Bun/Node/`node_modules`, passes native file/stdin smoke tests on every claimed platform, and leaves no generated build/test residue.
- Bun unit, integration, security, CLI, PTY, complete-document, coverage, and compiled-artifact checks pass; tests assert material behavior/failure/invariants rather than broad volatile third-party snapshots.
- Oxlint, Oxfmt, TypeScript, frozen install, CI, manual `file://` browser checks, phase reviews, and final review are green; all material findings are resolved or explicitly approved as deferred.
- `README.md` and `PROJECT.md` accurately describe the implemented one-command UX, cache/asset/security behavior, supported renderer subset/platforms, build/test commands, and meaningful limitations with no undocumented runtime dependency.
