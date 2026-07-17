# Bun Markdown CLI feasibility research

## Question
Can this empty project become a standalone Bun-built CLI that accepts a Markdown path, renders HTML, opens it in the browser, and provides polished GFM plus Mermaid support?

## Intended output
A source-backed feasibility assessment, architectural recommendation, limitations/trade-offs, and practical implementation direction. No implementation requested yet.

## Context
- Project was empty at research start.
- Local research runtime: Bun 1.3.14 (`1.3.14+0d9b296af`), macOS arm64.
- Desired distribution: standalone executable; desired rendering: offline-capable, rich GFM, Mermaid, styling/highlighting.

## Findings

### Bun Markdown
- `Bun.markdown` landed in Bun 1.3.8 and is explicitly marked unstable/under active development in current docs.
- `Bun.markdown.html()` returns an HTML fragment. Tables, strikethrough, and task lists default on. Autolinks, heading IDs, and GFM tag filtering require options.
- Recommended options: `tables`, `strikethrough`, `tasklists`, `autolinks: true`, `headings: { ids: true }`, `tagFilter: true`; sanitization remains separately necessary.
- Bun tests exercise CommonMark/GFM specs, compatibility regressions, pathological input, escaping, heading collisions, and size limits.
- `Bun.markdown.render()` is not an override-on-top-of-default-HTML API: unregistered callbacks pass only children through. A code-only callback strips normal HTML structure. Use `.html()` then transform the DOM for Mermaid/highlighting, unless recreating every renderer callback.
- A Mermaid fence renders as escaped `<pre><code class="language-mermaid">...</code></pre>`, ideal for safe client-side extraction via `textContent`.
- Mermaid, code highlighting, styling, TOC, copy controls, and rendered math are not supplied by Bun's Markdown HTML output. Bun is the parser/core HTML renderer, not the whole viewer.

### GFM and safety
- Full practical GFM mode needs `autolinks: true` and `tagFilter: true`; those defaults are false even though tables/strike/tasks default true.
- `tagFilter` implements GFM's nine disallowed raw-HTML tags, but it is not a complete HTML sanitizer.
- Empirical Bun 1.3.14 probe: default raw `<script>` passes through; `tagFilter` escapes script tags; Markdown links still emit `href="javascript:..."`; `noHtmlBlocks/noHtmlSpans` escape raw HTML but do not sanitize link protocols.
- Recommended browser-side DOMPurify sanitization before DOM insertion, using the HTML-only profile and conservative URI defaults. Add CSP. Mermaid should run afterwards on sanitized code-fence text with `securityLevel: "strict"`.

### Mermaid / frontend
- Current tested package: Mermaid 11.16.0. Official docs recommend browser integration and `mermaid.run`; strict is the default security level and encodes HTML/turns off click behavior.
- Full Mermaid supports many diagram families; Mermaid Tiny is about half-size but omits mindmap, architecture, KaTeX rendering, and lazy loading. Full build better matches “feature-rich”.
- Recommended transform: select `pre > code.language-mermaid`, read `textContent`, render each independently with unique IDs, preserve source, and show a readable error without breaking other diagrams.
- Highlight.js 11.11.1 and github-markdown-css 5.9.0 were tested successfully. Dynamic imports can avoid loading Mermaid/highlighting paths until matching code blocks exist.

### Standalone Bun executable
- Official docs: `bun build --compile` bundles imported packages plus Bun runtime; Bun/Node APIs remain available. Separate cross-compile targets exist for macOS, Linux (glibc/musl), and Windows, x64/arm64.
- HTML imported by a server entrypoint is bundled with its browser JS/CSS/assets and embedded in a full-stack executable. `Bun.serve` serves generated chunks with MIME/cache handling.
- Empirical PoC on Bun 1.3.14:
  - Imported `index.html` from a Bun server.
  - Browser entry imported Mermaid 11.16.0, Highlight.js 11.11.1, and GitHub Markdown CSS 5.9.0.
  - `bun build --compile --minify server.ts` bundled 2,082 modules successfully.
  - Executable: ~65 MB macOS arm64; browser JS chunk: ~4.3 MB uncompressed over localhost.
  - Basic minified Bun executable using `Bun.markdown`: ~61 MB, so runtime dominates.
  - Compiled executable served HTML/assets; browser verification found one rendered Mermaid SVG and one highlighted code block. Screenshot: `/tmp/mdrunner-browser-probe.png`. Server/browser were cleaned up.
