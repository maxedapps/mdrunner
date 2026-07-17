use std::path::Path;

use url::Url;

use crate::AppError;

pub(crate) fn open_output(path: &Path) -> Result<(), AppError> {
    let url = file_url(path)?;
    webbrowser::open(url.as_str())
        .map_err(|_| AppError::new("Could not open generated HTML in the default browser."))
}

fn file_url(path: &Path) -> Result<Url, AppError> {
    if !path.is_absolute() {
        return Err(AppError::new("Generated HTML path is not absolute."));
    }
    Url::from_file_path(path)
        .map_err(|()| AppError::new("Could not convert generated HTML path to a file URL."))
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn absolute_paths_become_encoded_file_urls() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("Space # & 世界.html");
        let url = file_url(&path).unwrap();
        assert_eq!(url.scheme(), "file");
        assert!(url.as_str().contains("Space%20%23%20&%20"));
        assert!(!url.as_str().contains(' '));
        assert!(!url.as_str().contains('世'));
    }

    #[test]
    fn relative_paths_are_rejected_before_the_browser_boundary() {
        assert_eq!(
            file_url(Path::new("relative output.html"))
                .unwrap_err()
                .to_string(),
            "Generated HTML path is not absolute."
        );
    }
}
