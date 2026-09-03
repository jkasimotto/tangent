// The name pills drawn over every visible Area, their runtime facts, and the
// accessible names shared with the Outline rows.

import type { Count, Index } from "../units/units.ts";

/** The fold state as the accessible name says it. */
export type FoldWord = "folded" | "unfolded";

/** The runtime verbs an Area pill can open in Work. */
export type RuntimeVerb = "work" | "for-you" | "problems";

/** The words for one Area label pill. */
export const AREA_LABELS = {
  /** Excalidraw's name for the canvas. */
  canvasName: "Area map",
  /** The accessible name of the layer that holds every pill. */
  ancestryName: "Complete Area hierarchy",
  /** The visible leaf name of an Area whose key is empty. */
  areaFallback: "Area",
  /** The separator between titled ancestors in a full Area path. */
  pathSeparator: " / ",
  /** The parent word for an Area at the root of the map. */
  mapRoot: "map root",
  folded: "folded · Space",
  unreadable: "map file unreadable",
  loadFailed: "load failed · click to retry",
  ready: "Ready",
  lastKnown: "Last known",
  lastKnownFacts: "last known facts",
  /** The block count under a pill whose Area is not shown in detail. */
  blockSummary(blocks: Count): string { return `${blocks} blocks`; },
  /** "3 blocks" or "1 block", for accessible names. */
  blockCount(blocks: Count): string { return `${blocks} ${blocks === 1 ? "block" : "blocks"}`; },
  /** The accessible name of the runtime facts group under one pill. */
  runtimeGroupName(areaName: string): string { return `${areaName} runtime`; },
  /** One runtime fact: "2 working", "1 for you", "3 problems". */
  working(value: Count): string { return `${value} working`; },
  /** One runtime fact: how many Goals wait for Julian. */
  forYou(value: Count): string { return `${value} for you`; },
  /** One runtime fact: how many problems, singular when one. */
  problems(value: Count): string { return `${value} ${value === 1 ? "problem" : "problems"}`; },
  /** The Work surface a runtime verb opens. */
  verbSurface(verb: RuntimeVerb): string { return verb === "work" ? "Work" : verb === "for-you" ? "For you" : "Problems"; },
  /** The accessible name of one runtime fact button. */
  runtimeActionName(verb: RuntimeVerb, areaName: string, fact: string): string { return `Open ${this.verbSurface(verb)} for ${areaName}: ${fact}`; },
  /** The accessible name of an Area pill or Outline row: name, parent, depth, fold, load state, blocks, then runtime words. */
  accessibleName(parts: { name: string; parent: string; depth: Index; fold: FoldWord; shardState: string; blocks: Count; runtimeWords: readonly string[] }): string {
    const runtime = parts.runtimeWords.length ? `, ${parts.runtimeWords.join(", ")}` : "";
    return `${parts.name}, child of ${parts.parent}, depth ${parts.depth + 1}, ${parts.fold}, ${parts.shardState}, ${this.blockCount(parts.blocks)}${runtime}`;
  },
} as const;
