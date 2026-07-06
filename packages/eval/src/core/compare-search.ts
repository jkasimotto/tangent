// Powers `tangent eval compare-search`: one command that scaffolds a search-vs-no-search eval,
// replacing the ~6 manual steps documented in skills/setup-tangent-eval/SKILL.md ("Search vs No
// Search"). It indexes the repo for `tangent search`, captures two context snapshots (one plain,
// one with a short instruction file telling the agent to use `tangent search`), and writes a ready
// eval.json comparing them. See docs/superpowers/specs/2026-07-05-mark-loop-design.md: evals are a
// byproduct of noticing, not a project the user sets up by hand.
//
// Pure logic (name defaulting, prompt-source precedence, substantive-message filtering, eval.json
// shape) is separated from the I/O orchestration in `runCompareSearch`, whose dependencies are all
// injectable so tests can exercise the full sequencing (including the .agents/eval-search.md
// write-then-delete around the with-search capture) without spawning `tangent`, `claude`, or real
// git commands.

import { access, mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveGitRoot } from "@tangent/repo/git";
import { processFailure, runProcess } from "@tangent/agent-runtime/process";
import {
  ensureUsageIndex,
  loadUsageDatasetFromIndex,
  readConversationsUserMessages,
  type ConversationUserMessage
} from "@tangent/usage-index-sqlite";

import { captureContextSnapshot, type CaptureContextOptions, type CaptureContextResult } from "./context-snapshot.js";
import type { EvalSpec } from "../types/spec.js";

/** How many days back "recent sessions" looks when no explicit prompt source is given. */
export const DEFAULT_RECENT_LOOKBACK_DAYS = 14;

/** How many of the most recent conversations for a repo are considered when picking the default prompt. */
export const DEFAULT_RECENT_CONVERSATION_LIMIT = 20;

/** The `.agents/eval-search.md` content that is the with-search arm's only difference from no-search. */
export const SEARCH_INSTRUCTIONS_CONTENT =
  'Use tangent structural search before broad file reads in this task. First run `tangent search index` once (fast; required in this checkout). Then use `tangent search open-plan "<task summary>"`, `tangent search "<query>"`, `tangent search symbol <name>`, and `tangent search callers <name>` to locate the relevant code, and read only what those results point to.\n';

/** The CLI's raw prompt-source flags, before precedence validation. */
export type CompareSearchPromptFlags = {
  prompt?: string;
  task?: string;
  session?: string;
};

/** Where the eval's task prompt comes from, once precedence has been resolved. */
export type ResolvedPromptSource =
  | { kind: "file"; path: string }
  | { kind: "text"; text: string }
  | { kind: "session"; sessionId: string }
  | { kind: "auto" };

/**
 * Resolves which prompt source the CLI flags name, enforcing that at most one of --prompt, --task,
 * and --session was given. Zero flags resolves to "auto": the most recent substantive user message
 * across recent sessions for the repo.
 */
export function resolvePromptSource(flags: CompareSearchPromptFlags): ResolvedPromptSource {
  const given = [flags.prompt, flags.task, flags.session].filter((value) => value !== undefined);
  if (given.length > 1) throw new Error("Pass at most one of --prompt, --task, or --session.");
  if (flags.prompt !== undefined) return { kind: "file", path: flags.prompt };
  if (flags.task !== undefined) return { kind: "text", text: flags.task };
  if (flags.session !== undefined) return { kind: "session", sessionId: flags.session };
  return { kind: "auto" };
}

/** Builds the default eval name, "search-compare-<yyyymmdd>", from the given clock. */
export function defaultCompareSearchName(now: Date = new Date()): string {
  return `search-compare-${now.toISOString().slice(0, 10).replace(/-/g, "")}`;
}

/**
 * Returns whether a user message is worth using as a task prompt: non-empty after trimming, and not
 * a command-XML message (the `<command-name>...</command-name>` wrapper Claude Code writes for
 * slash-command invocations, which carries no task text of its own).
 */
export function isSubstantiveUserMessage(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !trimmed.startsWith("<command-name>");
}

/**
 * Picks the last substantive message from a session's user messages, in ordinal order. Used for
 * `--session <id>`: the task is "whatever the user last asked in that session", skipping any
 * trailing command-XML messages.
 */
export function selectLastSubstantiveMessage(messages: ConversationUserMessage[]): string | undefined {
  const sorted = [...messages].sort((a, b) => a.ordinal - b.ordinal);
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const message = sorted[index]!;
    if (isSubstantiveUserMessage(message.text)) return message.text;
  }
  return undefined;
}

/** One flattened user message candidate for the "most recent across sessions" default prompt search. */
export type RecentMessageCandidate = { text: string; at?: string };

