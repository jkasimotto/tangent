#!/usr/bin/env node
// Runs ONE stage against ONE item as a fresh agent process. Spawned by dispatch.mjs into a dedicated
// tmux session; not meant to be run by hand. Fresh process per item == clean context per item. The
// agent gets the stage prompt plus a per-run note that scopes it to its single item and tells it how
// to reach the user. It does its one unit of work, advances the dossier, and exits, ending the session.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { loadConfig } from "./config.mjs";

const [root, stageName, slugArg] = process.argv.slice(2);
const slug = slugArg || "";
const cfg = loadConfig(root);
const stage = cfg.stages.find((s) => s.name === stageName);
if (!stage) { console.error(`unknown stage: ${stageName}`); process.exit(2); }

const prompt = fs.readFileSync(cfg.resolvePrompt(stage.prompt), "utf8");

const scope = slug
  ? `Process ONLY the item with slug '${slug}'.`
  : "Triage ONLY the currently-untriaged feedback.";
const note = `

---
## This dispatch run (fresh process, one item)
You were spawned fresh with a clean context for a SINGLE work item. ${scope} Ignore every other inbox item; each has its own agent. Do your one unit of work, leave the state truthful, then finish.

Coordinate ONLY through the item's dossier (manage it with \`listen dossier ...\`); never assume memory of other runs. If you need the user's attention or a decision (you parked this awaiting input, hit a blocker you cannot resolve, or shipped something they were waiting on), notify them once on the desktop if a notifier is available, e.g.:
  command -v terminal-notifier >/dev/null && terminal-notifier -title "listen: ${stage.name}${slug ? " / " + slug : ""}" -message "<concise: what you need, or what shipped>"
Only interrupt the human when it genuinely needs one.`;

// Build the agent argv. A {PROMPT} token in agent.args is replaced; otherwise the prompt is appended.
const full = prompt + note;
const args = cfg.agent.args.includes("{PROMPT}")
  ? cfg.agent.args.map((a) => (a === "{PROMPT}" ? full : a))
  : [...cfg.agent.args, full];

const result = spawnSync(cfg.agent.cmd, args, { stdio: "inherit", cwd: cfg.root, env: process.env });
process.exit(result.status ?? 0);
