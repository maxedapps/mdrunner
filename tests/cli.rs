use std::io::Write;
use std::net::TcpListener;
use std::process::{Command, Output, Stdio};

fn run_mdr(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mdr"))
        .args(args)
        .output()
        .expect("mdr should run")
}

fn run_mdr_with_stdin(args: &[&str], input: &[u8]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_mdr"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("mdr should start");
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
            b"Usage: mdr <file.md|file.mdx|http(s)://url>\n       command-producing-markdown | mdr\n       mdr\n\nWith no argument, mdr reads redirected stdin or the terminal clipboard.\n"
        );
        assert_eq!(output.stderr, b"");
    }
}

#[test]
fn version_flags_print_exact_package_version() {
    for flag in ["-V", "--version"] {
        let output = run_mdr(&[flag]);
        assert_eq!(output.status.code(), Some(0));
        assert_eq!(output.stdout, b"mdr 0.2.1\n");
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
