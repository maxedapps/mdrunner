use std::fs;
use std::io::Write;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use tempfile::tempdir;

fn run_mdr(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mdr"))
        .args(args)
        .output()
        .expect("mdr should run")
}

fn run_mdr_in(args: &[&str], cwd: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mdr"))
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("mdr should run")
}

fn run_mdr_with_stdin(args: &[&str], input: &[u8]) -> Output {
    run_mdr_with_stdin_in(args, input, None)
}

fn run_mdr_with_stdin_in(args: &[&str], input: &[u8], cwd: Option<&Path>) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_mdr"));
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let mut child = command.spawn().expect("mdr should start");
    child
        .stdin
        .take()
        .expect("stdin is piped")
        .write_all(input)
        .expect("stdin should be writable");
    child.wait_with_output().expect("mdr should finish")
}

#[test]
fn help_flags_print_exact_usage() {
    for flag in ["-h", "--help"] {
        let output = run_mdr(&[flag]);
        assert_eq!(output.status.code(), Some(0));
        assert_eq!(
            output.stdout,
            b"Usage: mdr [--no-open] [--out <path>] [<file.md|file.mdx|http(s)://url>]\n       command-producing-markdown | mdr [--no-open] [--out <path>]\n       mdr [--no-open] [--out <path>]\n\nOptions:\n    --no-open     Do not open generated HTML in the default browser.\n    --out <path>  Write generated HTML to path.\n\nWith no source, mdr reads redirected stdin or the terminal clipboard.\n"
        );
        assert_eq!(output.stderr, b"");
    }
}

#[test]
fn version_flags_print_exact_package_version() {
    for flag in ["-V", "--version"] {
        let output = run_mdr(&[flag]);
        assert_eq!(output.status.code(), Some(0));
        assert_eq!(output.stdout, b"mdr 0.3.0\n");
        assert_eq!(output.stderr, b"");
    }
}

#[test]
fn direct_mdx_and_remote_arguments_use_their_typed_source_paths() {
    let mdx = run_mdr(&["definitely-missing.mdx"]);
    assert_eq!(mdx.status.code(), Some(1));
    assert!(
        String::from_utf8(mdx.stderr)
            .unwrap()
            .ends_with("Markdown file was not found.\n")
    );

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let url = format!("http://user:secret@127.0.0.1:{port}/README.md?q=1");
    let remote = run_mdr(&[&url]);
    assert_eq!(remote.status.code(), Some(1));
    assert_eq!(remote.stdout, b"");
    assert_eq!(
        String::from_utf8(remote.stderr).unwrap(),
        format!("http://127.0.0.1:{port}/README.md?q=1: Remote request failed.\n")
    );
}

#[test]
fn redirected_stdin_errors_and_argument_precedence_are_exact() {
    let empty = run_mdr_with_stdin(&[], b" \n\t");
    assert_eq!(empty.status.code(), Some(1));
    assert_eq!(empty.stdout, b"");
    assert_eq!(empty.stderr, b"stdin: Piped Markdown is empty.\n");

    let file = run_mdr_with_stdin(&["missing.md"], b"# ignored\n");
    assert_eq!(file.status.code(), Some(1));
    assert_eq!(file.stdout, b"");
    assert!(
        String::from_utf8(file.stderr)
            .unwrap()
            .ends_with("Markdown file was not found.\n")
    );
}

