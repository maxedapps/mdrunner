# mdrunner

Render one Markdown document as polished, self-contained HTML, open it through `file://`, and exit.

```bash
mdrunner notes.md
cat notes.md | mdrunner
```

`mdrunner` accepts exactly one `.md` path or Markdown from redirected stdin. YAML and TOML frontmatter are recognized and ignored.

## Output

The generated HTML includes:

- GFM tables, tasks, autolinks, strikethrough, and footnotes
- deterministic heading IDs
- static Expressive Code highlighting
- static SVG for the supported Mermaid flowchart, state, sequence, class, ER, and XY families
- contained local PNG, JPEG, GIF, WebP, and validated SVG images as data URIs
- inline responsive light, dark, and print CSS
- a restrictive content security policy

Authored raw HTML is escaped. Unsafe URLs, escaping local asset paths, malformed diagrams, and unsafe SVG fail generation. There is no HTTP server, watcher, daemon, runtime renderer, or product JavaScript.

The output path is deterministic under the operating system's temporary directory. A complete temporary sibling is written and synchronized before replacing the previous output. The path is printed before the platform browser opener runs, so a valid file remains available if opening fails.

## Setup

Use the pinned Bun version from `package.json`:

```bash
bun install --frozen-lockfile
```

## Build commands

Build the current native platform as `dist/mdrunner` or `dist/mdrunner.exe`:

```bash
bun run build
```

Build one named target:

```bash
bun run build:macos-arm64
bun run build:macos-x64
bun run build:linux-arm64
bun run build:linux-arm64-musl
bun run build:linux-x64
bun run build:linux-x64-musl
bun run build:windows-arm64
bun run build:windows-x64
```

Build every target:

```bash
bun run build:all
```

The named commands install the matching locked optional Sätteri addon before compiling. `build:all` installs all locked platform addons, then builds sequentially so the fixed bootstrap cannot collide.

Targeted artifacts coexist in `dist`:

```text
dist/mdrunner-darwin-arm64
dist/mdrunner-darwin-x64
dist/mdrunner-linux-arm64
dist/mdrunner-linux-arm64-musl
dist/mdrunner-linux-x64
dist/mdrunner-linux-x64-musl
dist/mdrunner-windows-arm64.exe
dist/mdrunner-windows-x64.exe
```

You can still call the lower-level target selector directly, but the corresponding addon must already be installed:

```bash
bun run build -- bun-linux-x64-musl
```

A configured or cross-compiled target is not considered native-qualified until it runs successfully on the matching OS, architecture, and Linux libc. No hosted CI configuration is included.

## Testing without building first

Run the TypeScript source directly against a file or stdin:

```bash
bun run dev -- README.md
cat README.md | bun run dev
```

Run all source-level formatting, linting, type checking, unit, integration, security, and CLI checks:

```bash
bun run check
```

Or only the source tests:

```bash
bun run test
```

The CLI opens the generated page in your default browser and prints its HTML path.

## Testing after building

Build and run the native executable:

```bash
bun run build
./dist/mdrunner README.md
cat README.md | ./dist/mdrunner
```

On Windows:

```powershell
bun run build
.\dist\mdrunner.exe README.md
Get-Content README.md | .\dist\mdrunner.exe
```

Run the automated standalone test:

```bash
bun run test:standalone
```

That test builds the native executable if needed, copies it outside the repository, temporarily makes project `node_modules` unavailable, exercises file and stdin input, intercepts the platform opener, verifies the static HTML, and restores/cleans its resources.

To validate a targeted artifact, copy it to its matching native machine and run the same file/stdin commands there. Cross-compilation success alone cannot validate the embedded native addon.