/**
 * Picks the most recent substantive message across a flattened list of candidates from multiple
 * conversations, sorted by `at` timestamp descending. Used for the default (no source flag) prompt:
 * the most recent substantive user message across recent sessions for the repo.
 */
export function selectMostRecentSubstantiveMessage(candidates: RecentMessageCandidate[]): string | undefined {
  const substantive = candidates.filter((candidate) => isSubstantiveUserMessage(candidate.text));
  const sorted = [...substantive].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return sorted[0]?.text;
}

/** Truncates text to at most `maxLength` characters, appending an ellipsis when cut. */
export function truncateForDisplay(text: string, maxLength: number): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

/** Renders `prompts/task.md`: a banner marking the file as the eval's editable task prompt, then the chosen text. */
export function renderCompareSearchTaskPrompt(name: string, promptText: string): string {
  return `<!-- Generated by "tangent eval compare-search ${name}". Edit freely: this is the eval's task prompt, not a record of the source conversation. -->\n\n${promptText.trim()}\n`;
}

/** Options for building the generated eval.json spec, once both context snapshots have been captured. */
export type BuildCompareSearchSpecOptions = {
  name: string;
  model: string;
  judgeModel: string;
  noSearchRef: string;
  withSearchRef: string;
};

/**
 * Builds the `eval.spec.v1` scaffold for a search-vs-no-search comparison: one case, two
 * `claude-cli` variants (`no-search`, `with-search`) pointing at the two captured context
 * snapshots, and a three-criterion evaluator rubric (used search, correct, focused reads).
 */
export function buildCompareSearchEvalSpec(options: BuildCompareSearchSpecOptions): EvalSpec {
  return {
    schema: "eval.spec.v1",
    name: options.name,
    defaults: {
      repo: { path: ".", ref: "HEAD" },
      cwd: ".",
      agent: { kind: "claude-cli", model: options.model, permissionMode: "bypassPermissions" },
      phases: [{ id: "implement", mode: "workspace-write", commit: true }]
    },
    evaluator: {
      model: options.judgeModel,
      criteria: [
        { id: "used-search", statement: "The agent ran tangent search commands to locate code before reading files broadly." },
        { id: "correct", statement: "The agent completed the task described in the prompt correctly and completely." },
        { id: "focused-reads", statement: "The agent read only files relevant to the task rather than scanning unrelated files." }
      ]
    },
    cases: [
      {
        id: options.name,
        prompt: "prompts/task.md",
        variants: [
          { id: "no-search", context: { mode: "snapshot", ref: options.noSearchRef } },
          { id: "with-search", context: { mode: "snapshot", ref: options.withSearchRef } }
        ]
      }
    ]
  };
}

/** Caller-supplied options for `runCompareSearch`; only `promptFlags` has no default. */
export type CompareSearchOptions = {
  name?: string;
  repo?: string;
  cwd?: string;
  model?: string;
  judgeModel?: string;
  promptFlags: CompareSearchPromptFlags;
  now?: Date;
};

/**
 * Injectable I/O for `runCompareSearch`. All default to the real filesystem, git, process, and
 * usage-index implementations; tests inject fakes so the orchestration (existing-file abort, the
 * write-then-delete around the with-search capture, and the eval.json/task.md scaffold) can be
 * verified without spawning `tangent`/`claude` or touching a real git worktree.
 */
export type CompareSearchDependencies = {
  resolveRepoRoot?: (repo: string) => Promise<string>;
  runSearchIndex?: (repoRoot: string) => Promise<void>;
  captureSnapshot?: (options: CaptureContextOptions) => Promise<CaptureContextResult>;
  resolvePromptText?: (source: ResolvedPromptSource, context: { repoRoot: string; cwd: string }) => Promise<{ text: string; label: string }>;
  pathExists?: (targetPath: string) => Promise<boolean>;
  writeTextFile?: (targetPath: string, content: string) => Promise<void>;
  ensureDir?: (dir: string) => Promise<void>;
  deleteFile?: (targetPath: string) => Promise<void>;
  removeDirIfEmpty?: (dir: string) => Promise<void>;
  log?: (line: string) => void;
};

/** What `runCompareSearch` wrote, for the CLI to print and for tests to assert against. */
export type CompareSearchResult = {
  name: string;
  repoRoot: string;
  promptText: string;
  promptSourceLabel: string;
  noSearchRef: string;
  withSearchRef: string;
  evalDir: string;
  specPath: string;
  promptPath: string;
  spec: EvalSpec;
};

