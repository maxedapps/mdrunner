use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::fmt::Write as _;
use std::ops::RangeInclusive;
use std::sync::Mutex;

use comrak::adapters::{CodefenceRendererAdapter, SyntaxHighlighterAdapter};
use comrak::nodes::Sourcepos;
use lumis::formatters::Formatter as _;
use lumis::formatters::html_inline::HighlightLines;
use lumis::languages::Language;
use lumis::{HtmlMultiThemesBuilder, themes};
use mermaid_rs_renderer::{RenderOptions, render_strict};

use crate::AppError;

pub(crate) struct CodeRenderer {
    source_label: String,
    positions: Mutex<VecDeque<(usize, usize)>>,
    error: Mutex<Option<AppError>>,
}

impl CodeRenderer {
    pub(crate) fn new(source_label: String, positions: Vec<(usize, usize)>) -> Self {
        Self {
            source_label,
            positions: Mutex::new(positions.into()),
            error: Mutex::new(None),
        }
    }

    pub(crate) fn take_error(&self) -> Option<AppError> {
        self.error.lock().expect("code error lock poisoned").take()
    }

    fn fail(
        &self,
        sourcepos: Option<Sourcepos>,
        prepared_position: Option<(usize, usize)>,
        message: impl Into<String>,
    ) {
        let position = sourcepos
            .map(|position| (position.start.line, position.start.column))
            .or(prepared_position)
            .map_or_else(
                || self.source_label.clone(),
                |(line, column)| format!("{}:{line}:{column}", self.source_label),
            );
        let mut slot = self.error.lock().expect("code error lock poisoned");
        if slot.is_none() {
            *slot = Some(AppError::labeled(message, position));
        }
    }
}

impl CodefenceRendererAdapter for CodeRenderer {
    fn write(
        &self,
        output: &mut dyn fmt::Write,
        lang: &str,
        meta: &str,
        code: &str,
        sourcepos: Option<Sourcepos>,
    ) -> fmt::Result {
        let prepared_position = self
            .positions
            .lock()
            .expect("code position lock poisoned")
            .pop_front();
        let metadata = match FenceMetadata::parse(meta) {
            Ok(metadata) => metadata,
            Err(message) => {
                self.fail(sourcepos, prepared_position, message);
                return Ok(());
            }
        };

        if lang.eq_ignore_ascii_case("mermaid") {
            if !metadata.is_empty() {
                self.fail(
                    sourcepos,
                    prepared_position,
                    "Mermaid fences do not accept code metadata.",
                );
                return Ok(());
            }
            match render_strict(code, RenderOptions::default()) {
                Ok(svg) => {
                    writeln!(
                        output,
                        "<figure class=\"mermaid-diagram\" role=\"img\">{svg}</figure>"
                    )?;
                }
                Err(error) => {
                    self.fail(
                        sourcepos,
                        prepared_position,
                        format!("Invalid Mermaid diagram: {error}"),
                    );
                }
            }
            return Ok(());
        }

        match render_code(lang, code, &metadata) {
            Ok(html) => output.write_str(&html),
            Err(message) => {
                self.fail(sourcepos, prepared_position, message);
                Ok(())
            }
        }
    }
}

pub(crate) struct PlaintextRenderer;

impl SyntaxHighlighterAdapter for PlaintextRenderer {
    fn write_highlighted(
        &self,
        output: &mut dyn fmt::Write,
        _lang: Option<&str>,
        code: &str,
    ) -> fmt::Result {
        let code = strip_fence_line_ending(code);
        for (index, line) in code.split('\n').enumerate() {
            write!(
                output,
                "<span class=\"mdr-code-line\" data-line=\"{}\">{}</span>",
                index + 1,
                escape_html(line)
            )?;
        }
        Ok(())
    }

    fn write_pre_tag(
        &self,
        output: &mut dyn fmt::Write,
        _attributes: HashMap<&'static str, Cow<'_, str>>,
    ) -> fmt::Result {
        output.write_str("<pre class=\"lumis lumis-themes mdr-code\" data-language=\"\">")
    }

