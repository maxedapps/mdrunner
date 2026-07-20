# Add clipboard, MDX-file, and HTTP(S) Markdown sources

> **Status:** Ready for implementation

## Outcome and boundaries

- **Problem and target:** `mdr` currently accepts only one local `.md` path or redirected stdin. Add bare-command clipboard input, clipboard file/path opening, direct `.mdx` files, and HTTP(S) document fetching while preserving deterministic static output, concise errors, and the existing browser boundary.
- **In scope:** Text and native file-list clipboard formats; one local `.md`/`.mdx` file; textual local paths and `file://` URLs from the clipboard; HTTP(S) source URLs including URL-supplied Basic credentials and GitHub `/blob/` links; a uniform 10 MiB source limit; remote-relative link/image resolution; cross-platform builds, tests, documentation, and qualification evidence.
- **Out of scope:** Detecting whether arbitrary text is “valid Markdown”; executing MDX JSX/imports/exports; clipboard images/HTML/rich text; automatically fetching an HTTP URL found in clipboard text; private-service credential management; fetching or embedding remote images during generation; JavaScript or a server runtime.
- **Approach:** Separate pure input selection from side-effecting source loading. Represent local and remote resource bases explicitly, use `arboard` for clipboard text/file lists and blocking `ureq` for bounded HTTP(S), then reuse the existing renderer, atomic output, and default-browser flow.

## Key files, evidence, and decisions

