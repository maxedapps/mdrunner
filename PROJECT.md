# mdr project contract

## Purpose

`mdr` is a small synchronous Rust CLI that turns one Markdown source into one finished, self-contained HTML file, opens the file in the user's default browser, and exits.

```bash
mdr ./README.md
mdr https://github.com/maxedapps/mdr/blob/main/CHANGELOG.md
cat README.md | mdr
mdr # terminal clipboard
```

The product deliberately has no subcommands, server mode, watcher, daemon, renderer selector, theme configuration, or runtime JavaScript. Release automation is repository infrastructure, not product runtime behavior.

## User flow

```text
purely select file, HTTP(S) URL, redirected stdin, or terminal clipboard
  → load at most 10 MiB of strict UTF-8 Markdown
  → establish an explicit canonical local or sanitized final-URL resource context
  → parse one Comrak AST and prepare links, images, title, and code locations
  → render code with Lumis and Mermaid with the native renderer
  → assemble one complete inline-CSS HTML5 document
  → atomically persist the deterministic cache file
  → print its absolute path
  → open its encoded file:// URL with the default browser
  → exit
```

All meaningful rendering finishes before persistence and browser opening. Failures before persistence print no output path. A browser-opening failure happens after the valid path has been printed and retained.

## CLI and source contract

- Accept exact `-h`/`--help`, `-V`/`--version`, one case-insensitive `.md`/`.mdx` path, one absolute host-bearing HTTP(S) URL, redirected stdin, or terminal clipboard. Use `-- -notes.md` or `./-notes.md` for a dash-prefixed filename.
- Selection is pure and ordered: help/version, option termination, argument validation, redirected stdin, clipboard. Unknown options, malformed explicit HTTP(S) URLs, and unsupported explicit `scheme://` URLs fail before cwd, file handling, clipboard, network, render, output, or browser work. Schemeless values such as `www.example.com/readme.md` remain local path candidates.
- Canonicalize local files and require a regular file. Native clipboard file lists are authoritative and must contain exactly one supported file; only absent/empty lists fall through to text.
- Classify trimmed single-line clipboard `.md`/`.mdx` paths and `file://` URLs through the shared file loader. Preserve all other non-empty clipboard text exactly and never auto-fetch copied HTTP(S) text.
- Stream file, stdin, clipboard-selected-file, and decoded HTTP bodies through one 10 MiB + 1 boundary. Apply the same byte limit to materialized clipboard text. Require strict UTF-8; remote content must also be non-whitespace.
- Treat MDX syntax as inert Markdown. No JSX, import/export, expression, event-handler, or script execution exists.
- Resolve local resources from the canonical source directory or current directory. Resolve remote references only against a userinfo-free final HTTP(S) URL.
- Use first H1, then file/final-URL stem, then `Markdown document` as title precedence.

### Remote loading

Remote loading is a direct synchronous `ureq` request with ambient proxy discovery disabled, 5-second connect and 20-second global timeouts, and at most 10 followed redirects. URL userinfo supplies decoded Basic credentials only to the URL that explicitly contains it; authorization is cleared for every redirect before any target-supplied credentials are applied. Diagnostics redact username/password and never include response bodies.

Accept only successful strict-UTF-8 `text/markdown`, `text/plain`, or `application/markdown` responses. Missing or `application/octet-stream` content types require a requested or final `.md`, `.mdx`, or `.markdown` path. Reject HTML/XHTML, malformed/unsupported types, empty content, transport/TLS/decompression failures, and decoded bodies over 10 MiB. Canonical `github.com/{owner}/{repo}/blob/{opaque remainder}` paths alone are requested through GitHub's `/raw/` route; original URL identity is unchanged.

## Static document contract

The output is a complete HTML5 document with one semantic `<main>`, inline product CSS, responsive/light/dark/print rules, and a restrictive content security policy. It supports GFM tables, task lists, strikethrough, autolinks, footnotes, deterministic heading IDs, and hidden leading YAML or TOML frontmatter.

