use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use crate::AppError;
use crate::source::MarkdownSource;

pub(crate) fn write_output(source: &MarkdownSource, html: &str) -> Result<PathBuf, AppError> {
    write_output_in(source, html, &std::env::temp_dir())
}

fn write_output_in(
    source: &MarkdownSource,
    html: &str,
    temporary_directory: &Path,
) -> Result<PathBuf, AppError> {
    let destination = output_path_for_source(source, temporary_directory);
    let directory = destination
        .parent()
        .expect("the output path always has a parent");

    fs::create_dir_all(directory).map_err(|_| output_error(&destination))?;
    let mut temporary = NamedTempFile::new_in(directory).map_err(|_| output_error(&destination))?;
    temporary
        .write_all(html.as_bytes())
        .map_err(|_| output_error(&destination))?;
    temporary
        .persist(&destination)
        .map_err(|_| output_error(&destination))?;

    Ok(destination)
}

fn output_error(destination: &Path) -> AppError {
    AppError::labeled("Could not write generated HTML.", destination.display())
}

fn output_path_for_source(source: &MarkdownSource, temporary_directory: &Path) -> PathBuf {
    temporary_directory
        .join("mdr")
        .join(cache_digest(source))
        .join(format!("{}.html", output_stem(source)))
}

fn cache_digest(source: &MarkdownSource) -> String {
    let mut digest = Sha256::new();
    match source {
        MarkdownSource::File { canonical_path, .. } => {
            digest.update(canonical_path.as_os_str().as_encoded_bytes());
        }
        MarkdownSource::Stdin { markdown, cwd } => {
            digest.update(cwd.as_os_str().as_encoded_bytes());
            digest.update([0]);
            digest.update(markdown.as_bytes());
        }
    }
    format!("{:x}", digest.finalize())
}

fn output_stem(source: &MarkdownSource) -> String {
    match source {
        MarkdownSource::File { canonical_path, .. } => sanitize_output_stem(
            &canonical_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy(),
        ),
        MarkdownSource::Stdin { .. } => "stdin".to_owned(),
    }
}

fn sanitize_output_stem(stem: &str) -> String {
    let mut result = stem
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect::<String>();
    result.truncate(result.trim_end_matches(['.', ' ']).len());

    let device_part = result.split('.').next().unwrap_or_default();
    if result.is_empty() || is_windows_device_name(device_part) {
        "document".to_owned()
    } else {
        result
    }
}

fn is_windows_device_name(value: &str) -> bool {
    let upper = value.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .or_else(|| upper.strip_prefix("LPT"))
            .is_some_and(|number| {
                matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use tempfile::tempdir;

    use super::*;

    fn file_source(path: PathBuf) -> MarkdownSource {
        MarkdownSource::File {
            asset_base: path.parent().unwrap().to_owned(),
            canonical_path: path,
            markdown: "ignored for file identity".to_owned(),
        }
    }

    fn stdin_source(markdown: &str, cwd: &Path) -> MarkdownSource {
        MarkdownSource::Stdin {
            markdown: markdown.to_owned(),
            cwd: cwd.to_owned(),
        }
    }

    #[test]
    fn paths_are_stable_and_source_identity_is_complete() {
        let root = Path::new("/cache root");
        let file = file_source(PathBuf::from("/workspace/Notes & Résumé.md"));
        let first = output_path_for_source(&file, root);
        let second = output_path_for_source(&file, root);
        assert_eq!(first, second);
        assert_eq!(first.file_name().unwrap(), "Notes & Résumé.html");
        assert_eq!(cache_digest(&file).len(), 64);

        let changed_file_markdown = MarkdownSource::File {
            markdown: "changed".to_owned(),
            canonical_path: PathBuf::from("/workspace/Notes & Résumé.md"),
            asset_base: PathBuf::from("/workspace"),
        };
        assert_eq!(cache_digest(&file), cache_digest(&changed_file_markdown));

        let stdin = stdin_source("# Hello\n", Path::new("/workspace"));
        assert_eq!(
            output_path_for_source(&stdin, root).file_name().unwrap(),
            "stdin.html"
        );
        assert_ne!(
            cache_digest(&stdin),
            cache_digest(&stdin_source("# Changed\n", Path::new("/workspace")))
        );
        assert_ne!(
            cache_digest(&stdin),
            cache_digest(&stdin_source("# Hello\n", Path::new("/other")))
        );
    }

    #[test]
    fn portable_stems_replace_only_forbidden_text_and_reserved_names() {
        assert_eq!(sanitize_output_stem("archive.tar"), "archive.tar");
        assert_eq!(sanitize_output_stem("bad<name> ."), "bad-name-");
        assert_eq!(sanitize_output_stem("bad\u{0007}name"), "bad-name");
        assert_eq!(sanitize_output_stem("...."), "document");
        assert_eq!(sanitize_output_stem("CON"), "document");
        assert_eq!(sanitize_output_stem("con.report"), "document");
        assert_eq!(sanitize_output_stem("COM9"), "document");
        assert_eq!(sanitize_output_stem("LPT10"), "LPT10");
        assert_eq!(sanitize_output_stem("Résumé 世界"), "Résumé 世界");
    }

    #[test]
    fn persistence_replaces_complete_file_without_temporary_siblings() {
        let temporary_directory = tempdir().unwrap();
        let source = file_source(temporary_directory.path().join("source.md"));
        let first = write_output_in(&source, "first complete", temporary_directory.path()).unwrap();
        let second =
            write_output_in(&source, "second complete", temporary_directory.path()).unwrap();

        assert_eq!(first, second);
        assert_eq!(fs::read_to_string(&first).unwrap(), "second complete");
        let entries = fs::read_dir(first.parent().unwrap())
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path(), first);
    }

    #[test]
    fn filesystem_failures_are_concise() {
        let temporary_directory = tempdir().unwrap();
        let unusable_root = temporary_directory.path().join("not-a-directory");
        fs::write(&unusable_root, "file").unwrap();
        let source = file_source(temporary_directory.path().join("source.md"));

        let error = write_output_in(&source, "complete", &unusable_root).unwrap_err();
        assert!(
            error
                .to_string()
                .ends_with("Could not write generated HTML.")
        );
    }
}
