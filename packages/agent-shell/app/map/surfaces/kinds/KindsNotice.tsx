// The Map kinds notice: a polite status island that lists every problem the kinds reader found,
// one line each, so a broken kind definition is visible on the Map instead of silently falling
// back to a card. It renders nothing when there is nothing to say.

import type { ReactNode } from "react";
import { KINDS } from "../../copy.ts";
import type { MapKindsCatalog } from "../../kernel/kernel-types.ts";
import { kindsProblemLines } from "./kinds-lines.ts";

export type KindsNoticeProps = {
  readonly catalog: MapKindsCatalog | null;
};

/** The kinds problems as one live status region, or nothing when the catalog is clean. */
export function KindsNotice({ catalog }: KindsNoticeProps): ReactNode {
  const lines = kindsProblemLines(catalog);
  if (lines.length === 0) return null;
  return (
    <div className="tangent-map-kinds" role="status" aria-live="polite" aria-label={KINDS.statusName}>
      {lines.map((line) => <span key={line.key}>{line.text}</span>)}
    </div>
  );
}
