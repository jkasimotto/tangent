#!/usr/bin/env node
// Event-driven trigger. Watches the state dir and the feedback file and, on any change (debounced),
// runs one dispatch sweep. This is the "hook" model: work is picked up when it appears (new feedback,
// a stage advancing an item, a user answering) instead of polling on a timer. Runs one sweep at
// startup to pick up existing work. Uses Node's recursive fs.watch (no fswatch dependency).
import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.mjs";
import { dispatch } from "./dispatch.mjs";

const cfg = loadConfig(process.argv[2] || undefined);
fs.mkdirSync(cfg.stateDir, { recursive: true });
fs.mkdirSync(path.dirname(cfg.feedbackFile), { recursive: true });

/** Current local time as `YYYY-MM-DD HH:MM:SS` for log lines. */
const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

// Debounce: an agent writes many dossier files per run, and a status advance should trigger exactly
// one dispatch. Collapse a burst of events into a single sweep ~1.5s after it settles.
let timer = null;
/** Schedules a single debounced dispatch sweep, coalescing a burst of fs events into one. */
function trigger(reason) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    console.log(`[${stamp()}] dispatch (${reason})`);
    try { dispatch(cfg); } catch (e) { console.error("dispatch error:", e.message); }
  }, 1500);
}

try {
  fs.watch(cfg.stateDir, { recursive: true }, (_e, f) => trigger(`state:${f || "?"}`));
} catch (e) {
  console.error("could not watch state dir:", e.message);
}
// Watch the feedback file's directory and filter by name (watching a single file breaks on rewrite).
const feedbackName = path.basename(cfg.feedbackFile);
fs.watch(path.dirname(cfg.feedbackFile), {}, (_e, f) => { if (f === feedbackName) trigger("feedback"); });

console.log(`[${stamp()}] listening: ${cfg.name} -> dispatch on change (state: ${cfg.stateDir})`);
trigger("startup");
process.stdin.resume();