Authored raw HTML is escaped. Safe fragment, contained local-file, HTTP(S), mail, and telephone links are retained; unsafe protocols and escaping local links fail. The browser receives no product script, remote module, stylesheet, font, or rendering dependency.

### Code

Code highlighting is static Lumis output using GitHub light and dark themes. Lumis defaults are disabled and only these language features are compiled:

- Bash, C, C++, C#, CSS, Go, HTML, Java, JavaScript, JSON
- Python, Ruby, Rust, SQL, TOML, TSX, TypeScript, YAML

Known aliases map explicitly to those languages. Unknown and unlabeled fences are escaped plaintext; content is never auto-detected.

Fence metadata is limited to `title="..."`, marked ranges `{1,3-5}`, and inserted ranges `ins={2,6-8}`. Ranges contain comma-separated positive line numbers or inclusive `N-M` pairs. Duplicate, malformed, zero, reversed, or additional metadata fails with source location. This boundary is intentional and should not grow without a demonstrated document need.

### Mermaid

`mermaid-rs-renderer` renders `mermaid` fences synchronously with its native capabilities. The project does not maintain a diagram-family preflight allowlist or silently fall back to another engine. Renderer errors are wrapped with the Markdown fence location. Mermaid metadata is rejected.

Renderer-produced SVG is trusted inline output. It is not reparsed, rewritten, sanitized, or independently validated.

### Images and remote references

Remote HTTP(S) image URLs pass through without generation-time fetching. Remote-relative and root-relative links/images join only against the sanitized final HTTP(S) response URL; joined non-HTTP(S), protocol-relative, `file:`, `data:`, script, and backslash forms fail. This branch never resolves against cwd or reads local files.

Local image paths have query/fragment removed, are strictly percent-decoded, and are canonicalized against the canonical source base. The canonical target must remain inside that base, be a regular file, and use PNG, JPEG, GIF, WebP, or SVG extension mapping. Bytes are embedded with padded Base64.

The local policy is intentionally containment-based: there is no file-signature sniffing, repeated metadata comparison, no-follow platform machinery, or SVG content validation. Authored SVG stays isolated as an `<img>` data URI rather than inline trusted markup. Unsafe schemes, absolute/protocol-relative paths, traversal or symlink escape, missing files, and unsupported extensions fail with source context.

## Persistence and browser boundary

The destination shape is:

```text
<tmp>/mdr/<sha256-source-identity>/<portable-name>.html
```

File identity is the canonical source path, so content changes reuse the same destination. Stdin identity is the current directory, a NUL separator, and exact Markdown bytes. Clipboard text adds a source-kind separator and uses its cwd/content. Remote identity uses a source-kind separator and normalized original URL with fragment removed while retaining query and userinfo in the digest. Diagnostics and rendered metadata always redact URL userinfo.

File names replace control and cross-platform-forbidden characters, trim trailing dots/spaces, preserve other Unicode, and fall back to `document` for empty or reserved device stems. Stdin uses `stdin.html`, clipboard text uses `clipboard.html`, and remote output uses a final-path-derived stem.

A named temporary sibling is created in the destination directory, receives the complete HTML bytes, and is atomically persisted over the destination. Crash-durability synchronization and backup/restore machinery are out of scope.

The absolute destination is converted to an encoded `file://` URL and handed directly to the platform default browser. The CLI creates no HTTP listener, localhost request, child service, or long-running process.

## Technology and dependencies

The package is a Rust 2024 binary named `mdr`, pinned to Rust **1.91.0** because Lumis 0.12 requires that toolchain. Standard Cargo commands remain the local development, build, and test interface. The sole release-orchestration exception is the repository's pinned cargo-dist configuration and generated GitHub Actions release workflow.

Direct dependencies are intentionally narrow:

