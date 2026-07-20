use std::collections::HashSet;

use comrak::arena_tree::NodeEdge;
use comrak::nodes::NodeValue;
use comrak::options::Plugins;
use comrak::{Arena, Options, format_html_with_plugins, parse_document};
use url::Url;

use crate::AppError;
use crate::assets::{resolve_image, resolve_remote_image};
use crate::code::{CodeRenderer, PlaintextRenderer};
use crate::source::{MarkdownSource, ResourceContext};

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
                        link.url = rewrite_link(&link.url, source.resource_context())?;
                    }
                    NodeValue::Image(image) => {
                        image.url = rewrite_image(
                            &image.url,
                            source.resource_context(),
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

fn rewrite_link(raw: &str, resource_context: ResourceContext<'_>) -> Result<String, AppError> {
    let value = raw.trim();
    if value.starts_with('#') {
        return Ok(value.to_owned());
    }
    if value.is_empty() || value.starts_with("//") || value.contains('\\') {
        return Err(AppError::new("Unsafe or invalid link URL."));
    }

    if let Ok(url) = Url::parse(value) {
        return match url.scheme() {
            "http" | "https" if url.host_str().is_some() => Ok(value.to_owned()),
            "mailto" | "tel" => Ok(value.to_owned()),
            _ => Err(AppError::new("Unsafe or invalid link URL.")),
        };
    }

    match resource_context {
        ResourceContext::Local(asset_base) => {
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
        ResourceContext::Remote(resource_base) => {
            let joined = resource_base
                .join(value)
                .map_err(|_| AppError::new("Unsafe or invalid link URL."))?;
            if matches!(joined.scheme(), "http" | "https") && joined.host_str().is_some() {
                Ok(joined.to_string())
            } else {
                Err(AppError::new("Unsafe or invalid link URL."))
            }
        }
    }
}

fn rewrite_image(
    raw: &str,
    resource_context: ResourceContext<'_>,
    source_label: &str,
    line: usize,
    column: usize,
) -> Result<String, AppError> {
    match resource_context {
        ResourceContext::Local(asset_base) => {
            resolve_image(raw, asset_base, source_label, line, column)
        }
        ResourceContext::Remote(resource_base) => {
            resolve_remote_image(raw, resource_base, source_label, line, column)
        }
    }
}

fn fallback_title(source: &MarkdownSource) -> String {
    source.fallback_title()
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

    fn remote_source(markdown: &str, base: &str) -> MarkdownSource {
        MarkdownSource::Remote {
            markdown: markdown.to_owned(),
            original_url: Url::parse("https://example.test/original.md").unwrap(),
            resource_base: Url::parse(base).unwrap(),
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
            asset_base: asset_base.clone(),
        };
        let mut expected_local = Url::from_file_path(asset_base.join("guide one.md"))
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
    fn remote_links_and_images_resolve_against_the_final_http_url() {
        let source = remote_source(
            "[sibling](guide.md) [root](/root.md) [query](?raw=1) [fragment](#part)\n\n![sibling](img/p.png) ![root](/img/root.png) ![query](?image=1) ![fragment](#preview)\n\n[https](https://safe.example/a) [mail](mailto:hello@example.test) [tel](tel:+123) ![cdn](https://cdn.example/a.png)\n",
            "https://example.test/docs/source.md?old=1",
        );
        let html = render_document(&source).unwrap();
        for expected in [
            "https://example.test/docs/guide.md",
            "https://example.test/root.md",
            "https://example.test/docs/source.md?raw=1",
            "href=\"#part\"",
            "https://example.test/docs/img/p.png",
            "https://example.test/img/root.png",
            "https://example.test/docs/source.md?image=1",
            "https://example.test/docs/source.md?old=1#preview",
            "https://safe.example/a",
            "mailto:hello@example.test",
            "tel:+123",
            "https://cdn.example/a.png",
        ] {
            assert!(html.contains(expected), "missing {expected}");
        }

        let github = remote_source(
            "![raw sibling](../images/logo.png)\n",
            "https://github.com/o/r/raw/main/docs/guide.md",
        );
        assert!(
            render_document(&github)
                .unwrap()
                .contains("https://github.com/o/r/raw/main/images/logo.png")
        );
    }

    #[test]
    fn remote_references_reject_unsafe_forms_and_never_read_local_sentinels() {
        let directory = tempdir().unwrap();
        let sentinel = directory.path().join("sentinel.png");
        fs::write(&sentinel, b"LOCAL_SENTINEL_BYTES").unwrap();
        let source = remote_source(
            "[sentinel](sentinel.png) ![sentinel](sentinel.png)\n",
            "http://127.0.0.1:8123/docs/source.md",
        );
        let html = render_document(&source).unwrap();
        assert!(html.contains("http://127.0.0.1:8123/docs/sentinel.png"));
        assert!(!html.contains("file://"));
        assert!(!html.contains("LOCAL_SENTINEL_BYTES"));
        assert!(!html.contains("data:image"));

        let base = Url::parse("https://example.test/docs/source.md").unwrap();
        for raw in [
            "//evil.test/path",
            "file:///tmp/path",
            "data:text/plain,x",
            "javascript:alert(1)",
            "..\\local.md",
        ] {
            assert!(
                rewrite_link(raw, ResourceContext::Remote(&base)).is_err(),
                "{raw}"
            );
            assert!(
                rewrite_image(raw, ResourceContext::Remote(&base), "remote", 1, 1).is_err(),
                "{raw}"
            );
        }
    }

    #[test]
    fn mdx_syntax_remains_inert_static_markdown() {
        let markdown = r#"import Widget from './Widget.js'
export const secret = 'not executed'

# MDX stays static

<Widget onClick={() => alert('nope')} value={secret} />
<script>globalThis.compromised = true</script>
"#;
        let html = render_document(&file_source(markdown, "component.mdx")).unwrap();

        assert!(html.contains("import Widget"));
        assert!(html.contains("export const secret"));
        assert!(html.contains("&lt;Widget onClick="));
        assert!(html.contains("&lt;script&gt;globalThis.compromised"));
        assert!(!html.contains("<Widget"));
        assert!(!html.contains("<script"));
        assert!(!html.contains("onClick=\""));
        assert!(html.contains("script-src 'none'"));
        assert!(!html.contains("type=\"module\""));
    }

    #[test]
    fn remote_metadata_never_exposes_url_credentials_in_html_or_errors() {
        let source = MarkdownSource::Remote {
            markdown: "Paragraph\n\n```ts unsupported=true\nvalue\n```\n".to_owned(),
            original_url: Url::parse("https://user:secret@example.test/source.md?q=1").unwrap(),
            resource_base: Url::parse("https://other:token@example.test/final/Guide.md").unwrap(),
        };
        let error = render_document(&source).unwrap_err().to_string();
        assert!(error.starts_with("https://example.test/source.md?q=1:"));
        assert!(!error.contains("user"));
        assert!(!error.contains("secret"));
        assert!(!error.contains("token"));

        let source = MarkdownSource::Remote {
            markdown: "Paragraph only\n".to_owned(),
            original_url: Url::parse("https://user:secret@example.test/source.md").unwrap(),
            resource_base: Url::parse("https://other:token@example.test/final/Guide.md").unwrap(),
        };
        let html = render_document(&source).unwrap();
        assert!(html.contains("<title>Guide</title>"));
        assert!(!html.contains("user"));
        assert!(!html.contains("secret"));
        assert!(!html.contains("token"));
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
