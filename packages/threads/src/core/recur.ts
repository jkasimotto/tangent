import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, tangentHome } from "@tangent/core";
import { processFailure, runProcess } from "@tangent/agent-runtime/process";
import { writeFileAtomic } from "./atomic-write.js";
import { parseFrontmatter } from "./frontmatter.js";
import { readSidecar, writeSidecarAtomic } from "./sidecar.js";
import type { RegistryEntry, SidecarState, WorkerLauncher } from "./types.js";
import { walkFiles } from "./walk.js";

/** A recur definition's fire schedule: a daily time-of-day, or a weekly weekday+time-of-day. Both times are local wall-clock time (see isDue). */
export type RecurSchedule = { kind: "daily"; time: string } | { kind: "weekly"; weekday: number; time: string };

/** One parsed `recur-<slug>.md` file: what to run, where, and on what schedule. */
export type RecurDef = {
  slug: string;
  /** Vault-relative directory the recur file lives in. */
  node: string;
  schedule: RecurSchedule;
  /** Working directory the worker session runs in. */
  cwd: string;
  model: string;
  /** The recur file's body, verbatim: the prompt handed to the dispatched worker. */
  prompt: string;
};

const defaultModel = "sonnet";
const weekdayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dailyPattern = /^daily\s+(\d{2}:\d{2})$/i;
const weeklyPattern = /^weekly\s+([a-z]{3})\s+(\d{2}:\d{2})$/i;

/**
 * Parses one `recur-<slug>.md` file's frontmatter and body into a RecurDef. `fileName` supplies the
 * slug (the filename minus the `recur-` prefix and `.md` suffix); `node` is the vault-relative
 * directory the caller found it in. Frontmatter keys: `schedule` ("daily HH:MM" or "weekly <wkday>
 * HH:MM"), `cwd` (required), `model` (optional, defaults to "sonnet"). The body is the worker prompt,
 * verbatim. Throws a descriptive error when `schedule` or `cwd` is missing or malformed, since a bad
 * recur file should fail loudly at scan time rather than silently never firing.
 */
export function parseRecurFile(node: string, fileName: string, content: string): RecurDef {
  const { frontmatter, body } = parseFrontmatter(content);
  const schedule = parseSchedule(frontmatter.schedule, fileName);
  const cwd = frontmatter.cwd?.trim();
  if (!cwd) throw new Error(`Recur file ${fileName} is missing a required "cwd:" frontmatter field.`);
  return {
    slug: slugFromFileName(fileName),
    node,
    schedule,
    cwd,
    model: frontmatter.model?.trim() || defaultModel,
    prompt: body.trim()
  };
}

/** Strips the `recur-` prefix and `.md` suffix from a recur file's name to get its slug. */
function slugFromFileName(fileName: string): string {
  return fileName.replace(/^recur-/, "").replace(/\.md$/, "");
}

/** Parses a `schedule:` frontmatter value into a RecurSchedule, throwing a descriptive error naming the offending file on any malformed input. */
function parseSchedule(value: string | undefined, fileName: string): RecurSchedule {
  if (!value || !value.trim()) {
    throw new Error(`Recur file ${fileName} is missing a required "schedule:" frontmatter field.`);
  }
  const daily = value.match(dailyPattern);
  if (daily) return { kind: "daily", time: daily[1]! };
  const weekly = value.match(weeklyPattern);
  if (weekly) {
    const weekday = weekdayNames.indexOf(weekly[1]!.toLowerCase());
    if (weekday === -1) {
      throw new Error(`Recur file ${fileName} has an invalid schedule weekday ${JSON.stringify(weekly[1])}: expected one of ${weekdayNames.join(", ")}.`);
    }
    return { kind: "weekly", weekday, time: weekly[2]! };
  }
  throw new Error(`Recur file ${fileName} has an invalid schedule ${JSON.stringify(value)}: expected "daily HH:MM" or "weekly <mon..sun> HH:MM".`);
}

