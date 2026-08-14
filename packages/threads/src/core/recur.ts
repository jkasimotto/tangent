import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, tangentHome } from "@tangent/core";
import { processFailure, runProcess } from "@tangent/agent-runtime/process";
import { writeFileAtomic } from "./atomic-write.js";
import { parseFrontmatter } from "./frontmatter.js";
import { sidecarPath as defaultSidecarPath, vaultRoot as defaultVaultRoot } from "./paths.js";
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
  /** A paused definition remains visible but is never selected by the scheduler. */
  paused: boolean;
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
    paused: frontmatter.paused?.trim().toLowerCase() === "true",
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
export function isDue(def: { schedule: RecurSchedule; paused?: boolean }, lastRunAt: string | undefined, now: Date): boolean {
  if (def.paused) return false;
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
 * human-extended body), registers it in the sidecar's worktree/tmux registry (with a fresh
 * `registeredAt`, every run, so the session-misattribution guard in `resolveSessionIdByCwd` always has
 * a current bound to match candidate sessions against), starts the worker via the injected launcher,
 * and only once that launch resolves records this fire in `recur[def.slug].lastRunAt`. Recording
 * `lastRunAt` strictly after a successful launch (not before) means a launcher failure (including
 * `TmuxWorkerLauncher`'s duplicate-session refusal, see below) leaves this definition still due, so
 * `runRecurDue`'s next poll retries it once whatever blocked the previous attempt clears, instead of
 * silently skipping a whole cycle. Never checks isDue itself: the caller (a scheduler sweeping every
 * recur def) decides what is due and only calls this for due definitions.
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
  await writeSidecarAtomic(deps.sidecarPath, {
    ...sidecar,
    registry: { ...sidecar.registry, [def.slug]: registryEntry }
  });

  await deps.launcher.launch({ slug: def.slug, cwd: def.cwd, model: def.model, prompt: def.prompt });

  const afterLaunch = await readSidecar(deps.sidecarPath);
  const nextSidecar: SidecarState = {
    ...afterLaunch,
    recur: { ...(afterLaunch.recur ?? {}), [def.slug]: { lastRunAt: deps.now.toISOString() } }
  };
  await writeSidecarAtomic(deps.sidecarPath, nextSidecar);
}

/**
 * Creates or updates `<node>/thread-<slug>.md` for one recur firing. A fresh thread gets a new body
 * naming its owner and its source recur file; an existing thread only has `status:`/`opened:` reset to
 * open/today and a `ran: <iso>` line appended, so a human's edits to the body are never overwritten.
 * Reopening a previously `done` thread also clears its `closed:` date: `renderFrontmatter` drops
 * `undefined` fields, so setting it to `undefined` here removes the stale closed line rather than
 * leaving a done thread's old close date on an otherwise-open thread.
 */
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
  const nextFrontmatter = renderFrontmatter({ ...frontmatter, status: "open", opened: openedToday, closed: undefined });
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

/** Everything runRecurDue needs to scan the vault and dispatch its due definitions: the injectable launcher plus the vault/sidecar locations, clock, and dry-run flag. Mirrors RunRecurDeps with an added `dryRun` since a scheduler sweep, unlike a single runRecur call, decides for itself which definitions are due. */
export type RunRecurDueDeps = {
  launcher: WorkerLauncher;
  vaultRoot?: string;
  sidecarPath?: string;
  now?: Date;
  /** When true, reports which definitions are due without launching any worker or recording a run. */
  dryRun?: boolean;
};

/** The outcome of one `runRecurDue` sweep: every definition found due this cycle, and (when not a dry run) the ones actually dispatched. `due` and `ran` are always the same set on a real run; they diverge only for `dryRun: true`, where `ran` is empty. */
export type RunRecurDueResult = {
  due: RecurDef[];
  ran: RecurDef[];
};

