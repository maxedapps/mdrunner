mod browser;
mod output;
mod render;
mod source;

use std::env;
use std::fmt;
use std::io::{self, IsTerminal, Write};
use std::process::ExitCode;

use source::SourceSelection;

const USAGE_TEXT: &str = "Usage: mdr <file.md>\n       command-producing-markdown | mdr";

#[derive(Debug)]
pub(crate) struct AppError {
    message: String,
    label: Option<String>,
}

impl AppError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            label: None,
        }
    }

    pub(crate) fn labeled(message: impl Into<String>, label: impl fmt::Display) -> Self {
        Self {
            message: message.into(),
            label: Some(label.to_string()),
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(label) = &self.label {
            write!(formatter, "{label}: {}", self.message)
        } else {
            formatter.write_str(&self.message)
        }
    }
}

fn run() -> Result<(), AppError> {
    let args = env::args_os()
        .skip(1)
        .map(|argument| {
            argument
                .into_string()
                .map_err(|_| AppError::new("Command-line arguments must be valid UTF-8."))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let cwd =
        env::current_dir().map_err(|_| AppError::new("Could not determine current directory."))?;
    let stdin = io::stdin();
    let stdin_is_terminal = stdin.is_terminal();
    let selection =
        source::read_markdown_source(&args, &mut stdin.lock(), stdin_is_terminal, &cwd)?;

    let SourceSelection::Render(source) = selection else {
        println!("{USAGE_TEXT}");
        return Ok(());
    };

    let html = render::render_document(&source)?;
    let output_path = output::write_output(&source, &html)?;
    println!("{}", output_path.display());
    io::stdout()
        .flush()
        .map_err(|_| AppError::new("Could not print generated HTML path."))?;
    browser::open_output(&output_path)?;
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_have_concise_display_forms() {
        assert_eq!(AppError::new("Failed.").to_string(), "Failed.");
        assert_eq!(
            AppError::labeled("Failed.", "notes.md:7:3").to_string(),
            "notes.md:7:3: Failed."
        );
    }
}
