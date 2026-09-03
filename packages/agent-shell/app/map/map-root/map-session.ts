// The Map's mutable session state, in one object with named fields.
//
// The old component kept sixty refs. Everything that is not React state and not owned by another
// module lives here instead: the Excalidraw api, the Space flag, the last pointer point, the
// claimed identities of elements Excalidraw minted during a command, the paste and text placement
// windows, the non-pointer command word, and the openers focus returns to. `MapRoot.tsx` builds one
// with `useRef` and hands it to every hook, so a handler reads what is true now rather than what
// was true when its closure was made.

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { AuthoredFingerprint, ComposedOrigin, GestureKind, Selection, World } from "../kernel/kernel-types.ts";
import type { Point } from "../units/frames.ts";
import type { RuntimeId, ShardOwner } from "../units/ids.ts";
import type { Count } from "../units/units.ts";
import { count } from "../units/units.ts";
import type { SurfaceId } from "../surfaces/surface-registry.ts";

/** Where a paste asked its elements to land, and which Area owns them. */
export type PastePlacement = {
  readonly point: Point<"scene">;
  readonly area: ShardOwner;
};

/** The one open non-pointer command: the word it records and the world it began from. */
export type NonPointerCommand = {
  readonly kind: GestureKind;
  readonly baseline: World;
};

/** Every mutable field the Map root keeps outside React state. */
export type MapSession = {
  /** Excalidraw's imperative api, or null before it mounts and after it unmounts. */
  api: ExcalidrawImperativeAPI | null;
  /** True while Space is held, which makes the next press a pan. */
  spaceHeld: boolean;
  /** The last scene point the pointer was at, which is where B and paste land. */
  lastPointer: Point<"scene"> | null;
  /** The selection the Map believes is stable, as opposed to what a live drag is showing. */
  stableSelection: Selection;
  /** The selection the Map itself asked for, so an echo of it is not read as a person's change. */
  programmaticSelection: Selection | null;
  /** What the open press grabbed: empty when the press moved nothing of the Map's own. */
  pointerSelected: Selection;
  /** The selection an additive press built, kept until the release settles it. */
  additiveSelection: Selection | null;
  /** The fingerprint of the last scene published or pushed, so an unchanged echo is skipped. */
  fingerprint: AuthoredFingerprint | null;
  /** Excalidraw's temporary ids for elements the Map claimed, mapped to the world ids that replaced them. */
  claimedIds: Map<RuntimeId, RuntimeId>;
  /** The shard each claimed element was given, by every id it has been known under. */
  claimedOrigins: Map<RuntimeId, ComposedOrigin>;
  /** Where a paste landed, cleared once the pasted elements are published. */
  pastePlacement: PastePlacement | null;
  /** Where the text tool pressed, so the text element it creates lands in that Area. */
  textPlacement: Point<"scene"> | null;
  /** The word the next non-pointer publish records, set by the key that caused it. */
  actionKind: GestureKind | null;
  /** The open non-pointer command, or null. */
  nonPointer: NonPointerCommand | null;
  /** The token that supersedes a scheduled non-pointer settle. */
  nonPointerSettle: Count;
  /** True once the Area-outline protection has been announced for the current command. */
  outlineProtectionAnnounced: boolean;
  /** True until Excalidraw has settled the scene it mounted with. */
  initializing: boolean;
  /** The control focus returns to when a surface closes, by surface. */
  openers: Map<SurfaceId, HTMLElement | null>;
  /** The projection key of the placement preview last drawn, so it is redrawn only when it moved. */
  placementProjection: string;
};

/** Builds the session every field of which is empty, which is the state between commands. */
export function createMapSession(): MapSession {
  return {
    api: null,
    spaceHeld: false,
    lastPointer: null,
    stableSelection: new Set<RuntimeId>(),
    programmaticSelection: null,
    pointerSelected: new Set<RuntimeId>(),
    additiveSelection: null,
    fingerprint: null,
    claimedIds: new Map(),
    claimedOrigins: new Map(),
    pastePlacement: null,
    textPlacement: null,
    actionKind: null,
    nonPointer: null,
    nonPointerSettle: count(0),
    outlineProtectionAnnounced: false,
    initializing: true,
    openers: new Map(),
    placementProjection: "",
  };
}
