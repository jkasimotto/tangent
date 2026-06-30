import type { UsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";

export type NativeLogKind = "codex.rollout" | "claude.conversation" | "gemini.chat";

export type NativeSchemaCompatibilityStatus =
  | "compatible"
  | "unknown-newer"
  | "unknown-older"
  | "unknown"
  | "no-native-logs";

export type NativeVersionRange = {
  min?: string;
  max?: string;
};

export type NativeSchemaDescriptor = {
  id: string;
  provider: UsageProvider;
  logKind: NativeLogKind;
  versionRanges: NativeVersionRange[];
  observedFrom: string;
  variants: string[];
  notes: string[];
};

export type NativeRecordVariant = {
  key: string;
  count: number;
};

export type NativeLogInspection = {
  path: string;
  provider?: UsageProvider;
  logKind?: NativeLogKind;
  recordCount: number;
  parseErrors: Array<{ line: number; message: string }>;
  producerHints: {
    versions: Array<string | number>;
    models: string[];
    origins: string[];
    sources: string[];
  };
  variants: NativeRecordVariant[];
};

export type NativeVersionCompatibility = {
  version: string | number;
  status: Exclude<NativeSchemaCompatibilityStatus, "no-native-logs">;
  schemaId?: string;
  message: string;
};

export type NativeProviderSchemaStatus = {
  provider: UsageProvider;
  logKind: NativeLogKind;
  files: number;
  records: number;
  parseErrors: number;
  observedVersions: Array<string | number>;
  compatibility: NativeSchemaCompatibilityStatus;
  messages: string[];
  versions: NativeVersionCompatibility[];
  matchedSchemaIds: string[];
};

export type NativeSchemaStatusOptions = {
  repo: string;
  providers?: UsageProvider[];
};

