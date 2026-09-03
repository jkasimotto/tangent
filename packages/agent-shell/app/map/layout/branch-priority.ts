// The branch priority a re-anchored Area sits above.
//
// An Area the layout kernel drew away from its authored rectangle is on a lower branch priority
// than its siblings. When its own content changes, the Map absorbs the position it was drawn at and
// raises its priority above every other Area, so the solver keeps it there instead of snapping it
// back. Two callers need that number, the publish and the picker's placement, so it is named once.

import type { World } from "../kernel/kernel-types.ts";
import { count } from "../units/units.ts";
import type { Count } from "../units/units.ts";

/** The highest branch priority any Area in the world carries now. */
export function highestBranchPriority(world: World): Count {
  let highest = count(0);
  for (const node of world.areas) {
    const value = node.region.layout?.priority;
    if (value !== undefined && Number.isSafeInteger(value) && value >= 0 && value > highest) highest = value;
  }
  return highest;
}

/** The priority a re-anchored Area takes: one above every other Area in the world. */
export function nextBranchPriority(world: World): Count {
  return count(highestBranchPriority(world) + 1);
}
