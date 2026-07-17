# mdr project contract

## Purpose

`mdr` is a small synchronous Rust CLI that turns one Markdown source into one finished, self-contained HTML file, opens the file in the user's default browser, and exits.

```bash
mdr ./README.md
cat README.md | mdr
```

The product deliberately has no subcommands, server mode, watcher, daemon, renderer selector, theme configuration, runtime JavaScript, or custom release orchestration.

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

- Accept `-h` or `--help`, exactly one case-insensitive `.md` path, or redirected stdin.
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

The package is a Rust 2024 binary named `mdr`, pinned to Rust **1.91.0** because Lumis 0.12 requires that toolchain. Standard Cargo commands are the only build and test interface.

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
cargo test
cargo build --release
```

Tests protect distinct visible contracts: source selection and errors, GFM/static shell behavior, bounded code metadata, native Mermaid success and diagnostics, image containment and embedding, deterministic atomic output, encoded file URLs, and one representative complete document. Prefer semantic assertions over renderer-owned snapshots or implementation-shape tests. Automated tests do not invoke a real browser.

Release qualification additionally requires native file and stdin smoke runs outside the repository, direct `file://` browser inspection, prompt process exit, and evidence that no product server or localhost request exists.

## Qualified target

Only **macOS arm64** is currently native-qualified. The release executable passed both outside-repository input modes and direct local-file browser inspection on that platform. Other operating systems and architectures remain unqualified and must not be presented as supported releases solely because Cargo can compile for them.

## Product principles

1. Keep one obvious command and one linear synchronous flow.
2. Finish Markdown, code, diagrams, CSS, and local assets before opening the browser.
3. Produce deterministic, self-contained, directly loadable local HTML.
4. Keep authored executable content inert and local image access contained.
5. Prefer bounded behavior and semantic tests over compatibility frameworks.
6. Add options, dependencies, and abstractions only for demonstrated user needs.
