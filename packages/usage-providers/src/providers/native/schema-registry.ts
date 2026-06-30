import type { UsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import type {
  NativeSchemaCompatibilityStatus,
  NativeSchemaDescriptor,
  NativeVersionCompatibility
} from "./types.js";

export const nativeSchemaDescriptors: NativeSchemaDescriptor[] = [
  {
    id: "codex.rollout.v1",
    provider: "codex",
    logKind: "codex.rollout",
    versionRanges: [{ min: "0.130.0", max: "0.137.0" }],
    observedFrom: "Local inferred Codex rollout JSONL corpus, 2026-06-08.",
    variants: [
      "session_meta",
      "turn_context",
      "response_item:message",
      "response_item:reasoning",
      "response_item:function_call",
      "response_item:function_call_output",
      "event_msg:token_count",
      "event_msg:task_started",
      "event_msg:task_complete",
      "event_msg:user_message",
      "event_msg:agent_message",
      "compacted"
    ],
    notes: [
      "Codex native transcript_path rollout files are higher-signal than hooks, but the format is not a stable hook contract.",
      "Token usage appears in event_msg records where payload.type is token_count."
    ]
  },
  {
    id: "claude.conversation.v1",
    provider: "claude",
    logKind: "claude.conversation",
    versionRanges: [{ min: "2.1.145", max: "2.1.150" }],
    observedFrom: "Local inferred Claude Code project JSONL corpus, 2026-06-08.",
    variants: [
      "user",
      "assistant:message",
      "system",
      "attachment",
      "last-prompt",
      "ai-title",
      "permission-mode",
      "file-history-snapshot"
    ],
    notes: [
      "Claude Code native JSONL includes assistant message usage fields when provider usage is present.",
      "Some older records expose numeric versions; treat those as unknown and parse permissively."
    ]
  },
  {
    id: "gemini.chat.v1",
    provider: "gemini",
    logKind: "gemini.chat",
    versionRanges: [],
    observedFrom: "Local inferred Gemini CLI chat session corpus, 2026-06-30.",
    variants: [
      "session",
      "user",
      "gemini",
      "$set"
    ],
    notes: [
      "Gemini CLI chat sessions are stored as a single JSON document (session-*.json) or as JSONL (session-*.jsonl); both carry a session header plus user and gemini messages.",
      "Native Gemini sessions do not record a CLI version, so version compatibility is reported as unknown and parsing is permissive."
    ]
  }
];

export function listNativeSchemas(provider?: UsageProvider): NativeSchemaDescriptor[] {
  return provider ? nativeSchemaDescriptors.filter((descriptor) => descriptor.provider === provider) : [...nativeSchemaDescriptors];
}

export function compatibilityForVersion(provider: UsageProvider, version: string | number): NativeVersionCompatibility {
  const descriptors = listNativeSchemas(provider);
  if (typeof version === "number") {
    return {
      version,
      status: "unknown",
      message: `${providerLabel(provider)} native log version ${version} is not semver-like; parsing will be permissive.`
    };
  }

  const parsed = parseVersion(version);
  if (!parsed) {
    return {
      version,
      status: "unknown",
      message: `${providerLabel(provider)} native log version ${version} could not be matched; parsing will be permissive.`
    };
  }

  for (const descriptor of descriptors) {
    for (const range of descriptor.versionRanges) {
      if (versionInRange(version, range)) {
        return {
          version,
          status: "compatible",
          schemaId: descriptor.id,
          message: `${providerLabel(provider)} native logs match known schema ${descriptor.id} for ${version}.`
        };
      }
    }
  }

  const allBounds = descriptors.flatMap((descriptor) => descriptor.versionRanges);
  const min = allBounds.map((range) => range.min).filter((value): value is string => Boolean(value)).sort(compareVersions)[0];
  const max = allBounds.map((range) => range.max).filter((value): value is string => Boolean(value)).sort(compareVersions).at(-1);
  if (max && compareVersions(version, max) > 0) {
    return {
      version,
      status: "unknown-newer",
      message: `${providerLabel(provider)} ${version} is newer than Tangent's known native schema range; parsing will be permissive. Upgrade Tangent before relying on native import.`
    };
  }
  if (min && compareVersions(version, min) < 0) {
    return {
      version,
      status: "unknown-older",
      message: `${providerLabel(provider)} ${version} is older than Tangent's known native schema range; parsing will be permissive.`
    };
  }
  return {
    version,
    status: "unknown",
    message: `${providerLabel(provider)} ${version} does not match a known native schema range; parsing will be permissive.`
  };
}

export function aggregateCompatibility(values: NativeVersionCompatibility[]): NativeSchemaCompatibilityStatus {
  if (!values.length) return "unknown";
  if (values.some((value) => value.status === "unknown-newer")) return "unknown-newer";
  if (values.some((value) => value.status === "unknown-older")) return "unknown-older";
  if (values.some((value) => value.status === "unknown")) return "unknown";
  return "compatible";
}

function versionInRange(version: string, range: { min?: string; max?: string }): boolean {
  if (range.min && compareVersions(version, range.min) < 0) return false;
  if (range.max && compareVersions(version, range.max) > 0) return false;
  return true;
}

function compareVersions(left: string, right: string): number {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);
  if (!leftParsed || !rightParsed) return left.localeCompare(right);
  return leftParsed.major - rightParsed.major ||
    leftParsed.minor - rightParsed.minor ||
    leftParsed.patch - rightParsed.patch;
}

function parseVersion(value: string): { major: number; minor: number; patch: number } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function providerLabel(provider: UsageProvider): string {
  if (provider === "claude") return "Claude Code";
  if (provider === "gemini") return "Gemini CLI";
  return "Codex";
}

