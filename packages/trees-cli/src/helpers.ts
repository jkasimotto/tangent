import { spawn } from "node:child_process";
import { booleanArg, stringArg, type Args } from "@tangent/core";
import type { Checkpoint, TreeEntity } from "@tangent/trees-schema";

/** Documents the output helper. */
export function output(args: Args, data: unknown, human?: string): void {
  if (booleanArg(args.json)) console.log(JSON.stringify({ schema: "tangent.trees.cli.v1", data }, null, 2));
  else if (human !== undefined) console.log(human);
  else console.log(JSON.stringify(data, null, 2));
}

/** Documents the requiredPos helper. */
export function requiredPos(args: Args, index: number, message: string): string {
  const value = args._[index];
  if (!value) throw new Error(message);
  return value;
}

/** Documents the promptArg helper. */
export async function promptArg(args: Args): Promise<string | undefined> {
  const prompt = stringArg(args.prompt);
  return prompt === "-" ? stdinText() : prompt;
}

/** Documents the stdinText helper. */
export async function stdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** Documents the estimateArg helper. */
export function estimateArg(value: unknown) {
  const text = stringArg(value);
  if (!text) return undefined;
  return { text, minutes: parseDurationMinutes(text), source: "user" as const };
}

/** Documents the outcomeArg helper. */
export function outcomeArg(value: unknown): Checkpoint["outcome"] | undefined {
  const outcome = stringArg(value);
  if (!outcome) return undefined;
  if (outcome === "paused" || outcome === "done" || outcome === "blocked" || outcome === "abandoned" || outcome === "continue") return outcome;
  throw new Error(`Unsupported checkpoint outcome: ${outcome}`);
}

/** Documents the captureIds helper. */
export function captureIds(args: Args): string[] {
  const raw = args["capture-id"];
  if (Array.isArray(raw)) return raw.map(String);
  return typeof raw === "string" ? [raw] : [];
}

/** Documents the providerFromAdapter helper. */
export function providerFromAdapter(adapterId: string): string | undefined {
  if (adapterId.startsWith("codex")) return "codex";
  if (adapterId.startsWith("claude")) return "claude";
  if (adapterId.startsWith("gemini")) return "gemini";
  return undefined;
}

/** Documents the humanEntity helper. */
export function humanEntity(entity: TreeEntity): string {
  return [
    `${entity.path} (${entity.kind})`,
    entity.branch ? `branch: ${entity.branch}` : undefined,
    entity.worktreePath ? `worktree: ${entity.worktreePath}` : undefined,
    entity.description
  ].filter(Boolean).join("\n");
}

/** Documents the humanRows helper. */
export function humanRows(rows: string[]): string {
  return rows.join("\n");
}

/** Spawns a fully detached, fire-and-forget background process (no stdio, survives this CLI exiting). Used to launch the per-run notify watcher. */
export function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

/** Documents the spawnInherited helper. */
export function spawnInherited(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

/** Documents the waitForInterrupt helper. */
export function waitForInterrupt(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    /** Documents the stop helper. */
    const stop = () => void close().finally(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

/** Documents the parseDurationMinutes helper. */
function parseDurationMinutes(text: string): number | undefined {
  const match = text.match(/^(\d+(?:\.\d+)?)(m|h)?$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return match[2] === "h" ? amount * 60 : amount;
}
