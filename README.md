# mdr

`mdr` turns one Markdown document into polished, self-contained static HTML, optionally opens it in your default browser with a `file://` URL, and exits. It accepts local files, redirected input, clipboard content, and HTTP(S) documents without running a server.

## Install

Prebuilt v0.3.0 archives and installers do not require Rust.

### macOS or Linux

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/maxedapps/mdr/releases/download/v0.3.0/mdr-installer.sh | sh
```

Opening the result requires a graphical environment and a configured default browser. On Linux, it also depends on an available desktop browser opener. Rendering with `--no-open` does not require a browser.

### Windows

Run in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://github.com/maxedapps/mdr/releases/download/v0.3.0/mdr-installer.ps1 | iex"
```

Opening the result requires a graphical environment and a configured default browser. Rendering with `--no-open` does not require a browser.

### Manual download and SHA-256 check

Download the archive for your platform and its matching `.sha256` file from the [v0.3.0 release](https://github.com/maxedapps/mdr/releases/tag/v0.3.0). Verify the archive before extracting it, then place `mdr` (`mdr.exe` on Windows) somewhere on your `PATH`.

On macOS, for example:

```sh
shasum -a 256 -c mdr-aarch64-apple-darwin.tar.xz.sha256
```

On Linux, for example:

```sh
sha256sum -c mdr-x86_64-unknown-linux-gnu.tar.xz.sha256
```

On Windows, calculate the hash and compare it with the value in the downloaded `.sha256` file:

```powershell
Get-FileHash .\mdr-x86_64-pc-windows-msvc.zip -Algorithm SHA256
Get-Content .\mdr-x86_64-pc-windows-msvc.zip.sha256
```

The artifacts are unsigned: macOS artifacts are not notarized, and Windows artifacts do not use Authenticode. Platform trust prompts may appear. SHA-256 checks detect corruption or modification but do not establish publisher identity. GitHub attestations provide hosted build provenance; attestations are not code signing.

## Use

Render one local Markdown or MDX file:

```sh
mdr notes.md
mdr component.mdx
mdr -- -notes.md
```

Use `-- -notes.md` or `./-notes.md` for a dash-prefixed filename.

Fetch Markdown over HTTPS, including canonical GitHub blob links:

```sh
mdr https://example.com/guide.md
mdr https://github.com/maxedapps/mdr/blob/main/CHANGELOG.md
```

Or redirect non-empty Markdown through standard input:

```sh
cat notes.md | mdr
```

Generate the default deterministic output without opening a browser, write to an exact custom path, or combine both options:

```sh
mdr --no-open notes.md
mdr --out ./public/notes.html notes.md
mdr --no-open --out ./public/notes.html notes.md
cat notes.md | mdr --no-open --out ./public/notes.html
```

Options may appear before or after the single source argument. `--out` accepts an exact file path, not a directory; it does not add an extension. Relative output paths resolve from the current directory, missing parent directories are created, and an existing destination is atomically replaced. Use `./-page.html` for a dash-prefixed output name.

Running `mdr` with no argument and interactive stdin reads the system clipboard. A non-empty native file list is authoritative and must contain exactly one regular `.md` or `.mdx` file. Otherwise, single-line clipboard text ending in `.md`/`.mdx` or containing a `file://` URL opens that path; all other non-empty text is rendered exactly as copied. HTTP(S) text copied to the clipboard remains Markdown text and is not fetched.

Precedence is exact help/version, options and one file or absolute HTTP(S) URL argument, redirected stdin, then terminal clipboard. `--` ends option parsing. Unknown or repeated options, missing option values, malformed HTTP(S) URLs, and unsupported explicit `scheme://` URLs fail before cwd or source handling. Schemeless values such as `www.example.com/readme.md` remain local path candidates. File extensions are case-insensitive. Every source is strict UTF-8 and limited to 10 MiB; exactly 10 MiB is accepted. Local resources resolve from the canonical file directory, or from the current directory for stdin and clipboard text.

`.mdx` is treated as inert Markdown text. Imports, exports, JSX, expressions, event handlers, and scripts are never executed or processed as components.

Show usage or the installed version and exit without any source I/O:

```sh
mdr --help
mdr --version
```

Help and version flags must be used alone.

## Output, rendering, and limitations

Without `--out`, the output location is deterministic:

```text
<temporary-directory>/mdr/<sha256-source-identity>/<portable-source-name>.html
```

Direct and clipboard-selected files use their canonical path as identity. Stdin identity uses the current directory and exact content; clipboard text has a separate identity using its current directory and exact content. Remote identity uses the original URL without its fragment but retains query and credentials in the digest. Outputs use portable source-derived names such as `stdin.html`, `clipboard.html`, or `CHANGELOG.html`. URL credentials are removed from diagnostics, titles, and HTML.

With `--out <path>`, `mdr` writes only the exact resolved destination and does not also create the deterministic cache file. In both modes, it creates missing parent directories, writes a complete temporary sibling, atomically replaces the destination, and prints the resulting absolute path. Source, fetch, render, and persistence errors occur before the path is printed.

| Options | Output | Browser |
| --- | --- | --- |
| none | Deterministic temporary cache | Opens |
| `--no-open` | Deterministic temporary cache | Does not open |
| `--out <path>` | Exact custom file | Opens |
| `--no-open --out <path>` | Exact custom file | Does not open |

The browser receives exactly the printed path. If browser opening fails, the completed file remains available for manual opening.

Generated pages support:

- GFM tables, task lists, autolinks, strikethrough, and footnotes
- hidden leading YAML or TOML frontmatter, deterministic heading IDs, and document title selection
- static syntax highlighting with light and dark themes
- generation-time Mermaid diagrams as SVG
- embedded eligible local images, responsive light/dark and print styles, and a restrictive content security policy

Product assets, eligible local images, styles, highlighting, and diagrams are included in the static output. There is no product server, listener, watcher, daemon, or runtime JavaScript. URL sources are fetched once during generation with a direct blocking request: ambient proxy environment variables are ignored, redirects and time are bounded, and response bodies are never included in errors. Plain HTTP exposes the document and any URL-supplied Basic credentials to the network; prefer HTTPS. Credentials are sent only for the URL that supplies them and are not forwarded to a redirect target.

Remote-relative links and images resolve against the final HTTP(S) response URL. Remote images are not downloaded or embedded during generation, but the browser may request them when the local result is opened. GitHub support only rewrites canonical `github.com/{owner}/{repo}/blob/...` links to GitHub's `/raw/` route.

### Code fences and diagrams

Syntax highlighting is available for Bash, C, C++, C#, CSS, Go, HTML, Java, JavaScript, JSON, Python, Ruby, Rust, SQL, TOML, TSX, TypeScript, and YAML, including familiar aliases such as `sh`, `js`, `py`, `rs`, `ts`, and `yml`. Unknown or unlabeled fences remain escaped plaintext; content is never used to guess a language.

Fence metadata is limited to `title="..."`, marked line ranges such as `{1,3-5}`, and inserted line ranges such as `ins={2}`. Ranges use comma-separated line numbers or inclusive `N-M` spans. Unsupported metadata fails with the fence location. Mermaid fences accept no code metadata. Invalid diagrams fail with source location and renderer detail; generated Mermaid SVG is trusted without an additional validation pass.

### HTML, links, and images

Authored raw HTML is escaped. Local image paths are percent-decoded and must resolve canonically to regular PNG, JPEG, GIF, WebP, or SVG files inside the source base directory. Missing, unsupported, absolute, protocol-relative, `data:`, `file:`, or directory-escaping local references fail generation. Query strings and fragments on local paths are discarded.

Remote relative and root-relative references resolve only to HTTP(S) URLs and never access local files. Unsafe schemes, protocol-relative forms, and backslashes are rejected. Remote images stay remote. Image type for embedded local assets is determined from the extension; file signatures and SVG contents are not validated or sanitized. Authored SVG is embedded as a base64 `<img>` resource rather than trusted inline markup. Only open documents and local assets you trust.

## Platform downloads and status

Release publication, hosted build testing, and native qualification are separate.

| Platform | v0.3.0 archive | Hosted build-tested | Native-qualified |
| --- | --- | --- | --- |
| Apple Silicon macOS | `mdr-aarch64-apple-darwin.tar.xz` | Yes | Not yet for v0.3.0; v0.2.0 evidence is retained below |
| Intel macOS | `mdr-x86_64-apple-darwin.tar.xz` | Yes | Not yet |
| x86-64 Linux (GNU) | `mdr-x86_64-unknown-linux-gnu.tar.xz` | Yes; glibc 2.35 build baseline | Not yet |
| x86-64 Windows (MSVC) | `mdr-x86_64-pc-windows-msvc.zip` | Yes | Not yet |

Each archive has a matching `.sha256` sidecar. Hosted build testing confirms that all four v0.3.0 archives compile and package; it does not qualify desktop/browser behavior. The Linux artifact is evidenced only against the glibc 2.35 build environment, so compatibility with older glibc versions is not claimed.

The v0.2.0 Apple Silicon macOS build was locally qualified for direct `.md`/`.mdx`, stdin, HTTP, HTTPS, GitHub blob, remote references, timeout/oversize errors, generated-file inspection, and browser opening. Clipboard text/path/file URL/native-file behavior was functionally exercised, but native clipboard qualification remained incomplete because the pre-test clipboard value was not safely captured and verified after restoration. No v0.3.0 archive is newly native-qualified. Linux, Intel macOS, and Windows remain unqualified until matching native desktop checks run; compilation alone does not qualify clipboard or browser behavior. On Linux, X11/XWayland and Wayland data-control support vary by session, and unsupported/headless environments return the documented clipboard error.

## Project information

- [Changelog](CHANGELOG.md)
- [License](LICENSE)
