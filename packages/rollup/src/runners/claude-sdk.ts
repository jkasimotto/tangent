import type { RollupInput, RollupOutput } from "../types/digest.js";
import type { RunnerStatus, SummaryProviderConfig, SummaryRunner } from "../types/provider.js";
import { rollupPrompt } from "../core/prompts.js";
import { stripMarkdownFence } from "@tangent/agent-runtime/process";

type ClaudeSdkConfig = Extract<SummaryProviderConfig, { kind: "claude-sdk" }>;

export class ClaudeSdkSummaryRunner implements SummaryRunner {
  id = "claude-sdk";
  kind = "claude-sdk" as const;

  constructor(private readonly config: ClaudeSdkConfig) {}

  /** Checks whether the Claude SDK can be imported and queried. */
  async checkAvailable(): Promise<RunnerStatus> {
    try {
      const sdk = await importClaudeSdk();
      const models = await getSupportedModels(sdk);
      return { available: true, authStatus: "unknown", supportedModels: models, warnings: [] };
    } catch (error) {
      return { available: false, authStatus: "unknown", warnings: [(error as Error).message] };
    }
  }

  /** Runs one Claude SDK rollup request and parses the generated JSON output. */
  async summarizeRollup(input: RollupInput): Promise<RollupOutput> {
    const sdk = await importClaudeSdk();
    const chunks: string[] = [];
    const query = sdk.query({
      prompt: rollupPrompt({ period: input.period, inputJson: JSON.stringify(input), purpose: input.purpose }),
      options: {
        model: this.config.model,
        maxTurns: 1,
        settingSources: [],
        allowedTools: [],
        disallowedTools: ["Bash", "Read", "Write", "Edit"]
      }
    });
    for await (const message of query) collectText(message, chunks);
    const text = chunks.join("\n").trim();
    if (!text) throw new Error("Claude SDK returned empty output.");
    return normalizeRollup(JSON.parse(stripMarkdownFence(text)) as unknown);
  }
}

type ClaudeSdkModule = {
  query: (args: unknown) => AsyncIterable<unknown> & { supportedModels?: () => Promise<string[]> | string[] };
};

/** Imports the optional Claude SDK dependency without making it a hard startup requirement. */
async function importClaudeSdk(): Promise<ClaudeSdkModule> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return await dynamicImport("@anthropic-ai/claude-agent-sdk") as ClaudeSdkModule;
}

/** Reads supported model names from the SDK when the installed version exposes them. */
async function getSupportedModels(sdk: ClaudeSdkModule): Promise<string[] | undefined> {
  const maybeQuery = sdk.query({ prompt: "", options: { maxTurns: 0, settingSources: [] } });
  if (typeof maybeQuery.supportedModels !== "function") return undefined;
  const result = await maybeQuery.supportedModels();
  return Array.isArray(result) ? result : undefined;
}

/** Collects text-like fields from SDK streaming messages. */
function collectText(message: unknown, chunks: string[]): void {
  if (!message || typeof message !== "object") return;
  const record = message as Record<string, unknown>;
  for (const key of ["text", "result", "content"]) {
    const value = record[key];
    if (typeof value === "string") chunks.push(value);
    if (Array.isArray(value)) {
      for (const part of value) {
        if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
          chunks.push((part as Record<string, string>).text);
        }
      }
    }
  }
}

/** Converts a runner JSON payload into the rollup output contract. */
function normalizeRollup(value: unknown): RollupOutput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    schema: "rollup.output.v1",
    markdown: typeof record.markdown === "string" ? record.markdown : typeof record.generatedMarkdown === "string" ? record.generatedMarkdown : "",
    sourceCaveats: stringArray(record.sourceCaveats)
  };
}

/** Keeps only string entries from an unknown array-like field. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
