use std::path::PathBuf;

use crate::AppError;
use crate::source::{self, SourceRequest};

const ARITY_ERROR: &str =
    "Expected at most one .md/.mdx path or HTTP(S) URL; use --help for usage.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RenderRequest {
    pub(crate) source: SourceRequest,
    pub(crate) output_path: Option<PathBuf>,
    pub(crate) open_browser: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Selection {
    Help,
    Version,
    Render(RenderRequest),
}

pub(crate) fn select(args: &[String], stdin_is_terminal: bool) -> Result<Selection, AppError> {
    if let [argument] = args {
        match argument.as_str() {
            "-h" | "--help" => return Ok(Selection::Help),
            "-V" | "--version" => return Ok(Selection::Version),
            _ => {}
        }
    }
    if args
        .first()
        .is_some_and(|argument| matches!(argument.as_str(), "-h" | "--help" | "-V" | "--version"))
    {
        return Err(AppError::new(ARITY_ERROR));
    }

    let mut source_argument = None;
    let mut output_path = None;
    let mut open_browser = true;
    let mut options_ended = false;
    let mut index = 0;

    while index < args.len() {
        let argument = &args[index];
        if options_ended {
            set_source(&mut source_argument, argument)?;
            index += 1;
            continue;
        }

        match argument.as_str() {
            "--" => options_ended = true,
            "--no-open" => {
                if !open_browser {
                    return Err(AppError::new("Option '--no-open' may only be used once."));
                }
                open_browser = false;
            }
            "--out" => {
                if output_path.is_some() {
                    return Err(AppError::new("Option '--out' may only be used once."));
                }
                let Some(value) = args.get(index + 1) else {
                    return Err(AppError::new("Option '--out' requires a path."));
                };
                if value.is_empty() || value.starts_with('-') {
                    return Err(AppError::new("Option '--out' requires a path."));
                }
                output_path = Some(PathBuf::from(value));
                index += 1;
            }
            "-h" | "--help" | "-V" | "--version" => {
                return Err(AppError::new(ARITY_ERROR));
            }
            _ if argument.starts_with('-') => {
                return Err(AppError::new(format!(
                    "Unknown option '{argument}'. Use 'mdr --help' for usage."
                )));
            }
            _ => set_source(&mut source_argument, argument)?,
        }
        index += 1;
    }

    Ok(Selection::Render(RenderRequest {
        source: source::select_source(source_argument.as_deref(), stdin_is_terminal)?,
        output_path,
        open_browser,
    }))
}

