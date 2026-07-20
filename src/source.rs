use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::AppError;

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
}

impl MarkdownSource {
    pub(crate) fn markdown(&self) -> &str {
        match self {
            Self::File { markdown, .. } | Self::Stdin { markdown, .. } => markdown,
        }
    }

    pub(crate) fn asset_base(&self) -> &Path {
        match self {
            Self::File { asset_base, .. } => asset_base,
            Self::Stdin { cwd, .. } => cwd,
        }
    }

    pub(crate) fn label(&self) -> String {
        match self {
            Self::File { canonical_path, .. } => canonical_path.display().to_string(),
            Self::Stdin { .. } => "stdin".to_owned(),
        }
    }
}

#[derive(Debug)]
pub(crate) enum SourceSelection {
    Help,
    Version,
    Render(MarkdownSource),
}

pub(crate) fn read_markdown_source(
    args: &[String],
    stdin: &mut impl Read,
    stdin_is_terminal: bool,
    cwd: &Path,
) -> Result<SourceSelection, AppError> {
    if args.len() == 1 {
        match args[0].as_str() {
            "-h" | "--help" => return Ok(SourceSelection::Help),
            "-V" | "--version" => return Ok(SourceSelection::Version),
            _ => {}
        }
    }
    if args.len() > 1 {
        return Err(AppError::new(
            "Expected one .md file or piped Markdown; use --help for usage.",
        ));
    }

    if let Some(argument) = args.first() {
        return read_file_source(argument, cwd).map(SourceSelection::Render);
    }

    read_stdin_source(stdin, stdin_is_terminal, cwd).map(SourceSelection::Render)
}

