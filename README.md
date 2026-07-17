# mdr

`mdr` renders one Markdown document as polished, self-contained HTML, opens it directly through `file://`, and exits.

```bash
mdr notes.md
cat notes.md | mdr
```

It accepts exactly one case-insensitive `.md` path or non-empty UTF-8 Markdown from redirected stdin. A file argument wins over redirected stdin. Relative assets resolve from the Markdown file's directory, or from the current directory for stdin.

## Build and use

The project is a Rust 2024 Cargo binary pinned to Rust 1.91 by `rust-toolchain.toml`.

```bash
cargo build --release
./target/release/mdr README.md
cat README.md | ./target/release/mdr
```

During development, run it directly through Cargo:

```bash
cargo run -- README.md
cat README.md | cargo run --quiet
```

Run the complete automated gate with:

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --release
```

## Generated document

The finished HTML includes:

- GFM tables, task lists, autolinks, strikethrough, and footnotes
- hidden leading YAML or TOML frontmatter
- deterministic heading IDs and document title selection
- static Lumis highlighting with GitHub light and dark themes
- native, generation-time Mermaid SVG
- contained local PNG, JPEG, GIF, WebP, and SVG images as data URIs
- inline responsive, light/dark, and print CSS
- a restrictive content security policy

Authored raw HTML is escaped. There are no external product assets, runtime JavaScript, server, listener, watcher, or daemon, and mdr initiates no localhost request.

### Code fences

Lumis is compiled with only these languages: Bash, C, C++, C#, CSS, Go, HTML, Java, JavaScript, JSON, Python, Ruby, Rust, SQL, TOML, TSX, TypeScript, and YAML. Familiar aliases such as `sh`, `js`, `py`, `rs`, `ts`, and `yml` are accepted. Unknown or unlabeled fences remain escaped plaintext; language detection is never inferred from content.

Fence metadata is intentionally bounded:

````markdown
```ts title="example.ts" {1,3-5} ins={2}
const answer = 42;
```
````

Only `title="..."`, marked line ranges `{...}`, and inserted line ranges `ins={...}` are supported. Ranges are comma-separated line numbers or inclusive `N-M` ranges. Other metadata fails with the fence location.

A `mermaid` fence is rendered synchronously by the native Rust renderer. Its supported syntax follows that renderer rather than a project-maintained diagram-family allowlist. Invalid diagrams fail with source location and renderer detail; Mermaid fences accept no code metadata. Generated SVG is trusted without an additional SVG parse or validation pass.

### Images

Remote HTTP(S) image URLs are preserved and are not fetched during generation. A local image path is percent-decoded, resolved from the canonical source base, and accepted only when its canonical regular-file target remains inside that base and has a supported extension. Query strings and fragments on local paths are discarded.

Image MIME type comes from the extension. File signatures and SVG contents are not validated or sanitized; authored SVG remains a base64 `<img>` resource rather than trusted inline markup. Absolute, protocol-relative, `data:`, `file:`, escaping, missing, and unsupported local image references fail generation.

## Output and browser flow

Output is deterministic under the operating system's temporary directory:

```text
<tmp>/mdr/<sha256-source-identity>/<portable-source-name>.html
```

For file input, identity is the canonical source path. For stdin, identity is the current directory, a NUL separator, and the Markdown bytes. File output names use a portable sanitized source stem; stdin uses `stdin.html`.

`mdr` renders the complete document first, writes a temporary sibling in the destination directory, and atomically persists it over the deterministic path. It then prints the absolute path, opens that exact path through the default browser as an encoded `file://` URL, and exits. If browser opening fails, the completed file and printed path remain available.

## Release qualification

The only natively qualified release target is **macOS arm64**. Its release binary passed file and stdin runs outside the repository plus direct `file://` browser inspection. No other OS or architecture is claimed as qualified; a Cargo build alone is not native runtime qualification.