- Standalone users do not need Bun installed. API instability is mostly a build-time maintenance concern because the selected Bun runtime is embedded.
- Releases require separate platform/architecture artifacts; macOS signing/notarization is needed for smooth Gatekeeper UX.

### Recommended architecture
1. CLI validates/realpaths a `.md` path and reads with `Bun.file()`.
2. Render once with `Bun.markdown.html()` and explicit GFM/heading/tag-filter options.
3. Start `Bun.serve` on `127.0.0.1`, port `0` (ephemeral). Never bind publicly by default.
4. Serve an imported HTML viewer route plus a document API. Bun bundles and embeds viewer JS/CSS/dependencies in the executable.
5. Browser client sanitizes HTML with DOMPurify before insertion, then adds Mermaid, syntax highlighting, anchor links/TOC, copy buttons, responsive GitHub-like typography, print CSS, and auto light/dark theme.
6. Rewrite/route relative document images through a source-asset endpoint. Resolve and realpath every request, enforce containment under the Markdown directory, and reject traversal/symlink escape.
7. Open the localhost URL with a small platform adapter (`open` on macOS, `xdg-open` on Linux, PowerShell/Start-Process or `cmd start` on Windows), since Bun has no dedicated default-browser API. Provide `--no-open` and print URL on failure/headless/SSH systems.
8. Keep process alive while serving; stop on Ctrl-C. Optional file watch/live reload is natural in this architecture.

### Why localhost instead of temp `file://`
- Correctly serves bundled module/CSS assets and local images.
- Avoids browser `file://` module/CORS inconsistencies.
- Enables watch/live reload and future linked-document navigation.
- Trade-off: CLI remains running until stopped. A later `--export file.html` can use Bun standalone-HTML as a two-stage build, but local asset inlining/path rewriting makes it more complex.

### Scope caveats
- Core request is feasible now.
- “Beautiful” comes from CSS/theme/UI, not Bun Markdown itself.
- Mermaid is not a Bun Markdown feature; it is a bundled browser dependency activated by `language-mermaid` fences.
- GitHub-only conveniences beyond GFM/CommonMark (alerts, emoji shortcodes, footnotes, frontmatter semantics) need explicit transforms/dependencies and should not be promised as built in.
- Invalid Mermaid needs per-diagram error handling.
- Local server must use loopback, strict asset containment, sanitizer, Mermaid strict mode, and CSP.

## Primary sources
- Bun Markdown docs: https://bun.com/docs/runtime/markdown
- Bun Markdown source docs (unstable warning): https://github.com/oven-sh/bun/blob/main/docs/runtime/markdown.mdx
- Bun 1.3.8 release (API introduction): https://bun.com/blog/bun-v1.3.8
- Bun executable docs: https://bun.com/docs/bundler/executables
- Bun full-stack docs: https://bun.com/docs/bundler/fullstack
- Bun standalone HTML docs: https://bun.com/docs/bundler/standalone-html
- Bun Markdown spec/compat tests: https://github.com/oven-sh/bun/blob/main/test/js/bun/md/md-spec.test.ts and https://github.com/oven-sh/bun/blob/main/test/js/bun/md/gfm-compat.test.ts
- Mermaid usage/security: https://mermaid.js.org/config/usage.html
- Mermaid package: https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/package.json
- DOMPurify usage/security: https://github.com/cure53/DOMPurify/blob/main/README.md
- Cross-platform open package reference: https://www.npmjs.com/package/open

## Follow-up: strict no-server/static-file requirement

The user explicitly rejected a localhost server. Revised target:
1. Parse/transform everything inside the CLI process.
2. Produce a complete final HTML document with inline CSS, pre-highlighted code, pre-rendered SVG diagrams, and optionally embedded local image/font data.
3. Write it to an explicit output/cache path.
4. Open the `file://` URL in the default browser.
5. Exit; no listener or background process remains.

### Sätteri assessment
- Sätteri 0.9.5 is a strong fit for this static pipeline and may be better than `Bun.markdown` here because it exposes MDAST/HAST plugin passes rather than only an HTML string/custom renderer.
- It defaults to GFM + frontmatter and supports tables, footnotes, strike, tasks, autolinks, math parsing, heading attributes, directives, wiki links, definition lists, super/subscript, and smart punctuation.
- `satteri-expressive-code` 0.1.18 pre-renders fenced code via Expressive Code/Shiki. It injects generated styles and optional JS modules into the document, making output self-contained. Highlighting itself is static; JS is only for enhancements such as copy behavior and can be omitted with a custom renderer.
- Sätteri has no actual Mermaid renderer. Its Mermaid references only demonstrate converting fences to raw HTML for later handling.
- Sätteri is pre-1.0 and warns that minor releases may break APIs.
- Sätteri uses a platform N-API binary. A normal Bun `--compile` build succeeded but the executable failed at runtime because the loader's dynamic platform `require()` did not embed the native addon. A build bootstrap that imports the target `.node` file with `{ type: "file" }`, sets `NAPI_RS_NATIVE_LIBRARY_PATH`, and dynamically imports Sätteri fixed this. The resulting macOS arm64 executable ran successfully (~73–74 MB). This requires target-specific build entries/native packages.

