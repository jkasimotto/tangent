// Loads and normalizes a project's listen config. The config is the only project-specific surface
// the generic engine reads: it declares where work lives (stateDir, feedbackFile), how to run an
// agent, and the stages (status-cursor pipeline) the dispatcher drives. Everything else is generic.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_REL = path.join(".listen", "config.json");

/** Walks up from `start` to find the project root holding `.listen/config.json`; null if none. */
export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_REL))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Expands a leading `~` to the home dir; leaves other paths untouched. */
function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/**
 * Reads `.listen/config.json` and returns a fully-resolved config: absolute paths, defaulted knobs,
 * and the validated stage list. Relative paths resolve against the `.listen/` directory so a config
 * is portable. Throws with an actionable message when the config is missing or malformed.
 */
export function loadConfig(root = findProjectRoot()) {
  if (!root) throw new Error("No .listen/config.json found. Run `listen init` in your project root.");
  const listenDir = path.join(root, ".listen");
  const raw = JSON.parse(fs.readFileSync(path.join(root, CONFIG_REL), "utf8"));
  /** Resolves a config path against `.listen/` (expanding `~`); absolute paths pass through. */
  const resolve = (p) => {
    const e = expandHome(p);
    return path.isAbsolute(e) ? e : path.resolve(listenDir, e);
  };

  const statuses = raw.statuses;
  const stages = raw.stages;
  if (!Array.isArray(statuses) || !statuses.length) throw new Error("config.statuses must be a non-empty array");
  if (!Array.isArray(stages) || !stages.length) throw new Error("config.stages must be a non-empty array");
  for (const stage of stages) {
    if (!stage.name || !stage.inbox || !stage.prompt) throw new Error(`stage needs name, inbox, prompt: ${JSON.stringify(stage)}`);
  }

  return {
    root,
    listenDir,
    name: raw.name || path.basename(root),
    stateDir: resolve(raw.stateDir || "state"),
    feedbackFile: resolve(raw.feedbackFile || "feedback.jsonl"),
    feedbackKey: raw.feedbackKey || "ts",
    logDir: resolve(raw.logDir || "logs"),
    agent: { cmd: "claude", args: ["-p", "--dangerously-skip-permissions"], ...(raw.agent || {}) },
    tmuxPrefix: raw.tmuxPrefix || `listen-${(raw.name || path.basename(root)).replace(/[^a-z0-9]+/gi, "-")}-`,
    statuses,
    terminalStatus: raw.terminalStatus || statuses[statuses.length - 1],
    stages,
    /** Resolves a stage's prompt path (relative to `.listen/`) to an absolute path. */
    resolvePrompt: (rel) => resolve(rel)
  };
}
