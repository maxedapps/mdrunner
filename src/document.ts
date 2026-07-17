// @ts-expect-error -- Bun's text loader embeds this product asset in source and standalone builds.
import productStyles from "./styles.css" with { type: "text" };

export const DOCUMENT_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "font-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "img-src data: http: https:",
  "manifest-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "worker-src 'none'",
].join("; ");

const PROHIBITED_ACTIVE_ELEMENT =
  /<(?:animate|animateMotion|animateTransform|applet|audio|base|button|canvas|discard|embed|foreignObject|form|frame|frameset|iframe|image|link|object|portal|script|select|set|source|template|textarea|track|use|video)\b/iu;
const EVENT_HANDLER_ATTRIBUTE = /<[^>]+\son[a-z][\w:-]*\s*=/iu;
const EXECUTABLE_URL_ATTRIBUTE =
  /<[^>]+\s(?:href|src|xlink:href|formaction)\s*=\s*["']\s*(?:javascript\s*:|vbscript\s*:|data\s*:\s*text\/html)/iu;
const EXTERNAL_CSS_URL = /url\(\s*["']?(?:(?:https?:)?\/\/|data\s*:\s*font)/iu;

/** A final-shell failure. It intentionally carries no parser or authored object references. */
export class FinalDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinalDocumentError";
  }
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fail(message: string): never {
  throw new FinalDocumentError(`Generated document invariant failed: ${message}.`);
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function withoutInlineStyleContents(html: string): string {
  return html.replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/giu, "$1$2");
}

function validateInlineStyles(html: string): void {
  const styleElements = html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu);
  for (const match of styleElements) {
    const css = match[1] ?? "";
    if (/@import\b/iu.test(css)) fail("CSS imports are not allowed");
    if (/@font-face\b/iu.test(css)) fail("embedded or external font definitions are not allowed");
    if (EXTERNAL_CSS_URL.test(css)) fail("external CSS URLs are not allowed");
  }
}

function validateTaskInputs(html: string): void {
  for (const match of html.matchAll(/<input\b[^>]*>/giu)) {
    const element = match[0];
    if (!/\btype=["']checkbox["']/iu.test(element) || !/\bdisabled\b/iu.test(element)) {
      fail("unexpected active input element");
    }
    if (/\b(?:form|formaction|name)\s*=/iu.test(element)) {
      fail("task input contains an active form attribute");
    }
  }
}

/**
 * Fail closed on shell structure and active/external runtime constructs after all
 * trusted renderers have completed and before output persistence begins.
 */
export function validateFinalDocument(html: string): void {
  if (!html.startsWith('<!doctype html>\n<html lang="en">\n<head>\n')) {
    fail("required HTML5 root structure is missing");
  }
  if (!html.endsWith("\n</body>\n</html>\n")) fail("document closing structure is missing");
  if (
    countMatches(html, /<html\b/giu) !== 1 ||
    countMatches(html, /<head>/gu) !== 1 ||
    countMatches(html, /<\/head>/gu) !== 1 ||
    countMatches(html, /<body>/gu) !== 1 ||
    countMatches(html, /<\/body>/gu) !== 1
  ) {
    fail("document must contain one html, head, and body element");
  }
  if (
    countMatches(html, /<main class="markdown-body">/gu) !== 1 ||
    countMatches(html, /<\/main>/gu) !== 1
  ) {
    fail("semantic Markdown main container is missing");
  }
  if (!html.includes('</head>\n<body>\n<main class="markdown-body">')) {
    fail("head, body, and main structure is out of order");
  }
  if (!html.includes('<meta charset="utf-8">')) fail("UTF-8 charset metadata is missing");
  if (!html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">')) {
    fail("viewport metadata is missing");
  }
  const csp = `<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">`;
  if (
    countMatches(html, /<meta\s+http-equiv=/giu) !== 1 ||
    countMatches(html, /<meta\s+http-equiv="Content-Security-Policy"/giu) !== 1
  ) {
    fail("exactly one content security policy is required");
  }
  if (!html.includes(csp)) fail("content security policy is missing or altered");
  if (!/<title>[^<]*<\/title>/u.test(html)) fail("escaped document title is missing");
  if (countMatches(html, /<style data-mdrunner-styles>/gu) !== 1) {
    fail("inline product styles are missing");
  }
  const markup = withoutInlineStyleContents(html);
  if (PROHIBITED_ACTIVE_ELEMENT.test(markup)) fail("unexpected active element is present");
  if (EVENT_HANDLER_ATTRIBUTE.test(markup)) fail("event-handler attributes are not allowed");
  if (EXECUTABLE_URL_ATTRIBUTE.test(markup)) fail("an executable URL attribute is present");
  validateInlineStyles(html);
  validateTaskInputs(html);
}

/** Assemble and validate one deterministic, self-contained HTML5 document. */
export function createHtmlDocument(title: string, fragment: string): string {
  const document = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">
<title>${escapeHtmlText(title)}</title>
<style data-mdrunner-styles>
${productStyles}
</style>
</head>
<body>
<main class="markdown-body">${fragment}</main>
</body>
</html>
`;
  validateFinalDocument(document);
  return document;
}
