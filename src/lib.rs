mod assets;
mod browser;
mod clipboard;
mod code;
mod output;
mod remote;
mod render;
mod source;

use std::env;
use std::fmt;
use std::io::{self, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};

use source::{MarkdownSource, SourceRequest, SourceSelection};

pub const USAGE_TEXT: &str = "Usage: mdr <file.md|file.mdx|http(s)://url>\n       command-producing-markdown | mdr\n       mdr\n\nWith no argument, mdr reads redirected stdin or the terminal clipboard.";

#[derive(Debug)]
pub struct AppError {
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

impl std::error::Error for AppError {}

pub fn run() -> Result<(), AppError> {
    let args = env::args_os()
        .skip(1)
        .map(|argument| {
            argument
                .into_string()
                .map_err(|_| AppError::new("Command-line arguments must be valid UTF-8."))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let stdin = io::stdin();
    let selection = source::select_source_request(&args, stdin.is_terminal())?;
    let request = match selection {
        SourceSelection::Help => {
            println!("{USAGE_TEXT}");
            return Ok(());
        }
        SourceSelection::Version => {
            println!("mdr {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        SourceSelection::Request(request) => request,
    };

    let cwd =
        env::current_dir().map_err(|_| AppError::new("Could not determine current directory."))?;
    execute_render(request, &mut stdin.lock(), &cwd, &mut ProductionRuntime)
}

trait RenderRuntime {
    fn load(
        &mut self,
        request: SourceRequest,
        stdin: &mut dyn Read,
        cwd: &Path,
    ) -> Result<MarkdownSource, AppError>;
    fn render(&mut self, source: &MarkdownSource) -> Result<String, AppError>;
    fn persist(&mut self, source: &MarkdownSource, html: &str) -> Result<PathBuf, AppError>;
    fn print_path(&mut self, path: &Path) -> Result<(), AppError>;
    fn open_browser(&mut self, path: &Path) -> Result<(), AppError>;
}

struct ProductionRuntime;

impl RenderRuntime for ProductionRuntime {
    fn load(
        &mut self,
        request: SourceRequest,
        stdin: &mut dyn Read,
        cwd: &Path,
    ) -> Result<MarkdownSource, AppError> {
        source::load_source_request(request, stdin, cwd)
    }

    fn render(&mut self, source: &MarkdownSource) -> Result<String, AppError> {
        render::render_document(source)
    }

    fn persist(&mut self, source: &MarkdownSource, html: &str) -> Result<PathBuf, AppError> {
        output::write_output(source, html)
    }

    fn print_path(&mut self, path: &Path) -> Result<(), AppError> {
        println!("{}", path.display());
        io::stdout()
            .flush()
            .map_err(|_| AppError::new("Could not print generated HTML path."))
    }

    fn open_browser(&mut self, path: &Path) -> Result<(), AppError> {
        browser::open_output(path)
    }
}

fn execute_render(
    request: SourceRequest,
    stdin: &mut dyn Read,
    cwd: &Path,
    runtime: &mut impl RenderRuntime,
) -> Result<(), AppError> {
    let source = runtime.load(request, stdin, cwd)?;
    let html = runtime.render(&source)?;
    let output_path = runtime.persist(&source, &html)?;
    runtime.print_path(&output_path)?;
    runtime.open_browser(&output_path)
}

/// Render a Markdown file without persistence or browser side effects.
///
/// This is the synchronous renderer boundary used by semantic integration tests
/// and embedders that need the same self-contained document as the CLI.
pub fn render_file_to_html(path: &Path) -> Result<String, AppError> {
    let cwd =
        env::current_dir().map_err(|_| AppError::new("Could not determine current directory."))?;
    let argument = path
        .to_str()
        .ok_or_else(|| AppError::new("Markdown path must be valid UTF-8."))?;
    let source = source::read_file_source(argument, &cwd)?;
    render::render_document(&source)
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    struct FakeRuntime {
        fail_at: Option<&'static str>,
        calls: Vec<&'static str>,
    }

    impl FakeRuntime {
        fn result(&self, step: &'static str) -> Result<(), AppError> {
            if self.fail_at == Some(step) {
                Err(AppError::new(format!("{step} failed")))
            } else {
                Ok(())
            }
        }
    }

    impl RenderRuntime for FakeRuntime {
        fn load(
            &mut self,
            _: SourceRequest,
            _: &mut dyn Read,
            cwd: &Path,
        ) -> Result<MarkdownSource, AppError> {
            self.calls.push("load");
            self.result("load")?;
            Ok(MarkdownSource::Stdin {
                markdown: "# test".to_owned(),
                cwd: cwd.to_owned(),
            })
        }

        fn render(&mut self, _: &MarkdownSource) -> Result<String, AppError> {
            self.calls.push("render");
            self.result("render")?;
            Ok("html".to_owned())
        }

        fn persist(&mut self, _: &MarkdownSource, _: &str) -> Result<PathBuf, AppError> {
            self.calls.push("persist");
            self.result("persist")?;
            Ok(PathBuf::from("/tmp/mdr-test.html"))
        }

        fn print_path(&mut self, _: &Path) -> Result<(), AppError> {
            self.calls.push("print");
            self.result("print")
        }

        fn open_browser(&mut self, _: &Path) -> Result<(), AppError> {
            self.calls.push("browser");
            self.result("browser")
        }
    }

    #[test]
    fn orchestration_stops_before_persistence_and_browser_on_earlier_failures() {
        let steps = ["load", "render", "persist", "print", "browser"];
        for (failed_index, failed_step) in steps.into_iter().enumerate() {
            let mut runtime = FakeRuntime {
                fail_at: Some(failed_step),
                calls: Vec::new(),
            };
            let error = execute_render(
                SourceRequest::Stdin,
                &mut Cursor::new(b"ignored"),
                Path::new("/workspace"),
                &mut runtime,
            )
            .unwrap_err();
            assert_eq!(runtime.calls, steps[..=failed_index]);
            assert_eq!(error.to_string(), format!("{failed_step} failed"));
        }

        let mut runtime = FakeRuntime {
            fail_at: None,
            calls: Vec::new(),
        };
        execute_render(
            SourceRequest::Stdin,
            &mut Cursor::new(b"ignored"),
            Path::new("/workspace"),
            &mut runtime,
        )
        .unwrap();
        assert_eq!(runtime.calls, steps);
    }

    #[test]
    fn errors_have_concise_display_forms() {
        assert_eq!(AppError::new("Failed.").to_string(), "Failed.");
        assert_eq!(
            AppError::labeled("Failed.", "notes.md:7:3").to_string(),
            "notes.md:7:3: Failed."
        );
    }
}