/**
 * Runs the full `tangent eval compare-search` sequence: resolves the task prompt, indexes the repo
 * for `tangent search`, captures a plain "no-search" context snapshot, writes
 * `.agents/eval-search.md`, captures the "with-search" snapshot over it, deletes the file to restore
 * the tree, and writes `evals/<name>/{eval.json,prompts/task.md}`. Aborts before any side effect if
 * `.agents/eval-search.md` already exists, so a prior run (or an unrelated file with that name) is
 * never silently overwritten. The with-search capture and the file deletion are wrapped so the
 * instruction file is always removed even if that capture fails.
 */
export async function runCompareSearch(options: CompareSearchOptions, deps: CompareSearchDependencies = {}): Promise<CompareSearchResult> {
  const log = deps.log || ((): void => {});
  const now = options.now || new Date();
  const name = (options.name || defaultCompareSearchName(now)).trim();
  if (!name) throw new Error("tangent eval compare-search requires a non-empty name.");
  const cwd = options.cwd || ".";
  const model = options.model || "sonnet";
  const judgeModel = options.judgeModel || "haiku";

  const resolveRepoRoot = deps.resolveRepoRoot || resolveGitRoot;
  const runSearchIndex = deps.runSearchIndex || defaultRunSearchIndex;
  const captureSnapshot = deps.captureSnapshot || captureContextSnapshot;
  const resolvePromptTextFn = deps.resolvePromptText || defaultResolvePromptText;
  const pathExists = deps.pathExists || defaultPathExists;
  const writeTextFile = deps.writeTextFile || defaultWriteTextFile;
  const ensureDir = deps.ensureDir || defaultEnsureDir;
  const deleteFile = deps.deleteFile || defaultDeleteFile;
  const removeDirIfEmpty = deps.removeDirIfEmpty || defaultRemoveDirIfEmpty;

  const repoRoot = await resolveRepoRoot(options.repo || ".");
  const searchFilePath = path.join(repoRoot, cwd === "." ? "" : cwd, ".agents", "eval-search.md");
  const searchFileRel = relativeSlashPath(repoRoot, searchFilePath);
  const searchFileDir = path.dirname(searchFilePath);

  if (await pathExists(searchFilePath)) {
    throw new Error(`${searchFileRel} already exists; remove or rename it before running compare-search.`);
  }

  const promptSource = resolvePromptSource(options.promptFlags);
  const resolvedPrompt = await resolvePromptTextFn(promptSource, { repoRoot, cwd });
  log(`prompt (${resolvedPrompt.label}): ${truncateForDisplay(resolvedPrompt.text, 200)}`);

  log("Indexing the repo for tangent search...");
  await runSearchIndex(repoRoot);

  log(`Capturing no-search context snapshot "${name}-no-search"...`);
  const noSearch = await captureSnapshot({ name: `${name}-no-search`, repo: repoRoot, cwd, includeAncestors: true });

  log(`Writing ${searchFileRel}...`);
  await ensureDir(searchFileDir);
  await writeTextFile(searchFilePath, SEARCH_INSTRUCTIONS_CONTENT);

  let withSearch: CaptureContextResult;
  try {
    log(`Capturing with-search context snapshot "${name}-with-search"...`);
    withSearch = await captureSnapshot({ name: `${name}-with-search`, repo: repoRoot, cwd, includeAncestors: true, includeDirtyContext: true });
  } finally {
    log(`Removing ${searchFileRel} to restore the working tree...`);
    await deleteFile(searchFilePath);
    await removeDirIfEmpty(searchFileDir);
  }

  const evalDir = path.join(repoRoot, "evals", name);
  const promptPath = path.join(evalDir, "prompts", "task.md");
  const specPath = path.join(evalDir, "eval.json");
  const spec = buildCompareSearchEvalSpec({ name, model, judgeModel, noSearchRef: noSearch.ref, withSearchRef: withSearch.ref });

  log(`Writing eval scaffold to evals/${name}...`);
  await ensureDir(path.dirname(promptPath));
  await writeTextFile(promptPath, renderCompareSearchTaskPrompt(name, resolvedPrompt.text));
  await writeTextFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);

  return {
    name,
    repoRoot,
    promptText: resolvedPrompt.text,
    promptSourceLabel: resolvedPrompt.label,
    noSearchRef: noSearch.ref,
    withSearchRef: withSearch.ref,
    evalDir,
    specPath,
    promptPath,
    spec
  };
}

