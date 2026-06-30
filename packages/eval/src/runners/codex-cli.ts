import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { EvalAgentConfig } from "../types/provider.js";
import { processFailure, runProcess } from "@tangent/agent-runtime/process";

type CodexConfig = Extract<EvalAgentConfig, { kind: "codex-cli" }>;
type ProcessOutputChunk = { stream: "stdout" | "stderr"; chunk: string };

export async function runCodexCli(args: {
  config: CodexConfig;
  prompt: string;
  cwd: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: ProcessOutputChunk) => void;
}): Promise<string> {
  const command = args.config.command || "codex";
  const tempDir = await mkdtemp(path.join(tmpdir(), "tangent-eval-codex-"));
  const outputPath = path.join(tempDir, "last-message.md");
  try {
    const cliArgs = [
      "exec",
      "--sandbox",
      args.sandbox,
      "--model",
      args.config.model,
      "--output-last-message",
      outputPath
    ];
    if (args.config.profile) cliArgs.push("--profile", args.config.profile);
    cliArgs.push("-");
    const processArgs = {
      command,
      args: cliArgs,
      stdin: args.prompt,
      cwd: args.cwd,
      timeoutMs: args.config.timeoutMs || 1800000,
      env: args.env,
      signal: args.signal,
      onOutput: args.onOutput
    };
    const result = await runProcess(processArgs);
    if (result.code !== 0) throw processFailure(command, result.code, result.stderr, result.stdout);
    return await readFile(outputPath, "utf8").catch(() => result.stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