| File or source | Why it matters | Decision or plan impact |
|---|---|---|
| `src/lib.rs` — `USAGE_TEXT`, `run` | Owns argument decoding, terminal detection, source selection, output printing, and browser orchestration. | Preserve help/version no-side-effect behavior and route production clipboard/fetch adapters through a testable orchestration boundary. |
| `src/source.rs` — `MarkdownSource`, `read_markdown_source`, file/stdin loaders | Only `File` and `Stdin` exist; one argument always becomes a file and terminal/no-argument fails. | Split request selection from loading; add `Clipboard` and `Remote`, `.mdx`, shared size enforcement, file-list/path interpretation, and exact precedence. |
| `src/render.rs` — `prepare_ast`, `rewrite_link`, `fallback_title` | Rendering currently requires a filesystem `asset_base`; local links are containment-checked. | Introduce local/remote resource contexts without weakening local containment; derive remote titles and links from URL context. |
| `src/assets.rs` — `resolve_image` | Relative images are currently local-only; absolute HTTP(S) images pass through. | Keep local canonical containment; resolve remote-relative images to HTTP(S) URLs without generation-time fetching. |
| `src/output.rs` — `cache_digest`, `output_stem` | Output identity and names cover only file and stdin. | Add stable clipboard and normalized-original-URL identities and `clipboard.html`/URL-derived names. |
| `src/browser.rs` — `open_output` | Opens only the completed local HTML `file://` URL. | No functional change; all new source failures must remain before persistence/browser opening. |
| `tests/cli.rs`, `tests/render.rs`, colocated module tests | Protect exact CLI output, selection, rendering, resource containment, and deterministic output without opening a browser. | Extend each layer beside its behavior; use injected fakes and a loopback HTTP fixture rather than public-network tests. |
| `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` | Rust is pinned to 1.91.0 and the dependency set intentionally avoids async/runtime sprawl. | Add version-compatible blocking dependencies with minimal features; retain a synchronous application. |
| `README.md`, `PROJECT.md`, `CHANGELOG.md`, `RELEASING.md` | Define user behavior, project/security boundaries, release notes, and qualification rules. | Document precedence, `.mdx` limitations, network/clipboard behavior, errors, size limit, and new native qualification requirements. |
| `.github/workflows/ci.yml`, `dist-workspace.toml`, `.github/workflows/release.yml` | Native CI covers Linux/macOS/Windows; cargo-dist owns generated release packaging for four targets. | Compile/test platform dependencies natively, verify generated planning/current-host packaging without upload mode, and never hand-edit the generated release workflow. |
| [`arboard` 3.6.1 API](https://docs.rs/arboard/3.6.1/arboard/struct.Get.html) and [Linux notes](https://github.com/1Password/arboard/blob/v3.6.1/README.md) | Provides synchronous UTF-8 text and native file-list access; Wayland data-control is optional and compositor-dependent. | Use `default-features = false`, `wayland-data-control`; map non-text/headless/occupied/conversion failures without external clipboard commands. |
| [`ureq` 3.3.0 configuration](https://docs.rs/ureq/3.3.0/ureq/config/struct.ConfigBuilder.html), [body limits](https://docs.rs/ureq/3.3.0/ureq/struct.BodyWithConfig.html), and [response URI](https://docs.rs/ureq/3.3.0/ureq/trait.ResponseExt.html) | Blocking client supports global/connect timeouts, redirect bounds, strict configured body reads, proxies, and final-URL inspection. | Use `default-features = false`, `rustls`, `gzip`; allow HTTP and HTTPS, URL credentials, and cross-scheme redirects while bounding time and redirects. |
| [GitHub raw-file documentation](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files) | A `/blob/` URL returns HTML; GitHub provides a raw-file route. Refs can contain `/`. | Rewrite only canonical GitHub `/blob/` paths to GitHub `/raw/` while preserving the opaque remainder; do not guess the ref/path split or scrape HTML. |

## Phase 1 — Typed source loading and clipboard input

#### T1.1 — Refactor source selection and enforce the shared input contract

- **Change:** Introduce a pure request-selection step with precedence: exact help/version; one local path or parsed absolute HTTP(S) URL; redirected stdin; terminal clipboard. Model `File`, `Stdin`, `Clipboard`, and `Remote` explicitly and expose source-owned labels, fallback-title context, resource context, output identity, and output-stem inputs. Centralize streaming reads capped at 10 MiB + 1 for direct files, stdin, clipboard-selected files, and later HTTP bodies; accept exactly 10 MiB and reject the next byte, using metadata/`Content-Length` only for early rejection. Apply the same 10 MiB byte check to already-materialized clipboard text. Accept `.md` and `.mdx` case-insensitively; `.mdx` remains inert Markdown input, not an MDX runtime. Preserve strict UTF-8, canonical regular-file checks, file-over-stdin behavior, and exact help/version no-I/O behavior.
- **Starts at:** `src/source.rs` — `MarkdownSource`, `SourceSelection`, `read_markdown_source`, `read_file_source`, `read_stdin_source`; `src/lib.rs` — `run`, `USAGE_TEXT`; colocated source tests and `tests/cli.rs`.
- **Verify:**
  - Run `cargo test --locked source::tests` and `cargo test --locked --test cli`; expect selection tests for argument → redirected stdin → clipboard, `.md`/`.mdx`, exact 10 MiB acceptance/10 MiB + 1 rejection, growing-reader bounds, strict UTF-8, and help/version avoiding all source I/O.
  - Verify direct local `.md` behavior, canonical asset bases, symlink handling, and existing exact CLI errors remain green. Render an `.mdx` fixture containing imports/exports, JSX elements/expressions, event handlers, and `<script>`; expect inert escaped/static output, no import/component processing or executable attributes/elements, and the unchanged no-script CSP.

#### T1.2 — Add cross-platform clipboard text and file-list loading

- **Change:** Add `arboard 3.6.1` with image data disabled and Wayland data-control enabled behind a narrow injectable clipboard adapter. For terminal/no-argument input, a present non-empty native file list is authoritative: require exactly one canonical regular `.md`/`.mdx` file, and never fall back to text after multiple-file, unsupported-file, missing, unreadable, oversized, UTF-8, or backend/access failures. Only an absent/empty file-list format proceeds to UTF-8 text. For path classification only, remove surrounding Unicode whitespace and require the result to contain no line break; interpret a complete `.md`/`.mdx` path relative to cwd or a `file://` URL through the shared file loader, while native file-list paths retain exact leading/trailing characters. Otherwise render the original untrimmed clipboard text. Do not auto-fetch HTTP(S) text from the clipboard. Render any non-empty text without Markdown-validity heuristics. Map no-text, unavailable/headless, occupied, and conversion failures to concise `clipboard:` errors.
- **Starts at:** `Cargo.toml`, `Cargo.lock`; new `src/clipboard.rs`; `src/source.rs` — clipboard request loader and shared file loader; source/output tests.
- **Depends on:** T1.1.
- **Verify:**
  - Run focused clipboard/source tests with a fake adapter; expect coverage for text, whitespace, 10 MiB overflow, native one/multiple/unsupported file lists, absolute/relative/file-URL paths, missing paths, `.mdx`, adapter failures, and redirected-stdin precedence.
  - On an available desktop, preserve restorable clipboard text, then smoke-test known Markdown text, one temporary `.md`, one `.mdx`, an unsupported file, and multiple files; expect successful paths only for the first three and restore the prior text afterward. If prior clipboard state is not safely restorable, obtain approval before overwriting it and record the skipped native cases.
  - On Linux, distinguish compile support from runtime qualification: X11/XWayland and supported Wayland data-control may work; headless or unsupported pure-Wayland sessions must return a concise error.

#### T1.3 — Extend deterministic output behavior for new source kinds

- **Change:** Keep direct and clipboard-selected files on canonical-path identity. Give clipboard text a distinct digest over source kind, cwd, and exact content with `clipboard.html`. Give remote sources a digest over source kind and normalized original URL with fragment removed but query and credentials retained in the hash; use a sanitized final path segment such as `CHANGELOG.html`, falling back to `document.html`. Ensure diagnostic labels redact both username and password while requests and identities retain the supplied URL; never place source credentials in titles or rendered HTML.
- **Starts at:** `src/output.rs` — `cache_digest`, `output_stem`, `sanitize_output_stem`; `src/source.rs` — source identity/label methods; colocated tests.
- **Depends on:** T1.1.
- **Verify:**
  - Run output/source tests; expect stable same-source paths, clipboard-vs-stdin separation, cwd/content distinctions, query-sensitive and fragment-insensitive URL identities, userinfo-free diagnostics/rendered labels, and portable URL-derived stems.
  - Confirm existing file and stdin path tests remain unchanged unless the shared source-kind domain separator intentionally changes their cache directories; if changed, document the cache-path migration as harmless regeneration under the OS temporary directory.

- **Phase exit:** `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test --locked` pass with local file/stdin behavior preserved and clipboard behavior fully fake-tested.

## Phase 2 — Bounded HTTP(S) sources and remote resources

#### T2.1 — Implement bounded blocking HTTP(S) fetching

- **Change:** Add `ureq 3.3.0` with only Rustls and gzip features behind an injectable remote-fetch adapter. Accept absolute `http` and `https` URLs with a host, including userinfo, queries, custom ports, localhost/private addresses, and cross-scheme redirects. Configure production constants of a 5-second connect timeout, 20-second global timeout, and 10 followed redirects with the eleventh rejected; disable ambient proxy discovery initially and send a versioned `User-Agent`. URL userinfo supplies Basic authentication to the initial request, but authorization is not forwarded across redirects unless the redirect target explicitly contains its own userinfo. Preserve credentials/query data in the request and hashed identity, but redact all userinfo from diagnostics and strip it from the final URL before constructing rendered resource URLs. Stream at most 10 MiB + 1 decoded bytes, accepting exactly 10 MiB and rejecting the next byte; `Content-Length` is only an early check. Parse `Content-Type` case-insensitively and ignore parameters: accept `text/markdown`, `text/plain`, and `application/markdown`; accept missing or `application/octet-stream` only when either requested or final path ends case-insensitively in `.md`, `.mdx`, or `.markdown`; reject malformed/other types, `text/html`, and `application/xhtml+xml` regardless of extension. Reject non-success status, redirect exhaustion, timeout/TLS/transport/decompression failure, strict-UTF-8 failure without lossy decoding, and empty/whitespace-only content. Never include response bodies in errors.
- **Starts at:** `Cargo.toml`, `Cargo.lock`; new `src/remote.rs`; `src/source.rs` — URL classification/loading; remote module tests.
- **Depends on:** T1.1, T1.3.
- **Verify:**
  - Run remote/source tests against an injected executor and a bounded no-proxy loopback `TcpListener` fixture with short test-only timeout values; expect real HTTP coverage for statuses, timeouts, redirects/loops, declared/chunked/gzip oversize bodies, strict UTF-8, MIME parameters/malformed/unsupported types, empty bodies, and final URI. Use fakes for HTTPS/TLS and HTTP↔HTTPS redirect/error mapping; assert production config retains 5s/20s/10 and that the eleventh redirect fails without a 20-second test.
  - Test initial Basic credentials, default non-forwarding across redirects, credentials explicitly supplied by a redirect target, final-resource userinfo removal, custom ports, private/localhost hosts, and fully redacted errors.
  - Run manual fetches against one local HTTP fixture, one public HTTPS `.md`, and the requested public GitHub example; expect bounded completion, rendered Markdown, and no HTML blob-page body.

#### T2.2 — Normalize GitHub blob URLs without parsing refs

- **Change:** Detect only canonical `github.com/{owner}/{repo}/blob/{opaque remainder}` HTTP(S) paths and replace the `/blob/` segment with `/raw/`, preserving the full remainder, percent encoding, query, credentials, and original URL identity. Let GitHub resolve slash-bearing refs and follow the bounded redirect. Do not scrape GitHub HTML, call the REST API, or special-case other providers.
- **Starts at:** `src/remote.rs` — request normalization; URL-focused tests.
- **Depends on:** T2.1.
- **Verify:**
  - Run normalization tests for branch, slash-bearing opaque remainder, commit, Unicode/percent-encoded path, query, fragment, malformed/non-GitHub, and already-raw URLs; expect only the intended path segment to change.
  - Fetch `https://github.com/maxedapps/mdr/blob/main/CHANGELOG.md` manually; expect final `text/plain` UTF-8 Markdown titled from `CHANGELOG`, with no GitHub page chrome.

#### T2.3 — Resolve remote-relative links and images without local access

- **Change:** Replace the path-only asset-base contract with explicit local and remote resource contexts. Preserve canonical containment and embedding for local file/stdin/clipboard images. Reject a non-HTTP(S) redirect-final source URL before creating a remote context, remove its userinfo, then resolve relative and root-relative links/images with `Url::join`; every joined result must remain HTTP(S), while fragment-only links remain local document fragments. Leave remote images browser-fetched as current absolute remote images are. Preserve safe authored absolute HTTP(S)/mailto/tel links and existing rejection of protocol-relative, `file:`, `data:`, script, backslash, and other unsafe forms. Never resolve a remote document reference against cwd or read a local file.
- **Starts at:** `src/render.rs` — `prepare_ast`, `rewrite_link`, `fallback_title`; `src/assets.rs` — `resolve_image`; `src/source.rs` — resource context; `tests/render.rs` and colocated tests.
- **Depends on:** T2.1.
- **Verify:**
  - Run render/asset tests; expect remote sibling/root/query/fragment resolution, raw-GitHub image bases, userinfo-free final-URL redirect bases, safe authored absolute links, and failures for joined non-HTTP(S), unsafe schemes, and protocol-relative forms.
  - Add a sentinel local file beside the test cwd and prove a remote-relative image/link never reads or emits its `file://` path.
  - Confirm local traversal/symlink containment, static CSP, authored HTML escaping, and no-script/no-server assertions remain green.

- **Phase exit:** All unit/integration tests pass without public network access; a manual HTTP and GitHub smoke produces deterministic local HTML and the existing browser boundary remains the only opener.

## Phase 3 — Product contract, native evidence, and release readiness

#### T3.1 — Complete CLI-level and manual end-to-end coverage

- **Change:** Update exact help/usage and black-box error assertions for `.mdx`, URL, stdin, and clipboard precedence. Keep success-path browser side effects behind injected orchestration tests rather than a hidden production flag. Manually exercise installed/release binaries with outside-repository file, stdin, clipboard text, clipboard file/path/file URL, HTTP, HTTPS, GitHub blob, remote-relative image/link, timeout, oversize, and browser-open flows where the matching desktop/network environment exists.
- **Starts at:** `src/lib.rs` — `USAGE_TEXT`, orchestration boundary; `tests/cli.rs`; `.github/workflows/ci.yml`; existing manual qualification steps in `RELEASING.md`.
- **Depends on:** T1.2, T2.2, T2.3.
- **Verify:**
  - Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --locked`, and `cargo build --release --locked`; expect all checks and exact help/version/error assertions to pass.
  - Require native CI on Linux, macOS, and Windows to compile/link the new platform dependencies and pass locked tests plus release help/version smoke without reading a real clipboard, opening a browser, or using public-network test dependencies.
  - Run `dist --version`, `dist init --yes`, `dist generate --check`, `dist plan --tag=v0.1.0`, and current-host `dist build --tag=v0.1.0 --print=linkage`; expect cargo-dist 0.32.0, exactly four planned targets, no generated drift, and a valid current-host archive. Do not enable PR upload mode unless a packaging/linkage failure creates a separately approved need.
  - Record each manual source mode separately as qualified or unqualified per platform; do not infer clipboard/URL/browser qualification from compilation, fake tests, Rosetta, or another OS.

#### T3.2 — Update user, project, changelog, and release documentation

- **Change:** Update user-only `README.md` with exact examples, precedence, 10 MiB limit, `.mdx` inert-rendering boundary, clipboard file/text behavior, HTTP confidentiality caveat, direct/no-ambient-proxy behavior, remote-image/browser-network behavior, GitHub support, source credentials/redacted diagnostics, and platform clipboard limitations. Reconcile `PROJECT.md` with the typed local/remote source contract and justified blocking HTTP/clipboard dependencies. Add concise `Unreleased` notes to `CHANGELOG.md`. Update `RELEASING.md` qualification and artifact-inspection steps for clipboard/URL paths without rewriting historical v0.1.0 evidence.
- **Starts at:** `README.md` — Use/limitations; `PROJECT.md` — CLI/source/static/security/dependency contracts; `CHANGELOG.md` — `Unreleased`; `RELEASING.md` — qualification and candidate checks.
- **Depends on:** T3.1.
- **Verify:**
  - Search active docs for stale `.md`-only, file/stdin-only, no-network-generation, unchanged qualification, and unbounded-input claims; expect no contradiction.
  - Dry-run every documented command appropriate to the current platform and verify links, error wording, source precedence, MDX limitation, HTTP-vs-HTTPS caveat, and platform qualification labels match tested behavior.

## Final acceptance

- **Checks:** All focused tests plus `cargo metadata --locked --no-deps --format-version 1`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --locked`, `cargo build --release --locked`, exact help/version smoke, `git diff --check`, cargo-dist 0.32.0 init/generate checks, `dist plan --tag=v0.1.0`, and current-host dist build/linkage pass. Hosted native Linux/macOS/Windows CI and PR plan-mode release checks pass; no upload-mode run is required absent a separately approved packaging failure.
- **End state:** `mdr` renders one direct `.md`/`.mdx` file, redirected stdin, terminal clipboard text, one clipboard file/path/file URL, or one bounded HTTP(S)/GitHub blob source; output remains deterministic static local HTML, errors precede persistence except the existing browser-open failure, local containment remains intact, remote references never access local files, active docs match behavior, and no release is published.
- **Deferrals or blockers:** Actual clipboard and full browser qualification remains explicitly unqualified on platforms without matching interactive desktop access; pure Wayland compositors lacking supported data-control and XWayland may return the documented clipboard-unavailable error.
