import { eventFileForConversation } from "../core/paths.js";
import { appendJsonl } from "../core/append-jsonl.js";
import { repoInfo } from "../core/repo.js";
import { defaultRedaction } from "../core/redaction.js";
import type { CaptureScope, ConvosProvider } from "../core/schema/convos-jsonl-v1.js";
import { normalizeHookInput } from "./normalize-hook-input.js";
import { readGlobalConfig } from "./tracking-policy.js";

export type RecordHookOptions = {
  provider: ConvosProvider;
  scope: CaptureScope;
  stdin?: string;
};

export async function recordHook(options: RecordHookOptions): Promise<number> {
  if (process.env.CONVOS_DISABLE_CAPTURE === "1") return 0;

  const stdin = options.stdin ?? await readStdin();
  const input = JSON.parse(stdin || "{}") as Record<string, unknown>;
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const repo = await repoInfo(cwd);
  const root = repo.root || repo.cwd;
  const config = await readGlobalConfig();

  const contentMode = config.capture.contentMode || defaultRedaction.contentMode;
  const events = normalizeHookInput(input, {
    provider: options.provider,
    scope: options.scope,
    repo,
    tracking: { enabled: true, source: trackingSourceForScope(options.scope) },
    redaction: {
      ...defaultRedaction,
      contentMode,
      redactSecrets: config.capture.redactSecrets ?? true,
      maxToolResponseBytes: config.capture.maxToolResponseBytes || defaultRedaction.maxToolResponseBytes
    },
    convosVersion: "0.1.0"
  });

  const conversation = events[0]?.conversation.id || `${options.provider}:unknown`;
  const filePath = eventFileForConversation(root, options.provider, conversation);
  for (const event of events) await appendJsonl(filePath, event);
  return 0;
}

function trackingSourceForScope(scope: CaptureScope): "global-default" | "repo-local" | "repo-shared" {
  if (scope === "repo-local" || scope === "repo-shared") return scope;
  return "global-default";
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
