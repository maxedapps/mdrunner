use std::collections::HashSet;
use std::path::Path;

use comrak::arena_tree::NodeEdge;
use comrak::nodes::NodeValue;
use comrak::options::Plugins;
use comrak::{Arena, Options, format_html_with_plugins, parse_document};
use url::Url;

use crate::AppError;
use crate::assets::resolve_image;
use crate::code::{CodeRenderer, PlaintextRenderer};
use crate::source::MarkdownSource;

const DOCUMENT_CSP: &str = "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src data: http: https:; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'; worker-src 'none'";
const PRODUCT_STYLES: &str = include_str!("styles.css");

pub(crate) fn render_document(source: &MarkdownSource) -> Result<String, AppError> {
    let arena = Arena::new();
    let options = markdown_options(source.markdown());
    let root = parse_document(&arena, source.markdown(), &options);
    let prepared = prepare_ast(root, source)?;
    let title = prepared
        .title
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| fallback_title(source));

    let code_renderer = CodeRenderer::new(source.label(), prepared.code_positions);
    let plaintext_renderer = PlaintextRenderer;
    let mut plugins = Plugins::default();
    for language in prepared.code_languages {
        plugins
            .render
            .codefence_renderers
            .insert(language, &code_renderer);
    }
    plugins.render.codefence_syntax_highlighter = Some(&plaintext_renderer);

    let mut fragment = String::new();
    format_html_with_plugins(root, &options, &mut fragment, &plugins)
        .map_err(|_| AppError::new("Could not render Markdown."))?;
    if let Some(error) = code_renderer.take_error() {
        return Err(error);
    }

    Ok(assemble_document(&title, &fragment))
}

fn markdown_options(markdown: &str) -> Options<'static> {
    let mut options = Options::default();
    options.extension.strikethrough = true;
    options.extension.tagfilter = true;
    options.extension.table = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.footnotes = true;
    options.extension.header_id_prefix = Some(String::new());
    options.extension.front_matter_delimiter = leading_frontmatter(markdown).map(str::to_owned);
    // `file:` links are prepared and validated below. `escape` still takes
    // precedence for authored raw HTML when Comrak's URL gate is relaxed.
    options.render.r#unsafe = true;
    options.render.escape = true;
    options
}

fn leading_frontmatter(markdown: &str) -> Option<&'static str> {
    if markdown.starts_with("---\n") || markdown.starts_with("---\r\n") {
        Some("---")
    } else if markdown.starts_with("+++\n") || markdown.starts_with("+++\r\n") {
        Some("+++")
    } else {
        None
    }
}

struct PreparedAst {
    title: Option<String>,
    code_languages: HashSet<String>,
    code_positions: Vec<(usize, usize)>,
}

fn prepare_ast<'a>(
    root: &'a comrak::nodes::AstNode<'a>,
    source: &MarkdownSource,
) -> Result<PreparedAst, AppError> {
    let mut title = None;
    let mut h1_text = None::<String>;
    let mut code_languages = HashSet::new();
    let mut code_positions = Vec::new();

    for edge in root.traverse() {
        match edge {
            NodeEdge::Start(node) => {
                let mut data = node.data.borrow_mut();
                let line = data.sourcepos.start.line;
                let column = data.sourcepos.start.column;
                match &mut data.value {
                    NodeValue::Heading(heading) if heading.level == 1 && title.is_none() => {
                        h1_text = Some(String::new());
                    }
                    NodeValue::Text(text) if h1_text.is_some() => {
                        h1_text.as_mut().expect("checked above").push_str(text);
                    }
                    NodeValue::Code(code) if h1_text.is_some() => {
                        h1_text
                            .as_mut()
                            .expect("checked above")
                            .push_str(&code.literal);
                    }
                    NodeValue::SoftBreak | NodeValue::LineBreak if h1_text.is_some() => {
                        h1_text.as_mut().expect("checked above").push(' ');
                    }
                    NodeValue::Link(link) => {
                        link.url = rewrite_link(&link.url, source.asset_base())?;
                    }
                    NodeValue::Image(image) => {
                        image.url = resolve_image(
                            &image.url,
                            source.asset_base(),
                            &source.label(),
                            line,
                            column,
                        )?;
                    }
                    NodeValue::CodeBlock(block) => {
                        let language = block.info.split_whitespace().next().unwrap_or_default();
                        if !language.is_empty() {
                            code_languages.insert(language.to_owned());
                            code_positions.push((line, column));
                        }
                    }
                    _ => {}
                }
            }
            NodeEdge::End(node) => {
                let data = node.data.borrow();
                if matches!(&data.value, NodeValue::Heading(heading) if heading.level == 1)
                    && let Some(text) = h1_text.take()
                {
                    let text = text.trim();
                    if !text.is_empty() {
                        title = Some(text.to_owned());
                    }
                }
            }
        }
    }

    Ok(PreparedAst {
        title,
        code_languages,
        code_positions,
    })
}

