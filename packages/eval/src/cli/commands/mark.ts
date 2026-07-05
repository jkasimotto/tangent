import { repoInfo } from "@tangent/repo";

import { booleanArg, numberArg, requiredString, stringArg, type Args } from "../args.js";
import { createMarkRecord, listMarks, readMark, updateMark, writeMark, type MarkDraft, type MarkListFilter, type MarkUpdatePatch } from "../../marks/store.js";
import { isMarkKind, isMarkStatus, type MarkAnchor, type MarkKind, type MarkRecord, type MarkRepo, type MarkStatus } from "../../marks/types.js";
import { resolveAnchor } from "../../marks/resolve.js";
import { toEvalCommand } from "./mark-to-eval.js";
import { markScanCommand } from "./mark-scan.js";

/**
 * Dispatches `tangent mark` subcommands. `list`/`show`/`update`/`to-eval`/`scan` are checked first so
 * `--json` keeps its ordinary meaning there ("print as JSON"); only once none of them match does a
 * bare `--json` mean "read a record from stdin", the /mark skill's capture path.
 */
export async function markCommand(args: Args): Promise<void> {
  const subcommand = args._[0];
  if (subcommand === "list") return listCommand(args);
  if (subcommand === "show") return showCommand(args);
  if (subcommand === "update") return updateCommand(args);
  if (subcommand === "to-eval") return toEvalCommand(args);
  if (subcommand === "scan") return markScanCommand(args);
  if (booleanArg(args.json)) return captureFromStdin(args);
  return captureCommand(args);
}

/** Handles bare `tangent mark "<note>"` capture, anchoring to the cwd-resolved current session. */
async function captureCommand(args: Args): Promise<void> {
  const cwd = process.cwd();
  const anchor = await requireAnchor(cwd, stringArg(args.session), numberArg(args.turn));
  const repo = await resolveMarkRepo(stringArg(args.repo) || cwd);
  const draft = draftFromFlags(args, anchor, repo);
  const mark = await writeMark(createMarkRecord(draft));
  printCreated(mark);
}

/**
 * Builds a mark draft from CLI flags, pure and synchronous so argument parsing is testable without
 * touching the filesystem. `--observed` overrides the bare note; one of the two is required.
 */
export function draftFromFlags(args: Args, anchor: MarkAnchor, repo: MarkRepo): MarkDraft {
  const note = stringArg(args._[0]);
  const observed = stringArg(args.observed) || note;
  if (!observed) throw new Error('tangent mark requires a note or --observed text, e.g. tangent mark "note".');
  return {
    kind: kindArg(args.kind),
    anchor,
    repo,
    observed,
    expected: stringArg(args.expected),
    hypothesis: stringArg(args.hypothesis)
  };
}

/** Handles `tangent mark --json`, the /mark skill's entry point: a full or partial record on stdin. */
async function captureFromStdin(args: Args): Promise<void> {
  const raw = JSON.parse(await readStdin()) as Record<string, unknown>;
  const cwd = process.cwd();
  const anchor = coerceAnchor(raw.anchor) || await requireAnchor(cwd, stringArg(args.session), numberArg(args.turn));
  const repo = coerceRepo(raw.repo) || await resolveMarkRepo(cwd);
  const draft = draftFromStdinInput(raw, anchor, repo);
  const mark = await writeMark(createMarkRecord(draft));
  printCreated(mark);
}

/**
 * Builds a mark draft from a raw stdin object, pure so validation and defaulting is testable
 * without simulating a real stdin stream. `anchor`/`repo` are the already-resolved fallbacks used
 * when the input does not supply its own (a fully partial record from the /mark skill).
 */
export function draftFromStdinInput(raw: Record<string, unknown>, anchor: MarkAnchor, repo: MarkRepo): MarkDraft {
  const observed = typeof raw.observed === "string" && raw.observed ? raw.observed : undefined;
  if (!observed) throw new Error('tangent mark --json requires a non-empty "observed" field on stdin.');
  return {
    id: stringField(raw.id),
    at: stringField(raw.at),
    kind: isMarkKind(raw.kind) ? raw.kind : undefined,
    anchor: coerceAnchor(raw.anchor) || anchor,
    repo: coerceRepo(raw.repo) || repo,
    observed,
    expected: stringField(raw.expected),
    hypothesis: stringField(raw.hypothesis),
    quote: stringField(raw.quote),
    status: isMarkStatus(raw.status) ? raw.status : undefined,
    links: typeof raw.links === "object" && raw.links ? (raw.links as MarkDraft["links"]) : undefined
  };
}

