// The one import path for every kernel shape. The shapes live in three files so none passes the
// module-size cap: `kernel-world-types.ts` for shards, scenes, elements, the composition and the
// gesture solvers; `kernel-facts-types.ts` for Resources, Block facts, actions, the picker, Find
// and the keyboard context; `kernel-controller-types.ts` for the controller, its snapshot and its
// options. Consumers import from here and never from the three directly.

export type * from "./kernel-controller-types.ts";
export type * from "./kernel-facts-types.ts";
export type * from "./kernel-world-types.ts";