    fn write_code_tag(
        &self,
        output: &mut dyn fmt::Write,
        _attributes: HashMap<&'static str, Cow<'_, str>>,
    ) -> fmt::Result {
        output.write_str("<code translate=\"no\" tabindex=\"0\">")
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
struct FenceMetadata {
    title: Option<String>,
    marks: Vec<RangeInclusive<usize>>,
    inserts: Vec<RangeInclusive<usize>>,
}

impl FenceMetadata {
    fn parse(input: &str) -> Result<Self, &'static str> {
        let mut metadata = Self::default();
        let mut rest = input.trim();

        while !rest.is_empty() {
            if let Some(after_prefix) = rest.strip_prefix("title=\"") {
                if metadata.title.is_some() {
                    return Err("Code fence title metadata is duplicated.");
                }
                let end = after_prefix
                    .find('"')
                    .ok_or("Code fence title metadata is missing a closing quote.")?;
                metadata.title = Some(after_prefix[..end].to_owned());
                rest = &after_prefix[end + 1..];
                if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
                    return Err("Code fence title metadata is malformed.");
                }
            } else {
                let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
                let token = &rest[..end];
                if let Some(ranges) = token
                    .strip_prefix("ins={")
                    .and_then(|value| value.strip_suffix('}'))
                {
                    if !metadata.inserts.is_empty() {
                        return Err("Code fence insert metadata is duplicated.");
                    }
                    metadata.inserts = parse_ranges(ranges)?;
                } else if let Some(ranges) = token
                    .strip_prefix('{')
                    .and_then(|value| value.strip_suffix('}'))
                {
                    if !metadata.marks.is_empty() {
                        return Err("Code fence mark metadata is duplicated.");
                    }
                    metadata.marks = parse_ranges(ranges)?;
                } else {
                    return Err("Unsupported code fence metadata.");
                }
                rest = &rest[end..];
            }
            rest = rest.trim_start();
        }

        Ok(metadata)
    }

    fn is_empty(&self) -> bool {
        self.title.is_none() && self.marks.is_empty() && self.inserts.is_empty()
    }
}

fn parse_ranges(input: &str) -> Result<Vec<RangeInclusive<usize>>, &'static str> {
    if input.is_empty() {
        return Err("Code fence line ranges are empty.");
    }
    input
        .split(',')
        .map(|item| {
            if item.is_empty() {
                return Err("Code fence line range is malformed.");
            }
            let (start, end) = match item.split_once('-') {
                Some((start, end)) if !start.is_empty() && !end.is_empty() => {
                    if end.contains('-') {
                        return Err("Code fence line range is malformed.");
                    }
                    (parse_line(start)?, parse_line(end)?)
                }
                Some(_) => return Err("Code fence line range is malformed."),
                None => {
                    let line = parse_line(item)?;
                    (line, line)
                }
            };
            if start > end {
                return Err("Code fence line range is reversed.");
            }
            Ok(start..=end)
        })
        .collect()
}

fn parse_line(value: &str) -> Result<usize, &'static str> {
    let line = value
        .parse::<usize>()
        .map_err(|_| "Code fence line range is malformed.")?;
    if line == 0 {
        return Err("Code fence line numbers must start at one.");
    }
    Ok(line)
}

fn strip_fence_line_ending(code: &str) -> &str {
    code.strip_suffix('\n')
        .map(|code| code.strip_suffix('\r').unwrap_or(code))
        .unwrap_or(code)
}

