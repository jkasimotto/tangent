// Event-driven dispatcher. Scans every stage's inbox and spawns a FRESH per-item agent (clean
// context, exactly one work item) into its own tmux session for each item not already in flight.
// Idempotent: the per-item tmux session is the in-flight lock, and an agent that advances an item's
// status moves it out of this inbox, so it is not re-dispatched for the same stage. Fresh process
// per item == clean context per item (no cross-task pollution).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { allManifests, dossierDir } from "./dossier.mjs";

const runStage = path.join(import.meta.dirname, "run-stage.mjs");
/** Runs a tmux subcommand, capturing output as text. */
const tmux = (args) => spawnSync("tmux", args, { encoding: "utf8" });
/** Single-quotes a value for safe interpolation into a shell command string. */
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Reads JSON objects from a .jsonl file (blank/garbage lines skipped); [] if absent. */
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Feedback ids already turned into items or explicitly parked, so they are not re-triaged. */
function settledFeedbackIds(cfg, manifests) {
  const ids = new Set();
  for (const m of manifests) for (const id of m.sourceFeedbackIds || []) ids.add(id);
  for (const r of readJsonl(path.join(cfg.stateDir, "triaged.jsonl"))) if (r.id !== undefined) ids.add(r.id);
  return ids;
}

/** True if any feedback entry has not yet been triaged (promoted into an item or parked). */
function hasUntriagedFeedback(cfg, manifests) {
  const settled = settledFeedbackIds(cfg, manifests);
  return readJsonl(cfg.feedbackFile).some((e) => !settled.has(e[cfg.feedbackKey]));
}

/** Spawns one fresh agent for a stage+item in its own tmux session, unless one is already running. */
function spawnAgent(cfg, stage, slug) {
  const session = slug ? `${cfg.tmuxPrefix}${stage.name}-${slug}` : `${cfg.tmuxPrefix}${stage.name}`;
  if (tmux(["has-session", "-t", `=${session}`]).status === 0) return false; // already in flight
  fs.mkdirSync(cfg.logDir, { recursive: true });
  const cmd = ["node", runStage, cfg.root, stage.name, slug || ""].map(shq).join(" ");
  const started = tmux(["new-session", "-d", "-s", session, "-c", cfg.root, cmd]);
  if (started.status !== 0) { console.error(`spawn ${session} failed: ${(started.stderr || "").trim()}`); return false; }
  const log = path.join(cfg.logDir, `${session.replace(cfg.tmuxPrefix, "")}.log`);
  tmux(["pipe-pane", "-o", "-t", session, `cat >> ${shq(log)}`]);
  console.log(`dispatched ${stage.name}${slug ? " / " + slug : ""}  (tmux ${session})`);
  return true;
}

/** Whether an item in a per-item stage is ready to dispatch now. */
function dispatchable(cfg, stage, manifest) {
  if (stage.requiresFile) return fs.existsSync(path.join(dossierDir(cfg, manifest.slug), stage.requiresFile));
  return !manifest.blockedOn; // parked items wait for a human to unblock
}

/** One dispatch sweep: spawn agents for all newly-actionable work. Returns the number spawned. */
export function dispatch(cfg) {
  const manifests = allManifests(cfg);
  let spawned = 0;
  for (const stage of cfg.stages) {
    if (stage.batch) {
      if (hasUntriagedFeedback(cfg, manifests) && spawnAgent(cfg, stage, "")) spawned++;
      continue;
    }
    for (const m of manifests.filter((m) => m.status === stage.inbox && dispatchable(cfg, stage, m))) {
      if (spawnAgent(cfg, stage, m.slug)) spawned++;
    }
  }
  console.log(spawned ? `dispatch: spawned ${spawned} agent(s)` : "dispatch: nothing new to do");
  return spawned;
}