pub(crate) fn read_file_source(argument: &str, cwd: &Path) -> Result<MarkdownSource, AppError> {
    let requested_path = cwd.join(argument);
    let has_markdown_extension = requested_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"));
    if !has_markdown_extension {
        return Err(AppError::labeled(
            "Expected a Markdown file with a .md extension.",
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

    let metadata = fs::metadata(&canonical_path).map_err(|_| {
        AppError::labeled("Markdown file could not be read.", canonical_path.display())
    })?;
    if !metadata.is_file() {
        return Err(AppError::labeled(
            "Markdown source is not a regular file.",
            canonical_path.display(),
        ));
    }

    let bytes = fs::read(&canonical_path).map_err(|_| {
        AppError::labeled("Markdown file could not be read.", canonical_path.display())
    })?;
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
    stdin: &mut impl Read,
    stdin_is_terminal: bool,
    cwd: &Path,
) -> Result<MarkdownSource, AppError> {
    if stdin_is_terminal {
        return Err(AppError::new(
            "Provide one .md file or pipe Markdown through stdin.",
        ));
    }

    let mut bytes = Vec::new();
    stdin
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::labeled("Could not read Markdown from stdin.", "stdin"))?;
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

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use tempfile::tempdir;

    use super::*;

    fn select(
        args: &[&str],
        input: &[u8],
        terminal: bool,
        cwd: &Path,
    ) -> Result<SourceSelection, AppError> {
        let args = args.iter().map(ToString::to_string).collect::<Vec<_>>();
        read_markdown_source(&args, &mut Cursor::new(input), terminal, cwd)
    }

    #[test]
    fn help_and_argument_count_are_strict() {
        let cwd = Path::new("/unused");
        assert!(matches!(
            select(&["-h"], b"", true, cwd),
            Ok(SourceSelection::Help)
        ));
        assert!(matches!(
            select(&["--help"], b"", true, cwd),
            Ok(SourceSelection::Help)
        ));
        assert_eq!(
            select(&["one.md", "two.md"], b"", false, cwd)
                .unwrap_err()
                .to_string(),
            "Expected one .md file or piped Markdown; use --help for usage."
        );
    }

    #[test]
    fn version_flags_are_exact_and_do_not_read_stdin() {
        struct Unreadable;

        impl Read for Unreadable {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                panic!("version selection must not read stdin")
            }
        }

        let cwd = Path::new("/unused");
        for flag in ["-V", "--version"] {
            let args = vec![flag.to_owned()];
            assert!(matches!(
                read_markdown_source(&args, &mut Unreadable, false, cwd),
                Ok(SourceSelection::Version)
            ));
        }

        for args in [["--version", "extra.md"], ["-V", "extra.md"]] {
            assert_eq!(
                select(&args, b"# ignored\n", false, cwd)
                    .unwrap_err()
                    .to_string(),
                "Expected one .md file or piped Markdown; use --help for usage."
            );
        }
    }

    #[test]
    fn file_argument_wins_and_accepts_case_insensitive_extension() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("Résumé 世界.MD");
        fs::write(&path, "# Preferred 🧁\n").unwrap();

        let selection = select(
            &[path.to_str().unwrap()],
            b"# ignored\n",
            false,
            directory.path(),
        )
        .unwrap();
        let SourceSelection::Render(MarkdownSource::File {
            markdown,
            canonical_path,
            asset_base,
        }) = selection
        else {
            panic!("expected file source")
        };
        assert_eq!(markdown, "# Preferred 🧁\n");
        assert_eq!(canonical_path, fs::canonicalize(path).unwrap());
        assert_eq!(asset_base, canonical_path.parent().unwrap());
    }

    #[test]
    fn rejects_missing_wrong_extension_directory_and_invalid_utf8() {
        let directory = tempdir().unwrap();
        assert!(
            select(&["missing.md"], b"", false, directory.path())
                .unwrap_err()
                .to_string()
                .ends_with("Markdown file was not found.")
        );
        assert!(
            select(&["notes.txt"], b"", false, directory.path())
                .unwrap_err()
                .to_string()
                .ends_with("Expected a Markdown file with a .md extension.")
        );

        let folder = directory.path().join("folder.md");
        fs::create_dir(&folder).unwrap();
        assert!(
            select(&["folder.md"], b"", false, directory.path())
                .unwrap_err()
                .to_string()
                .ends_with("Markdown source is not a regular file.")
        );

        fs::write(directory.path().join("invalid.md"), [0xc3, 0x28]).unwrap();
        assert!(
            select(&["invalid.md"], b"", false, directory.path())
                .unwrap_err()
                .to_string()
                .ends_with("Input is not valid UTF-8.")
        );
    }

    #[cfg(unix)]
    #[test]
    fn resolves_symlinks_to_canonical_file_context() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let real = directory.path().join("real.md");
        let alias = directory.path().join("alias.md");
        fs::write(&real, "# Linked\n").unwrap();
        symlink(&real, &alias).unwrap();

        let SourceSelection::Render(MarkdownSource::File { canonical_path, .. }) =
            select(&["alias.md"], b"", true, directory.path()).unwrap()
        else {
            panic!("expected file source")
        };
        assert_eq!(canonical_path, fs::canonicalize(real).unwrap());
    }

    #[test]
    fn stdin_requires_redirection_nonempty_strict_utf8() {
        let cwd = Path::new("/workspace");
        assert_eq!(
            select(&[], b"", true, cwd).unwrap_err().to_string(),
            "Provide one .md file or pipe Markdown through stdin."
        );
        assert_eq!(
            select(&[], b" \n\t", false, cwd).unwrap_err().to_string(),
            "stdin: Piped Markdown is empty."
        );
        assert_eq!(
            select(&[], &[0x66, 0x80], false, cwd)
                .unwrap_err()
                .to_string(),
            "stdin: Input is not valid UTF-8."
        );

        let SourceSelection::Render(MarkdownSource::Stdin {
            markdown,
            cwd: actual,
        }) = select(&[], b"# piped\n", false, cwd).unwrap()
        else {
            panic!("expected stdin source")
        };
        assert_eq!(markdown, "# piped\n");
        assert_eq!(actual, cwd);
    }
}
