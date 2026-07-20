use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use url::Url;

use crate::AppError;
use crate::clipboard::{ClipboardAdapter, SystemClipboard, clipboard_app_error};
use crate::remote::{RemoteFetcher, SystemRemoteFetcher};

pub(crate) const MAX_SOURCE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SourceRequest {
    File(PathBuf),
    Stdin,
    Clipboard,
    Remote(Url),
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum ResourceContext<'a> {
    Local(&'a Path),
    Remote(&'a Url),
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum OutputIdentity<'a> {
    File(&'a Path),
    Stdin { markdown: &'a str, cwd: &'a Path },
    Clipboard { markdown: &'a str, cwd: &'a Path },
    Remote(&'a Url),
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum OutputStemInput<'a> {
    Path(&'a Path),
    Fixed(&'static str),
    Url(&'a Url),
}

#[derive(Debug)]
pub(crate) enum MarkdownSource {
    File {
        markdown: String,
        canonical_path: PathBuf,
        asset_base: PathBuf,
    },
    Stdin {
        markdown: String,
        cwd: PathBuf,
    },
    Clipboard {
        markdown: String,
        cwd: PathBuf,
    },
    Remote {
        markdown: String,
        original_url: Url,
        resource_base: Url,
    },
}

impl MarkdownSource {
    pub(crate) fn markdown(&self) -> &str {
        match self {
            Self::File { markdown, .. }
            | Self::Stdin { markdown, .. }
            | Self::Clipboard { markdown, .. }
            | Self::Remote { markdown, .. } => markdown,
        }
    }

    pub(crate) fn resource_context(&self) -> ResourceContext<'_> {
        match self {
            Self::File { asset_base, .. } => ResourceContext::Local(asset_base),
            Self::Stdin { cwd, .. } | Self::Clipboard { cwd, .. } => ResourceContext::Local(cwd),
            Self::Remote { resource_base, .. } => ResourceContext::Remote(resource_base),
        }
    }

    pub(crate) fn label(&self) -> String {
        match self {
            Self::File { canonical_path, .. } => canonical_path.display().to_string(),
            Self::Stdin { .. } => "stdin".to_owned(),
            Self::Clipboard { .. } => "clipboard".to_owned(),
            Self::Remote { original_url, .. } => redacted_url(original_url).to_string(),
        }
    }

    pub(crate) fn fallback_title(&self) -> String {
        match self {
            Self::File { canonical_path, .. } => path_stem(canonical_path),
            Self::Stdin { .. } | Self::Clipboard { .. } => "Markdown document".to_owned(),
            Self::Remote { resource_base, .. } => {
                url_stem(resource_base).unwrap_or_else(|| "Markdown document".to_owned())
            }
        }
    }

    pub(crate) fn output_identity(&self) -> OutputIdentity<'_> {
        match self {
            Self::File { canonical_path, .. } => OutputIdentity::File(canonical_path),
            Self::Stdin { markdown, cwd } => OutputIdentity::Stdin { markdown, cwd },
            Self::Clipboard { markdown, cwd } => OutputIdentity::Clipboard { markdown, cwd },
            Self::Remote { original_url, .. } => OutputIdentity::Remote(original_url),
        }
    }

    pub(crate) fn output_stem_input(&self) -> OutputStemInput<'_> {
        match self {
            Self::File { canonical_path, .. } => OutputStemInput::Path(canonical_path),
            Self::Stdin { .. } => OutputStemInput::Fixed("stdin"),
            Self::Clipboard { .. } => OutputStemInput::Fixed("clipboard"),
            Self::Remote { resource_base, .. } => OutputStemInput::Url(resource_base),
        }
    }
}

pub(crate) fn select_source(
    argument: Option<&str>,
    stdin_is_terminal: bool,
) -> Result<SourceRequest, AppError> {
    if let Some(argument) = argument {
        if let Ok(url) = Url::parse(argument)
            && matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
        {
            return Ok(SourceRequest::Remote(url));
        }

        if let Some(scheme) = explicit_url_scheme(argument) {
            if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") {
                return Err(AppError::new("Invalid HTTP(S) URL."));
            }
            if !is_windows_drive_path(argument) {
                return Err(AppError::new(format!(
                    "Unsupported URL scheme '{scheme}'; only HTTP(S) URLs are supported."
                )));
            }
        }

        return Ok(SourceRequest::File(PathBuf::from(argument)));
    }

    Ok(if stdin_is_terminal {
        SourceRequest::Clipboard
    } else {
        SourceRequest::Stdin
    })
}

fn explicit_url_scheme(argument: &str) -> Option<&str> {
    let (scheme, _) = argument.split_once("://")?;
    let mut bytes = scheme.bytes();
    let first = bytes.next()?;
    (first.is_ascii_alphabetic()
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.')))
    .then_some(scheme)
}

fn is_windows_drive_path(argument: &str) -> bool {
    let bytes = argument.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

pub(crate) fn load_source_request(
    request: SourceRequest,
    stdin: &mut (impl Read + ?Sized),
    cwd: &Path,
) -> Result<MarkdownSource, AppError> {
    match request {
        SourceRequest::File(path) => read_file_path(&path, cwd),
        SourceRequest::Stdin => read_stdin_source(stdin, cwd),
        SourceRequest::Clipboard => {
            let mut clipboard = SystemClipboard::new()?;
            read_clipboard_source(&mut clipboard, cwd)
        }
        SourceRequest::Remote(url) => read_remote_source(&url, &SystemRemoteFetcher::new()),
    }
}

#[cfg(test)]
pub(crate) fn load_source_request_with_clipboard(
    request: SourceRequest,
    stdin: &mut (impl Read + ?Sized),
    cwd: &Path,
    clipboard: &mut impl ClipboardAdapter,
) -> Result<MarkdownSource, AppError> {
    match request {
        SourceRequest::File(path) => read_file_path(&path, cwd),
        SourceRequest::Stdin => read_stdin_source(stdin, cwd),
        SourceRequest::Clipboard => read_clipboard_source(clipboard, cwd),
        SourceRequest::Remote(url) => read_remote_source(&url, &SystemRemoteFetcher::new()),
    }
}

fn read_remote_source(
    original_url: &Url,
    fetcher: &impl RemoteFetcher,
) -> Result<MarkdownSource, AppError> {
    let fetched = fetcher.fetch(original_url)?;
    let resource_base = sanitize_remote_resource_url(fetched.final_url, original_url)?;
    Ok(MarkdownSource::Remote {
        markdown: fetched.markdown,
        original_url: original_url.clone(),
        resource_base,
    })
}

#[cfg(test)]
pub(crate) fn read_remote_source_with_fetcher(
    original_url: &Url,
    fetcher: &impl RemoteFetcher,
) -> Result<MarkdownSource, AppError> {
    read_remote_source(original_url, fetcher)
}

fn sanitize_remote_resource_url(mut final_url: Url, original_url: &Url) -> Result<Url, AppError> {
    if !matches!(final_url.scheme(), "http" | "https") || final_url.host_str().is_none() {
        return Err(AppError::labeled(
            "Remote response has an unsafe final URL.",
            redacted_url(original_url),
        ));
    }
    let _ = final_url.set_password(None);
    let _ = final_url.set_username("");
    Ok(final_url)
}

pub(crate) fn read_file_source(argument: &str, cwd: &Path) -> Result<MarkdownSource, AppError> {
    read_file_path(Path::new(argument), cwd)
}

fn read_file_path(path: &Path, cwd: &Path) -> Result<MarkdownSource, AppError> {
    let requested_path = if path.is_absolute() {
        path.to_owned()
    } else {
        cwd.join(path)
    };
    if !has_markdown_extension(&requested_path) {
        return Err(AppError::labeled(
            "Expected a Markdown file with a .md or .mdx extension.",
            requested_path.display(),
        ));
    }

    let canonical_path = fs::canonicalize(&requested_path).map_err(|error| {
        let message = if error.kind() == std::io::ErrorKind::NotFound {
            "Markdown file was not found."
        } else {
            "Markdown file could not be read."
        };
        AppError::labeled(message, requested_path.display())
    })?;
    if !has_markdown_extension(&canonical_path) {
        return Err(AppError::labeled(
            "Expected a Markdown file with a .md or .mdx extension.",
            canonical_path.display(),
        ));
    }
    let metadata = fs::metadata(&canonical_path).map_err(|_| {
        AppError::labeled("Markdown file could not be read.", canonical_path.display())
    })?;
    if !metadata.is_file() {
        return Err(AppError::labeled(
            "Markdown source is not a regular file.",
            canonical_path.display(),
        ));
    }
    if metadata.len() > MAX_SOURCE_BYTES {
        return Err(source_too_large(canonical_path.display()));
    }

    let file = File::open(&canonical_path).map_err(|_| {
        AppError::labeled("Markdown file could not be read.", canonical_path.display())
    })?;
    let bytes = read_bounded(
        file,
        canonical_path.display(),
        "Markdown file could not be read.",
    )?;
    let markdown = String::from_utf8(bytes)
        .map_err(|_| AppError::labeled("Input is not valid UTF-8.", canonical_path.display()))?;
    let asset_base = canonical_path
        .parent()
        .expect("a canonical file path has a parent")
        .to_owned();

    Ok(MarkdownSource::File {
        markdown,
        canonical_path,
        asset_base,
    })
}

fn read_stdin_source(
    stdin: &mut (impl Read + ?Sized),
    cwd: &Path,
) -> Result<MarkdownSource, AppError> {
    let bytes = read_bounded(stdin, "stdin", "Could not read Markdown from stdin.")?;
    let markdown = String::from_utf8(bytes)
        .map_err(|_| AppError::labeled("Input is not valid UTF-8.", "stdin"))?;
    if markdown.trim().is_empty() {
        return Err(AppError::labeled("Piped Markdown is empty.", "stdin"));
    }

    Ok(MarkdownSource::Stdin {
        markdown,
        cwd: cwd.to_owned(),
    })
}

fn read_clipboard_source(
    clipboard: &mut impl ClipboardAdapter,
    cwd: &Path,
) -> Result<MarkdownSource, AppError> {
    match clipboard.file_list().map_err(clipboard_app_error)? {
        Some(paths) if !paths.is_empty() => {
            if paths.len() != 1 {
                return Err(AppError::labeled(
                    "Expected exactly one Markdown file in the native file list.",
                    "clipboard",
                ));
            }
            return read_file_path(&paths[0], cwd)
                .map_err(|error| AppError::labeled(error.to_string(), "clipboard"));
        }
        Some(_) | None => {}
    }

    let text = clipboard.text().map_err(clipboard_app_error)?;
    if text.is_empty() {
        return Err(AppError::labeled("Clipboard text is empty.", "clipboard"));
    }
    if text.len() as u64 > MAX_SOURCE_BYTES {
        return Err(source_too_large("clipboard"));
    }

    let candidate = text.trim();
    if !candidate.is_empty() && !candidate.chars().any(is_line_break) {
        let candidate_path = Path::new(candidate);
        if candidate_path.is_absolute() && has_markdown_extension(candidate_path) {
            return read_file_path(candidate_path, cwd)
                .map_err(|error| AppError::labeled(error.to_string(), "clipboard"));
        }
        if let Ok(url) = Url::parse(candidate) {
            if url.scheme() == "file" {
                let path = url.to_file_path().map_err(|()| {
                    AppError::labeled("File URL is not a valid local path.", "clipboard")
                })?;
                return read_file_path(&path, cwd)
                    .map_err(|error| AppError::labeled(error.to_string(), "clipboard"));
            }
        } else if has_markdown_extension(candidate_path) {
            return read_file_path(candidate_path, cwd)
                .map_err(|error| AppError::labeled(error.to_string(), "clipboard"));
        }
    }

    Ok(MarkdownSource::Clipboard {
        markdown: text,
        cwd: cwd.to_owned(),
    })
}

pub(crate) enum BoundedReadError {
    Read(std::io::Error),
    TooLarge,
}

pub(crate) fn read_bounded_bytes(reader: impl Read) -> Result<Vec<u8>, BoundedReadError> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_SOURCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(BoundedReadError::Read)?;
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        return Err(BoundedReadError::TooLarge);
    }
    Ok(bytes)
}

fn read_bounded(
    reader: impl Read,
    label: impl std::fmt::Display,
    read_error: &'static str,
) -> Result<Vec<u8>, AppError> {
    match read_bounded_bytes(reader) {
        Ok(bytes) => Ok(bytes),
        Err(BoundedReadError::Read(_)) => Err(AppError::labeled(read_error, label)),
        Err(BoundedReadError::TooLarge) => Err(source_too_large(label)),
    }
}

fn source_too_large(label: impl std::fmt::Display) -> AppError {
    AppError::labeled("Input exceeds the 10 MiB limit.", label)
}

fn has_markdown_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("mdx")
        })
}

