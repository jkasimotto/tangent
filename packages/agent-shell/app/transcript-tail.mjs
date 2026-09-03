import { open, readFile, stat } from "node:fs/promises";
import { resolveTranscript } from "./harness-transcripts.mjs";

const TAIL_BYTES = 64 * 1024;

/** Reads the last bytes of a transcript without parsing the complete file. */
export async function readTranscriptTail(file, maxBytes = TAIL_BYTES) {
  const info = await stat(file);
  const start = Math.max(0, info.size - maxBytes);
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(info.size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return start ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    await handle.close();
  }
}

/** Reads the last known event and token count for a supported transcript. */
export function parseTranscriptTail(provider, text) {
  const rows = String(text ?? "").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  if (!rows.length) return null;
  if (["claude", "claude-otto"].includes(provider)) return parseClaude(rows);
  if (provider === "pi-code" || provider === "pi") return parsePi(rows);
  if (["codex", "codex-gw"].includes(provider)) return parseCodex(rows);
  return null;
}

/**
 * Resolves and reads the transcript for one recorded harness conversation.
 *
 * The layouts live in `harness-transcripts.mjs`, which is also what the cost
 * path reads, so liveness and cost can no longer disagree about where a
 * harness writes. They used to: this function looked for a pi transcript at
 * `<transcripts>/<id>.jsonl`, which is not where pi writes, so liveness was
 * silently off for every pi attempt ever recorded.
 */
export async function observeTranscript({ harness, conversation, cwd, startedAt } = {}) {
  const resolved = await resolveTranscript({ harness, conversation, cwd, startedAt });
  if (!resolved) return null;
  try {
    const parsed = parseTranscriptTail(resolved.harness, await readTranscriptTail(resolved.path));
    return parsed ? { ...parsed, path: resolved.path, provider: resolved.harness } : null;
  } catch {
    return null;
  }
}

/** Reads the complete first native user message for an exact prompt receipt. */
export async function firstUserMessageReceipt({ harness, conversation, cwd, startedAt, expectedSha256, expectedBytes } = {}) {
  const resolved = await resolveTranscript({ harness, conversation, cwd, startedAt });
  if (!resolved) return { ok: false, reason: "unsupported-or-missing-transcript" };
  let text;
  try { text = await readFile(resolved.path, "utf8"); }
  catch { return { ok: false, reason: "transcript-unavailable" }; }
  const rows = text.split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const message = firstUserMessage(resolved.harness, rows);
  if (message == null) return { ok: false, reason: "first-user-message-unavailable" };
  const bytes = Buffer.byteLength(message);
  const sha256 = (await import("node:crypto")).createHash("sha256").update(message).digest("hex");
  return { ok: sha256 === expectedSha256 && bytes === expectedBytes, sha256, bytes, expectedSha256, expectedBytes, provider: resolved.harness, path: resolved.path, reason: sha256 === expectedSha256 && bytes === expectedBytes ? null : "prompt-mismatch" };
}

/** Extracts the complete first native user message from transcript rows. */
function firstUserMessage(provider, rows) {
  for (const row of rows) {
    let role = row.message?.role ?? row.role ?? row.payload?.role;
    let content = row.message?.content ?? row.content ?? row.payload?.content;
    if (provider.startsWith("codex") && row.type === "response_item" && row.payload?.type === "message") { role = row.payload.role; content = row.payload.content; }
    if (role !== "user") continue;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : item?.text ?? item?.input_text ?? "").join("");
  }
  return null;
}

/** Reads the newest supported Claude transcript event. */
function parseClaude(rows) {
  const event = [...rows].reverse().find((row) => row.timestamp && (row.message?.role || row.type));
  if (!event) return null;
  const usage = event.message?.usage ?? {};
  return {
    lastEventAt: Date.parse(event.timestamp),
    lastEventKind: event.message?.role ?? event.type,
    outputTokens: Number(usage.output_tokens ?? usage.outputTokens ?? 0) || 0,
  };
}

/** Reads the newest supported pi transcript event. */
function parsePi(rows) {
  const event = [...rows].reverse().find((row) => row.timestamp || row.createdAt);
  if (!event) return null;
  const usage = event.usage ?? event.message?.usage ?? {};
  return {
    lastEventAt: Date.parse(event.timestamp ?? event.createdAt),
    lastEventKind: event.role ?? event.type ?? "event",
    outputTokens: Number(usage.output ?? usage.outputTokens ?? 0) || 0,
  };
}

/** Reads the newest supported Codex rollout event. */
function parseCodex(rows) {
  const event = [...rows].reverse().find((row) => row.timestamp && ["event_msg", "response_item"].includes(row.type));
  if (!event) return null;
  const kind = event.payload?.type ?? event.type;
  const usage = event.payload?.usage ?? {};
  return { lastEventAt: Date.parse(event.timestamp), lastEventKind: kind, outputTokens: Number(usage.output_tokens ?? 0) || 0 };
}
