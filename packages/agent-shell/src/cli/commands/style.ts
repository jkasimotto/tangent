import { renderCommandHelp } from "@tangent/core";
import { booleanArg, numberArg, parseArgs, requiredString, stringArg, stringsArg, type Args } from "@tangent/core/cli";

import { postJson, resolveServerUrl, vaultFetch } from "../client.js";
import { styleCommandSpec } from "../spec.js";

type StyleNote = {
  id: string;
  at: string;
  note: string;
  tags: string[];
  document: { file: string; area: string | null; title: string | null; vaultCommit: string | null };
  quote: { text: string; line: number | null; heading: string | null } | null;
  author: { known: boolean; source: string; commit: string | null; session: string | null; harness: string | null; model: string | null; effort: string | null };
  observer: { kind: string; session: string | null; area: string | null; harness: string | null; model: string | null; effort: string | null };
};

type StyleCounts = { total: number; byModel: Array<{ value: string; count: number }>; byHarness: Array<{ value: string; count: number }>; byTag: Array<{ value: string; count: number }>; byArea: Array<{ value: string; count: number }>; unknownAuthors: number };

const DEFAULT_LIMIT = 40;

/**
 * Dispatches `tangent style` subcommands: observations about how writing went,
 * as opposed to `tangent document`, which is Julian's actionable comments
 * inside a Document (design contract: docs/design/style-notes/design-record.md).
 *
 * A style note is deliberately not a comment. It writes no vault file, makes no
 * commit, and never appears in the reader, in `tangent document comments`, or
 * in a brain notice. The corpus it appends to is read back with `list` and
 * distilled into writing rules by hand.
 */
export async function runStyleCli(argv = process.argv.slice(2)): Promise<void> {
  const messageIndex = argv.indexOf("-m");
  const message = messageIndex >= 0 ? argv[messageIndex + 1] ?? "" : "";
  const rest = messageIndex >= 0 ? [...argv.slice(0, messageIndex), ...argv.slice(messageIndex + 2)] : argv;
  const args = parseArgs(rest, { repeatable: ["tag"] });
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand === "add") return addCommand(args, message);
  if (subcommand === "list") return listCommand(args);
  if (subcommand === "show") return showCommand(args);
  throw new Error(`Unknown style command: ${subcommand}. Try "tangent style add <file> \\"<observation>\\"" or "tangent style list".`);
}

/** Handles `tangent style add <file> "<observation>" [--quote "<words>"] [--tag <tag>]`. */
async function addCommand(args: Args, message: string): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const file = requiredString(args._[1], "tangent style add requires <vault-relative file> \"<observation>\".");
  const note = (stringArg(args.note) ?? message ?? "").trim() || args._.slice(2).join(" ").trim();
  if (!note) throw new Error("tangent style add requires the observation, after the file or in --note.");
  const result = await postJson(server, "/api/style-notes", {
    file,
    note,
    quote: stringArg(args.quote) ?? "",
    tags: stringsArg(args.tag),
  });
  const saved = result.note as StyleNote;
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(saved, null, 2));
    return;
  }
  console.log(`style note ${saved.id} on ${saved.document.file}`);
  console.log(authorLine(saved));
}

/** One line naming who wrote the annotated words, or why that is unknown. */
function authorLine(note: StyleNote): string {
  if (note.author.known) {
    const launch = [note.author.harness, note.author.model, note.author.effort].filter(Boolean).join("/");
    return `written by ${launch} (${note.author.session}).`;
  }
  const reasons: Record<string, string> = {
    "quote-not-found": "no quote was given or the words are gone, so the line could not be blamed",
    "no-blame": "the vault gave no blame answer for that line",
    "no-trailer": "the commit that wrote those words records no session",
    "unknown-session": "the session that wrote those words has no durable record left",
  };
  return `author unknown: ${reasons[note.author.source] ?? note.author.source}.`;
}

/** Handles `tangent style list` with its filters. */
async function listCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const query = new URLSearchParams();
  for (const key of ["area", "file", "since", "model", "harness", "tag"]) {
    const value = stringArg(args[key]);
    if (value) query.set(key, value);
  }
  const result = await vaultFetch(server, `/api/style-notes${query.toString() ? `?${query}` : ""}`);
  const notes = result.entries as StyleNote[];
  const counts = result.counts as StyleCounts;
  if (booleanArg(args.json)) {
    console.log(JSON.stringify({ entries: notes, counts, skipped: result.skipped, total: result.total }, null, 2));
    return;
  }
  if (!notes.length) {
    console.log("No style notes yet.");
    return;
  }
  console.log(`${notes.length} style note${notes.length === 1 ? "" : "s"}${result.skipped ? `, ${result.skipped} unreadable line${result.skipped === 1 ? "" : "s"} skipped` : ""}.`);
  for (const line of [countLine("by model", counts?.byModel), countLine("by harness", counts?.byHarness), countLine("by tag", counts?.byTag)].filter(Boolean)) console.log(line);
  const limit = numberArg(args.limit) ?? DEFAULT_LIMIT;
  for (const note of notes.slice(0, limit)) {
    console.log("");
    console.log(`${note.id.slice(0, 8)}  ${note.at}  ${note.document.file}`);
    console.log(`  ${note.note}${note.tags.length ? `  [${note.tags.join(", ")}]` : ""}`);
    if (note.quote) console.log(`  on "${clip(note.quote.text, 120)}"`);
    console.log(`  ${authorLine(note)}`);
  }
  if (notes.length > limit) console.log(`\n${notes.length - limit} more; raise --limit or use --json.`);
}

/** Handles `tangent style show <id>`. */
async function showCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const id = requiredString(args._[1], "tangent style show requires the note id.");
  const result = await vaultFetch(server, `/api/style-notes?id=${encodeURIComponent(id)}`);
  const note = (result.entries as StyleNote[])[0];
  if (!note) throw new Error(`no style note ${id}; run "tangent style list" to see the corpus.`);
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(note, null, 2));
    return;
  }
  console.log(`${note.id}  ${note.at}`);
  console.log(`Document: ${note.document.file}${note.document.title ? ` (${note.document.title})` : ""}`);
  if (note.document.vaultCommit) console.log(`Vault commit: ${note.document.vaultCommit}`);
  if (note.quote) console.log(`Quoted${note.quote.heading ? ` under "${note.quote.heading}"` : ""}:\n  ${note.quote.text}`);
  console.log(`Note: ${note.note}`);
  if (note.tags.length) console.log(`Tags: ${note.tags.join(", ")}`);
  console.log(authorLine(note));
  console.log(`Observed by ${note.observer.kind}${note.observer.session ? ` (${note.observer.session})` : ""}.`);
}

/** One `by model: a 3, b 1` line, or an empty string when nothing was counted. */
function countLine(label: string, counts: Array<{ value: string; count: number }> | undefined): string {
  if (!counts?.length) return "";
  return `${label}: ${counts.slice(0, 6).map((item) => `${item.value} ${item.count}`).join(", ")}`;
}

/** Shortens one quoted stretch for a listing row. */
function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Prints `tangent style` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(styleCommandSpec));
  console.log(`
Examples:
  tangent style add otto/tangent/design-scene-generation.md "Three clauses before the subject." --quote "Because the pipeline resolves each anchor" --tag buried-lede
  tangent style list --area otto/tangent
  tangent style list --json
  tangent style show 0f3a1c2d
`);
}