- `comrak` — Markdown/GFM AST and HTML formatting, without default features
- `lumis` — static multi-theme code highlighting, without defaults and with the curated languages above
- `mermaid-rs-renderer` — synchronous native Mermaid SVG, without default features
- `arboard` 3.6.1 — synchronous text/native-file clipboard access, image data disabled, Wayland data-control enabled
- `ureq` 3.3.0 — bounded blocking HTTP(S), without defaults and with Rustls/gzip only
- `base64`, `percent-encoding`, and `url` — embedded assets, Basic credentials, and URL handling
- `sha2` — deterministic cache identity
- `tempfile` — sibling temporary files and atomic persistence
- `webbrowser` — direct default-browser opening, without default features

`flate2` is test-only for decoded-gzip limit fixtures. Do not add async runtimes, another HTTP stack, XML/SVG parsers, plugin frameworks, generic sanitizers, or cross-target build layers without an observed requirement and a separate design decision.

## Development and validation

```bash
cargo run -- README.md
cat README.md | cargo run --quiet

cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --locked
cargo build --release --locked
```

Tests protect distinct visible contracts: source precedence/errors, fake clipboard authority, shared source limits, loopback HTTP redirects/auth/MIME/decoded bodies, GitHub normalization, local/remote resource isolation, GFM/static shell behavior, bounded code metadata, native Mermaid diagnostics, image containment/embedding, deterministic atomic output, encoded file URLs, and one representative document. Prefer semantic assertions over renderer-owned snapshots or implementation-shape tests. Automated tests do not use a real clipboard, public network, or browser.

Release qualification additionally records each local, stdin, clipboard, HTTP, HTTPS, GitHub, remote-reference, timeout/oversize, output, and browser mode separately on matching native desktops. Compilation does not qualify clipboard or browser behavior. Maintainers follow [RELEASING.md](RELEASING.md).

## CI and release automation

`.github/workflows/ci.yml` is repository-owned. Pull requests and pushes to `main` use one Ubuntu runner for formatting, clippy, and locked tests. Ordinary CI intentionally performs no release-mode or cross-platform binary builds, opens no browser, and publishes nothing.

`dist-workspace.toml` is the repository-owned release contract. It pins cargo-dist 0.32.0, explicitly opts the non-crates.io `mdr` package into distribution, and configures these archive targets:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `x86_64-unknown-linux-gnu`
- `x86_64-pc-windows-msvc`

It also configures shell and PowerShell installers, SHA-256 checksums, GitHub hosting, and host-phase GitHub attestations. `.github/workflows/release.yml` is generated exclusively by `dist init` and must not be hand-edited. Its normal pull-request mode runs planning only and skips every binary-builder job. Only an explicitly pushed version tag starts native release builds, packaging, hosting, and publication. GitHub Actions/cargo-dist is the deliberate hosted-release exception to the otherwise Cargo-only development interface.

## Target evidence

**Build-tested** means cargo-dist successfully built, packaged, and checksummed the configured artifact on its release runner. **Native-qualified** additionally requires the desktop/browser smoke gate above on matching hardware. Ubuntu tests, compilation, or packaging alone are not qualification.

All four configured archives are build-tested by the non-publishing cargo-dist setup run. The Linux manifest records a glibc 2.35 build environment and linkage to system `libc`, `libgcc_s`, and `libm`; no older-glibc compatibility is claimed.

The published v0.1.0 evidence remains unchanged: only **Apple Silicon macOS** was native-qualified for its file/stdin/browser boundary. For v0.2.0, Apple Silicon macOS additionally passed local `.md`/`.mdx`, stdin, HTTP/HTTPS/GitHub, timeout/oversize, remote-reference, output, and browser checks. Clipboard text/path/file URL/native-file behavior passed functional smoke checks, but clipboard qualification remains incomplete because the pre-test value was not safely captured and verified after restoration. Intel macOS, x64 GNU/Linux, and x64 Windows remain unqualified for the new paths until the full matching desktop gate is performed.

## Product principles

1. Keep one obvious command and one linear synchronous flow.
2. Finish Markdown, code, diagrams, CSS, and local assets before opening the browser.
3. Produce deterministic, self-contained, directly loadable local HTML.
4. Keep authored executable content inert and local image access contained.
5. Prefer bounded behavior and semantic tests over compatibility frameworks.
6. Add options, dependencies, and abstractions only for demonstrated user needs.