/** Handles `tangent mark list`, printing marks optionally filtered by status and kind. */
async function listCommand(args: Args): Promise<void> {
  const filter: MarkListFilter = {
    status: statusArg(args.status),
    kind: kindArgOptional(args.kind),
    repo: stringArg(args.repo)
  };
  const marks = await listMarks(filter);
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(marks, null, 2));
    return;
  }
  if (!marks.length) {
    console.log("No marks.");
    return;
  }
  for (const mark of marks) {
    console.log(`${mark.id}  [${mark.status}]  ${mark.kind}  ${truncate(mark.observed, 72)}`);
  }
}

/** Handles `tangent mark show <id>`, printing the full record. */
async function showCommand(args: Args): Promise<void> {
  const id = requiredString(args._[1], "tangent mark show requires <id>.");
  console.log(JSON.stringify(await readMark(id), null, 2));
}

/** Handles `tangent mark update <id>`, applying a status and/or link patch. */
async function updateCommand(args: Args): Promise<void> {
  const id = requiredString(args._[1], "tangent mark update requires <id>.");
  const patch: MarkUpdatePatch = {};
  const status = statusArg(args.status);
  if (status) patch.status = status;
  const linkEval = stringArg(args["link-eval"]);
  const linkFix = stringArg(args["link-fix"]);
  if (linkEval !== undefined || linkFix !== undefined) {
    patch.links = {
      ...(linkEval !== undefined ? { eval: linkEval } : {}),
      ...(linkFix !== undefined ? { fix: linkFix } : {})
    };
  }
  const mark = await updateMark(id, patch);
  console.log(`mark: ${mark.id}  status=${mark.status}`);
}

/** Prints the created mark id plus the two follow-up commands, so the trail back is one paste away. */
function printCreated(mark: MarkRecord): void {
  console.log(`mark: ${mark.id}`);
  console.log(`Follow up:  tangent mark show ${mark.id}   tangent mark update ${mark.id} --status triaged`);
}

/** Resolves an anchor by session id or cwd, throwing a specific error when neither yields a transcript. */
async function requireAnchor(cwd: string, sessionId: string | undefined, ordinal: number | undefined): Promise<MarkAnchor> {
  const anchor = await resolveAnchor(cwd, sessionId);
  if (!anchor) {
    throw new Error(sessionId
      ? `No Claude transcript found for session ${sessionId}.`
      : "No Claude transcript found for this directory. Pass --session <id> to anchor explicitly.");
  }
  return ordinal === undefined ? anchor : { ...anchor, ordinal };
}

/** Resolves repo metadata (root, branch) for a path via git, falling back to the path itself when not a git repo. */
async function resolveMarkRepo(repoPath: string): Promise<MarkRepo> {
  const info = await repoInfo(repoPath);
  return { root: info.root || repoPath, branch: info.branch };
}

/** Returns a validated MarkAnchor from a raw stdin value, or undefined when it is missing or malformed. */
function coerceAnchor(value: unknown): MarkAnchor | undefined {
  if (!value || typeof value !== "object") return undefined;
  const anchor = value as Record<string, unknown>;
  if (typeof anchor.sessionId !== "string" || !anchor.sessionId) return undefined;
  if (typeof anchor.transcriptPath !== "string" || !anchor.transcriptPath) return undefined;
  return {
    provider: "claude",
    sessionId: anchor.sessionId,
    conversationId: typeof anchor.conversationId === "string" && anchor.conversationId ? anchor.conversationId : `claude:${anchor.sessionId}`,
    transcriptPath: anchor.transcriptPath,
    ordinal: typeof anchor.ordinal === "number" ? anchor.ordinal : undefined
  };
}

/** Returns a validated MarkRepo from a raw stdin value, or undefined when it is missing or malformed. */
function coerceRepo(value: unknown): MarkRepo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const repo = value as Record<string, unknown>;
  if (typeof repo.root !== "string" || !repo.root) return undefined;
  return { root: repo.root, branch: typeof repo.branch === "string" ? repo.branch : undefined };
}

/** Returns a raw stdin field as a string, or undefined when absent or not a string. */
function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Parses --kind, defaulting to "failure" (the quality lens) when absent. */
function kindArg(value: unknown): MarkKind {
  return kindArgOptional(value) || "failure";
}

/** Parses --kind, validating against the known mark kinds, or undefined when absent. */
function kindArgOptional(value: unknown): MarkKind | undefined {
  const kind = stringArg(value);
  if (kind === undefined) return undefined;
  if (!isMarkKind(kind)) throw new Error('--kind must be "failure" or "candidate".');
  return kind;
}

/** Parses --status, validating against the known mark statuses, or undefined when absent. */
function statusArg(value: unknown): MarkStatus | undefined {
  const status = stringArg(value);
  if (status === undefined) return undefined;
  if (!isMarkStatus(status)) throw new Error("--status must be one of: new, suggested, triaged, eval-created, fixed, dismissed.");
  return status;
}

/** Truncates text to a max length for compact list output, appending an ellipsis when cut. */
function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** Reads all of stdin into a string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
