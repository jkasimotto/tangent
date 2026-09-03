// The CSS the Map root emits matches the table, and the stylesheet asks for nothing else.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { LAYOUT, layoutCssVariableName, layoutCssVariables } from "./layout-tokens.ts";

const MAP_CSS = readFileSync(fileURLToPath(new URL("../ui/map.css", import.meta.url)), "utf8");

/** Lists every distinct --tangent-map-* custom property that map.css reads through var(). */
function layoutVariablesReadByMapCss(): string[] {
  const names = new Set<string>();
  for (const match of MAP_CSS.matchAll(/var\((--tangent-map-[a-z0-9-]+)/g)) names.add(match[1] ?? "");
  return [...names].sort();
}

/** Lists every pixel width a media query in map.css tests against. */
function mediaQueryWidthsInMapCss(): number[] {
  return [...MAP_CSS.matchAll(/@media \((?:max|min)-width: (\d+)px\)/g)].map((match) => Number(match[1]));
}

test("every token in the table is emitted as one --tangent-map-* custom property", () => {
  const variables = layoutCssVariables(LAYOUT);
  const emitted = Object.keys(variables);
  assert.equal(emitted.length, Object.keys(LAYOUT).length);
  for (const token of Object.keys(LAYOUT)) assert.ok(emitted.includes(layoutCssVariableName(token)), `emits ${token}`);
});

test("token names become kebab-case custom properties", () => {
  assert.equal(layoutCssVariableName("rowTopUnderPanel"), "--tangent-map-row-top-under-panel");
  assert.equal(layoutCssVariableName("panelWidth"), "--tangent-map-panel-width");
});

test("each value is written with the unit its brand carries", () => {
  const variables = layoutCssVariables(LAYOUT);
  assert.equal(variables["--tangent-map-panel-width"], "min(680px, 72%)");
  assert.equal(variables["--tangent-map-row-top"], "16px");
  assert.equal(variables["--tangent-map-hang-top-under-panel"], "122px");
  assert.equal(variables["--tangent-map-nudge-fast"], "10px");
  assert.equal(variables["--tangent-map-block-width"], "280px");
  assert.equal(variables["--tangent-map-paste-window"], "1000ms");
  assert.equal(variables["--tangent-map-find-pulse"], "900ms");
  assert.equal(variables["--tangent-map-picker-window"], "30");
});

test("the table holds the numbers the design names", () => {
  assert.equal(LAYOUT.rowTop, 16);
  assert.equal(LAYOUT.rowTopUnderPanel, 76);
  assert.equal(LAYOUT.hangTop, 62);
  assert.equal(LAYOUT.hangTopUnderPanel, 122);
  assert.equal(LAYOUT.edgeInset, 12);
  assert.equal(LAYOUT.controlInset, 24);
  assert.equal(LAYOUT.saveInset, 62);
  assert.equal(LAYOUT.grabPadding, 10);
  assert.equal(LAYOUT.nudge, 1);
  assert.equal(LAYOUT.nudgeFast, 10);
  assert.equal(LAYOUT.placementStep, 16);
  assert.equal(LAYOUT.placementStepFine, 1);
  assert.equal(LAYOUT.narrowBreakpoint, 960);
  assert.equal(LAYOUT.pasteWindow, 1_000);
  assert.equal(LAYOUT.pickerWindow, 30);
  assert.equal(LAYOUT.findWindow, 4);
  assert.equal(LAYOUT.resourceCadence, 30_000);
});

test("every --tangent-map-* custom property map.css reads is one layoutCssVariables emits", () => {
  const emitted = new Set(Object.keys(layoutCssVariables(LAYOUT)));
  const read = layoutVariablesReadByMapCss();
  assert.ok(read.length > 0, "map.css reads layout tokens");
  const missing = read.filter((name) => !emitted.has(name));
  assert.deepEqual(missing, [], "map.css reads a --tangent-map-* property that layout-tokens.ts does not emit");
});

test("map.css defines no --tangent-map-* property of its own", () => {
  const defined = [...MAP_CSS.matchAll(/(--tangent-map-[a-z0-9-]+)\s*:/g)].map((match) => match[1]);
  assert.deepEqual(defined, [], "every layout number is named once, in layout-tokens.ts");
});

test("every media query width in map.css is a breakpoint the table names", () => {
  const breakpoints = new Set<number>([
    LAYOUT.narrowBreakpoint,
    LAYOUT.rowUnderToolbarBreakpoint,
    LAYOUT.rowUnderToolbarWithVerbsBreakpoint,
    LAYOUT.toolbarRecentreBreakpoint,
    LAYOUT.findShortBreakpoint,
  ]);
  const widths = mediaQueryWidthsInMapCss();
  assert.ok(widths.length > 0, "map.css has width media queries");
  const unnamed = widths.filter((width) => !breakpoints.has(width));
  assert.deepEqual(unnamed, [], "a media query width is not a breakpoint in layout-tokens.ts");
});

test("the short Find list in map.css hides the row after LAYOUT.findWindow", () => {
  const match = /\.tangent-map-find li:nth-child\(n \+ (\d+)\)/.exec(MAP_CSS);
  assert.ok(match, "map.css caps the short Find list with nth-child");
  assert.equal(Number(match[1]), LAYOUT.findWindow + 1);
});