### Static Mermaid rendering options
1. **`beautiful-mermaid` 1.1.3 (recommended self-contained default):** pure TypeScript, no DOM/browser, synchronous source→SVG, only `elkjs` + `entities`, 15 themes. It supports six types: flowchart/state, sequence, class, ER, and XY charts. It is Mermaid-like but not full Mermaid syntax/type parity. Source escapes XML text. Verified inside a Sätteri HAST/MDAST pipeline and a Bun standalone executable.
2. **Official Mermaid via `Bun.WebView` (full-parity option):** embed Mermaid's 3.4 MB IIFE in the executable, write a temporary helper HTML/JS file, open it headlessly, call `mermaid.render()`, extract SVG, remove helper files, and insert SVG into final HTML. This uses no server and leaves no runtime dependency in final HTML. Bun WebView uses built-in WKWebView on macOS; Linux/Windows need installed Chrome/Chromium/Edge/Brave. Verified official Mermaid 11.16 SVG generation from a compiled Bun 1.3.14 executable (~64 MB) on macOS.
3. **Official `mermaid-cli`:** full fidelity but Puppeteer/Chromium-based and unsuitable for a truly standalone small executable.
4. **Other no-browser projects:** `@speajus/mermaid-to-svg` supports eight types but v0.1.6 failed both direct Bun execution (ELK worker constructor) and Bun compilation (unresolved `web-worker`). `isomorphic-mermaid` v0.1.1 failed in Bun/compiled Bun because `CSSStyleSheet` was absent. `mermaid-svg-native` is v0.1.2, needs DOM/canvas/font polyfills, requires Mermaid loose security, and documents fidelity/line-break limitations.

### Revised empirical PoC
- Pipeline: Sätteri 0.9.5 → custom `language-mermaid` transform using `beautiful-mermaid` 1.1.3 → `satteri-expressive-code` 0.1.18 → complete HTML string → `Bun.write()`.
- Built with `bun build --compile --minify`, using explicit embedded Sätteri N-API bootstrap.
- Compiled executable: ~74 MB macOS arm64.
- Output: 26 KB standalone HTML, no external scripts/assets, pre-rendered SVG and pre-highlighted code. Expressive Code included two inline enhancement modules; no Mermaid runtime remained.
- Opened directly as `file:///tmp/.../static-output.html`; browser verification found one static diagram SVG, one Expressive Code block, zero external scripts, and no Mermaid runtime. Screenshot: `/tmp/satteri-static-output.png`.
- Separately verified compiled `Bun.WebView` with official Mermaid 11.16: generated a 22 KB static sequence-diagram SVG with no server.

### Revised recommendation
- The no-server product is feasible.
- Prefer Sätteri + Expressive Code for the Markdown/AST/highlighting pipeline.
- Offer two diagram engines:
  - `beautiful-mermaid` as the deterministic, completely self-contained default, with documented six-type coverage.
  - Official Mermaid through `Bun.WebView` when full Mermaid compatibility is requested and a supported browser backend is available; automatic fallback should be explicit, not silent for unsupported syntax.
- Build a full HTML shell with inline product CSS; inline local images/fonts as data URIs; use a safe HAST sanitizer before trusted generated SVG/code plugins; write output; open `file://`; exit.
- Keep Bun's built-in renderer as the simpler dependency-free fallback, but Sätteri is materially better for generation-time transformations.

## Conclusion
Yes. The strict no-server design works and has been validated from compiled executable through direct `file://` browser rendering. Sätteri is a better architectural match than `Bun.markdown` for static transforms, but its pre-1.0 status and N-API addon require a target-specific Bun compile bootstrap. For diagrams, `beautiful-mermaid` gives the cleanest standalone result with limited coverage; official Mermaid can be pre-rendered during generation via `Bun.WebView` without leaving a server or runtime Mermaid dependency in the final HTML.
