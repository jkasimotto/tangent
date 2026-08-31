/** Builds the shared response for a user-visible Work mutation. */
export function mutationResult(operationId, target, state, effect, extra = {}) {
  return {
    operationId: String(operationId ?? "").slice(0, 128),
    target,
    state,
    effect,
    retryable: state === "cleanup-pending",
    ...extra,
  };
}
