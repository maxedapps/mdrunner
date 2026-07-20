use std::process::{Command, Output};

fn run_mdr(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mdr"))
        .args(args)
        .output()
        .expect("mdr should run")
}

#[test]
fn help_flags_print_exact_usage() {
    for flag in ["-h", "--help"] {
        let output = run_mdr(&[flag]);
        assert_eq!(output.status.code(), Some(0));
        assert_eq!(
            output.stdout,
            b"Usage: mdr <file.md>\n       command-producing-markdown | mdr\n"
        );
        assert_eq!(output.stderr, b"");
    }
}

#[test]
fn version_flags_print_exact_package_version() {
    for flag in ["-V", "--version"] {
        let output = run_mdr(&[flag]);
        assert_eq!(output.status.code(), Some(0));
        assert_eq!(output.stdout, b"mdr 0.1.0\n");
        assert_eq!(output.stderr, b"");
    }
}

#[test]
fn version_with_an_extra_argument_is_rejected() {
    let output = run_mdr(&["--version", "extra.md"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(output.stdout, b"");
    assert_eq!(
        output.stderr,
        b"Expected one .md file or piped Markdown; use --help for usage.\n"
    );
}