/** Runs `tangent search index` in the repo, translating a missing `tangent` binary into one actionable sentence. */
async function defaultRunSearchIndex(repoRoot: string): Promise<void> {
  let result;
  try {
    result = await runProcess({ command: "tangent", args: ["search", "index"], cwd: repoRoot, timeoutMs: 120000 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Could not run `tangent search index`: the `tangent` command was not found on PATH.");
    }
    throw error;
  }
  if (result.code !== 0) throw processFailure("tangent search index", result.code, result.stderr, result.stdout);
}

/** Resolves the task prompt text for the given source, reading a file/stdin, an indexed session, or recent repo activity. */
async function defaultResolvePromptText(source: ResolvedPromptSource, context: { repoRoot: string; cwd: string }): Promise<{ text: string; label: string }> {
  if (source.kind === "text") return { text: source.text, label: "--task" };
  if (source.kind === "file") {
    const text = source.path === "-" ? await readStdinText() : await readFile(path.resolve(source.path), "utf8");
    return { text, label: source.path === "-" ? "stdin" : `--prompt ${source.path}` };
  }
  if (source.kind === "session") {
    const text = await promptFromSession(source.sessionId, context.repoRoot);
    return { text, label: `--session ${source.sessionId}` };
  }
  const text = await promptFromRecentRepoActivity(context.repoRoot);
  return { text, label: "most recent session in this repo" };
}

/** Pulls the last substantive user message of one Claude session from the usage index. */
async function promptFromSession(sessionId: string, repoRoot: string): Promise<string> {
  const conversationId = `claude:${sessionId}`;
  await ensureUsageIndex({ repo: repoRoot, scope: "all", providers: ["claude"] });
  const [conversation] = await readConversationsUserMessages({
    conversationIds: [conversationId],
    repo: repoRoot,
    scope: "all",
    providers: ["claude"]
  });
  const text = conversation && selectLastSubstantiveMessage(conversation.userMessages);
  if (!text) {
    throw new Error(`No substantive user message found for session ${sessionId} in the usage index. Pass --task "<text>" or --prompt <file> instead.`);
  }
  return text;
}

/** Picks the most recent substantive user message across the repo's recently indexed conversations. */
async function promptFromRecentRepoActivity(repoRoot: string): Promise<string> {
  const since = new Date(Date.now() - DEFAULT_RECENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const dataset = await loadUsageDatasetFromIndex({ repo: repoRoot, scope: "repo", providers: ["claude"], since });
  const conversationIds = dataset.conversations.all().data
    .slice()
    .sort((a, b) => recencyKey(b).localeCompare(recencyKey(a)))
    .slice(0, DEFAULT_RECENT_CONVERSATION_LIMIT)
    .map((row) => row.id);
  if (!conversationIds.length) {
    throw new Error(`No indexed Claude conversations found for ${repoRoot} in the last ${DEFAULT_RECENT_LOOKBACK_DAYS} days. Pass --task "<text>", --prompt <file>, or --session <id> instead.`);
  }
  const conversations = await readConversationsUserMessages({ conversationIds, repo: repoRoot, scope: "repo", providers: ["claude"] });
  const candidates = conversations.flatMap((conversation) => conversation.userMessages.map((message) => ({ text: message.text, at: message.at })));
  const text = selectMostRecentSubstantiveMessage(candidates);
  if (!text) {
    throw new Error(`No substantive user message found in recent sessions for ${repoRoot}. Pass --task "<text>", --prompt <file>, or --session <id> instead.`);
  }
  return text;
}

/** Sort key for a conversation row: its end time, falling back to its start time or the epoch. */
function recencyKey(row: { endedAt?: Date; startedAt?: Date }): string {
  return (row.endedAt || row.startedAt || new Date(0)).toISOString();
}

/** Reads all of stdin into a string, for `--prompt -`. */
async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** Returns whether a path exists, treating any access error as "does not exist". */
async function defaultPathExists(targetPath: string): Promise<boolean> {
  return access(targetPath).then(() => true).catch(() => false);
}

/** Writes a UTF-8 text file. */
async function defaultWriteTextFile(targetPath: string, content: string): Promise<void> {
  await writeFile(targetPath, content, "utf8");
}

/** Creates a directory and any missing parents. */
async function defaultEnsureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** Deletes a file, ignoring a missing file. */
async function defaultDeleteFile(targetPath: string): Promise<void> {
  await rm(targetPath, { force: true });
}

/** Removes a directory if it exists and is now empty, restoring the tree to how it was before it was created for this run. */
async function defaultRemoveDirIfEmpty(dir: string): Promise<void> {
  const entries = await readdir(dir).catch(() => undefined);
  if (entries && entries.length === 0) await rmdir(dir).catch(() => undefined);
}

/** Returns the POSIX-style relative path from base to target, for display in messages. */
function relativeSlashPath(base: string, target: string): string {
  return path.relative(base, target).split(path.sep).join("/");
}
