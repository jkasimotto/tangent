#!/usr/bin/env node
// `listen` CLI: scaffold a pipeline into a project (init), run/stop the event-driven watcher, inspect
// state (status), feed it work (feedback), and let stage agents manage items (dossier/promote/triage).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadConfig } from "../lib/config.mjs";
import { allManifests, listByStatus, createItem, advance, readManifest, dossierDir } from "../lib/dossier.mjs";

const libDir = path.join(import.meta.dirname, "..", "lib");
const templatesDir = path.join(import.meta.dirname, "..", "templates");
const [cmd, ...rest] = process.argv.slice(2);
/** Runs a tmux subcommand, capturing output as text. */
const tmux = (args) => spawnSync("tmux", args, { encoding: "utf8" });
/** Single-quotes a value for safe interpolation into a shell command string. */
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Parses `--flag value` / `--flag` pairs out of an argv slice. */
function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) { positional.push(args[i]); continue; }
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else { flags[key] = next; i++; }
  }
  return { flags, positional };
}

/** Recursively copies a template tree into dest, never overwriting an existing file. */
function scaffold(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    // AGENTS.md/CLAUDE.md in templates/ exist for this repo's own doc governance, not the user's pipeline.
    if (entry.name === "AGENTS.md" || entry.name === "CLAUDE.md") continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) { scaffold(src, dest); continue; }
    if (fs.existsSync(dest)) { console.log(`  kept    ${path.relative(process.cwd(), dest)} (exists)`); continue; }
    fs.copyFileSync(src, dest);
    console.log(`  created ${path.relative(process.cwd(), dest)}`);
  }
}

/** Scaffolds .listen/ (config + editable stage prompts) into the current project. */
function cmdInit() {
  const dest = path.join(process.cwd(), ".listen");
  console.log(`Scaffolding listen pipeline into ${dest}`);
  scaffold(templatesDir, dest);
  console.log("\nNext: edit .listen/prompts/*.md for your project's stages, then:");
  console.log("  listen start --yes      # start the watcher");
  console.log('  listen feedback "..."   # drop work in, or point your app at .listen/feedback.jsonl');
}

/** The tmux session name for this project's watcher. */
function watchSession(cfg) { return `${cfg.tmuxPrefix}watch`; }

/** Starts the watcher in a tmux session (gated by --yes / LISTEN_YES). */
function cmdStart() {
  const { flags } = parseFlags(rest);
  const cfg = loadConfig();
  if (process.env.LISTEN_YES !== "1" && !flags.yes) {
    console.error([
      `'listen start' runs your agent (${cfg.agent.cmd} ${cfg.agent.args.join(" ")}) UNATTENDED when work`,
      "appears. It can edit files, run commands, and (depending on your prompts) commit and deploy.",
      "Re-run with --yes (or LISTEN_YES=1) to start."
    ].join("\n"));
    process.exit(1);
  }
  if (!tmux(["-V"]).status === 0) { console.error("tmux is required."); process.exit(1); }
  const session = watchSession(cfg);
  if (tmux(["has-session", "-t", `=${session}`]).status === 0) {
    console.error(`already running (tmux ${session}). 'listen stop' first to restart.`); process.exit(1);
  }
  fs.mkdirSync(cfg.logDir, { recursive: true });
  const inner = ["node", path.join(libDir, "watch.mjs"), cfg.root].map(shq).join(" ");
  tmux(["new-session", "-d", "-s", session, "-c", cfg.root, inner]);
  tmux(["set-option", "-t", session, "remain-on-exit", "on"]);
  tmux(["pipe-pane", "-o", "-t", session, `cat >> ${shq(path.join(cfg.logDir, "watch.log"))}`]);
  console.log(`listening (tmux ${session}). Fresh agent per item as work appears.`);
  console.log(`  attach:  tmux attach -t ${session}`);
  console.log(`  watch:   tmux ls | grep ${cfg.tmuxPrefix}`);
  console.log(`  stop:    listen stop`);
}

/** Kills the watcher and any in-flight per-item agent sessions. */
function cmdStop() {
  const cfg = loadConfig();
  const names = (tmux(["ls", "-F", "#{session_name}"]).stdout || "").split("\n").filter((s) => s.startsWith(cfg.tmuxPrefix));
  if (!names.length) { console.log("no listen sessions running."); return; }
  for (const n of names) { tmux(["kill-session", "-t", `=${n}`]); console.log(`stopped ${n}`); }
}