fn set_source(target: &mut Option<String>, argument: &str) -> Result<(), AppError> {
    if target.is_some() {
        return Err(AppError::new(ARITY_ERROR));
    }
    *target = Some(argument.to_owned());
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn parse(args: &[&str], terminal: bool) -> Result<Selection, AppError> {
        select(
            &args.iter().map(ToString::to_string).collect::<Vec<_>>(),
            terminal,
        )
    }

    fn render(args: &[&str], terminal: bool) -> RenderRequest {
        let Selection::Render(request) = parse(args, terminal).unwrap() else {
            panic!("expected render request")
        };
        request
    }

    fn assert_error(args: &[&str], expected: &str) {
        assert_eq!(parse(args, false).unwrap_err().to_string(), expected);
    }

    #[test]
    fn selection_is_pure_exact_and_precedence_ordered() {
        for flag in ["-h", "--help"] {
            assert_eq!(parse(&[flag], true).unwrap(), Selection::Help);
            assert_error(&[flag, "extra.md"], ARITY_ERROR);
            assert_error(&["notes.md", flag], ARITY_ERROR);
            assert_eq!(
                render(&["--", flag], false).source,
                SourceRequest::File(PathBuf::from(flag))
            );
        }
        for flag in ["-V", "--version"] {
            assert_eq!(parse(&[flag], false).unwrap(), Selection::Version);
            assert_error(&[flag, "--no-open"], ARITY_ERROR);
            assert_error(&["--no-open", flag], ARITY_ERROR);
        }

        assert_error(&["-x"], "Unknown option '-x'. Use 'mdr --help' for usage.");
        assert_error(
            &["--versin", "extra.md"],
            "Unknown option '--versin'. Use 'mdr --help' for usage.",
        );
        assert_error(
            &["--out=page.html"],
            "Unknown option '--out=page.html'. Use 'mdr --help' for usage.",
        );

        for terminal in [false, true] {
            let fallback = if terminal {
                SourceRequest::Clipboard
            } else {
                SourceRequest::Stdin
            };
            assert_eq!(render(&[], terminal).source, fallback);
            assert_eq!(render(&["--"], terminal).source, fallback);
            assert_eq!(
                render(&["--no-open"], terminal),
                RenderRequest {
                    source: fallback.clone(),
                    output_path: None,
                    open_browser: false,
                }
            );
            assert_eq!(
                render(&["--out", "page.html"], terminal),
                RenderRequest {
                    source: fallback,
                    output_path: Some(PathBuf::from("page.html")),
                    open_browser: true,
                }
            );
        }

        assert_eq!(
            render(&["notes.md", "--no-open"], false),
            RenderRequest {
                source: SourceRequest::File(PathBuf::from("notes.md")),
                output_path: None,
                open_browser: false,
            }
        );
        assert_eq!(
            render(&["notes.md", "--out", "page.html"], false),
            RenderRequest {
                source: SourceRequest::File(PathBuf::from("notes.md")),
                output_path: Some(PathBuf::from("page.html")),
                open_browser: true,
            }
        );

        let cases = [
            vec!["--no-open", "--out", "page.html", "notes.md"],
            vec!["--out", "page.html", "notes.md", "--no-open"],
            vec!["notes.md", "--no-open", "--out", "page.html"],
            vec!["--out", "page.html", "--no-open", "notes.md"],
        ];
        for args in cases {
            assert_eq!(
                render(&args, false),
                RenderRequest {
                    source: SourceRequest::File(PathBuf::from("notes.md")),
                    output_path: Some(PathBuf::from("page.html")),
                    open_browser: false,
                }
            );
        }
        assert_eq!(
            render(&["--", "--no-open"], false),
            RenderRequest {
                source: SourceRequest::File(PathBuf::from("--no-open")),
                output_path: None,
                open_browser: true,
            }
        );
        assert_eq!(
            render(&["--no-open", "--", "-notes.md"], false).source,
            SourceRequest::File(PathBuf::from("-notes.md"))
        );
        assert_error(&["--", "one.md", "two.md"], ARITY_ERROR);

        for args in [
            vec!["--out"],
            vec!["--out", "--"],
            vec!["--out", "--", "file.md"],
            vec!["--out", "--no-open"],
            vec!["--out", "--help"],
            vec!["--out", "-page.html"],
            vec!["--out", ""],
        ] {
            assert_error(&args, "Option '--out' requires a path.");
        }
        assert_eq!(
            render(&["--out", "./-page.html"], false).output_path,
            Some(PathBuf::from("./-page.html"))
        );
        assert_error(
            &["--out", "one.html", "--out", "two.html"],
            "Option '--out' may only be used once.",
        );
        assert_error(
            &["--no-open", "--no-open"],
            "Option '--no-open' may only be used once.",
        );

        for path in [
            "notes.md",
            "/tmp/absolute-notes.mdx",
            "./-notes.md",
            "www.example.test/readme.md",
            "notes:archive.md",
            r"C:\docs\notes.md",
            "C:/docs/notes.md",
        ] {
            assert_eq!(
                render(&[path], false).source,
                SourceRequest::File(PathBuf::from(path))
            );
        }
        for argument in [
            "http://example.test/readme.md",
            "hTtPs://user:secret@example.test/a.md?q=1#part",
        ] {
            let SourceRequest::Remote(url) = render(&[argument], false).source else {
                panic!("expected remote source for {argument}")
            };
            assert!(matches!(url.scheme(), "http" | "https"));
            assert!(url.host_str().is_some());
        }
        for argument in ["http://", "HTTPS://", "hTtP://?missing-host"] {
            assert_error(&[argument], "Invalid HTTP(S) URL.");
        }
        for (argument, scheme) in [
            ("ftp://example.test/readme.md", "ftp"),
            ("file:///tmp/readme.md", "file"),
        ] {
            assert_error(
                &[argument],
                &format!("Unsupported URL scheme '{scheme}'; only HTTP(S) URLs are supported."),
            );
        }
    }
}
