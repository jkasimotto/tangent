import { repoInfo } from "@tangent/repo";

import type { UsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { discoverClaudeNative } from "../claude/native/discover.js";
import { discoverCodexNative } from "../codex/native/discover.js";
import { discoverGeminiNative } from "../gemini/native/discover.js";
import { aggregateCompatibility, compatibilityForVersion } from "./schema-registry.js";
import { inspectNativeLogFile } from "./inspect.js";
import type {
  NativeLogInspection,
  NativeProviderSchemaStatus,
  NativeSchemaStatusOptions,
  NativeVersionCompatibility
} from "./types.js";

/** Returns schema compatibility status for each provider's native logs in the given repo. */
export async function nativeSchemaStatus(options: NativeSchemaStatusOptions): Promise<NativeProviderSchemaStatus[]> {
  const providers = options.providers?.length ? options.providers : ["claude", "codex", "gemini"] as UsageProvider[];
  const info = await repoInfo(options.repo);
  const root = info.root || info.cwd;
  const result: NativeProviderSchemaStatus[] = [];

  for (const provider of providers) {
    const files = provider === "claude"
      ? await discoverClaudeNative(root)
      : provider === "gemini"
        ? await discoverGeminiNative(root)
        : await discoverCodexNative(root);
    result.push(await nativeProviderSchemaStatus(provider, files));
  }

  return result;
}

/** Builds a schema status summary for one provider by inspecting its native log files. */
async function nativeProviderSchemaStatus(provider: UsageProvider, files: string[]): Promise<NativeProviderSchemaStatus> {
  if (!files.length) {
    return {
      provider,
      logKind: nativeLogKind(provider),
      files: 0,
      records: 0,
      parseErrors: 0,
      observedVersions: [],
      compatibility: "no-native-logs",
      messages: [`No ${providerLabel(provider)} native logs found for this repo.`],
      versions: [],
      matchedSchemaIds: []
    };
  }

  const inspections = await Promise.all(files.map((file) => inspectNativeLogFile(file)));
  const observedVersions = distinctValues(inspections.flatMap((inspection) => inspection.producerHints.versions));
  const versions = observedVersions.map((version) => compatibilityForVersion(provider, version));
  const compatibility = aggregateCompatibility(versions);
  const messages = versions.length
    ? versions.map((version) => version.message)
    : [`${providerLabel(provider)} native logs found, but provider version could not be detected; parsing will be permissive.`];
  return {
    provider,
    logKind: provider === "claude" ? "claude.conversation" : "codex.rollout",
    files: files.length,
    records: sum(inspections.map((inspection) => inspection.recordCount)),
    parseErrors: sum(inspections.map((inspection) => inspection.parseErrors.length)),
    observedVersions,
    compatibility: versions.length ? compatibility : "unknown",
    messages,
    versions,
    matchedSchemaIds: distinctStrings(versions.map((version) => version.schemaId).filter(Boolean)),
  };
}

/** Inspects multiple native log files and returns their structural summaries. */
export async function inspectNativeLogFiles(files: string[]): Promise<NativeLogInspection[]> {
  return Promise.all(files.map((file) => inspectNativeLogFile(file)));
}

/** Returns deduplicated and sorted string-or-number values, preserving the original type. */
function distinctValues(values: Array<string | number>): Array<string | number> {
  return [...new Map(values.map((value) => [String(value), value])).values()]
    .sort((left, right) => String(left).localeCompare(String(right)));
}

/** Returns deduplicated and sorted strings from the input array, omitting undefined values. */
function distinctStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

/** Returns the sum of a number array. */
function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Returns the native log kind string for the given provider. */
function nativeLogKind(provider: UsageProvider): NativeProviderSchemaStatus["logKind"] {
  if (provider === "claude") return "claude.conversation";
  if (provider === "gemini") return "gemini.chat";
  return "codex.rollout";
}

/** Returns a human-readable label for the given provider. */
function providerLabel(provider: UsageProvider): string {
  if (provider === "claude") return "Claude Code";
  if (provider === "gemini") return "Gemini CLI";
  return "Codex";
}

