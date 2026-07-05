import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildReportModel } from "../dist/report/model.js";
import { renderHtmlReport } from "../dist/report/html.js";
import { reportFixture } from "./report-fixtures.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));

test("renderHtmlReport matches the golden fixture for two variants with one discriminating criterion", async () => {
  const { manifest, sidecars, taskSummary } = reportFixture();
  const model = buildReportModel({ manifest, sidecars, taskSummary });
  const golden = await readFile(path.join(testDir, "report-html-fixture-a.golden.html"), "utf8");
  assert.equal(renderHtmlReport(model), golden);
});

test("renderHtmlReport is one self-contained document: no external script, link, or fetch", () => {
  const { manifest, sidecars, taskSummary } = reportFixture();
  const model = buildReportModel({ manifest, sidecars, taskSummary });
  const html = renderHtmlReport(model);
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script\b[^>]*\ssrc=/i);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /\bfetch\(/);
});

test("renderHtmlReport skips the transcripts and context-diff sections cleanly when the model carries neither", () => {
  const { manifest, sidecars, taskSummary } = reportFixture();
  const model = buildReportModel({ manifest, sidecars, taskSummary });
  const html = renderHtmlReport(model);
  assert.doesNotMatch(html, /Conversation transcripts/);
  assert.doesNotMatch(html, /Context diff vs baseline/);
});

test("renderHtmlReport escapes judge reasoning text so it cannot inject markup", () => {
  const { manifest, sidecars, taskSummary } = reportFixture();
  sidecars[0].evaluation.criteria[1].reasoning = "<img src=x onerror=alert(1)> and a & an \"quote\"";
  const model = buildReportModel({ manifest, sidecars, taskSummary });
  const html = renderHtmlReport(model);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; and a &amp; an &quot;quote&quot;/);
});
