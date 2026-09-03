#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { LAYERS_OWNER, isMapStyleFile, reasonHit, runStyleLint } from "./style-scope.mjs";

// The stacking authority. The z-index scale is defined only in packages/agent-shell/app/map/ui/
// layers.css, one --tangent-layer-* name per layer. Everywhere else a z-index may only read the
// scale as var(--tangent-layer-*); any literal z-index value, and any --tangent-layer-* definition
// outside layers.css, fails. The audit found eleven retyped z-index values in the old Map; a closed
// named scale is the fix. The strict scope is never grandfathered, so there is no ratchet.

const NAME = "layer-confinement";
const EXTENSIONS = new Set([".css", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const REMEDY = `Stack only through var(--tangent-layer-*). A new layer is a design decision made in ${LAYERS_OWNER}.`;

// A z-index declaration, as CSS or as its camelCase style-object twin.
const Z_INDEX_USE = /\b(?:z-index|zIndex)\s*:/;
// The one allowed value: exactly one var(--tangent-layer-*) read, optionally quoted in a style object.
const Z_INDEX_VIA_SCALE = /\b(?:z-index|zIndex)\s*:\s*["'`]?var\(--tangent-layer-[a-z0-9-]+\)["'`]?\s*(?:[;,}]|$)/;
// A definition of a layer name, which only layers.css may hold.
const LAYER_DEFINITION = /--tangent-layer-[a-z0-9-]+\s*:/;

/** True for the files this lint inspects: every production Map source other than layers.css. */
function isInspected(repoPath) {
  return isMapStyleFile(repoPath, EXTENSIONS) && repoPath !== LAYERS_OWNER;
}

/** Returns why one line violates layer confinement, or null when it is fine. */
function reasonForLine(text) {
  if (LAYER_DEFINITION.test(text)) return `a --tangent-layer-* definition outside ${LAYERS_OWNER}`;
  if (Z_INDEX_USE.test(text) && !Z_INDEX_VIA_SCALE.test(text)) return "a z-index not read from var(--tangent-layer-*)";
  return null;
}

/** Scans one file for stray z-index declarations and layer definitions and returns the hits. */
function collectFileHits(file) {
  const hits = [];
  readFileSync(file.absolutePath, "utf8").split("\n").forEach((text, index) => {
    const reason = reasonForLine(text);
    if (reason !== null) hits.push(reasonHit(file, index + 1, reason, text));
  });
  return hits;
}

runStyleLint({ name: NAME, remedy: REMEDY, isInspected, collectFileHits });
