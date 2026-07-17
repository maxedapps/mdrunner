import { describe, expect, test } from "bun:test";

import { validateAuthoredSvg, type ImageAssetContext } from "../../src/assets.ts";
import { ExpectedError } from "../../src/errors.ts";

const context: ImageAssetContext = {
  assetBase: "/workspace/docs",
  label: "/workspace/docs/document.md",
  line: 7,
  column: 1,
};

const encoder = new TextEncoder();

function svgFailure(svg: string): ExpectedError {
  try {
    validateAuthoredSvg(encoder.encode(svg), context);
  } catch (error) {
    expect(error).toBeInstanceOf(ExpectedError);
    const expected = error as ExpectedError;
    expect(expected.source).toEqual({ label: context.label, line: 7, column: 1 });
    return expected;
  }
  throw new Error("Expected SVG validation to fail");
}

function document(body = "", attributes = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;
}

describe("authored SVG structural validation", () => {
  test("accepts inert SVG and safe internal paint references", () => {
    expect(() =>
      validateAuthoredSvg(
        encoder.encode(
          `<?xml version="1.0"?>${document(`
  <defs>
    <linearGradient id="safe-paint"><stop offset="0" stop-color="#fff"/></linearGradient>
    <clipPath id="clip_1"><path d="M0 0h1v1z"/></clipPath>
  </defs>
  <rect width="1" height="1" fill="url(#safe-paint)" clip-path="url(#clip_1)" style="stroke:url(#safe-paint)"/>
  <title>Inert image</title>
`)}`,
        ),
        context,
      ),
    ).not.toThrow();
  });

  test.each([
    ["script", "<script/>"],
    ["foreignObject", "<foreignObject/>"],
    ["iframe", "<iframe/>"],
    ["object", "<object/>"],
    ["embed", "<embed/>"],
    ["audio", "<audio/>"],
    ["video", "<video/>"],
    ["image", "<image/>"],
    ["use", "<use/>"],
    ["anchor", "<a/>"],
    ["style", "<style/>"],
    ["set", "<set/>"],
    ["discard", "<discard/>"],
    ["animate", "<animate/>"],
    ["animateMotion", "<animateMotion/>"],
    ["animateTransform", "<animateTransform/>"],
    ["mpath", "<mpath/>"],
  ])("rejects the active/load-capable %s element", (_name, body) => {
    expect(svgFailure(document(body)).message).toContain("active element");
  });

  test.each([
    ["event handler", 'onload="alert(1)"'],
    ["mixed-case event handler", 'onClick="alert(1)"'],
    ["href", 'href="#local"'],
    ["xlink href", 'xlink:href="#local"'],
    ["src", 'src="asset.png"'],
  ])("rejects %s attributes", (_name, attribute) => {
    expect(svgFailure(document(`<rect ${attribute}/>`)).message).toContain("unsafe attribute");
  });

  test.each([
    ["CSS import", 'style="@import url(https://example.test/a.css)"'],
    ["CSS expression", 'style="width: expression(alert(1))"'],
    ["escaped CSS URL", 'style="fill:u\\72l(https://example.test/a.svg#x)"'],
    ["HTTP URL", 'fill="url(https://example.test/a.svg#x)"'],
    ["relative URL", 'fill="url(other.svg#x)"'],
    ["data URL", 'fill="url(data:image/svg+xml;base64,AAAA)"'],
    ["quoted fragment", "fill=\"url('#paint')\""],
    ["unsafe fragment id", 'fill="url(#bad id)"'],
    ["unterminated URL", 'fill="url(#paint"'],
  ])("rejects %s in CSS-capable values", (_name, attribute) => {
    expect(svgFailure(document(`<rect ${attribute}/>`)).message).toMatch(/CSS|URL/u);
  });

  test.each([
    ["malformed XML", document("<g>")],
    ["multiple roots", `${document()}${document()}`],
    ["non-svg root", '<html xmlns="http://www.w3.org/2000/svg"/>'],
    ["prefixed root", '<s:svg xmlns:s="http://www.w3.org/2000/svg"/>'],
    ["missing namespace", "<svg/>"],
    ["wrong namespace", '<svg xmlns="https://example.test/svg"/>'],
    ["additional namespace", '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="urn:x"/>'],
    ["nested wrong namespace", document('<g xmlns="urn:not-svg"><rect/></g>')],
    ["boolean attribute", document("<rect disabled/>")],
    ["duplicate attribute", document('<rect fill="red" fill="blue"/>')],
    ["DOCTYPE", '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>'],
    [
      "entity declaration",
      '<!DOCTYPE svg [<!ENTITY x "payload">]><svg xmlns="http://www.w3.org/2000/svg"/>',
    ],
    ["named entity reference", document("<title>&amp;</title>")],
    ["non-leading XML declaration", `<!--comment--><?xml version="1.0"?>${document()}`],
    ["nested processing instruction", document("<?target value?>")],
    ["trailing processing instruction", `${document()}<?target value?>`],
    ["namespaced child", document("<x:rect/>", 'xmlns:x="urn:x"')],
    ["non-UTF-8 bytes", null],
  ])("fails closed for %s", (_name, svg) => {
    if (svg === null) {
      try {
        validateAuthoredSvg(new Uint8Array([0xff, 0xfe]), context);
      } catch (error) {
        expect(error).toBeInstanceOf(ExpectedError);
        expect((error as ExpectedError).message).toBe("SVG is not valid UTF-8.");
        return;
      }
      throw new Error("Expected invalid UTF-8 to fail");
    }
    svgFailure(svg);
  });
});
