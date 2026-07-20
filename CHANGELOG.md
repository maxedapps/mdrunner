# Changelog

All notable user-visible changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-20

### Added

- Added terminal clipboard Markdown, native clipboard `.md`/`.mdx` files, clipboard paths, and `file://` sources.
- Added inert `.mdx` file rendering without executing imports, JSX, expressions, handlers, or scripts.
- Added bounded HTTP(S) Markdown fetching, URL-supplied Basic credentials, canonical GitHub blob links, and safe remote-relative links/images.

### Changed

- Changed installer destinations from Rust's Cargo directory to user-local application paths (`~/.local/bin` on macOS/Linux and `%LOCALAPPDATA%\mdr\bin` on Windows).
- Applied one strict UTF-8 10 MiB source limit across files, stdin, clipboard, and decoded remote responses.
- Extended deterministic output identity and portable names for clipboard and remote sources while keeping source credentials out of diagnostics and HTML.

All four archives are build-tested by the release workflow. Only Apple Silicon macOS is native-qualified for the new local, stdin, URL, output, and browser flows; native clipboard qualification remains incomplete. The Linux artifact has a glibc 2.35 build baseline. The macOS and Windows artifacts are unsigned and may trigger platform trust prompts.

## [0.1.0] - 2026-07-20

### Added

- Initial `mdr` CLI for rendering a Markdown file or redirected standard input as deterministic, self-contained HTML and opening it in the default browser.
- Static GFM rendering with syntax-highlighted code, native Mermaid diagrams, and contained inline local images.
- Exact `-V` and `--version` output for identifying installed binaries.
- No-Rust shell and PowerShell installers plus SHA-256-verified archives for Apple Silicon and Intel macOS, x64 GNU/Linux, and x64 Windows.

All four archives are build-tested. Only Apple Silicon macOS is native-qualified for the full file, stdin, and default-browser flow. The Linux artifact has a glibc 2.35 build baseline. The macOS and Windows artifacts are unsigned and may trigger platform trust prompts.

[Unreleased]: https://github.com/maxedapps/mdr/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/maxedapps/mdr/releases/tag/v0.2.0
[0.1.0]: https://github.com/maxedapps/mdr/releases/tag/v0.1.0