/** Prints items grouped by status plus any running agent sessions. */
function cmdStatus() {
  const cfg = loadConfig();
  const manifests = allManifests(cfg);
  console.log(`listen: ${cfg.name}   (state: ${cfg.stateDir})`);
  for (const status of cfg.statuses) {
    const slugs = manifests.filter((m) => m.status === status).map((m) => m.slug);
    if (slugs.length) console.log(`  ${status.padEnd(16)} ${slugs.join(", ")}`);
  }
  const sessions = (tmux(["ls", "-F", "#{session_name}"]).stdout || "").split("\n").filter((s) => s.startsWith(cfg.tmuxPrefix));
  console.log(sessions.length ? `\n  live: ${sessions.join(", ")}` : "\n  (no agents running)");
}

/** Appends a feedback entry to the configured feedback file. */
function cmdFeedback() {
  const cfg = loadConfig();
  const text = rest.join(" ").trim();
  if (!text) { console.error('usage: listen feedback "<text>"'); process.exit(2); }
  fs.mkdirSync(path.dirname(cfg.feedbackFile), { recursive: true });
  const entry = { [cfg.feedbackKey]: Date.now(), text, at: new Date().toISOString() };
  fs.appendFileSync(cfg.feedbackFile, JSON.stringify(entry) + "\n");
  console.log(`feedback recorded (${cfg.feedbackKey}=${entry[cfg.feedbackKey]}).`);
}

/** Records a feedback id as handled (e.g. parked) so it is not re-triaged. */
function cmdTriage() {
  const cfg = loadConfig();
  const { positional } = parseFlags(rest);
  const [id, status = "parked", ...noteParts] = positional;
  if (!id) { console.error("usage: listen triage <feedbackId> [status] [note]"); process.exit(2); }
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  fs.appendFileSync(path.join(cfg.stateDir, "triaged.jsonl"),
    JSON.stringify({ id: Number.isNaN(Number(id)) ? id : Number(id), status, note: noteParts.join(" "), at: new Date().toISOString() }) + "\n");
  console.log(`triaged ${id} -> ${status}`);
}

/** Creates a work item from feedback (stage agents call this). */
function cmdPromote() {
  const cfg = loadConfig();
  const { flags } = parseFlags(rest);
  if (!flags.slug) { console.error("usage: listen promote --slug S [--title T] [--feedback id,id]"); process.exit(2); }
  const feedback = flags.feedback ? String(flags.feedback).split(",").map((s) => (Number.isNaN(Number(s.trim())) ? s.trim() : Number(s.trim()))) : [];
  const dir = createItem(cfg, { slug: String(flags.slug), title: flags.title ? String(flags.title) : undefined, feedback });
  console.log(dir);
}

/** Item state CLI for stage agents: list|show|path|create|advance. */
function cmdDossier() {
  const cfg = loadConfig();
  const [sub, ...args] = rest;
  const { flags, positional } = parseFlags(args);
  if (sub === "list") { for (const slug of listByStatus(cfg, positional[0])) console.log(slug); }
  else if (sub === "show") { console.log(JSON.stringify(readManifest(cfg, positional[0]), null, 2)); }
  else if (sub === "path") { console.log(dossierDir(cfg, positional[0])); }
  else if (sub === "create") { console.log(createItem(cfg, { slug: String(flags.slug), title: flags.title && String(flags.title), feedback: flags.feedback ? String(flags.feedback).split(",") : [] })); }
  else if (sub === "advance") { const m = advance(cfg, positional[0], positional[1], { note: flags.note && String(flags.note), block: flags.block, unblock: flags.unblock }); console.log(`${m.slug} -> ${m.status}`); }
  else { console.error("usage: listen dossier <list|show|path|create|advance> ..."); process.exit(2); }
}

const commands = { init: cmdInit, start: cmdStart, stop: cmdStop, status: cmdStatus, feedback: cmdFeedback, triage: cmdTriage, promote: cmdPromote, dossier: cmdDossier };

if (!cmd || cmd === "help" || cmd === "--help") {
  console.log(`listen - event-driven agent pipelines

  listen init                 scaffold .listen/ (config + editable stage prompts) into this project
  listen start [--yes]        start the watcher (fresh agent per item as work appears)
  listen stop                 stop the watcher and any in-flight agents
  listen status               show items by stage + running agents
  listen feedback "<text>"    drop a piece of work into the feedback inbox
  listen triage <id> [status] mark a feedback id handled (e.g. parked) so it is not re-triaged
  listen promote --slug S ...  create a work item from feedback (stage agents use this)
  listen dossier <...>        item state CLI for stage agents (list|show|path|create|advance)`);
  process.exit(cmd ? 0 : 1);
}
if (!commands[cmd]) { console.error(`unknown command: ${cmd} (try 'listen help')`); process.exit(2); }
commands[cmd]();