fn rewrite_link(raw: &str, asset_base: &Path) -> Result<String, AppError> {
    let value = raw.trim();
    if value.starts_with('#') {
        return Ok(value.to_owned());
    }
    if value.is_empty() || value.starts_with("//") || value.contains('\\') {
        return Err(AppError::new("Unsafe or invalid link URL."));
    }

    if let Ok(url) = Url::parse(value) {
        return match url.scheme() {
            "http" | "https" | "mailto" | "tel" => Ok(url.to_string()),
            _ => Err(AppError::new("Unsafe or invalid link URL.")),
        };
    }

    let base_url = Url::from_directory_path(asset_base)
        .map_err(|()| AppError::new("Could not resolve the Markdown source directory."))?;
    let containment_base = base_url
        .to_file_path()
        .map_err(|()| AppError::new("Could not resolve the Markdown source directory."))?;
    let url = base_url
        .join(value)
        .map_err(|_| AppError::new("Unsafe or invalid link URL."))?;
    let target = url
        .to_file_path()
        .map_err(|()| AppError::new("Unsafe or invalid link URL."))?;
    if !target.starts_with(&containment_base) {
        return Err(AppError::new("Unsafe or invalid link URL."));
    }
    Ok(url.to_string())
}

fn fallback_title(source: &MarkdownSource) -> String {
    match source {
        MarkdownSource::File { canonical_path, .. } => canonical_path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .filter(|stem| !stem.is_empty())
            .unwrap_or("Markdown document")
            .to_owned(),
        MarkdownSource::Stdin { .. } => "Markdown document".to_owned(),
    }
}

