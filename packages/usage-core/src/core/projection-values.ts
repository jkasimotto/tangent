// Leaf value/text/id helpers used across the projection pipeline. Extracted from projections.ts to
// keep that file under the governance size limit. These depend only on schema types and node:crypto,
// never on projections.ts, so there is no import cycle.
import { createHash } from "node:crypto";

import type { UsageEventV3, UsageSession } from "../schema/index.js";

/** Returns the best timestamp for ordering and displaying an event. */
export function eventTime(event: UsageEventV3 | undefined): string | undefined {
  return event?.observedAt || event?.recordedAt || event?.time?.startedAt;
}

/** Computes a non-negative duration between ISO timestamps. */
export function durationBetween(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return undefined;
  return Math.max(0, ended - started);
}

/** Reads full text when available, falling back to preview text. */
export function textValue(event: UsageEventV3 | undefined): string | undefined {
  return event?.data.text || event?.data.textPreview;
}

/** Reads provider preview text or builds one from full text. */
export function textPreview(event: UsageEventV3 | undefined): string | undefined {
  return event?.data.textPreview || preview(event?.data.text);
}

/** Compacts a string into a single-line preview. */
export function preview(value: unknown, length = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > length ? `${singleLine.slice(0, length - 1)}...` : singleLine;
}

/** Builds a preview for string or JSON-serializable values. */
export function previewUnknown(value: unknown, length = 1000): string | undefined {
  if (typeof value === "string") return preview(value, length);
  if (value === undefined) return undefined;
  return preview(JSON.stringify(value), length);
}

/** Hashes a value into a deterministic identifier. */
export function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Creates an empty session count object. */
export function emptyCounts(): UsageSession["counts"] {
  return { turns: 0, messages: 0, userMessages: 0, assistantMessages: 0, toolCalls: 0, subagents: 0, compactions: 0, filesTouched: 0 };
}
