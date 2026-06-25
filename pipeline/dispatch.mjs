#!/usr/bin/env node
// Event-driven dispatcher. Scans every stage's inbox and spawns a FRESH per-feature agent
// (`claude -p`, clean context, exactly one work item) into its own tmux session for each item not
// already in flight. Called by watch.mjs on any ~/.tangent change and once at startup. Idempotent:
// safe to run repeatedly because each item's tmux session is the in-flight lock (a session that
// already exists is skipped), and an agent that advances a feature's status moves it out of this
// inbox, so it is not re-dispatched for the same stage.
//
// Why per feature, not per tick: a single process that handled several inbox items would reason
// about them in one shared context, leaking one feature's reasoning into the next. One agent per
// feature gives every feature a clean slate.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const pipelineDir = import.meta.dirname;
const repoRoot = path.resolve(pipelineDir, "..");
// The per-item launcher. Overridable so tests can point spawns at a stub instead of real claude.
const loopStage = process.env.TANGENT_LOOP_STAGE || path.join(pipelineDir, "loop-stage.sh");
const dotTangent = path.join(process.env.TANGENT_HOME || os.homedir(), ".tangent");
const featuresDir = path.join(dotTangent, "features");
const logDir = process.env.TANGENT_LOOPS_LOG_DIR || path.join(dotTangent, "loops");
fs.mkdirSync(logDir, { recursive: true });

// stage -> the dossier status that is its inbox (one stage owns each status).
const STAGE_INBOX = [
  ["scope", "promoted"],
  ["ux", "scoped"],
  ["plan", "ux-done"],
  ["implement", "planned"],
  ["review", "implemented"],
  ["deploy", "deploy-ready"],
];

/** Runs a tmux subcommand, capturing output as text. */
const tmux = (args) => spawnSync("tmux", args, { encoding: "utf8" });
/** Single-quotes a value for safe interpolation into a shell command string. */
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** True if a tmux session with this exact name exists (the in-flight lock for an item). */
const sessionExists = (name) => tmux(["has-session", "-t", `=${name}`]).status === 0;

/** Reads every JSON object from a .jsonl file, skipping blank or unparseable lines; [] if absent. */
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/** Every readable feature manifest under the features dir (unreadable ones skipped). */
function readManifests() {
  if (!fs.existsSync(featuresDir)) return [];
  return fs.readdirSync(featuresDir)
    .map((slug) => {
      try { return JSON.parse(fs.readFileSync(path.join(featuresDir, slug, "feature.json"), "utf8")); }
      catch { return null; }
    })
    .filter(Boolean);
}

/** True if any feedback entry lacks a triage record. One untriaged batch is a single work item
 * (triage clusters across all new feedback), so this gates a single feedback agent. */
function hasUntriagedFeedback() {
  const feedback = readJsonl(path.join(dotTangent, "feedback.jsonl"));
  const triaged = new Set(readJsonl(path.join(dotTangent, "feedback-triage.jsonl")).map((r) => r.id));
  return feedback.some((e) => !triaged.has(e.ts));
}

/** Spawns a fresh per-item agent in its own tmux session, unless one is already in flight.
 * Returns true if it started a new agent. slug "" is the feedback-triage batch. */
function spawnAgent(stage, slug) {
  const session = slug ? `tangent-loop-${stage}-${slug}` : `tangent-loop-${stage}`;
  if (sessionExists(session)) return false; // already in flight; the session is the lock
  const cmd = [loopStage, stage, slug || "", repoRoot].map(shq).join(" ");
  const started = tmux(["new-session", "-d", "-s", session, "-c", repoRoot, cmd]);
  if (started.status !== 0) {
    console.error(`spawn ${session} failed: ${(started.stderr || "").trim()}`);
    return false;
  }
  const log = path.join(logDir, `${session.replace(/^tangent-loop-/, "")}.log`);
  tmux(["pipe-pane", "-o", "-t", session, `cat >> ${shq(log)}`]);
  console.log(`dispatched ${stage}${slug ? " / " + slug : ""}  (tmux ${session})`);
  return true;
}

const manifests = readManifests();
let spawned = 0;

if (hasUntriagedFeedback() && spawnAgent("feedback", "")) spawned++;

for (const [stage, status] of STAGE_INBOX) {
  for (const m of manifests.filter((m) => m.status === status)) {
    if (spawnAgent(stage, m.slug)) spawned++;
  }
}

// awaiting-answers is parked on the user. Resume scope ONLY once they have written 12-answers.md
// (the watcher sees that file land and re-dispatches automatically).
for (const m of manifests.filter((m) => m.status === "awaiting-answers")) {
  if (fs.existsSync(path.join(featuresDir, m.slug, "12-answers.md")) && spawnAgent("scope", m.slug)) spawned++;
}

console.log(spawned ? `dispatch: spawned ${spawned} agent(s)` : "dispatch: nothing new to do");