fn render_code(lang: &str, code: &str, metadata: &FenceMetadata) -> Result<String, String> {
    let code = strip_fence_line_ending(code);
    let language = language_for_label(lang).unwrap_or(Language::PlainText);
    let line_count = code.lines().count().max(1);
    let mut theme_map = HashMap::new();
    theme_map.insert(
        "light".to_owned(),
        themes::get("github_light")
            .map_err(|_| "GitHub light highlighting theme is unavailable.".to_owned())?,
    );
    theme_map.insert(
        "dark".to_owned(),
        themes::get("github_dark")
            .map_err(|_| "GitHub dark highlighting theme is unavailable.".to_owned())?,
    );
    let highlight_lines = HighlightLines {
        lines: vec![1..=line_count],
        style: None,
        class: None,
    };
    let formatter = HtmlMultiThemesBuilder::new()
        .language(language)
        .themes(theme_map)
        .default_theme("light")
        .pre_class(Some("mdr-code".to_owned()))
        .highlight_lines(Some(highlight_lines))
        .build()
        .map_err(|error| format!("Code highlighting failed: {error}"))?;
    let mut bytes = Vec::new();
    formatter
        .format(code, &mut bytes)
        .map_err(|error| format!("Code highlighting failed: {error}"))?;
    let highlighted = String::from_utf8(bytes)
        .map_err(|_| "Code highlighting produced invalid UTF-8.".to_owned())?
        .replace("mdr-code dark light", "mdr-code light dark");
    let highlighted = decorate_lines(&highlighted, &metadata.marks, &metadata.inserts);
    let highlighted = highlighted.replacen(
        "<pre ",
        &format!("<pre data-language=\"{}\" ", escape_html(lang)),
        1,
    );

    let class = if metadata.title.is_some() {
        "code-frame has-title"
    } else {
        "code-frame"
    };
    let mut html = format!("<figure class=\"{class}\">");
    if let Some(title) = &metadata.title {
        write!(
            html,
            "<figcaption class=\"code-title\">{}</figcaption>",
            escape_html(title)
        )
        .expect("writing to String cannot fail");
    }
    html.push_str(&highlighted);
    html.push_str("</figure>\n");
    Ok(html)
}

fn decorate_lines(
    html: &str,
    marks: &[RangeInclusive<usize>],
    inserts: &[RangeInclusive<usize>],
) -> String {
    let mut result = String::with_capacity(html.len() + marks.len() * 9 + inserts.len() * 8);
    let mut rest = html;

    while let Some(index) = rest.find("<div class=\"l-line") {
        result.push_str(&rest[..index]);
        rest = &rest[index..];
        let Some(tag_end) = rest.find('>') else {
            break;
        };
        let tag = &rest[..=tag_end];
        let line = data_line(tag);
        let mut decorated = tag.to_owned();
        if let Some(line) = line {
            let mut classes = String::new();
            if marks.iter().any(|range| range.contains(&line)) {
                classes.push_str(" mark");
            }
            if inserts.iter().any(|range| range.contains(&line)) {
                classes.push_str(" ins");
            }
            if !classes.is_empty() {
                decorated =
                    decorated.replacen("class=\"l-line", &format!("class=\"l-line{classes}"), 1);
            }
        }
        result.push_str(&decorated);
        rest = &rest[tag_end + 1..];
    }
    result.push_str(rest);
    result
}

fn data_line(tag: &str) -> Option<usize> {
    let value = tag.split_once("data-line=\"")?.1;
    value.split_once('"')?.0.parse().ok()
}

