/**
 * Allocates one bounded tmux session name while preserving semantic suffixes.
 *
 * The caller supplies an already-normalized base and suffix. Retry suffixes
 * reserve their space before truncation, so every candidate differs even when
 * the base already fills tmux's name budget.
 */
export function uniqueSessionName(base, suffix, liveNames, maxLength = 60) {
  const names = liveNames instanceof Set ? liveNames : new Set(liveNames);
  const candidate = boundedSessionName(base, suffix, maxLength);
  if (!names.has(candidate)) return candidate;
  const attempts = names.size + 2;
  for (let attempt = 2; attempt <= attempts; attempt += 1) {
    const retried = boundedSessionName(base, `${suffix}-r${attempt}`, maxLength);
    if (!names.has(retried)) return retried;
  }
  throw new Error(`could not allocate a tmux session name after ${attempts} bounded attempts`);
}

/** Truncates the base before appending a suffix that must remain visible. */
export function boundedSessionName(base, suffix, maxLength = 60) {
  if (!Number.isInteger(maxLength) || maxLength < 8) throw new Error("session name limit must be at least 8 characters");
  const tail = String(suffix ?? "");
  if (tail.length >= maxLength) throw new Error("session name suffix exceeds its length limit");
  return `${String(base ?? "").slice(0, maxLength - tail.length)}${tail}`;
}
