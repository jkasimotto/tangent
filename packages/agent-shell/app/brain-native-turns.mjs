import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expandHome, findCodexRollouts } from "./harness-conversation.mjs";

const execFileAsync = promisify(execFile);

/** The explicit phrases that make the complete native user turn durable. */
export function requestsTurnMemory(text) {
  const value = String(text ?? "");
  return /(^|\b)remember this\b/i.test(value) || /^\s*\/remember(?:\s|$)/i.test(value);
}

/** Maps a harness registry id to a Usage native provider when supported. */
export function nativeProviderForHarness(harnessId) {
  const id = String(harnessId ?? "").toLowerCase();
  if (id.startsWith("claude")) return "claude";
  if (id.startsWith("codex")) return "codex";
  if (id.startsWith("gemini")) return "gemini";
  return null;
}

/** Claude's deterministic project-directory encoding for one exact cwd. */
export function claudeTranscriptPath(transcripts, cwd, conversationId) {
  if (!transcripts || !cwd || !conversationId) return null;
  const project = String(cwd).replace(/[/.]/g, "-");
  return path.join(expandHome(transcripts), project, `${conversationId}.jsonl`);
}

/** Finds the concrete transcript owned by one brain generation. */
export async function brainTranscriptPath(generation, harness) {
  if (generation?.transcriptPath) return generation.transcriptPath;
  const provider = nativeProviderForHarness(harness?.id);
  if (provider === "claude") {
    return claudeTranscriptPath(harness.transcripts, generation?.cwd, generation?.providerSession?.id);
  }
  if (provider === "codex") {
    const matches = await findCodexRollouts({ transcripts: harness?.transcripts, cwd: generation?.cwd, startedAt: generation?.startedAt });
    return matches.length === 1 ? matches[0].transcriptPath : null;
  }
  return null;
}

/** Reads normalized messages from one transcript through Usage's provider support. */
export async function readNativeMessages({ transcriptPath, provider, command = process.env.TANGENT_USAGE_CLI || "tangent", run = execFileAsync }) {
  const { stdout } = await run(command, ["usage", "native", "messages", transcriptPath, "--provider", provider, "--json"], {
    timeout: 10_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed?.data) ? parsed.data : [];
}

/** Native user messages that explicitly request complete-turn storage. */
export function rememberedUserTurns(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === "user" && message.id && typeof message.text === "string" && requestsTurnMemory(message.text))
    .map((message) => ({ id: String(message.id), text: message.text, createdAt: message.createdAt || undefined }));
}

/**
 * Polls only changed brain transcripts. Journal idempotency remains the
 * durable retry fence; this cache only avoids reparsing unchanged files.
 */
export function createRememberedTurnMonitor({ harnessFor, capture, failure, readMessages = readNativeMessages, fileStat = stat, now = Date.now }) {
  const seen = new Map();
  return {
    /** Checks one active brain's current native transcript for saved turns. */
    async check(record) {
      const generation = record?.generations?.findLast?.((entry) => entry.session === record.session) ?? record?.generations?.at?.(-1);
      if (!generation || record.status !== "active") return;
      const harness = await harnessFor(generation.resolvedLaunch?.ref?.harness);
      const provider = nativeProviderForHarness(harness?.id);
      if (!harness || !provider) return;
      const transcriptPath = await brainTranscriptPath(generation, harness);
      if (!transcriptPath) return;
      const info = await fileStat(transcriptPath).catch(() => null);
      if (!info) return;
      const key = `${record.area}:${generation.generation}:${transcriptPath}`;
      const prior = seen.get(key);
      if (prior && prior.mtimeMs === info.mtimeMs && (!prior.retryAt || prior.retryAt > now())) return;
      let retry = false;
      const messages = await readMessages({ transcriptPath, provider });
      for (const turn of rememberedUserTurns(messages)) {
        const result = await capture(record, turn);
        if (result?.route === "not-committed") {
          retry = true;
          await failure(record, turn, result);
        }
      }
      seen.set(key, { mtimeMs: info.mtimeMs, retryAt: retry ? now() + 5_000 : 0 });
    }
  };
}
