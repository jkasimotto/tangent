// The Tangent command reference that the brain prompt carries.
//
// The reference is generated from the installed CLI's own `--help` output at
// prompt time, never hand-copied into prose. A brain that reads a stale command
// list guesses syntax and fails; reading the live CLI keeps the reference
// correct on its own whenever the CLI changes.

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

/** The nouns a brain issues. `tangent send brain` is the worker's route, not the brain's. */
export const BRAIN_COMMAND_NOUNS = ["area", "brain", "goal", "document", "agent", "idea", "vault", "shell", "harness"];

/**
 * The built CLI entry the `tangent` binary on this machine links to. Tests and
 * other checkouts can point at another build with TANGENT_CLI_ENTRY.
 */
export function defaultCliEntry(env = process.env) {
  return env.TANGENT_CLI_ENTRY || path.resolve(here, "../../../dist/cli/index.js");
}

/**
 * Reads one noun's `--help` into its description and subcommand signatures.
 * The shape is the CLI's own help layout: a name line, a description, then a
 * `Commands:` block of two-space indented `signature  description` rows.
 */
export function parseCommandHelp(text) {
  const lines = String(text ?? "").split("\n");
  const start = lines.indexOf("Commands:");
  const head = lines.slice(1, start < 0 ? lines.length : start)
    .map((line) => line.trim())
    .filter((line) => line && line !== "Options:");
  const subcommands = [];
  for (let index = start + 1; start >= 0 && index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) break;
    if (!line.startsWith("  ")) break;
    const row = line.slice(2);
    const gap = row.search(/\s{2,}/);
    const signature = (gap < 0 ? row : row.slice(0, gap)).trim();
    if (signature) subcommands.push({ signature, description: gap < 0 ? "" : row.slice(gap).trim() });
  }
  return { description: head[0] ?? "", subcommands };
}

/** One reference line per noun: what the noun is for, then every installed subcommand signature. */
export function renderCommandReference(nouns) {
  return nouns
    .filter((noun) => noun.subcommands.length)
    .map((noun) => `- \`tangent ${noun.name}\` (${noun.description}): ${noun.subcommands.map((item) => item.signature).join(" | ")}`)
    .join("\n");
}

let cached = null;

/**
 * The generated reference block, or null when the CLI is not built and the
 * prompt has to fall back to bare discovery. Cached against the CLI file's
 * modification time, so a rebuilt CLI regenerates it and an unchanged one
 * costs nothing.
 */
export async function installedCommandReference(options = {}) {
  const cli = options.cli ?? defaultCliEntry(options.env ?? process.env);
  if (!existsSync(cli)) return null;
  let stamp;
  try {
    stamp = `${cli}:${statSync(cli).mtimeMs}`;
  } catch {
    return null;
  }
  if (cached?.stamp === stamp) return cached.text;
  const nouns = await Promise.all(BRAIN_COMMAND_NOUNS.map(async (name) => {
    try {
      const { stdout } = await execFileAsync(process.execPath, [cli, name, "--help"], { env: options.env ?? process.env });
      return { name, ...parseCommandHelp(stdout) };
    } catch {
      return { name, description: "", subcommands: [] };
    }
  }));
  const text = renderCommandReference(nouns);
  if (!text) return null;
  cached = { stamp, text };
  return text;
}
