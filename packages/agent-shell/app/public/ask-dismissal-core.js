export const ASK_DISMISSALS_SCHEMA = "agent-shell.ask-dismissals.v1";
export const ASK_DISMISSALS_KEY = ASK_DISMISSALS_SCHEMA;

/** Keeps only non-empty string identities in deterministic order. */
export function normalizeDismissedAskIds(ids) {
  return [...new Set(Array.from(ids ?? []).filter((id) => typeof id === "string").map((id) => id.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

/** Reads one versioned set of dismissed attention events. */
export function readDismissedAskIds(storage) {
  try {
    const record = JSON.parse(storage?.getItem(ASK_DISMISSALS_KEY) || "null");
    if (record?.schema !== ASK_DISMISSALS_SCHEMA || !Array.isArray(record.ids)) return new Set();
    return new Set(normalizeDismissedAskIds(record.ids));
  } catch {
    return new Set();
  }
}

/** Writes the complete dismissal set. An empty set removes the record. */
export function writeDismissedAskIds(storage, ids) {
  const normalized = normalizeDismissedAskIds(ids);
  try {
    if (normalized.length) storage?.setItem(ASK_DISMISSALS_KEY, JSON.stringify({ schema: ASK_DISMISSALS_SCHEMA, ids: normalized }));
    else storage?.removeItem(ASK_DISMISSALS_KEY);
    return true;
  } catch {
    return false;
  }
}
