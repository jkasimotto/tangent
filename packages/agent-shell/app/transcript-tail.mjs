import { open, stat } from "node:fs/promises";
import path from "node:path";
import { expandHome, findCodexRollouts } from "./harness-conversation.mjs";

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

/** Resolves and reads the transcript for one recorded harness conversation. */
export async function observeTranscript({ harness, conversation, cwd, startedAt } = {}) {
  if (!harness?.transcripts || !conversation?.id) return null;
  const provider = String(conversation.provider ?? harness.id ?? "");
  let transcriptPath = null;
  if (provider.startsWith("claude")) {
    transcriptPath = path.join(expandHome(harness.transcripts), claudeProjectKey(cwd), `${conversation.id}.jsonl`);
  } else if (provider.startsWith("codex")) {
    const found = await findCodexRollouts({ transcripts: harness.transcripts, cwd, startedAt });
    transcriptPath = found.find((item) => item.id === conversation.id)?.transcriptPath ?? null;
  } else if (provider === "pi" || provider === "pi-code") {
    transcriptPath = path.join(expandHome(harness.transcripts), `${conversation.id}.jsonl`);
  }
  if (!transcriptPath) return null;
  try {
    const parsed = parseTranscriptTail(provider, await readTranscriptTail(transcriptPath));
    return parsed ? { ...parsed, path: transcriptPath, provider } : null;
  } catch {
    return null;
  }
}

/** Encodes a cwd the same way Claude names its projects folder. */
function claudeProjectKey(cwd) {
  return String(cwd ?? "").replace(/[/.]/g, "-");
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
