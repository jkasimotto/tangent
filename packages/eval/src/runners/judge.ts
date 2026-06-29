import { processFailure, runProcess } from "@tangent/agent-runtime/process";

/** Pulls the final stream-json `result` event text out of the judge process stdout. */
export function extractResultText(stdout: string): string {
  let resultText = "";
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try { event = JSON.parse(trimmed); } catch { continue; }
    if (event.type === "result" && typeof event.result === "string") resultText = event.result;
  }
  return resultText;
}

/**
 * One non-interactive judge call: prompt in, result text out. Reuses the claude `--print` stream-json
 * path the agent runner uses, but emits no telemetry and runs no tools; it exists so the evaluator can
 * score a variant with a model distinct from the agent under test.
 */
export async function runJudge(args: {
  model: string; prompt: string; cwd: string; env: NodeJS.ProcessEnv;
  command?: string; timeoutMs?: number; signal?: AbortSignal;
}): Promise<string> {
  const command = args.command || "claude";
  const result = await runProcess({
    command,
    args: ["--print", "--output-format", "stream-json", "--verbose", "--model", args.model],
    stdin: args.prompt,
    cwd: args.cwd,
    timeoutMs: args.timeoutMs || 600000,
    env: args.env,
    signal: args.signal
  });
  if (result.code !== 0) throw processFailure(command, result.code, result.stderr, result.stdout);
  return extractResultText(result.stdout);
}
