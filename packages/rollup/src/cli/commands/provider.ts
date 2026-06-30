import { loadConfig } from "../../core/config.js";
import { createSummaryRunner } from "../../runners/summary-runner.js";
import { sandboxArg, stringArg, summaryProviderArg, type Args } from "../args.js";
import type { SummaryProviderConfig } from "../../types/provider.js";

/** Tests availability or lists models for the configured summary provider. */
export async function providerCommand(args: Args): Promise<void> {
  const subcommand = args._[1] || "test";
  const config = await providerConfig(args);
  const runner = createSummaryRunner(config);
  const status = await runner.checkAvailable();
  if (args.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (subcommand === "models") {
    for (const model of status.supportedModels || []) console.log(model);
    if (!status.supportedModels?.length) console.log("No model list available for this provider.");
    return;
  }
  if (subcommand === "test") {
    console.log(`${config.kind}: ${status.available ? "available" : "unavailable"}`);
    if (status.command) console.log(`command: ${status.command}`);
    if (status.version) console.log(`version: ${status.version}`);
    for (const warning of status.warnings) console.log(`warning: ${warning}`);
    return;
  }
  throw new Error(`Unknown provider command: ${subcommand}`);
}

/** Resolves the summary provider config from CLI args or the repo config. */
async function providerConfig(args: Args): Promise<SummaryProviderConfig> {
  const kind = summaryProviderArg(args.provider);
  const model = stringArg(args.model);
  if (!kind) {
    const loaded = await loadConfig({ repo: stringArg(args.repo) || "." });
    return loaded.config.summary.provider;
  }
  if (kind === "codex-cli") return { kind, command: stringArg(args.command) || "codex", model: model || "gpt-5.4", sandbox: sandboxArg(args.sandbox) || "read-only", timeoutMs: 120000 };
  if (kind === "claude-sdk") return { kind, model: model || "sonnet", timeoutMs: 120000 };
  return { kind, command: stringArg(args.command) || "claude", model: model || "sonnet", timeoutMs: 120000, maxTurns: 2 };
}
