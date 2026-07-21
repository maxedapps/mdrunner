mod assets;
mod browser;
mod cli;
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

use cli::{RenderRequest, Selection};
use source::{MarkdownSource, SourceRequest};

pub const USAGE_TEXT: &str = "Usage: mdr [--no-open] [--out <path>] [<file.md|file.mdx|http(s)://url>]\n       command-producing-markdown | mdr [--no-open] [--out <path>]\n       mdr [--no-open] [--out <path>]\n\nOptions:\n    --no-open     Do not open generated HTML in the default browser.\n    --out <path>  Write generated HTML to path.\n\nWith no source, mdr reads redirected stdin or the terminal clipboard.";

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
    let selection = cli::select(&args, stdin.is_terminal())?;
    let request = match selection {
        Selection::Help => {
            println!("{USAGE_TEXT}");
            return Ok(());
        }
        Selection::Version => {
            println!("mdr {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        Selection::Render(request) => request,
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
    fn persist(
        &mut self,
        source: &MarkdownSource,
        html: &str,
        custom_output: Option<&Path>,
        cwd: &Path,
    ) -> Result<PathBuf, AppError>;
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

    fn persist(
        &mut self,
        source: &MarkdownSource,
        html: &str,
        custom_output: Option<&Path>,
        cwd: &Path,
    ) -> Result<PathBuf, AppError> {
        output::write_output(source, html, custom_output, cwd)
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
    request: RenderRequest,
    stdin: &mut dyn Read,
    cwd: &Path,
    runtime: &mut impl RenderRuntime,
) -> Result<(), AppError> {
    let RenderRequest {
        source: source_request,
        output_path: custom_output,
        open_browser,
    } = request;
    let source = runtime.load(source_request, stdin, cwd)?;
    let html = runtime.render(&source)?;
    let output_path = runtime.persist(&source, &html, custom_output.as_deref(), cwd)?;
    runtime.print_path(&output_path)?;
    if open_browser {
        runtime.open_browser(&output_path)?;
    }
    Ok(())
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
        persist_requests: Vec<Option<PathBuf>>,
        printed_paths: Vec<PathBuf>,
        opened_paths: Vec<PathBuf>,
    }

    impl FakeRuntime {
        fn new(fail_at: Option<&'static str>) -> Self {
            Self {
                fail_at,
                calls: Vec::new(),
                persist_requests: Vec::new(),
                printed_paths: Vec::new(),
                opened_paths: Vec::new(),
            }
        }

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

        fn persist(
            &mut self,
            _: &MarkdownSource,
            _: &str,
            custom_output: Option<&Path>,
            cwd: &Path,
        ) -> Result<PathBuf, AppError> {
            self.calls.push("persist");
            self.persist_requests
                .push(custom_output.map(Path::to_owned));
            self.result("persist")?;
            Ok(match custom_output {
                Some(path) if path.is_absolute() => path.to_owned(),
                Some(path) => cwd.join(path),
                None => PathBuf::from("/tmp/mdr-test.html"),
            })
        }

        fn print_path(&mut self, path: &Path) -> Result<(), AppError> {
            self.calls.push("print");
            self.printed_paths.push(path.to_owned());
            self.result("print")
        }

        fn open_browser(&mut self, path: &Path) -> Result<(), AppError> {
            self.calls.push("browser");
            self.opened_paths.push(path.to_owned());
            self.result("browser")
        }
    }

    fn request(output_path: Option<&str>, open_browser: bool) -> RenderRequest {
        RenderRequest {
            source: SourceRequest::Stdin,
            output_path: output_path.map(PathBuf::from),
            open_browser,
        }
    }

    #[test]
    fn orchestration_preserves_order_for_default_custom_open_and_no_open() {
        let mut default = FakeRuntime::new(None);
        execute_render(
            request(None, true),
            &mut Cursor::new(b"ignored"),
            Path::new("/workspace"),
            &mut default,
        )
        .unwrap();
        assert_eq!(
            default.calls,
            ["load", "render", "persist", "print", "browser"]
        );
        assert_eq!(default.persist_requests, [None]);
        assert_eq!(default.printed_paths, [PathBuf::from("/tmp/mdr-test.html")]);
        assert_eq!(default.opened_paths, default.printed_paths);

        let mut custom_open = FakeRuntime::new(None);
        execute_render(
            request(Some("published/opened.html"), true),
            &mut Cursor::new(b"ignored"),
            Path::new("/workspace"),
            &mut custom_open,
        )
        .unwrap();
        assert_eq!(
            custom_open.calls,
            ["load", "render", "persist", "print", "browser"]
        );
        assert_eq!(
            custom_open.persist_requests,
            [Some(PathBuf::from("published/opened.html"))]
        );
        assert_eq!(
            custom_open.printed_paths,
            [PathBuf::from("/workspace/published/opened.html")]
        );
        assert_eq!(custom_open.opened_paths, custom_open.printed_paths);

        let mut custom = FakeRuntime::new(None);
        execute_render(
            request(Some("published/page.html"), false),
            &mut Cursor::new(b"ignored"),
            Path::new("/workspace"),
            &mut custom,
        )
        .unwrap();
        assert_eq!(custom.calls, ["load", "render", "persist", "print"]);
        assert_eq!(
            custom.persist_requests,
            [Some(PathBuf::from("published/page.html"))]
        );
        assert_eq!(
            custom.printed_paths,
            [PathBuf::from("/workspace/published/page.html")]
        );
        assert!(custom.opened_paths.is_empty());
    }

    #[test]
    fn orchestration_stops_at_each_failure_without_reordering_side_effects() {
        let steps = ["load", "render", "persist", "print", "browser"];
        for (failed_index, failed_step) in steps.into_iter().enumerate() {
            let mut runtime = FakeRuntime::new(Some(failed_step));
            let error = execute_render(
                request(None, true),
                &mut Cursor::new(b"ignored"),
                Path::new("/workspace"),
                &mut runtime,
            )
            .unwrap_err();
            assert_eq!(runtime.calls, steps[..=failed_index]);
            assert_eq!(error.to_string(), format!("{failed_step} failed"));
        }
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
