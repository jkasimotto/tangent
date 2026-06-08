import { spawn } from "node:child_process";

export type ProcessRunResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export type RunProcessArgs = {
  command: string;
  args: string[];
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  defaultEnv?: NodeJS.ProcessEnv;
};

export async function runProcess(args: RunProcessArgs): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(args.command, args.args, {
      cwd: args.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...args.defaultEnv,
        ...args.env
      }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = args.timeoutMs ? setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      settled = true;
      reject(new Error(`Command timed out after ${args.timeoutMs}ms: ${args.command}`));
    }, args.timeoutMs) : undefined;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, code });
    });
    if (args.stdin !== undefined) child.stdin.end(args.stdin);
    else child.stdin.end();
  });
}

export function processFailure(command: string, code: number | null, stderr: string, stdout: string): Error {
  return commandFailure(command, code, stderr, stdout, 1600);
}

export function runnerFailure(command: string, code: number | null, stderr: string, stdout: string): Error {
  return commandFailure(command, code, stderr, stdout, 1200);
}

export function parseRunnerJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Summary runner returned empty output.");
  const parsed = JSON.parse(trimmed) as unknown;
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const result = record.result || record.message || record.output || record.content;
    if (typeof result === "string") {
      try {
        return JSON.parse(stripMarkdownFence(result)) as unknown;
      } catch {
        return parsed;
      }
    }
  }
  return parsed;
}

export function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function commandFailure(command: string, code: number | null, stderr: string, stdout: string, maxChars: number): Error {
  const raw = stderr.trim() || stdout.trim() || `${command} exited with code ${code}`;
  return new Error(truncateProcessOutput(raw, maxChars));
}

function truncateProcessOutput(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars - 3)}...` : compact;
}
