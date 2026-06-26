import { describe, expect, it } from "vitest";

import { renderScopeMarkdown } from "./markdown.js";

describe("renderScopeMarkdown", () => {
  it("wraps a paragraph and applies bold and inline code", () => {
    expect(renderScopeMarkdown("The **real** problem lives in `10-scope.md` only."))
      .toBe("<p>The <strong>real</strong> problem lives in <code>10-scope.md</code> only.</p>");
  });

  it("renders an unordered list", () => {
    expect(renderScopeMarkdown("- first\n- second")).toBe("<ul><li>first</li><li>second</li></ul>");
  });

  it("renders an ordered list", () => {
    expect(renderScopeMarkdown("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
  });

  it("keeps separate blocks separate", () => {
    expect(renderScopeMarkdown("Intro paragraph.\n\n- a\n- b"))
      .toBe("<p>Intro paragraph.</p>\n<ul><li>a</li><li>b</li></ul>");
  });

  it("escapes HTML so source is never trusted as markup", () => {
    expect(renderScopeMarkdown("<script>alert(1)</script> & more"))
      .toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; more</p>");
  });
});