fn assemble_document(title: &str, fragment: &str) -> String {
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta http-equiv=\"Content-Security-Policy\" content=\"{DOCUMENT_CSP}\">\n<title>{}</title>\n<style data-mdr-styles>\n{PRODUCT_STYLES}\n</style>\n</head>\n<body>\n<main class=\"markdown-body\">{fragment}</main>\n</body>\n</html>\n",
        escape_html(title)
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use tempfile::tempdir;

    use super::*;

    fn test_workspace() -> PathBuf {
        std::env::temp_dir().join("mdr-tests")
    }

    fn file_source(markdown: &str, name: &str) -> MarkdownSource {
        let asset_base = test_workspace().join("docs");
        MarkdownSource::File {
            markdown: markdown.to_owned(),
            canonical_path: asset_base.join(name),
            asset_base,
        }
    }

    fn stdin_source(markdown: &str) -> MarkdownSource {
        MarkdownSource::Stdin {
            markdown: markdown.to_owned(),
            cwd: test_workspace(),
        }
    }

    #[test]
    fn renders_gfm_and_hides_yaml_and_toml_frontmatter() {
        for (frontmatter, hidden) in [
            ("---\nauthor: Ada\n---", "author: Ada"),
            ("+++\nauthor = \"Ada\"\n+++", "author = \"Ada\""),
        ] {
            let markdown = format!(
                "{frontmatter}\n## Features\n\n| Item | Ready |\n| --- | --- |\n| Parser | yes |\n\n- [x] done\n\n~~old~~ https://example.com/docs.\n\nA note.[^n]\n\n[^n]: footnote.\n"
            );
            let html = render_document(&file_source(&markdown, "Guide.md")).unwrap();
            assert!(html.contains("<table>"));
            assert!(html.contains("task-list-item"));
            assert!(html.contains("<del>old</del>"));
            assert!(html.contains("https://example.com/docs"));
            assert!(html.contains("data-footnotes"));
            assert!(!html.contains(hidden));
            assert!(html.contains("<title>Guide</title>"));
        }
    }

    #[test]
    fn title_precedence_heading_ids_and_determinism() {
        let source = file_source(
            "## Before\n\n# First *document* &amp; title\n\n## Duplicate\n\n## Duplicate\n",
            "Fallback.md",
        );
        let first = render_document(&source).unwrap();
        let second = render_document(&source).unwrap();
        assert_eq!(first, second);
        assert!(first.contains("<title>First document &amp; title</title>"));
        assert!(first.contains("<h2 id=\"duplicate\">"));
        assert!(first.contains("<h2 id=\"duplicate-1\">"));

        assert!(
            render_document(&file_source("## Child\n", "API Notes.MD"))
                .unwrap()
                .contains("<title>API Notes</title>")
        );
        assert!(
            render_document(&stdin_source("## Child\n"))
                .unwrap()
                .contains("<title>Markdown document</title>")
        );
    }

    #[test]
    fn authored_html_is_inert_and_links_are_resolved_safely() {
        let directory = tempdir().unwrap();
        let docs = directory.path().join("docs");
        fs::create_dir(&docs).unwrap();
        let asset_base = fs::canonicalize(docs).unwrap();
        let source = MarkdownSource::File {
            markdown: "<script>alert(1)</script>\n\n[local](<guide one.md#part>) [remote](https://example.com/a?q=1)\n".to_owned(),
            canonical_path: asset_base.join("Links.md"),
            asset_base,
        };
        let mut expected_local = Url::from_file_path(source.asset_base().join("guide one.md"))
            .expect("the canonical test directory has a file URL");
        expected_local.set_fragment(Some("part"));

        let html = render_document(&source).unwrap();
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(html.contains(expected_local.as_str()));
        assert!(html.contains("https://example.com/a?q=1"));

        assert!(render_document(&file_source("[bad](../secret.md)\n", "Links.md")).is_err());
        assert!(render_document(&file_source("[bad](javascript:alert(1))\n", "Links.md")).is_err());
    }

    #[test]
    fn static_shell_has_inline_responsive_dark_print_css_and_no_runtime() {
        let html = render_document(&file_source("# <Static> & \"safe\"\n", "Shell.md")).unwrap();
        assert!(html.starts_with("<!doctype html>\n<html lang=\"en\">\n<head>\n"));
        assert!(html.contains("<meta charset=\"utf-8\">"));
        assert!(html.contains("Content-Security-Policy"));
        assert!(html.contains("script-src 'none'"));
        assert!(html.contains("<style data-mdr-styles>"));
        assert!(html.contains("@media (prefers-color-scheme: dark)"));
        assert!(html.contains("@media print"));
        assert!(html.contains("<main class=\"markdown-body\">"));
        assert!(!html.contains("<script"));
        assert!(!html.contains("<link"));
        assert!(!html.contains("@import"));
        assert!(!html.contains("@font-face"));
        assert!(!html.contains("type=\"module\""));
    }

    #[test]
    fn no_label_is_numbered_escaped_plaintext() {
        let html =
            render_document(&stdin_source("```\nalpha < beta && gamma > delta\n```\n")).unwrap();
        assert!(html.contains("data-language=\"\""));
        assert!(html.contains("class=\"mdr-code-line\" data-line=\"1\""));
        assert!(html.contains("alpha &lt; beta &amp;&amp; gamma &gt; delta"));
        assert!(!html.contains("<button"));
        assert!(!html.contains("<script"));
    }

    #[test]
    fn stdin_sources_embed_images_relative_to_their_canonical_cwd() {
        let directory = tempdir().unwrap();
        fs::write(directory.path().join("pixel.png"), b"png bytes").unwrap();
        let source = MarkdownSource::Stdin {
            markdown: "![stdin asset](pixel.png)\n".to_owned(),
            cwd: fs::canonicalize(directory.path()).unwrap(),
        };
        let html = render_document(&source).unwrap();
        assert!(html.contains("src=\"data:image/png;base64,cG5nIGJ5dGVz\""));
    }

    #[test]
    fn invalid_code_metadata_reports_the_fence_source_line() {
        let source = file_source(
            "# Before\n\nParagraph\n\n```ts del={2}\nconst value = 1;\n```\n",
            "Code.md",
        );
        let expected_prefix = format!("{}:5:1:", source.label());
        let error = render_document(&source).unwrap_err().to_string();
        assert!(error.starts_with(&expected_prefix), "{error}");
        assert!(error.contains("Unsupported code fence metadata"));
    }
}
