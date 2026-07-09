export type ProgressPayloadLike = {
  phase: string;
  stage?: string;
  step?: string;
  path?: string;
  durationMs?: number;
  stepElapsedMs?: number;
  message?: string;
  level?: "info" | "warning";
};

export type ProgressContextLike<T extends ProgressPayloadLike> = {
  emit: (event: T) => void;
  slowOperationMs: number;
};

/** Emits counter progress. */
export function emitCounterProgress(current: number, total: number, onProgress?: (current: number, total: number) => void): void {
  if (!onProgress || total === 0) return;
  if (current === 1 || current === total || current % 100 === 0) onProgress(current, total);
}

/** Emits slow operation. */
export function emitSlowOperation<T extends ProgressPayloadLike>(progress: ProgressContextLike<T> | undefined, event: T, durationMs: number): void {
  if (!progress || durationMs < progress.slowOperationMs) return;
  progress.emit({
    ...event,
    level: "warning",
    step: "warning",
    durationMs,
    stepElapsedMs: durationMs,
    message: `${event.stage || event.phase} took ${durationMs}ms${event.path ? ` for ${event.path}` : ""}`
  });
}

/** Supports the full index reason helper. */
export function fullIndexReason(options: {
  force: boolean;
  existingSize: number;
  oldVersion: string | undefined;
  currentVersion: string;
  oldInclude: string | undefined;
  includeGenerated: boolean;
  oldLanguages: string | undefined;
  languages: readonly string[];
  oldContext: string | undefined;
  contextSignature: string;
}): string | undefined {
  if (options.force) return "forced";
  if (options.existingSize === 0) return "empty-index";
  if (options.oldVersion !== undefined && options.oldVersion !== options.currentVersion) return "index-version-changed";
  if (options.oldInclude !== undefined && options.oldInclude !== (options.includeGenerated ? "1" : "0")) return "include-generated-changed";
  if (options.oldLanguages !== undefined && options.oldLanguages !== [...options.languages].sort().join(",")) return "languages-changed";
  if (options.oldContext !== undefined && options.oldContext !== options.contextSignature) return "language-context-changed";
  return undefined;
}
