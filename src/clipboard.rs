use std::path::PathBuf;

use arboard::{Clipboard, Error as ArboardError};

use crate::AppError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ClipboardError {
    NoContent,
    Unavailable,
    Occupied,
    Conversion,
}

impl ClipboardError {
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::NoContent => "Clipboard does not contain text.",
            Self::Unavailable => "Clipboard is unavailable.",
            Self::Occupied => "Clipboard is busy.",
            Self::Conversion => "Clipboard content could not be converted.",
        }
    }
}

pub(crate) trait ClipboardAdapter {
    /// `None` means that no native file-list format is present. An empty list
    /// is also non-authoritative and is represented separately for testing.
    fn file_list(&mut self) -> Result<Option<Vec<PathBuf>>, ClipboardError>;
    fn text(&mut self) -> Result<String, ClipboardError>;
}

pub(crate) struct SystemClipboard {
    clipboard: Clipboard,
}

impl SystemClipboard {
    pub(crate) fn new() -> Result<Self, AppError> {
        Clipboard::new()
            .map(|clipboard| Self { clipboard })
            .map_err(|error| clipboard_app_error(map_arboard_error(error)))
    }
}

impl ClipboardAdapter for SystemClipboard {
    fn file_list(&mut self) -> Result<Option<Vec<PathBuf>>, ClipboardError> {
        match self.clipboard.get().file_list() {
            Ok(paths) => Ok(Some(paths)),
            Err(ArboardError::ContentNotAvailable) => Ok(None),
            Err(error) => Err(map_arboard_error(error)),
        }
    }

    fn text(&mut self) -> Result<String, ClipboardError> {
        match self.clipboard.get().text() {
            Ok(text) => Ok(text),
            Err(ArboardError::ContentNotAvailable) => Err(ClipboardError::NoContent),
            Err(error) => Err(map_arboard_error(error)),
        }
    }
}

pub(crate) fn clipboard_app_error(error: ClipboardError) -> AppError {
    AppError::labeled(error.message(), "clipboard")
}

fn map_arboard_error(error: ArboardError) -> ClipboardError {
    match error {
        ArboardError::ClipboardOccupied => ClipboardError::Occupied,
        ArboardError::ConversionFailure => ClipboardError::Conversion,
        ArboardError::ContentNotAvailable
        | ArboardError::ClipboardNotSupported
        | ArboardError::Unknown { .. } => ClipboardError::Unavailable,
        _ => ClipboardError::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_errors_have_concise_stable_messages() {
        assert_eq!(
            clipboard_app_error(ClipboardError::NoContent).to_string(),
            "clipboard: Clipboard does not contain text."
        );
        assert_eq!(
            clipboard_app_error(ClipboardError::Unavailable).to_string(),
            "clipboard: Clipboard is unavailable."
        );
        assert_eq!(
            clipboard_app_error(ClipboardError::Occupied).to_string(),
            "clipboard: Clipboard is busy."
        );
        assert_eq!(
            clipboard_app_error(ClipboardError::Conversion).to_string(),
            "clipboard: Clipboard content could not be converted."
        );
    }
}