/**
 * Scans the vault for recur definitions, filters them to the ones due against the sidecar's
 * recorded `lastRunAt` (see isDue), and, unless `dryRun`, dispatches each due definition via
 * runRecur. Backs both `tangent threads recur due` (the launchd-scheduled sweep) and its
 * `--dry-run` preview; `vaultRoot`/`sidecarPath`/`now` default to the real vault, sidecar, and
 * clock but are injectable so tests never touch either. One definition's dispatch error (a bad
 * launcher, a `TmuxWorkerLauncher` duplicate-session refusal, anything) is caught, logged as a single
 * clear stderr line naming the slug, and never stops the remaining due definitions from running: a
 * single sweep dispatching several definitions must not let one bad def block every other. `ran`
 * reports only the definitions that actually launched, so a caller (or a test) can tell a failed
 * dispatch apart from a successful one; the failed def's `lastRunAt` is left unset (see runRecur), so
 * it stays due and is retried on the next poll.
 */
export async function runRecurDue(deps: RunRecurDueDeps): Promise<RunRecurDueResult> {
  const vaultRootPath = deps.vaultRoot || defaultVaultRoot();
  const sidecarFile = deps.sidecarPath || defaultSidecarPath();
  const now = deps.now || new Date();

  const defs = await scanRecurFiles(vaultRootPath);
  const sidecar = await readSidecar(sidecarFile);
  const due = defs.filter((def) => isDue(def, sidecar.recur?.[def.slug]?.lastRunAt, now));

  if (deps.dryRun) return { due, ran: [] };

  const runDeps: RunRecurDeps = { launcher: deps.launcher, vaultRoot: vaultRootPath, sidecarPath: sidecarFile, now };
  const ran: RecurDef[] = [];
  for (const def of due) {
    try {
      await runRecur(def, runDeps);
      ran.push(def);
    } catch (error) {
      console.error(`threads recur: ${def.slug} failed: ${errorMessage(error)}`);
    }
  }
  return { due, ran };
}

/** Extracts a readable message from a thrown value, for a one-line stderr log that never crashes when something throws a non-Error value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  /**
   * Refuses with a clear error when cwd does not exist, or when a `tg-<slug>` tmux session is
   * already running (the previous dispatch has not finished, so this poll must not pile a second
   * worker onto the same slug); otherwise records the prompt and starts `tmux new-session -d` running
   * claude with the prompt as a single argv element. Because `runRecur` now records `lastRunAt` only
   * after this resolves, a duplicate-session refusal leaves the definition due, so the next poll
   * retries it automatically once the old session ends: no separate retry bookkeeping is needed.
   */
  async launch(args: { slug: string; cwd: string; model: string; prompt: string }): Promise<void> {
    if (!(await pathExists(args.cwd))) {
      throw new Error(`Cannot launch recurring worker ${JSON.stringify(args.slug)}: cwd ${JSON.stringify(args.cwd)} does not exist.`);
    }
    const sessionName = `tg-${args.slug}`;
    if (await tmuxSessionExists(sessionName, this.config.timeoutMs || 30000)) {
      throw new Error(`session ${sessionName} still running; skipped`);
    }
    const promptDir = this.config.promptDir || path.join(tangentHome(), ".tangent", "recur-prompts");
    await writeFileAtomic(path.join(promptDir, `${args.slug}.md`), `${args.prompt}\n`);

    const tmuxArgs = [
      "new-session", "-d",
      "-s", sessionName,
      "-c", args.cwd,
      "claude", "--model", args.model, args.prompt
    ];
    const result = await runProcess({ command: "tmux", args: tmuxArgs, timeoutMs: this.config.timeoutMs || 30000 });
    if (result.code !== 0) throw processFailure("tmux", result.code, result.stderr, result.stdout);
  }
}

/**
 * True when a tmux session with this name is currently running (`tmux has-session` exits 0). Any
 * spawn failure (tmux not installed, no tmux server yet) is treated as "no session", so the real
 * `new-session` call below produces whatever clearer error applies rather than this probe masking it.
 */
async function tmuxSessionExists(name: string, timeoutMs: number): Promise<boolean> {
  try {
    const result = await runProcess({ command: "tmux", args: ["has-session", "-t", name], timeoutMs });
    return result.code === 0;
  } catch {
    return false;
  }
}
