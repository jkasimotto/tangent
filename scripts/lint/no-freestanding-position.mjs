#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { UI_OWNER, isMapStyleFile, reasonHit, runStyleLint } from "./style-scope.mjs";

// The positioning authority. Only the Map's kit under packages/agent-shell/app/map/ui/ may leave
// normal flow: position: absolute and position: fixed anywhere else fail. Feature code puts content
// in a kit surface, which is how a surface landing behind the Resources panel becomes
// unrepresentable (audit defect 1). The strict scope is never grandfathered, so there is no ratchet.

const NAME = "no-freestanding-position";
const EXTENSIONS = new Set([".css", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const REMEDY = `Only the kit positions. Render through a surface from ${UI_OWNER} instead of positioning in a feature.`;

// The CSS declaration and its style-object twin: position: fixed and position: "absolute".
const OUT_OF_FLOW = /\bposition\s*:\s*["'`]?(absolute|fixed)\b/;

/** True for the files this lint inspects: production Map sources outside the kit. */
function isInspected(repoPath) {
  return isMapStyleFile(repoPath, EXTENSIONS) && !repoPath.startsWith(UI_OWNER);
}

/** Scans one file for out-of-flow positioning and returns the hits. */
function collectFileHits(file) {
  const hits = [];
  readFileSync(file.absolutePath, "utf8").split("\n").forEach((text, index) => {
    const match = OUT_OF_FLOW.exec(text);
    if (match) hits.push(reasonHit(file, index + 1, `position: ${match[1]} outside the kit`, text));
  });
  return hits;
}

runStyleLint({ name: NAME, remedy: REMEDY, isInspected, collectFileHits });
