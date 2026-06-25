#!/usr/bin/env node
// Event-driven trigger for the feature pipeline. Watches ~/.tangent and, on any change (debounced),
// runs dispatch.mjs, which spawns a fresh agent for each new inbox item. This is the "hook" model:
// work is picked up when it appears (new feedback captured, a stage advances a feature, the user
// answers questions) instead of polling on a timer. Run it once at startup to sweep existing work.
//
// fswatch is not required; this uses Node's built-in recursive fs.watch (supported on macOS/Windows).
// A cron job calling `node pipeline/dispatch.mjs` every minute is a coarser polling alternative.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dispatch = path.join(import.meta.dirname, "dispatch.mjs");
const dotTangent = path.join(process.env.TANGENT_HOME || os.homedir(), ".tangent");
const featuresDir = path.join(dotTangent, "features");
fs.mkdirSync(featuresDir, { recursive: true });

/** Current local time as `YYYY-MM-DD HH:MM:SS` for log lines. */
const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

// Debounce: an agent writes many dossier files per run, and a status advance should trigger exactly
// one dispatch. Collapse a burst of events into a single dispatch ~1.5s after it settles.
let timer = null;
/** Schedules a single debounced dispatch run, coalescing a burst of fs events into one. */
function trigger(reason) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    console.log(`[${stamp()}] dispatch (${reason})`);
    spawnSync("node", [dispatch], { stdio: "inherit" });
  }, 1500);
}

// The features tree: new dossiers and every status advance land here.
try {
  fs.watch(featuresDir, { recursive: true }, (_e, f) => trigger(`features:${f || "?"}`));
} catch (e) {
  console.error("could not watch features dir:", e.message);
}
// feedback.jsonl is rewritten by the app on capture; watch its directory and filter by name
// (watching the single file breaks when it is replaced rather than appended).
fs.watch(dotTangent, {}, (_e, f) => { if (f === "feedback.jsonl") trigger("feedback"); });

console.log(`[${stamp()}] watching ${dotTangent} -> dispatch on change`);
trigger("startup");
process.stdin.resume(); // keep the watcher alive
