# mdr

`mdr` turns one Markdown document into polished, self-contained static HTML, opens it in your default browser with a `file://` URL, and exits. It is designed for quickly reading local Markdown without running a server.

## Install

The v0.1.0 downloads and installer commands below will work **after v0.1.0 is published**. The release is not hosted yet. Prebuilt archives and installers do not require Rust.

### macOS or Linux

Once v0.1.0 is published:

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/maxedapps/mdr/releases/download/v0.1.0/mdr-installer.sh | sh
```

A complete render requires a graphical environment and a configured default browser. On Linux, opening the result also depends on an available desktop browser opener.

### Windows

Once v0.1.0 is published, run in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://github.com/maxedapps/mdr/releases/download/v0.1.0/mdr-installer.ps1 | iex"
```

A complete render requires a graphical environment and a configured default browser.

### Manual download and SHA-256 check

After publication, download the archive for your platform and its matching `.sha256` file from the [v0.1.0 release](https://github.com/maxedapps/mdr/releases/tag/v0.1.0). Verify the archive before extracting it, then place `mdr` (`mdr.exe` on Windows) somewhere on your `PATH`.

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

The artifacts are unsigned: macOS artifacts are not notarized, and Windows artifacts do not use Authenticode. Platform trust prompts may appear. SHA-256 checks detect corruption or modification but do not establish publisher identity. GitHub attestations will be available after hosted publication; attestations are not code signing.

## Use

Render a Markdown file:

```sh
mdr notes.md
```

Or redirect non-empty Markdown through standard input:

```sh
cat notes.md | mdr
```

`mdr` accepts exactly one file whose `.md` extension is case-insensitive, or non-empty UTF-8 Markdown from redirected stdin. If both are provided, the file argument takes precedence. Relative assets resolve from the Markdown file's directory; for stdin, they resolve from the current directory.

Show usage or the installed version and exit without rendering:

```sh
mdr --help
mdr --version
```

## Output, rendering, and limitations

The output location is deterministic:

```text
<temporary-directory>/mdr/<sha256-source-identity>/<portable-source-name>.html
```

File identity comes from the canonical source path. Stdin identity comes from the current directory and Markdown content; its output is named `stdin.html`. `mdr` finishes and atomically persists the HTML, prints its absolute path, opens that exact file in the default browser, and exits. If browser opening fails, the printed path and completed file remain available for manual opening.

Generated pages support:

- GFM tables, task lists, autolinks, strikethrough, and footnotes
- hidden leading YAML or TOML frontmatter, deterministic heading IDs, and document title selection
- static syntax highlighting with light and dark themes
- generation-time Mermaid diagrams as SVG
- embedded eligible local images, responsive light/dark and print styles, and a restrictive content security policy

Product assets, eligible local images, styles, highlighting, and diagrams are included in the static output. There is no server, listener, watcher, daemon, localhost request, or runtime JavaScript. Authored remote HTTP(S) image URLs remain remote and are not fetched while generating the file, but a browser may request them when the result is opened.

### Code fences and diagrams

Syntax highlighting is available for Bash, C, C++, C#, CSS, Go, HTML, Java, JavaScript, JSON, Python, Ruby, Rust, SQL, TOML, TSX, TypeScript, and YAML, including familiar aliases such as `sh`, `js`, `py`, `rs`, `ts`, and `yml`. Unknown or unlabeled fences remain escaped plaintext; content is never used to guess a language.

Fence metadata is limited to `title="..."`, marked line ranges such as `{1,3-5}`, and inserted line ranges such as `ins={2}`. Ranges use comma-separated line numbers or inclusive `N-M` spans. Unsupported metadata fails with the fence location. Mermaid fences accept no code metadata. Invalid diagrams fail with source location and renderer detail; generated Mermaid SVG is trusted without an additional validation pass.

### HTML and images

Authored raw HTML is escaped. Local image paths are percent-decoded and must resolve canonically to regular PNG, JPEG, GIF, WebP, or SVG files inside the source base directory. Missing, unsupported, absolute, protocol-relative, `data:`, `file:`, or directory-escaping local references fail generation. Query strings and fragments on local paths are discarded.

Image type is determined from the extension; file signatures and SVG contents are not validated or sanitized. Authored SVG is embedded as a base64 `<img>` resource rather than trusted inline markup. Only open documents and local assets you trust.

## Platform downloads and status

Release publication, hosted build testing, and native qualification are separate. v0.1.0 is not published yet, so none of these archives is currently hosted.

| Platform | Planned v0.1.0 archive | Availability | Hosted build-tested | Native-qualified |
| --- | --- | --- | --- | --- |
| Apple Silicon macOS | `mdr-aarch64-apple-darwin.tar.xz` | After v0.1.0 publication | Not yet | Yes, from existing native file/stdin and browser checks |
| Intel macOS | `mdr-x86_64-apple-darwin.tar.xz` | After v0.1.0 publication | Not yet | Not yet |
| x86-64 Linux (GNU) | `mdr-x86_64-unknown-linux-gnu.tar.xz` | After v0.1.0 publication | Not yet | Not yet |
| x86-64 Windows (MSVC) | `mdr-x86_64-pc-windows-msvc.zip` | After v0.1.0 publication | Not yet | Not yet |

Each archive will have a matching `.sha256` sidecar. The three targets marked “Not yet” are configured release targets, but they have not been hosted-build-tested or natively qualified; this table does not make broader platform support claims.

## Project information

- [Changelog](CHANGELOG.md)
- [License](LICENSE)