/**
 * True when `now` is at or past this cycle's scheduled instant (today's time-of-day for a daily
 * schedule, this week's weekday+time for a weekly one) and `lastRunAt` is missing or predates that
 * instant. Schedule times are local wall-clock time: this reads `now`'s local calendar fields, so the
 * caller's process timezone is the schedule's timezone. Bounded to the current cycle only (never scans
 * further back), so a schedule that was never due this cycle reports false even with no lastRunAt: a
 * dispatcher polling faster than the schedule period should not "catch up" on missed cycles.
 */
export function isDue(def: { schedule: RecurSchedule }, lastRunAt: string | undefined, now: Date): boolean {
  const scheduledInstant = mostRecentScheduledInstant(def.schedule, now);
  if (scheduledInstant.getTime() > now.getTime()) return false;
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt);
  return last.getTime() < scheduledInstant.getTime();
}

/** Computes this cycle's scheduled instant (today's for daily, this week's for weekly) as a Date, from `now`'s local calendar fields. */
function mostRecentScheduledInstant(schedule: RecurSchedule, now: Date): Date {
  const [hours, minutes] = schedule.time.split(":").map(Number);
  if (schedule.kind === "daily") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
  }
  const daysSinceScheduledWeekday = (now.getDay() - schedule.weekday + 7) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceScheduledWeekday, hours, minutes, 0, 0);
}

/** Formats a Date as a local-calendar YYYY-MM-DD, for the thread file's `opened:` field: a recurring job's "today" is the local calendar day it fired on, matching its local-time schedule. */
function localCalendarDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Everything runRecur needs beyond the def itself: the injectable launcher plus the vault/sidecar locations and clock, all explicit so runRecur stays deterministic and testable without touching real paths or the real clock. */
export type RunRecurDeps = {
  launcher: WorkerLauncher;
  vaultRoot: string;
  sidecarPath: string;
  now: Date;
};

/**
 * Dispatches one due recur definition: upserts its `thread-<slug>.md` (open, never overwriting a
 * human-extended body), registers it in the sidecar's worktree/tmux registry, records this fire in
 * `recur[def.slug].lastRunAt`, and starts the worker via the injected launcher. Registry and recur
 * bookkeeping are written together in one sidecar write. Never checks isDue itself: the caller (a
 * scheduler sweeping every recur def) decides what is due and only calls this for due definitions.
 */
export async function runRecur(def: RecurDef, deps: RunRecurDeps): Promise<void> {
  await upsertThreadFile(deps.vaultRoot, def, deps.now);

  const sidecar = await readSidecar(deps.sidecarPath);
  const registryEntry: RegistryEntry = {
    node: def.node,
    worktree: def.cwd,
    tmux: `tg-${def.slug}`,
    registeredAt: deps.now.toISOString()
  };
  const nextSidecar: SidecarState = {
    ...sidecar,
    registry: { ...sidecar.registry, [def.slug]: registryEntry },
    recur: { ...(sidecar.recur ?? {}), [def.slug]: { lastRunAt: deps.now.toISOString() } }
  };
  await writeSidecarAtomic(deps.sidecarPath, nextSidecar);

  await deps.launcher.launch({ slug: def.slug, cwd: def.cwd, model: def.model, prompt: def.prompt });
}

/** Creates or updates `<node>/thread-<slug>.md` for one recur firing. A fresh thread gets a new body naming its owner and its source recur file; an existing thread only has `status:`/`opened:` reset to open/today and a `ran: <iso>` line appended, so a human's edits to the body are never overwritten. */
async function upsertThreadFile(vaultRoot: string, def: RecurDef, now: Date): Promise<void> {
  const filePath = path.join(vaultRoot, def.node, `thread-${def.slug}.md`);
  const existing = await readFileIfExists(filePath);
  const openedToday = localCalendarDate(now);
  const ranLine = `ran: ${now.toISOString()}`;

  if (existing === undefined) {
    const frontmatter = renderFrontmatter({ status: "open", opened: openedToday });
    const body = ["Owner: sonnet worker (recurring)", "", `Prompt: recur-${def.slug}.md`, "", ranLine].join("\n");
    await writeFileAtomic(filePath, `${frontmatter}\n${body}\n`);
    return;
  }

  const { frontmatter, body } = parseFrontmatter(existing);
  const nextFrontmatter = renderFrontmatter({ ...frontmatter, status: "open", opened: openedToday });
  const nextBody = `${body.replace(/\s+$/, "")}\n${ranLine}\n`;
  await writeFileAtomic(filePath, `${nextFrontmatter}\n${nextBody}`);
}

