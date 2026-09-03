// The Block picker dialog.

import type { KeyedText } from "./keyed-text.ts";
import { key } from "./keyed-text.ts";
import type { Representation } from "./resources-panel.ts";

/** The words of the Block picker. */
export const PICKER = {
  name: "Place a Tangent block",
  wholeVault: "Place from the whole vault",
  outsideEveryArea: "Outside every Area",
  placeholder: "Resource, Goal, Document, Area, or URL",
  otherBlocks: "Other Blocks",
  /** The status of a picker choice built from a resource row. */
  placementStatus(representation: Representation): string {
    return representation === "on-map" ? "On Map" : representation === "hidden" ? "Hidden" : representation === "never-placed" ? "Never placed" : "Map unavailable";
  },
  /** The heading when the picker targets one Area, by its leaf name. */
  placeIn(areaLeaf: string): string { return `Place in ${areaLeaf}`; },
  /** The group heading over the resource choices of the target Area. */
  resourcesIn(areaName: string): string { return `Resources in ${areaName}`; },
  /** The accessible name of a resource choice: its facts, then its Map state. */
  resourceChoiceName(accessibleName: string, representation: Representation): string { return `${accessibleName}. ${this.placementStatus(representation)}.`; },
  /** The separator between state words in a choice's status line. */
  statusSeparator: " · ",
  /** The key line under the list; Tab reads differently once the whole vault is shown. */
  keys(wide: boolean): KeyedText {
    return [key("Tab"), " ", wide ? "return here" : "whole vault", " · ", key("Enter"), " place · ", key("⇧Enter"), " place another · ", key("Esc"), " close"];
  },
} as const;
