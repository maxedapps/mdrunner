use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use mdr::render_file_to_html;
use tempfile::tempdir;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn count(haystack: &str, needle: &str) -> usize {
    haystack.match_indices(needle).count()
}

#[test]
fn representative_document_has_static_semantic_parity() {
    let path = fixture("documents/complete.md");
    let html = render_file_to_html(&path).unwrap();

    assert!(html.starts_with("<!doctype html>\n<html lang=\"en\">\n<head>\n"));
    assert!(html.ends_with("</main>\n</body>\n</html>\n"));
    assert_eq!(count(&html, "<html"), 1);
    assert_eq!(count(&html, "<main class=\"markdown-body\">"), 1);
    assert!(html.contains("<title>Café 世界 — Static output</title>"));
    assert!(!html.contains("purpose: representative source contract"));

    assert!(html.contains("<table>"));
    assert!(html.contains("contains-task-list"));
    assert!(html.contains("<del>obsolete text</del>"));
    assert!(html.contains("data-footnotes"));
    assert!(html.contains("id=\"repeated-heading\""));
    assert!(html.contains("id=\"repeated-heading-1\""));
    assert!(html.contains("id=\"unicode-καλημέρα\""));

    assert_eq!(
        count(&html, "<figure class=\"mermaid-diagram\" role=\"img\">"),
        6
    );
    assert_eq!(count(&html, "<svg"), 6);
    assert!(!html.contains("language-mermaid"));
    assert!(!html.contains("```mermaid"));

    assert!(html.contains("data-language=\"ts\""));
    assert!(html.contains("class=\"code-title\">complete.ts</figcaption>"));
    assert!(html.contains("class=\"l-line mark"));
    assert!(html.contains("--lumis-light"));
    assert!(html.contains("--lumis-dark"));
    assert!(html.contains("data-language=\"unknown-language\""));
    assert!(html.contains("literal &lt;tag&gt; &amp; a-layout-token"));

    assert_eq!(count(&html, "src=\"data:image/"), 2);
    assert!(html.contains("src=\"https://images.example.test/preview.png\""));
    assert!(!html.contains("assets/pixel.png"));
    assert!(!html.contains("assets/safe.svg"));

    assert!(html.contains("&lt;script data-origin=&quot;authored&quot;&gt;"));
    assert!(!html.contains("<script"));
    assert!(!html.contains("<button"));
    assert!(!html.contains("type=\"module\""));
    assert!(!html.contains("@import"));
    assert!(!html.contains("@font-face"));
    assert!(html.contains("@media (prefers-color-scheme: dark)"));
    assert!(html.contains("@media (max-width: 40rem)"));
    assert!(html.contains("@media print"));
    assert!(html.contains("script-src 'none'"));

    assert_eq!(render_file_to_html(&path).unwrap(), html);
}

#[test]
fn embeds_all_supported_image_extensions_for_file_and_stdin_style_bases() {
    let image_fixture = fixture("images");
    let directory = tempdir().unwrap();
    for name in [
        "pixel.png",
        "pixel.jpg",
        "pixel.gif",
        "pixel.webp",
        "safe.svg",
    ] {
        fs::copy(image_fixture.join(name), directory.path().join(name)).unwrap();
    }
    let markdown = r#"# Images

![png](pixel.png)
![jpeg](pixel.jpg)
![gif](pixel.gif)
![webp](pixel.webp)
![svg](safe.svg)
![nested](nested/Unicode%20%C3%BC%20space/tiny%20image.png?download=1#preview)
![<remote & image>](https://images.example.test/a.png?q=1 "remote & title")
"#;
    let nested = directory.path().join("nested/Unicode ü space");
    fs::create_dir_all(&nested).unwrap();
    fs::copy(
        image_fixture.join("nested/Unicode ü space/tiny image.png"),
        nested.join("tiny image.png"),
    )
    .unwrap();
    let path = directory.path().join("images.md");
    fs::write(&path, markdown).unwrap();

    let html = render_file_to_html(&path).unwrap();
    for (name, mime) in [
        ("pixel.png", "image/png"),
        ("pixel.jpg", "image/jpeg"),
        ("pixel.gif", "image/gif"),
        ("pixel.webp", "image/webp"),
        ("safe.svg", "image/svg+xml"),
    ] {
        let expected = format!(
            "data:{mime};base64,{}",
            STANDARD.encode(fs::read(directory.path().join(name)).unwrap())
        );
        assert!(html.contains(&expected), "missing {name}");
    }
    assert_eq!(count(&html, "src=\"data:image/"), 6);
    assert!(html.contains("src=\"https://images.example.test/a.png?q=1\""));
    assert!(html.contains("alt=\"&lt;remote &amp; image&gt;\""));
    assert!(html.contains("title=\"remote &amp; title\""));
    assert!(!html.contains("download=1"));
    assert!(!html.contains("#preview"));
}

#[test]
fn image_failures_are_contained_and_source_aware() {
    let root = tempdir().unwrap();
    let base = root.path().join("base");
    fs::create_dir(&base).unwrap();
    fs::write(root.path().join("outside.png"), b"outside").unwrap();
    fs::write(base.join("notes.txt"), b"text").unwrap();

    for value in [
        "../outside.png",
        "missing.png",
        "notes.txt",
        "data:image/png;base64,AAAA",
        "file:///tmp/a.png",
        "//example.test/a.png",
        "/tmp/a.png",
    ] {
        let path = base.join("unsafe.md");
        fs::write(&path, format!("paragraph\n\n![asset]({value})\n")).unwrap();
        let error = render_file_to_html(&path).unwrap_err().to_string();
        assert!(error.contains("unsafe.md:3:1:"), "{value}: {error}");
    }
}

#[test]
fn malformed_mermaid_reports_the_fence_line_before_any_persistence_boundary() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("malformed.md");
    fs::write(
        &path,
        "# Valid prefix\n\n```mermaid\nflowchart LR\n  --> MissingSource\n```\n",
    )
    .unwrap();
    let error = render_file_to_html(&path).unwrap_err().to_string();
    assert!(error.contains("malformed.md:3:1:"), "{error}");
    assert!(error.contains("Invalid Mermaid diagram"), "{error}");
}
