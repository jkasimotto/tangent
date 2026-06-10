export { scanRepo, openUsage } from "./scanRepo.js";
export type { ScanRepoOptions } from "./scanRepo.js";
export { archiveUsageTelemetry, ensureUsageIndex, loadUsageDatasetFromIndex, resolveConversationRef } from "./indexStore.js";
export type { ResolvedConversationRef, UsageArchiveOptions, UsageArchiveResult, UsageDatasetQuery, UsageIndexOptions, UsageIndexResult, UsageIndexSource } from "./indexStore.js";
export { status } from "./status.js";
export type { RepoStatus, StatusOptions } from "./status.js";
export { importNative } from "./importNative.js";
export type { ImportNativeOptions, ImportNativeResult } from "./importNative.js";
export { inspectNativeLogFile } from "../providers/native/inspect.js";
export { listNativeSchemas } from "../providers/native/schema-registry.js";
export { nativeSchemaStatus } from "../providers/native/status.js";
export type {
  NativeLogInspection,
  NativeProviderSchemaStatus,
  NativeSchemaCompatibilityStatus,
  NativeSchemaDescriptor,
  NativeSchemaStatusOptions,
  NativeVersionCompatibility,
  NativeVersionRange
} from "../providers/native/types.js";
export { UsageDataset } from "../core/dataset.js";
export type { ActivityTimelineItem, ConversationListItem, ToolCallWithResult, TurnListItem, VisibleMessage } from "../core/dataset.js";
export { conversationReport } from "../core/conversation-report.js";
export type {
  NormalizedConversation,
  NormalizedConversationMessage,
  NormalizedToolCall,
  TokenUsage
} from "../core/conversation-report.js";
export type { UsageCaptureConfidence, UsageJsonlLineV1, UsageJsonlLineV2, UsageProvider, QueryResult, QuerySupport, UsageConfidence } from "../core/schema/usage-jsonl-v1.js";
