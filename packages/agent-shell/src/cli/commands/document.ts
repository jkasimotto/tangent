import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, requiredString, stringArg, type Args } from "@tangent/core/cli";

import { currentTmuxSession, postJson, resolveServerUrl, vaultFetch } from "../client.js";
import { documentCommandSpec } from "../spec.js";

type DocumentComment = { index: number; author: string; text: string; quote: string | null; line: number };

/**
 * Dispatches `tangent document` subcommands: the agent's lane for Julian's comments inside a
 * vault Document (design contract: otto/tangent/design-comment-on-documents). Comments are
 * CriticMarkup in the Markdown; the server parses them and `resolve` is the only path that
 * removes one, in its own named commit.
 */
export async function runDocumentCli(argv = process.argv.slice(2)): Promise<void> {
  const messageIndex = argv.indexOf("-m");
  const note = messageIndex >= 0 ? argv[messageIndex + 1] ?? "" : "";
  const rest = messageIndex >= 0 ? [...argv.slice(0, messageIndex), ...argv.slice(messageIndex + 2)] : argv;
  const args = parseArgs(rest);
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand === "comments") return commentsCommand(args);
  if (subcommand === "resolve") return resolveCommand(args, note);
  throw new Error(`Unknown document command: ${subcommand}. Try "tangent document comments <file>" or "tangent document resolve <file> \"<first words>\" -m \"<what changed>\"".`);
}

/** Handles `tangent document comments <file>`. */
async function commentsCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const file = requiredString(args._[1], "tangent document comments requires <vault-relative file>.");
  const result = await vaultFetch(server, `/api/document/comments?file=${encodeURIComponent(file)}`);
  const comments = result.comments as DocumentComment[];
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(comments, null, 2));
    return;
  }
  if (!comments.length) {
    console.log(`No open comments in ${file}.`);
    return;
  }
  for (const comment of comments) {
    const where = comment.quote ? `on "${comment.quote}"` : `line ${comment.line + 1}`;
    console.log(`${comment.index + 1}. ${comment.author || "comment"} (${where}): ${comment.text}`);
  }
}

/** Handles `tangent document resolve <file> "<first words>" -m "<what changed>"`. */
async function resolveCommand(args: Args, note: string): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const file = requiredString(args._[1], "tangent document resolve requires <vault-relative file> \"<first words of the comment>\".");
  const prefix = args._.slice(2).join(" ").trim();
  const index = stringArg(args.index) ? Number(stringArg(args.index)) : null;
  if (!prefix && !Number.isInteger(index)) throw new Error("tangent document resolve requires first words or --index <number>.");
  if (!note.trim()) throw new Error("tangent document resolve requires -m \"<what changed>\" so the resolution is recorded.");
  const session = stringArg(args.session) ?? (await currentTmuxSession());
  const result = await postJson(server, "/api/document/resolve", { file, prefix, index, note, session });
  const comment = result.comment as DocumentComment;
  console.log(`resolved: ${comment.text}`);
  console.log(`${result.remaining} open comment${result.remaining === 1 ? "" : "s"} left in ${file}.`);
}

/** Prints `tangent document` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(documentCommandSpec));
  console.log(`
Examples:
  tangent document comments otto/tangent/design-scene-generation.md
  tangent document resolve otto/tangent/design-scene-generation.md "Say why" -m "Added the reason to Principles"
`);
}