fn language_for_label(label: &str) -> Option<Language> {
    match label.to_ascii_lowercase().as_str() {
        "bash" | "sh" | "shell" => Some(Language::Bash),
        "c" => Some(Language::C),
        "c++" | "cc" | "cpp" => Some(Language::CPlusPlus),
        "c#" | "cs" | "csharp" => Some(Language::CSharp),
        "css" => Some(Language::CSS),
        "go" | "golang" => Some(Language::Go),
        "htm" | "html" => Some(Language::HTML),
        "java" => Some(Language::Java),
        "cjs" | "javascript" | "js" | "jsx" | "mjs" => Some(Language::JavaScript),
        "json" => Some(Language::JSON),
        "py" | "python" => Some(Language::Python),
        "rb" | "ruby" => Some(Language::Ruby),
        "rs" | "rust" => Some(Language::Rust),
        "sql" => Some(Language::SQL),
        "toml" => Some(Language::Toml),
        "tsx" => Some(Language::Tsx),
        "ts" | "typescript" => Some(Language::TypeScript),
        "yaml" | "yml" => Some(Language::YAML),
        _ => None,
    }
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
    use super::*;

    #[test]
    fn parses_only_the_bounded_metadata_grammar() {
        assert_eq!(
            FenceMetadata::parse(r#"title="example.ts" {1,3-5} ins={2}"#).unwrap(),
            FenceMetadata {
                title: Some("example.ts".to_owned()),
                marks: vec![1..=1, 3..=5],
                inserts: vec![2..=2],
            }
        );
        for metadata in [
            "title=example.ts",
            "{0}",
            "{4-2}",
            "{1,}",
            "del={2}",
            "title=\"a\" extra",
        ] {
            assert!(FenceMetadata::parse(metadata).is_err(), "{metadata}");
        }
    }

    #[test]
    fn known_code_uses_static_github_themes_titles_and_line_classes() {
        let metadata = FenceMetadata::parse(r#"title="example.ts" {2} ins={3}"#).unwrap();
        let html = render_code(
            "ts",
            "const answer: number = 42;\nconsole.log(answer);\nreturn answer;\n",
            &metadata,
        )
        .unwrap();
        assert!(html.contains("class=\"code-frame has-title\""));
        assert!(html.contains("class=\"code-title\">example.ts</figcaption>"));
        assert!(html.contains("data-language=\"ts\""));
        assert!(html.contains("--lumis-light"));
        assert!(html.contains("--lumis-dark"));
        assert!(html.contains("class=\"l-line mark"));
        assert!(html.contains("class=\"l-line ins"));
        assert!(html.contains("data-line=\"3\""));
        assert!(!html.contains("data-line=\"4\""));
        assert_eq!(html.matches("class=\"l-line").count(), 3);
        assert!(!html.contains("<script"));
        assert!(!html.contains("<button"));

        let escaped_title = render_code(
            "ts",
            "const safe = true;\n",
            &FenceMetadata::parse(r#"title="<unsafe & title>""#).unwrap(),
        )
        .unwrap();
        assert!(escaped_title.contains("&lt;unsafe &amp; title&gt;"));

        let javascript = render_code(
            "js",
            "const answer = 42;\nconsole.log(answer);\n",
            &FenceMetadata::default(),
        )
        .unwrap();
        assert!(javascript.contains("class=\"language-javascript\""));
        assert!(javascript.contains("<span style="));
        assert!(javascript.contains("console"));
    }

    #[test]
    fn unknown_language_is_plaintext_and_preserves_escaped_authored_label() {
        let html = render_code(
            "strange<&quot;",
            "alpha < beta && gamma > delta\n",
            &FenceMetadata::default(),
        )
        .unwrap();
        assert!(html.contains("data-language=\"strange&lt;&amp;quot;\""));
        assert!(html.contains("alpha &lt; beta &amp;&amp; gamma &gt; delta"));
        assert!(!html.contains("data-line=\"2\""));
        assert!(!html.contains("<button"));
    }

    #[test]
    fn removes_only_the_structural_fence_line_ending() {
        assert_eq!(strip_fence_line_ending("one\n"), "one");
        assert_eq!(strip_fence_line_ending("one\r\n"), "one");
        assert_eq!(strip_fence_line_ending("one\n\n"), "one\n");

        let renderer = PlaintextRenderer;
        let mut ordinary = String::new();
        renderer
            .write_highlighted(&mut ordinary, None, "one\ntwo\n")
            .unwrap();
        assert!(ordinary.contains("data-line=\"2\""));
        assert!(!ordinary.contains("data-line=\"3\""));
        assert!(!ordinary.contains("</span>\n<span"));

        let mut authored_blank = String::new();
        renderer
            .write_highlighted(&mut authored_blank, None, "one\n\n")
            .unwrap();
        assert!(authored_blank.contains("data-line=\"2\"></span>"));
        assert!(!authored_blank.contains("data-line=\"3\""));
    }
}
