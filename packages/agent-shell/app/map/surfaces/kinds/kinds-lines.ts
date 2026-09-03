// The lines of the Map kinds notice: one per problem the kinds reader found in Julian's
// `map-kinds.md` or its icon files, in the words `copy.ts` gives them. The controller snapshot
// carries the catalog; this module turns its problems into keyed lines so the notice stays thin.

import { KINDS } from "../../copy.ts";
import type { MapKindsCatalog } from "../../kernel/kernel-types.ts";

/** One line of the notice: a stable key for React and the sentence a person reads. */
export type KindsLine = {
  readonly key: string;
  readonly text: string;
};

/** One line per problem, in catalog order. An empty list when there is no catalog or nothing is wrong. */
export function kindsProblemLines(catalog: MapKindsCatalog | null): readonly KindsLine[] {
  return (catalog?.problems ?? []).map((problem, position) => ({
    key: `${problem.scope}:${problem.name ?? position}`,
    text: KINDS.problem(problem.name, problem.message),
  }));
}