#[test]
fn no_open_and_custom_output_complete_file_and_stdin_renders_without_a_browser() {
    let workspace = tempdir().unwrap();
    let source = workspace.path().join("notes.md");
    fs::write(&source, "# First render\n").unwrap();

    let default = run_mdr(&["--no-open", source.to_str().unwrap()]);
    assert_eq!(default.status.code(), Some(0));
    assert_eq!(default.stderr, b"");
    let default_path = PathBuf::from(String::from_utf8(default.stdout).unwrap().trim());
    assert!(default_path.is_absolute());
    let default_html = fs::read_to_string(&default_path).unwrap();
    assert!(default_html.starts_with("<!doctype html>"));
    assert!(default_html.contains("First render"));

    let relative_output = "published/nested/Custom output.html";
    let expected_output = fs::canonicalize(workspace.path())
        .unwrap()
        .join(relative_output);
    let first = run_mdr_in(
        &[
            source.to_str().unwrap(),
            "--out",
            relative_output,
            "--no-open",
        ],
        workspace.path(),
    );
    assert_eq!(first.status.code(), Some(0));
    assert_eq!(first.stderr, b"");
    assert_eq!(
        String::from_utf8(first.stdout).unwrap(),
        format!("{}\n", expected_output.display())
    );
    assert!(
        fs::read_to_string(&expected_output)
            .unwrap()
            .contains("First render")
    );

    fs::write(&source, "# Replacement render\n").unwrap();
    let replacement = run_mdr_in(
        &[
            "--no-open",
            "--out",
            relative_output,
            source.to_str().unwrap(),
        ],
        workspace.path(),
    );
    assert_eq!(replacement.status.code(), Some(0));
    assert_eq!(replacement.stderr, b"");
    let replacement_html = fs::read_to_string(&expected_output).unwrap();
    assert!(replacement_html.contains("Replacement render"));
    assert!(!replacement_html.contains("First render"));

    let stdin_output = workspace.path().join("piped output.html");
    let piped = run_mdr_with_stdin_in(
        &["--out", stdin_output.to_str().unwrap(), "--no-open"],
        b"# Piped render\n",
        Some(workspace.path()),
    );
    assert_eq!(piped.status.code(), Some(0));
    assert_eq!(piped.stderr, b"");
    assert_eq!(
        String::from_utf8(piped.stdout).unwrap(),
        format!("{}\n", stdin_output.display())
    );
    assert!(
        fs::read_to_string(&stdin_output)
            .unwrap()
            .contains("Piped render")
    );

    fs::remove_file(&default_path).unwrap();
    let _ = fs::remove_dir(default_path.parent().unwrap());
}

#[test]
fn argument_selection_errors_are_exact_and_early() {
    let cases: &[(&[&str], &str)] = &[
        (
            &["-x"],
            "Unknown option '-x'. Use 'mdr --help' for usage.\n",
        ),
        (
            &["--versin"],
            "Unknown option '--versin'. Use 'mdr --help' for usage.\n",
        ),
        (
            &["--versin", "extra.md"],
            "Unknown option '--versin'. Use 'mdr --help' for usage.\n",
        ),
        (&["https://"], "Invalid HTTP(S) URL.\n"),
        (&["HTTP://"], "Invalid HTTP(S) URL.\n"),
        (
            &["ftp://example.com/readme.md"],
            "Unsupported URL scheme 'ftp'; only HTTP(S) URLs are supported.\n",
        ),
        (
            &["file:///tmp/readme.md"],
            "Unsupported URL scheme 'file'; only HTTP(S) URLs are supported.\n",
        ),
        (&["--out"], "Option '--out' requires a path.\n"),
        (
            &["--out", "--", "notes.md"],
            "Option '--out' requires a path.\n",
        ),
        (
            &["--out", "one.html", "--out", "two.html"],
            "Option '--out' may only be used once.\n",
        ),
        (
            &["--no-open", "--no-open"],
            "Option '--no-open' may only be used once.\n",
        ),
        (
            &["--out=page.html"],
            "Unknown option '--out=page.html'. Use 'mdr --help' for usage.\n",
        ),
    ];

    for (args, expected_stderr) in cases {
        let output = run_mdr(args);
        assert_eq!(output.status.code(), Some(1), "args: {args:?}");
        assert_eq!(output.stdout, b"", "args: {args:?}");
        assert_eq!(
            String::from_utf8(output.stderr).unwrap(),
            *expected_stderr,
            "args: {args:?}"
        );
    }
}

#[test]
fn extra_arguments_keep_the_exact_arity_error() {
    for args in [&["--version", "extra.md"][..], &["one.md", "two.md"][..]] {
        let output = run_mdr(args);
        assert_eq!(output.status.code(), Some(1));
        assert_eq!(output.stdout, b"");
        assert_eq!(
            output.stderr,
            b"Expected at most one .md/.mdx path or HTTP(S) URL; use --help for usage.\n"
        );
    }
}