fn is_line_break(character: char) -> bool {
    matches!(
        character,
        '\n' | '\r' | '\u{0085}' | '\u{2028}' | '\u{2029}'
    )
}

pub(crate) fn redacted_url(url: &Url) -> Url {
    let mut redacted = url.clone();
    let _ = redacted.set_password(None);
    let _ = redacted.set_username("");
    redacted
}

pub(crate) fn normalized_original_url(url: &Url) -> Url {
    let mut normalized = url.clone();
    normalized.set_fragment(None);
    normalized
}

pub(crate) fn url_stem(url: &Url) -> Option<String> {
    let segment = url.path_segments()?.next_back()?;
    if segment.is_empty() {
        return None;
    }
    let decoded = percent_decode_str(segment).decode_utf8_lossy();
    let stem = Path::new(decoded.as_ref()).file_stem()?.to_str()?;
    (!stem.is_empty()).then(|| stem.to_owned())
}

fn path_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("Markdown document")
        .to_owned()
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::io::{Cursor, Error};

    use tempfile::tempdir;

    use crate::clipboard::ClipboardError;

    use super::*;

    struct FakeClipboard {
        files: Result<Option<Vec<PathBuf>>, ClipboardError>,
        text: Result<String, ClipboardError>,
        file_reads: Cell<usize>,
        text_reads: Cell<usize>,
    }

    impl FakeClipboard {
        fn new(
            files: Result<Option<Vec<PathBuf>>, ClipboardError>,
            text: Result<impl Into<String>, ClipboardError>,
        ) -> Self {
            Self {
                files,
                text: text.map(Into::into),
                file_reads: Cell::new(0),
                text_reads: Cell::new(0),
            }
        }
    }

    impl ClipboardAdapter for FakeClipboard {
        fn file_list(&mut self) -> Result<Option<Vec<PathBuf>>, ClipboardError> {
            self.file_reads.set(self.file_reads.get() + 1);
            self.files.clone()
        }

        fn text(&mut self) -> Result<String, ClipboardError> {
            self.text_reads.set(self.text_reads.get() + 1);
            self.text.clone()
        }
    }

    fn load(
        request: SourceRequest,
        input: &[u8],
        cwd: &Path,
        clipboard: &mut FakeClipboard,
    ) -> Result<MarkdownSource, AppError> {
        load_source_request_with_clipboard(request, &mut Cursor::new(input), cwd, clipboard)
    }

    fn no_clipboard() -> FakeClipboard {
        FakeClipboard::new(Ok(None), Ok("unused"))
    }

    #[test]
    fn file_argument_wins_over_stdin_and_accepts_md_mdx_case_insensitively() {
        let directory = tempdir().unwrap();
        for name in ["Résumé 世界.MD", "component.MdX"] {
            fs::write(directory.path().join(name), format!("# {name}\n")).unwrap();
            let request = select_source(Some(name), false).unwrap();
            let source = load(
                request,
                b"# ignored\n",
                directory.path(),
                &mut no_clipboard(),
            )
            .unwrap();
            assert!(matches!(source, MarkdownSource::File { .. }));
            assert!(source.markdown().contains(name));
        }
    }

    #[test]
    fn file_loading_is_canonical_regular_and_strict_utf8() {
        let directory = tempdir().unwrap();
        assert!(
            read_file_source("missing.md", directory.path())
                .unwrap_err()
                .to_string()
                .ends_with("Markdown file was not found.")
        );
        assert!(
            read_file_source("notes.txt", directory.path())
                .unwrap_err()
                .to_string()
                .ends_with("Expected a Markdown file with a .md or .mdx extension.")
        );
        fs::create_dir(directory.path().join("folder.md")).unwrap();
        assert!(
            read_file_source("folder.md", directory.path())
                .unwrap_err()
                .to_string()
                .ends_with("Markdown source is not a regular file.")
        );
        fs::write(directory.path().join("invalid.md"), [0xc3, 0x28]).unwrap();
        assert!(
            read_file_source("invalid.md", directory.path())
                .unwrap_err()
                .to_string()
                .ends_with("Input is not valid UTF-8.")
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_uses_canonical_file_identity_and_resource_base() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let real = directory.path().join("real.md");
        let alias = directory.path().join("alias.md");
        fs::write(&real, "# Linked\n").unwrap();
        symlink(&real, &alias).unwrap();
        let MarkdownSource::File {
            canonical_path,
            asset_base,
            ..
        } = read_file_source("alias.md", directory.path()).unwrap()
        else {
            panic!("expected file source")
        };
        assert_eq!(canonical_path, fs::canonicalize(real).unwrap());
        assert_eq!(asset_base, canonical_path.parent().unwrap());
    }

    #[test]
    fn bounded_reader_accepts_exact_limit_rejects_next_byte_and_stops() {
        assert_eq!(
            read_bounded(
                Cursor::new(vec![b'a'; MAX_SOURCE_BYTES as usize]),
                "test",
                "read failed"
            )
            .unwrap()
            .len() as u64,
            MAX_SOURCE_BYTES
        );
        assert_eq!(
            read_bounded(
                Cursor::new(vec![b'a'; MAX_SOURCE_BYTES as usize + 1]),
                "test",
                "read failed"
            )
            .unwrap_err()
            .to_string(),
            "test: Input exceeds the 10 MiB limit."
        );

        struct GrowingReader {
            remaining: u64,
            read: u64,
        }
        impl Read for GrowingReader {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                if self.remaining == 0 {
                    return Ok(0);
                }
                let count = buffer.len().min(self.remaining as usize);
                buffer[..count].fill(b'x');
                self.remaining -= count as u64;
                self.read += count as u64;
                Ok(count)
            }
        }
        let mut reader = GrowingReader {
            remaining: MAX_SOURCE_BYTES * 2,
            read: 0,
        };
        assert!(
            read_bounded(&mut reader, "growing", "read failed")
                .unwrap_err()
                .to_string()
                .contains("10 MiB")
        );
        assert_eq!(reader.read, MAX_SOURCE_BYTES + 1);
    }

    #[test]
    fn bounded_reader_preserves_read_and_utf8_errors() {
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(Error::other("broken"))
            }
        }
        assert_eq!(
            read_stdin_source(&mut Broken, Path::new("/cwd"))
                .unwrap_err()
                .to_string(),
            "stdin: Could not read Markdown from stdin."
        );
        assert_eq!(
            read_stdin_source(&mut Cursor::new([0x66, 0x80]), Path::new("/cwd"))
                .unwrap_err()
                .to_string(),
            "stdin: Input is not valid UTF-8."
        );
    }

    #[test]
    fn redirected_stdin_is_nonempty_and_never_reads_clipboard() {
        let mut clipboard = FakeClipboard::new(
            Err(ClipboardError::Unavailable),
            Err::<String, _>(ClipboardError::Unavailable),
        );
        let source = load(
            SourceRequest::Stdin,
            b"# piped\n",
            Path::new("/workspace"),
            &mut clipboard,
        )
        .unwrap();
        assert!(matches!(source, MarkdownSource::Stdin { .. }));
        assert_eq!(clipboard.file_reads.get(), 0);
        assert_eq!(clipboard.text_reads.get(), 0);
        assert_eq!(
            load(
                SourceRequest::Stdin,
                b" \n\t",
                Path::new("/workspace"),
                &mut clipboard
            )
            .unwrap_err()
            .to_string(),
            "stdin: Piped Markdown is empty."
        );
    }

    #[test]
    fn authoritative_native_file_list_loads_one_file_without_text_fallback() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(" leading name.MDX");
        fs::write(&path, "# Native\n").unwrap();
        let mut clipboard = FakeClipboard::new(
            Ok(Some(vec![path.clone()])),
            Err::<String, _>(ClipboardError::Unavailable),
        );
        let source = load(
            SourceRequest::Clipboard,
            b"",
            directory.path(),
            &mut clipboard,
        )
        .unwrap();
        assert!(matches!(source, MarkdownSource::File { .. }));
        assert_eq!(source.markdown(), "# Native\n");
        assert_eq!(clipboard.text_reads.get(), 0);
    }

    #[test]
    fn authoritative_native_list_never_falls_back_after_any_failure() {
        let directory = tempdir().unwrap();
        let unsupported = directory.path().join("notes.txt");
        fs::write(&unsupported, "# text").unwrap();
        let invalid = directory.path().join("invalid.md");
        fs::write(&invalid, [0xff]).unwrap();
        let oversized = directory.path().join("large.md");
        fs::write(&oversized, vec![b'x'; MAX_SOURCE_BYTES as usize + 1]).unwrap();

        let cases = vec![
            vec![directory.path().join("missing.md")],
            vec![unsupported],
            vec![invalid],
            vec![oversized],
            vec![
                directory.path().join("one.md"),
                directory.path().join("two.md"),
            ],
        ];
        for paths in cases {
            let mut clipboard = FakeClipboard::new(Ok(Some(paths)), Ok("# fallback"));
            let error = load(
                SourceRequest::Clipboard,
                b"",
                directory.path(),
                &mut clipboard,
            )
            .unwrap_err();
            assert!(error.to_string().starts_with("clipboard:"), "{error}");
            assert_eq!(clipboard.text_reads.get(), 0);
        }

        for kind in [
            ClipboardError::Unavailable,
            ClipboardError::Occupied,
            ClipboardError::Conversion,
        ] {
            let mut clipboard = FakeClipboard::new(Err(kind), Ok("# fallback"));
            let error = load(
                SourceRequest::Clipboard,
                b"",
                directory.path(),
                &mut clipboard,
            )
            .unwrap_err();
            assert!(error.to_string().starts_with("clipboard:"), "{error}");
            assert_eq!(clipboard.text_reads.get(), 0);
        }
    }

    #[test]
    fn absent_or_empty_native_list_uses_exact_nonempty_text() {
        for files in [None, Some(Vec::new())] {
            let original = "  # exact clipboard text  \n";
            let mut clipboard = FakeClipboard::new(Ok(files), Ok(original));
            let source = load(
                SourceRequest::Clipboard,
                b"",
                Path::new("/workspace"),
                &mut clipboard,
            )
            .unwrap();
            let MarkdownSource::Clipboard { markdown, .. } = source else {
                panic!("expected clipboard text")
            };
            assert_eq!(markdown, original);
            assert_eq!(clipboard.text_reads.get(), 1);
        }

        let mut clipboard = FakeClipboard::new(Ok(None), Ok(""));
        assert_eq!(
            load(
                SourceRequest::Clipboard,
                b"",
                Path::new("/workspace"),
                &mut clipboard
            )
            .unwrap_err()
            .to_string(),
            "clipboard: Clipboard text is empty."
        );
    }

    #[test]
    fn clipboard_text_classifies_trimmed_single_line_paths_and_file_urls() {
        let directory = tempdir().unwrap();
        let relative = directory.path().join("relative.md");
        let absolute = directory.path().join("absolute.MDX");
        fs::write(&relative, "# Relative\n").unwrap();
        fs::write(&absolute, "# Absolute\n").unwrap();
        let file_url = Url::from_file_path(&absolute).unwrap().to_string();

        for (text, expected) in [
            ("\u{2003}relative.md\u{2002}".to_owned(), "# Relative\n"),
            (absolute.display().to_string(), "# Absolute\n"),
            (file_url, "# Absolute\n"),
        ] {
            let mut clipboard = FakeClipboard::new(Ok(None), Ok(text));
            let source = load(
                SourceRequest::Clipboard,
                b"",
                directory.path(),
                &mut clipboard,
            )
            .unwrap();
            assert!(matches!(source, MarkdownSource::File { .. }));
            assert_eq!(source.markdown(), expected);
        }
    }

    #[test]
    fn clipboard_path_failures_are_authoritative_but_http_and_multiline_are_text() {
        let directory = tempdir().unwrap();
        for candidate in ["missing.md", "file:///definitely/missing.mdx"] {
            let mut clipboard = FakeClipboard::new(Ok(None), Ok(candidate));
            let error = load(
                SourceRequest::Clipboard,
                b"",
                directory.path(),
                &mut clipboard,
            )
            .unwrap_err();
            assert!(error.to_string().starts_with("clipboard:"), "{error}");
        }

        for original in [
            "https://example.test/readme.md?q=1",
            "relative.md\nsecond line",
            "   ",
        ] {
            let mut clipboard = FakeClipboard::new(Ok(None), Ok(original));
            let source = load(
                SourceRequest::Clipboard,
                b"",
                directory.path(),
                &mut clipboard,
            )
            .unwrap();
            assert!(matches!(source, MarkdownSource::Clipboard { .. }));
            assert_eq!(source.markdown(), original);
        }
    }

    #[test]
    fn clipboard_text_enforces_byte_limit_and_adapter_errors() {
        let mut exact = FakeClipboard::new(Ok(None), Ok("x".repeat(MAX_SOURCE_BYTES as usize)));
        let source = load(
            SourceRequest::Clipboard,
            b"",
            Path::new("/workspace"),
            &mut exact,
        )
        .unwrap();
        assert_eq!(source.markdown().len() as u64, MAX_SOURCE_BYTES);

        let mut clipboard =
            FakeClipboard::new(Ok(None), Ok("x".repeat(MAX_SOURCE_BYTES as usize + 1)));
        assert_eq!(
            load(
                SourceRequest::Clipboard,
                b"",
                Path::new("/workspace"),
                &mut clipboard
            )
            .unwrap_err()
            .to_string(),
            "clipboard: Input exceeds the 10 MiB limit."
        );

        for kind in [
            ClipboardError::NoContent,
            ClipboardError::Unavailable,
            ClipboardError::Occupied,
            ClipboardError::Conversion,
        ] {
            let mut clipboard = FakeClipboard::new(Ok(None), Err::<String, _>(kind));
            let error = load(
                SourceRequest::Clipboard,
                b"",
                Path::new("/workspace"),
                &mut clipboard,
            )
            .unwrap_err();
            assert!(error.to_string().starts_with("clipboard:"), "{error}");
        }
    }

    struct FakeRemoteFetcher {
        result: std::cell::RefCell<Option<Result<crate::remote::RemoteDocument, AppError>>>,
    }

    impl crate::remote::RemoteFetcher for FakeRemoteFetcher {
        fn fetch(&self, _: &Url) -> Result<crate::remote::RemoteDocument, AppError> {
            self.result.borrow_mut().take().unwrap()
        }
    }

    #[test]
    fn injected_remote_fetch_preserves_identity_and_sanitizes_cross_scheme_final_base() {
        let original = Url::parse("https://user:secret@example.test/original.md?q=1#part").unwrap();
        let fetcher = FakeRemoteFetcher {
            result: std::cell::RefCell::new(Some(Ok(crate::remote::RemoteDocument {
                markdown: "# fetched".to_owned(),
                final_url: Url::parse("http://target:token@127.0.0.1:8080/final.md?q=2").unwrap(),
            }))),
        };
        let source = read_remote_source_with_fetcher(&original, &fetcher).unwrap();
        let MarkdownSource::Remote {
            original_url,
            resource_base,
            ..
        } = source
        else {
            panic!("expected remote source")
        };
        assert_eq!(original_url, original);
        assert_eq!(resource_base.as_str(), "http://127.0.0.1:8080/final.md?q=2");
        assert!(!resource_base.as_str().contains("target"));
        assert!(!resource_base.as_str().contains("token"));

        let fetcher = FakeRemoteFetcher {
            result: std::cell::RefCell::new(Some(Ok(crate::remote::RemoteDocument {
                markdown: "# fetched".to_owned(),
                final_url: Url::parse("file:///tmp/final.md").unwrap(),
            }))),
        };
        let error = read_remote_source_with_fetcher(&original, &fetcher)
            .unwrap_err()
            .to_string();
        assert!(error.contains("unsafe final URL"));
        assert!(!error.contains("user"));
        assert!(!error.contains("secret"));
    }

    #[test]
    fn remote_metadata_redacts_labels_and_derives_safe_title_inputs() {
        let original =
            Url::parse("https://user:secret@example.test/docs/CHANGELOG.md?q=one#private-fragment")
                .unwrap();
        let resource =
            Url::parse("https://other:token@example.test/final/API%20Notes.mdx").unwrap();
        let source = MarkdownSource::Remote {
            markdown: "# fetched".to_owned(),
            original_url: original.clone(),
            resource_base: resource,
        };
        assert_eq!(
            source.label(),
            "https://example.test/docs/CHANGELOG.md?q=one#private-fragment"
        );
        assert!(!source.label().contains("user"));
        assert!(!source.label().contains("secret"));
        assert_eq!(source.fallback_title(), "API Notes");
        assert_eq!(
            normalized_original_url(&original).as_str(),
            "https://user:secret@example.test/docs/CHANGELOG.md?q=one"
        );
    }
}
