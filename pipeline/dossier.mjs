#!/usr/bin/env node
// Feature-dossier state CLI: the single writer of the pipeline's message bus.
//
// Every loop stage coordinates ONLY through `~/.tangent/features/<slug>/` (override root with
// TANGENT_HOME). A feature is a folder; `feature.json` is its manifest and status cursor; each stage
// reads upstream artifacts, writes its own `NN-*.md`, then calls `advance` to hand off to the next
// stage's inbox. Stages never talk to each other directly, so this file keeps `feature.json`
// schema-consistent no matter which stage writes it.
//
// Commands:
//   node pipeline/dossier.mjs list <status> [--json]      slugs in a status, oldest first (one per line)
//   node pipeline/dossier.mjs create --slug S --title T [--recurrence N] [--feedback id,id]
//   node pipeline/dossier.mjs show <slug>                  print feature.json
//   node pipeline/dossier.mjs path <slug>                  print the dossier directory
//   node pipeline/dossier.mjs advance <slug> <status> [--note "..."] [--block reason|--unblock] [--worktree branch]
//
// Canonical status flow (one stage owns each transition):
//   promoted -> scoped | awaiting-answers   (scoper; awaiting-answers resumes back through scoper)
//   scoped   -> ux-done                      (ux-designer)
//   ux-done  -> planned                      (impl-planner)
//   planned  -> implemented                  (implementer)
//   implemented -> deploy-ready | planned    (review; v1 stub passes through)
//   deploy-ready -> deployed                 (deployer)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATUSES = [
  "promoted", "scoped", "awaiting-answers", "ux-done",
  "planned", "implemented", "deploy-ready", "deployed",
];

// Matches the repo convention (src/cli/feedback.ts): TANGENT_HOME is the PARENT of `.tangent`,
// defaulting to the OS home dir, so `features/` always sits beside feedback.jsonl under `.tangent`.
const dotTangent = path.join(process.env.TANGENT_HOME || os.homedir(), ".tangent");
const featuresDir = path.join(dotTangent, "features");

/** Current time as an ISO-8601 string, the timestamp format used throughout the manifest. */
function nowIso() {
  return new Date().toISOString();
}

/** Absolute path to a feature's dossier directory. */
function dossierDir(slug) {
  return path.join(featuresDir, slug);
}

/** Absolute path to a feature's manifest file. */
function manifestPath(slug) {
  return path.join(dossierDir(slug), "feature.json");
}

/** Reads and parses a feature's manifest; throws if the feature does not exist. */
function readManifest(slug) {
  const file = manifestPath(slug);
  if (!fs.existsSync(file)) throw new Error(`no such feature: ${slug}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Writes a feature's manifest, stamping updatedAt and creating the dossier dir if needed. */
function writeManifest(slug, manifest) {
  manifest.updatedAt = nowIso();
  fs.mkdirSync(dossierDir(slug), { recursive: true });
  fs.writeFileSync(manifestPath(slug), JSON.stringify(manifest, null, 2) + "\n");
}

/** Parses `--flag value` and `--flag` boolean pairs out of an argv slice. */
function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

/** Reads every feature manifest, skipping unreadable ones, sorted oldest-first by createdAt. */
function allManifests() {
  if (!fs.existsSync(featuresDir)) return [];
  return fs.readdirSync(featuresDir)
    .map((slug) => {
      try {
        return readManifest(slug);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

const [command, ...rest] = process.argv.slice(2);

if (command === "list") {
  const status = rest[0];
  const flags = parseFlags(rest.slice(1));
  if (!STATUSES.includes(status)) {
    console.error(`unknown status "${status}". one of: ${STATUSES.join(", ")}`);
    process.exit(2);
  }
  const matched = allManifests().filter((m) => m.status === status);
  if (flags.json) {
    console.log(JSON.stringify(matched, null, 2));
  } else {
    for (const m of matched) console.log(m.slug);
  }
} else if (command === "create") {
  const flags = parseFlags(rest);
  if (!flags.slug || !flags.title) {
    console.error('create needs --slug and --title');
    process.exit(2);
  }
  const slug = String(flags.slug);
  if (fs.existsSync(manifestPath(slug))) {
    console.error(`feature already exists: ${slug}`);
    process.exit(2);
  }
  const feedbackIds = flags.feedback
    ? String(flags.feedback).split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n))
    : [];
  const manifest = {
    slug,
    title: String(flags.title),
    status: "promoted",
    sourceFeedbackIds: feedbackIds,
    recurrence: flags.recurrence ? Number(flags.recurrence) : feedbackIds.length,
    blockedOn: null,
    worktree: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    stageLog: [{ stage: "feedback", status: "promoted", at: nowIso(), note: "promoted from feedback" }],
  };
  writeManifest(slug, manifest);
  console.log(dossierDir(slug));
} else if (command === "show") {
  console.log(JSON.stringify(readManifest(rest[0]), null, 2));
} else if (command === "path") {
  console.log(dossierDir(rest[0]));
} else if (command === "advance") {
  const slug = rest[0];
  const status = rest[1];
  const flags = parseFlags(rest.slice(2));
  if (!STATUSES.includes(status)) {
    console.error(`unknown status "${status}". one of: ${STATUSES.join(", ")}`);
    process.exit(2);
  }
  const manifest = readManifest(slug);
  manifest.status = status;
  if (flags.unblock) manifest.blockedOn = null;
  if (flags.block) manifest.blockedOn = String(flags.block);
  if (flags.worktree) manifest.worktree = String(flags.worktree);
  manifest.stageLog.push({
    status,
    at: nowIso(),
    note: flags.note ? String(flags.note) : "",
  });
  writeManifest(slug, manifest);
  console.log(`${slug} -> ${status}`);
} else {
  console.error("usage: dossier.mjs <list|create|show|path|advance> ...");
  process.exit(2);
}
