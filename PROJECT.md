# mdr project contract

## Purpose

`mdr` is a small synchronous Rust CLI that turns one Markdown source into one finished, self-contained HTML file, opens the file in the user's default browser, and exits.

```bash
mdr ./README.md
cat README.md | mdr
```

The product deliberately has no subcommands, server mode, watcher, daemon, renderer selector, theme configuration, or runtime JavaScript. Release automation is repository infrastructure, not product runtime behavior.

## User flow

```text
select file or redirected stdin
  → read strict UTF-8 Markdown and establish a canonical asset base
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

- Accept `-h` or `--help`, `-V` or `--version`, exactly one case-insensitive `.md` path, or redirected stdin.
- `-V` and `--version` print `mdr <Cargo package version>` and exit successfully before source, render, output, or browser work.
- Reject extra arguments, interactive stdin without a file, empty stdin, and invalid UTF-8.
- A file argument takes precedence over redirected stdin.
- Canonicalize file input and require a regular file.
- Resolve file assets from the canonical source directory and stdin assets from the current directory.
- Use first H1, then file stem, then `Markdown document` as title precedence.

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

### Images

Remote HTTP(S) image URLs pass through without generation-time fetching. Local paths have query/fragment removed, are strictly percent-decoded, and are canonicalized against the canonical source base. The canonical target must remain inside that base, be a regular file, and use PNG, JPEG, GIF, WebP, or SVG extension mapping. Bytes are embedded with padded Base64.

The policy is intentionally containment-based: there is no file-signature sniffing, repeated metadata comparison, no-follow platform machinery, or SVG content validation. Authored SVG stays isolated as an `<img>` data URI rather than inline trusted markup. Unsafe schemes, absolute/protocol-relative paths, traversal or symlink escape, missing files, and unsupported extensions fail with source context.

## Persistence and browser boundary

The destination shape is:

```text
<tmp>/mdr/<sha256-source-identity>/<portable-name>.html
```

File identity is the canonical source path, so content changes reuse the same destination. Stdin identity is the current directory, a NUL separator, and exact Markdown bytes. File names replace control and cross-platform-forbidden characters, trim trailing dots/spaces, preserve other Unicode, and fall back to `document` for empty or reserved device stems. Stdin uses `stdin.html`.

A named temporary sibling is created in the destination directory, receives the complete HTML bytes, and is atomically persisted over the destination. Crash-durability synchronization and backup/restore machinery are out of scope.

The absolute destination is converted to an encoded `file://` URL and handed directly to the platform default browser. The CLI creates no HTTP listener, localhost request, child service, or long-running process.

## Technology and dependencies

The package is a Rust 2024 binary named `mdr`, pinned to Rust **1.91.0** because Lumis 0.12 requires that toolchain. Standard Cargo commands remain the local development, build, and test interface. The sole release-orchestration exception is the repository's pinned cargo-dist configuration and generated GitHub Actions release workflow.

Direct dependencies are intentionally narrow:

- `comrak` — Markdown/GFM AST and HTML formatting, without default features
- `lumis` — static multi-theme code highlighting, without defaults and with the curated languages above
- `mermaid-rs-renderer` — synchronous native Mermaid SVG, without default features
- `base64`, `percent-encoding`, and `url` — embedded assets and URL handling
- `sha2` — deterministic cache identity
- `tempfile` — sibling temporary files and atomic persistence
- `webbrowser` — direct default-browser opening, without default features

Do not add async runtimes, HTTP stacks, XML/SVG parsers, plugin frameworks, generic sanitizers, or cross-target build layers without an observed requirement and a separate design decision.

## Development and validation

```bash
cargo run -- README.md
cat README.md | cargo run --quiet

cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --locked
cargo build --release --locked
```

Tests protect distinct visible contracts: source selection and errors, GFM/static shell behavior, bounded code metadata, native Mermaid success and diagnostics, image containment and embedding, deterministic atomic output, encoded file URLs, and one representative complete document. Prefer semantic assertions over renderer-owned snapshots or implementation-shape tests. Automated tests do not invoke a real browser.

Release qualification additionally requires native file and stdin smoke runs outside the repository, direct `file://` browser inspection, prompt process exit, and evidence that no product server or localhost request exists. Maintainers follow [RELEASING.md](RELEASING.md) for versioning and publication.

## CI and release automation

`.github/workflows/ci.yml` is repository-owned. It runs formatting and clippy on Linux, then locked tests, a release build, and help/version smoke checks on native Linux, macOS, and Windows runners. It never opens a browser or publishes a release.

`dist-workspace.toml` is the repository-owned release contract. It pins cargo-dist 0.32.0, explicitly opts the non-crates.io `mdr` package into distribution, and configures these archive targets:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `x86_64-unknown-linux-gnu`
- `x86_64-pc-windows-msvc`

It also configures shell and PowerShell installers, SHA-256 checksums, GitHub hosting, and host-phase GitHub attestations. `.github/workflows/release.yml` is generated exclusively by `dist init` and must not be hand-edited. Its normal pull-request mode is planning only; release publication is triggered only by a version tag. GitHub Actions/cargo-dist is the deliberate hosted-release exception to the otherwise Cargo-only development interface.

## Target evidence

**Build-tested** means native CI and cargo-dist successfully built, packaged, and checksummed the configured artifact. **Native-qualified** additionally requires the desktop/browser smoke gate above on matching hardware. Compilation or packaging alone is not qualification.

All four configured archives are build-tested by the non-publishing cargo-dist setup run. The Linux manifest records a glibc 2.35 build environment and linkage to system `libc`, `libgcc_s`, and `libm`; no older-glibc compatibility is claimed.

Only **Apple Silicon macOS** is currently native-qualified from the existing unchanged runtime boundary. Its current-host and hosted cargo-dist archives have also been inspected. Intel macOS, x64 GNU/Linux, and x64 Windows remain build-tested but unqualified until the full matching desktop/browser gate is performed.

## Product principles

1. Keep one obvious command and one linear synchronous flow.
2. Finish Markdown, code, diagrams, CSS, and local assets before opening the browser.
3. Produce deterministic, self-contained, directly loadable local HTML.
4. Keep authored executable content inert and local image access contained.
5. Prefer bounded behavior and semantic tests over compatibility frameworks.
6. Add options, dependencies, and abstractions only for demonstrated user needs.
