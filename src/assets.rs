use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use percent_encoding::percent_decode_str;
use url::Url;

use crate::AppError;

pub(crate) fn resolve_remote_image(
    raw: &str,
    source_base: &Url,
    source_label: &str,
    line: usize,
    column: usize,
) -> Result<String, AppError> {
    let value = raw.trim();
    let context = format!("{source_label}:{line}:{column}");
    if value.is_empty() {
        return Err(AppError::labeled("Image URL is empty.", context));
    }
    if value.starts_with("//") {
        return Err(AppError::labeled(
            "Protocol-relative image URLs are not allowed.",
            context,
        ));
    }
    if value.contains('\\') {
        return Err(AppError::labeled(
            "Image URL is unsafe or invalid.",
            context,
        ));
    }

    if let Ok(url) = Url::parse(value) {
        return if matches!(url.scheme(), "http" | "https") && url.host_str().is_some() {
            Ok(value.to_owned())
        } else {
            Err(AppError::labeled(
                "Image URL scheme is not allowed.",
                context,
            ))
        };
    }

    let joined = source_base
        .join(value)
        .map_err(|_| AppError::labeled("Image URL is unsafe or invalid.", context.clone()))?;
    if matches!(joined.scheme(), "http" | "https") && joined.host_str().is_some() {
        Ok(joined.to_string())
    } else {
        Err(AppError::labeled(
            "Image URL scheme is not allowed.",
            context,
        ))
    }
}

pub(crate) fn resolve_image(
    raw: &str,
    source_base: &Path,
    source_label: &str,
    line: usize,
    column: usize,
) -> Result<String, AppError> {
    let value = raw.trim();
    let context = format!("{source_label}:{line}:{column}");

    if value.is_empty() {
        return Err(AppError::labeled("Image URL is empty.", context));
    }
    if value.starts_with("//") {
        return Err(AppError::labeled(
            "Protocol-relative image URLs are not allowed.",
            context,
        ));
    }

    if let Ok(url) = Url::parse(value) {
        return match url.scheme() {
            "http" | "https" if url.host_str().is_some() => Ok(value.to_owned()),
            "http" | "https" => Err(AppError::labeled("Remote image URL is invalid.", context)),
            _ => Err(AppError::labeled(
                "Image URL scheme is not allowed.",
                context,
            )),
        };
    }

    let path_part = value.split(['?', '#']).next().unwrap_or_default();
    if path_part.is_empty()
        || path_part.starts_with(['/', '\\'])
        || path_part.contains('\\')
        || Path::new(path_part).is_absolute()
    {
        return Err(AppError::labeled(
            "Image path must be a relative local path.",
            context,
        ));
    }
    validate_percent_encoding(path_part)
        .map_err(|message| AppError::labeled(message, context.clone()))?;
    let decoded = percent_decode_str(path_part)
        .decode_utf8()
        .map_err(|_| AppError::labeled("Image path is not valid UTF-8.", context.clone()))?;
    if decoded.is_empty()
        || decoded.contains('\0')
        || decoded.contains('\\')
        || Path::new(decoded.as_ref()).is_absolute()
    {
        return Err(AppError::labeled("Image path is invalid.", context));
    }

    let canonical_base = fs::canonicalize(source_base).map_err(|_| {
        AppError::labeled(
            "Image source directory could not be resolved.",
            context.clone(),
        )
    })?;
    let target = canonicalize_target(&canonical_base, decoded.as_ref(), &context)?;
    let metadata = fs::metadata(&target)
        .map_err(|_| AppError::labeled("Image asset could not be read.", context.clone()))?;
    if !metadata.is_file() {
        return Err(AppError::labeled(
            "Image asset is not a regular file.",
            context,
        ));
    }

    let mime = mime_for_path(&target)
        .ok_or_else(|| AppError::labeled("Image type is not supported.", context.clone()))?;
    let bytes = fs::read(&target)
        .map_err(|_| AppError::labeled("Image asset could not be read.", context))?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn canonicalize_target(base: &Path, relative: &str, context: &str) -> Result<PathBuf, AppError> {
    let lexical = base.join(relative);
    if !lexical.starts_with(base) {
        return Err(AppError::labeled(
            "Image path escapes the source directory.",
            context,
        ));
    }
    let canonical = fs::canonicalize(&lexical).map_err(|error| {
        let message = if error.kind() == std::io::ErrorKind::NotFound {
            "Image asset was not found."
        } else {
            "Image asset could not be resolved."
        };
        AppError::labeled(message, context)
    })?;
    if !canonical.starts_with(base) {
        return Err(AppError::labeled(
            "Image asset resolves outside the source directory.",
            context,
        ));
    }
    Ok(canonical)
}

fn validate_percent_encoding(value: &str) -> Result<(), &'static str> {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return Err("Image path has invalid percent encoding.");
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    Ok(())
}

