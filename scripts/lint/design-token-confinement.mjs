#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { TOKENS_OWNER, isMapStyleFile, jsxStyleSegments, reasonHit, segmentLines, runStyleLint } from "./style-scope.mjs";

// The CSS twin of the raw-number lints. A raw colour (hex, rgb(), hsl()), a font-size not drawn
// from a --tangent-* token and a font-family not drawn from a token may appear only in
// packages/agent-shell/app/map/ui/tokens.css. Every other .css line and every .tsx style text in
// the Map says var(--tangent-*). The style text of a .tsx file is the value of each style=
// attribute and the body of each <style> element; other code in a .tsx is not style text. The
// strict scope is never grandfathered, so there is no ratchet.

const NAME = "design-token-confinement";
const EXTENSIONS = new Set([".css", ".tsx", ".jsx"]);
const REMEDY = `Use var(--tangent-*) from ${TOKENS_OWNER}. If no token fits, adding one is a design decision made in tokens.css, not inline.`;

// Colour patterns run on the value side of a line, after its first colon, so an id selector such
// as #add-button does not read as a hex colour.
const VALUE_PATTERNS = [
  [/#[0-9a-fA-F]{3,8}\b/, "a raw hex colour"],
  [/\brgba?\(/, "a raw rgb() colour"],
  [/\bhsla?\(/, "a raw hsl() colour"]
];

// Type patterns run on the whole line and cover the CSS property and its camelCase style-object twin.
const LINE_PATTERNS = [
  [/\b(?:font-size|fontSize)\s*:(?![^;,]*var\(--tangent-)/, "a font-size not drawn from a --tangent-* token"],
  [/\b(?:font-family|fontFamily)\s*:(?![^;,]*var\(--tangent-)/, "a font-family not drawn from a --tangent-* token"]
];

/** True for the files this lint inspects: Map stylesheets and JSX files other than tokens.css. */
function isInspected(repoPath) {
  return isMapStyleFile(repoPath, EXTENSIONS) && repoPath !== TOKENS_OWNER;
}

/** Returns the part of a line after its first colon, where a declaration's value lives. */
function valueSide(text) {
  const colon = text.indexOf(":");
  return colon === -1 ? "" : text.slice(colon + 1);
}

/** Returns every reason one style line violates token confinement. */
function reasonsForLine(text) {
  const reasons = [];
  const value = valueSide(text);
  for (const [pattern, label] of VALUE_PATTERNS) {
    if (pattern.test(value)) reasons.push(label);
  }
  for (const [pattern, label] of LINE_PATTERNS) {
    if (pattern.test(text)) reasons.push(label);
  }
  return reasons;
}

/** Returns a file's style text as numbered lines: the whole file for .css, the JSX style segments otherwise. */
function styleLines(file, source) {
  if (file.repoPath.endsWith(".css")) {
    return source.split("\n").map((text, index) => ({ line: index + 1, text }));
  }
  return jsxStyleSegments(file, source).flatMap(segmentLines);
}

/** Scans one file's style text for raw visual values and returns the hits. */
function collectFileHits(file) {
  const source = readFileSync(file.absolutePath, "utf8");
  const hits = [];
  for (const { line, text } of styleLines(file, source)) {
    const reasons = reasonsForLine(text);
    if (reasons.length > 0) hits.push(reasonHit(file, line, reasons.join(", "), text));
  }
  return hits;
}

runStyleLint({ name: NAME, remedy: REMEDY, isInspected, collectFileHits });
