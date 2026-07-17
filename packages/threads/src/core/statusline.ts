import type { NeedsYouEntry, SidecarState } from "./types.js";

/** Compact, truthful summons for shell statuslines: identity + reason, with a visible stale marker. */
export function renderThreadsStatusBadge(sidecar: SidecarState, now = new Date()): string {
  const stale = !sidecar.sweptAt || now.getTime() - new Date(sidecar.sweptAt).getTime() > 60 * 60 * 1000;
  const entries = sidecar.needsYou || [];
  if (!entries.length) return stale ? "threads(stale)" : "";
  const first = entries[0]!;
  const reason = first.reason || inferReason(first);
  const overflow = entries.length - 1;
  return `●${entries.length} ${first.slug}(${reason})${overflow ? ` +${overflow}` : ""}${stale ? " stale" : ""}`;
}

/** Infers a reason class when reading a pre-reason-class sidecar. */
function inferReason(entry: NeedsYouEntry): string {
  if (/landed/i.test(entry.why)) return "landed";
  if (/deadline/i.test(entry.why)) return "deadline";
  if (/check-in/i.test(entry.why)) return "check-in";
  if (/reviewed|staged|verdict/i.test(entry.why)) return "ready";
  if (/question|permission|waiting on you/i.test(entry.why)) return "blocked";
  return "attention";
}