fn mime_for_path(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())?
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn resolves_remote_images_without_local_access_and_rejects_unsafe_forms() {
        let base = Url::parse("https://example.test/docs/guide.md?q=old#part").unwrap();
        for (raw, expected) in [
            ("image.png", "https://example.test/docs/image.png"),
            ("/assets/root.png", "https://example.test/assets/root.png"),
            ("?raw=1", "https://example.test/docs/guide.md?raw=1"),
            (
                "#preview",
                "https://example.test/docs/guide.md?q=old#preview",
            ),
            (
                "https://cdn.example.test/a.png?q=1",
                "https://cdn.example.test/a.png?q=1",
            ),
        ] {
            assert_eq!(
                resolve_remote_image(raw, &base, "remote", 2, 3).unwrap(),
                expected
            );
        }
        for unsafe_value in [
            "//example.test/a.png",
            "file:///tmp/a.png",
            "data:image/png;base64,AAAA",
            "javascript:alert(1)",
            "..\\local.png",
            "",
        ] {
            let error = resolve_remote_image(unsafe_value, &base, "remote", 2, 3).unwrap_err();
            assert!(error.to_string().starts_with("remote:2:3:"), "{error}");
        }
    }

    #[test]
    fn embeds_supported_extensions_without_signature_validation() {
        let directory = tempdir().unwrap();
        for (name, mime) in [
            ("a.png", "image/png"),
            ("a.jpg", "image/jpeg"),
            ("a.gif", "image/gif"),
            ("a.webp", "image/webp"),
            ("a.svg", "image/svg+xml"),
        ] {
            fs::write(directory.path().join(name), b"authored bytes").unwrap();
            let uri = resolve_image(name, directory.path(), "doc.md", 2, 1).unwrap();
            assert_eq!(
                uri,
                format!("data:{mime};base64,{}", STANDARD.encode(b"authored bytes"))
            );
        }
    }

    #[test]
    fn decodes_nested_paths_and_discards_query_and_fragment() {
        let directory = tempdir().unwrap();
        let nested = directory.path().join("Unicode ü space");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("tiny image.png"), b"png").unwrap();
        let uri = resolve_image(
            "Unicode%20%C3%BC%20space/tiny%20image.png?download=1#preview",
            directory.path(),
            "stdin",
            1,
            1,
        )
        .unwrap();
        assert_eq!(uri, "data:image/png;base64,cG5n");
    }

    #[test]
    fn preserves_remote_urls_and_rejects_unsafe_or_missing_local_paths() {
        let directory = tempdir().unwrap();
        let remote = "https://images.example.test/a.png?q=1#view";
        assert_eq!(
            resolve_image(remote, directory.path(), "doc.md", 1, 1).unwrap(),
            remote
        );

        for value in [
            "data:image/png;base64,AAAA",
            "file:///tmp/a.png",
            "//example.test/a.png",
            "/tmp/a.png",
            "../outside.png",
            "missing.png",
            "bad%ZZ.png",
        ] {
            let error = resolve_image(value, directory.path(), "doc.md", 7, 3).unwrap_err();
            assert!(error.to_string().starts_with("doc.md:7:3:"), "{error}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_escape_the_canonical_source_base() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let base = root.path().join("base");
        fs::create_dir(&base).unwrap();
        let outside = root.path().join("outside.png");
        fs::write(&outside, b"png").unwrap();
        symlink(&outside, base.join("escape.png")).unwrap();

        let error = resolve_image("escape.png", &base, "doc.md", 1, 1).unwrap_err();
        assert!(error.to_string().contains("outside the source directory"));
    }
}