/** Reads a file's contents, or undefined if it does not exist yet. */
async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Renders a flat key/value frontmatter block, skipping undefined values, preserving the given field order. */
function renderFrontmatter(fields: Record<string, string | undefined>): string {
  const lines = Object.entries(fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return ["---", ...lines, "---"].join("\n");
}

/** Matches a recur definition's filename, e.g. "recur-daily-rebase.md". */
const isRecurFile = (fileName: string): boolean => /^recur-[^/]+\.md$/.test(fileName);

/** Walks the vault for `recur-*.md` definitions, skipping any `shared/` subtree (team-facing git repos, not private automation), and parses each one. Throws if any definition is malformed (see parseRecurFile): a bad recur file should fail the scan loudly rather than silently drop a schedule. */
export async function scanRecurFiles(vaultRoot: string): Promise<RecurDef[]> {
  const files = await walkFiles(vaultRoot, isRecurFile);
  const defs: RecurDef[] = [];
  for (const file of files) {
    const content = await readFile(path.join(vaultRoot, file), "utf8");
    const dir = path.dirname(file);
    const node = dir === "." ? "" : dir;
    defs.push(parseRecurFile(node, path.basename(file), content));
  }
  return defs;
}

/** Config for TmuxWorkerLauncher's real dispatch: where the durable prompt record is written and how long a launch may take before it's considered failed. Both are injectable so tests never touch the real home directory or hang on a slow tmux/claude startup. */
export type TmuxWorkerLauncherConfig = {
  /** Directory the dispatch prompt is written under, one `<slug>.md` file per launch. Defaults to `<tangentHome>/.tangent/recur-prompts`; injectable so tests never write under the real home. */
  promptDir?: string;
  /** Max time the `tmux new-session` process itself may run before runProcess kills it and reports failure. Defaults to 30000ms. This bounds only starting the detached session, not the worker's own lifetime inside it. */
  timeoutMs?: number;
};

/**
 * Real WorkerLauncher: starts a detached tmux session running the coding agent directly against the
 * def's prompt, with no shell in between (the prompt is one argv element, not shell-interpolated, so
 * arbitrary prompt content can never break out of the command). Also writes the prompt to
 * `~/.tangent/recur-prompts/<slug>.md` as a durable record of what was dispatched, independent of the
 * tmux invocation itself.
 */
export class TmuxWorkerLauncher implements WorkerLauncher {
  constructor(private readonly config: TmuxWorkerLauncherConfig = {}) {}

  /** Refuses with a clear error when cwd does not exist; otherwise records the prompt and starts `tmux new-session -d` running claude with the prompt as a single argv element. */
  async launch(args: { slug: string; cwd: string; model: string; prompt: string }): Promise<void> {
    if (!(await pathExists(args.cwd))) {
      throw new Error(`Cannot launch recurring worker ${JSON.stringify(args.slug)}: cwd ${JSON.stringify(args.cwd)} does not exist.`);
    }
    const promptDir = this.config.promptDir || path.join(tangentHome(), ".tangent", "recur-prompts");
    await writeFileAtomic(path.join(promptDir, `${args.slug}.md`), `${args.prompt}\n`);

    const tmuxArgs = [
      "new-session", "-d",
      "-s", `tg-${args.slug}`,
      "-c", args.cwd,
      "claude", "--model", args.model, args.prompt
    ];
    const result = await runProcess({ command: "tmux", args: tmuxArgs, timeoutMs: this.config.timeoutMs || 30000 });
    if (result.code !== 0) throw processFailure("tmux", result.code, result.stderr, result.stdout);
  }
}
