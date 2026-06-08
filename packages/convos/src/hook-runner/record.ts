import { eventFileForConversation, rawHookFileForSession, repoHash } from "../core/paths.js";
import { appendJsonl } from "../core/append-jsonl.js";
import { repoInfo } from "@tangent/repo";
import { defaultRedaction, redactUnknown } from "../core/redaction.js";
import type { CaptureScope, ConvosProvider, RawHookLineV1 } from "../core/schema/convos-jsonl-v1.js";
import { normalizeHookInput } from "./normalize-hook-input.js";
import { readGlobalConfig, trackingDecision } from "./tracking-policy.js";

export type RecordHookOptions = {
  provider: ConvosProvider;
  scope: CaptureScope;
  repoRoot?: string;
  stdin?: string;
};

export async function recordHook(options: RecordHookOptions): Promise<number> {
  if (process.env.CONVOS_DISABLE_CAPTURE === "1") return 0;

  const stdin = options.stdin ?? await readStdin();
  const input = JSON.parse(stdin || "{}") as Record<string, unknown>;
  const cwd = options.repoRoot || (typeof input.cwd === "string" ? input.cwd : process.cwd());
  const repo = await repoInfo(cwd);
  const root = repo.root || repo.cwd;
  const config = await readGlobalConfig();
  const tracking = await trackingDecision(root, options.provider);
  if (!tracking.enabled) return 0;

  const contentMode = config.capture.contentMode || defaultRedaction.contentMode;
  const redaction = {
    ...defaultRedaction,
    contentMode,
    redactSecrets: config.capture.redactSecrets ?? true,
    maxToolResponseBytes: config.capture.maxToolResponseBytes || defaultRedaction.maxToolResponseBytes
  };
  const sessionId = String(input.session_id || "unknown");
  const rawLine: RawHookLineV1 = {
    schema: "convos.raw-hook.v1",
    provider: options.provider,
    session_id: sessionId,
    recorded_at: new Date().toISOString(),
    capture: {
      scope: options.scope,
      content_mode: contentMode
    },
    repo: {
      root,
      root_hash: repoHash(root),
      cwd: typeof input.cwd === "string" ? input.cwd : repo.cwd
    },
    raw: redactUnknown(input, redaction)
  };
  await appendJsonl(rawHookFileForSession(root, options.provider, sessionId), rawLine);

  const events = normalizeHookInput(input, {
    provider: options.provider,
    scope: options.scope,
    repo,
    tracking,
    redaction,
    convosVersion: "0.1.0"
  });

  const conversation = events[0]?.conversation.id || `${options.provider}:unknown`;
  const filePath = eventFileForConversation(root, options.provider, conversation);
  for (const event of events) await appendJsonl(filePath, event);
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
