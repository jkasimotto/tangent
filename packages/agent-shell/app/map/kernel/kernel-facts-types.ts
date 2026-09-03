// The typed shapes of the kernel's facts: what the Resources projection reports, what a Block
// resolves to, the actions a Block can run, the picker's choices, Find's rows, the keyboard
// context, the kinds catalog, and the icon files a projection needs. These are read by the surfaces and by the
// controller's fact methods. Like `kernel-world-types.ts`, nothing here exists at runtime.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type { Brand } from "../units/brand.ts";
import type { AreaKey, ResourceId, RuntimeId, ShardOwner, SourceId } from "../units/ids.ts";
import type { Count } from "../units/units.ts";
import type { BlockChoice, EpochMilliseconds, ImagePixels, SceneElement, ShardHash, TangentMeta, TreeDigest, VaultDocument, WorldDigest } from "./kernel-world-types.ts";

/** The complete identity of one Resource: the Area whose catalog holds it and its opaque id there. */
export type ResourceLocator = { owner: ShardOwner; id: ResourceId };

/** The one string that joins a locator without path ambiguity, as `resourceLocatorKey` mints it. */
export type ResourceLocatorKey = Brand<string, "ResourceLocatorKey">;

/** The thing a Resource record points at: a path on this machine or a URL. */
export type ResourceTarget = { kind: string; path?: string; url?: string };

/** One problem a projection read hit, coded so `copy.ts` can name it. */
export type ProjectionError = {
  code: string;
  owner?: ShardOwner;
  source?: string;
  message?: string;
  retryable?: boolean;
};

/** The state of a cached observation of one target. */
export type ObservationState = "current" | "checking" | "not-checked" | "last-known" | "unavailable";

/** One cached look at a target, never a refresh. `V` is what the look found: a local checkout or a provider lifecycle. */
export type ResourceObservation<V = unknown> = {
  state: ObservationState;
  value: V | null;
  checkedAt: string | null;
  error?: ProjectionError;
};

/** What a local look at a path found: whether it is a worktree, which checkout it holds, and which repository owns it. */
export type LocalObservationValue = {
  state: "available" | "missing" | "not-a-worktree" | string;
  checkout?: { kind: string; head?: string; branchRef?: string } | null;
  repositoryPath?: string | null;
  dirty?: boolean;
};

/** What a provider reported about a link: its state in words, its treatment, and when the provider last changed it. */
export type ProviderLifecycleValue = {
  stateLabel: string;
  treatment?: string;
  providerUpdatedAt?: string;
};

/** The provider record of a link Resource. A generic link has no lifecycle. */
export type ResourceLink = {
  kind: string;
  lifecycle?: ResourceObservation<ProviderLifecycleValue> | null;
  [field: string]: unknown;
};

/** One identity warning the catalog records on a Resource: another record may point at the same place. */
export type ResourceWarning = {
  kind: "path-alias" | "cross-kind-target" | string;
  other?: { id?: ResourceId; owner?: ShardOwner } | null;
};

/** Where a Resource came from when it was imported from an Area note's legacy binding. */
export type ResourceOrigin = {
  kind: "legacy-area-binding" | string;
  field?: string;
  evidenceHash?: string;
  declaredBranch?: string | null;
};

/** How one Resource shows on the Map: placed, hidden, or never placed. */
export type ResourceRepresentation = "on-map" | "hidden" | "never-placed";

/** The catalog-backed entity of one Resource. A gone Resource carries `reason` and its last known facts. */
export type ResourceEntity = {
  locator: ResourceLocator;
  label: string;
  target: ResourceTarget | null;
  representation: ResourceRepresentation | { state: "current"; value: ResourceRepresentation } | { state: "unavailable"; error?: ProjectionError };
  origin?: ResourceOrigin | null;
  warnings?: ResourceWarning[];
  local?: ResourceObservation<LocalObservationValue> | null;
  link?: ResourceLink | null;
  reason?: "removed" | "missing-record";
  lastKnown?: { label: string; target: ResourceTarget | null } | null;
};

/** The state of one Resource read: current, gone, being checked, or unavailable. */
export type ResourceResolutionState = "current" | "gone" | ObservationState;

/** One Resource's resolved facts as the controller installs them and `resolveMapEntity` reads them. */
export type ResourceResolution = {
  state: ResourceResolutionState;
  value: ResourceEntity | null;
  checkedAt?: string | null;
  locator?: ResourceLocator;
  error?: ProjectionError;
};

/** How one row relates to the Area it is viewed from: its own, inherited from an ancestor, or removed. An inherited row names the ancestor. */
export type ResourceRelation = { kind: "direct" | "inherited" | string; from?: ShardOwner; sourceArea?: ShardOwner };

/** Whether the Resource is the one the Area note launches from. */
export type LaunchMatch = { state: "current"; value: boolean } | { state: "unavailable"; error: ProjectionError };

/** One row of the Resources panel. */
export type ResourcePanelRow = {
  viewedFrom: AreaKey;
  relation: ResourceRelation;
  alsoFrom?: ShardOwner[];
  launchMatch: LaunchMatch;
  entity: ResourceEntity;
};

/** The evidence a Suggestion or a legacy candidate carries, which a mutation sends back unchanged so the server can check it did not move. */
export type SuggestionEvidence = {
  target?: ResourceTarget;
  evidence?: unknown;
  evidenceHash?: string;
  targetFingerprint?: string;
};

/** One legacy declaration the Area note still carries, reviewed for the Add-back flow. */
export type LegacyReviewRow = SuggestionEvidence & {
  state: "candidate" | "invalid" | string;
  owner: ShardOwner;
  field: string;
  message?: string;
  proposedLabel?: string;
  declaredBranch?: string | null;
};

/** A Resource the note's knowledge suggests but the catalog does not hold. */
export type ResourceSuggestion = SuggestionEvidence & {
  owner: ShardOwner;
  kind?: string;
  proposedLabel?: string;
  provenanceLabel?: string;
};

/** The revision of one Area's catalog, which a mutation names so the server refuses a write over a catalog that changed. */
export type ResourceCatalogRevision = { owner: ShardOwner; revision: string };

/** The complete Resources panel contract the server serves for one Area. */
export type ResourcePanelProjection = {
  state: "current" | "partial" | "unavailable";
  viewedFrom?: AreaKey;
  rows: ResourcePanelRow[];
  legacyReview: LegacyReviewRow[];
  suggestions: ResourceSuggestion[];
  catalogs?: ResourceCatalogRevision[];
  counts?: unknown;
  problems?: { key?: string; code?: string; message?: string; value?: { kind: string; error?: ProjectionError } }[];
  error?: ProjectionError;
};

/** One shard rewritten by a Resource transaction, installed as authority without a Map history entry. */
export type ResourceSourceUpdate = {
  owner: ShardOwner;
  hash: ShardHash;
  serializedSource: string;
  treeRevision?: TreeDigest;
  worldRevision?: WorldDigest;
};

/** The source identity of one Block: its shard and its id there. */
export type EntitySource = { owner: ShardOwner; sourceId: SourceId };

/** What a resolved Block refers to. */
export type EntityReference =
  | { kind: "resource"; resource: ResourceLocator }
  | { kind: "link"; url: string }
  | { kind: "vault"; entityKind: string; ref: string };

/** The one action a Block click or verb runs. Every kind is an existing Map action. */
export type MapEntityAction =
  | { kind: "copy-path"; path: string; resource: ResourceLocator | null }
  | { kind: "copy-url"; url: string }
  | { kind: "open-url"; url: string; targetLabel: string; resource: ResourceLocator | null }
  | { kind: "details"; resource: ResourceLocator }
  | { kind: "open-document"; file: string; subpath?: string; mode: "open" | "read" }
  | { kind: "open-goal"; file: string }
  | { kind: "open-area-brain"; area: AreaKey };

/** What running an action produced. A blocked clipboard or popup hands back what the person can do by hand. */
export type MapEntityActionResult =
  | { kind: "done" }
  | { kind: "unavailable" }
  | { kind: "clipboard-blocked"; copy: { kind: "path" | "url"; value: string } }
  | { kind: "popup-blocked"; url: string; targetLabel: string };

/** Whether the thing a Block names still exists. */
export type EntitySourceState = "current" | "gone" | "unresolved" | string;

/** The words a Block shows and reads out. */
export type MapEntityDisplay = {
  kindLabel: string;
  label: string;
  targetClue: string;
  stateText: string[];
  externalTreatment: string | null;
  actionLabel: string | null;
};

/** The exhaustive browser model of one Block: its reference, its words, its actions and its state. */
export type MapEntityFacts = {
  source: EntitySource;
  reference: EntityReference;
  kindId: string;
  states: string[];
  display: MapEntityDisplay;
  accessibleName: string;
  searchText: string;
  primaryAction: MapEntityAction | null;
  readAction: MapEntityAction | null;
  sourceState: EntitySourceState;
};

/** What `resolveMapEntity` reads: a composed element, or the explicit source and reference of one. */
export type ResolveMapEntityInput = {
  element?: SceneElement | null;
  tangent?: TangentMeta | null;
  source?: EntitySource | null;
  owner?: ShardOwner;
  sourceId?: SourceId;
  kinds?: MapKindsCatalog | null;
  resource?: ResourceResolution | null;
  resolution?: ResourceResolution | null;
  documents?: VaultDocument[];
  sha?: string;
};

/** The browser effects an action may use, injectable so tests never touch the real clipboard or window. */
export type MapEntityEffects = {
  clipboard?: Pick<Clipboard, "writeText"> | null;
  openWindow?: Window["open"] | null;
};

/** One record of the vault index as the picker reads it. */
export type VaultIndexItem = {
  kind: string;
  area?: AreaKey;
  ref?: string;
  file?: string;
  title?: string;
  name?: string;
  subject?: string;
  url?: string;
  status?: string;
  goal?: boolean;
  verify?: boolean;
  changedAt?: EpochMilliseconds;
  at?: EpochMilliseconds;
};

/** One choice the picker offers, with the section it sits in. */
export type PickerChoice = BlockChoice & { section: string; changedAt: EpochMilliseconds };

/** One titled group of picker choices. */
export type PickerSection = { title: string; choices: PickerChoice[] };

/** The facts about the target Area the contextual picker adds sections from. */
export type PickerTargetFacts = {
  placedChildren?: AreaKey[];
  commits?: { sha: string; at: EpochMilliseconds; title?: string; subject?: string }[];
  links?: { url: string; title?: string }[];
};

/** The facts about the scene the picker reads: which child Areas already have a region. */
export type PickerSceneFacts = { placedChildren?: AreaKey[] };

/** An Area as Find searches it. */
export type FindAreaInput = { name: string; path: AreaKey; depth?: Count };

/** A loaded Block as Find searches it. */
export type FindBlockInput = {
  kind: string;
  name: string;
  area: AreaKey;
  elementId: RuntimeId;
  key?: string;
  hidden?: boolean;
};

/** One Find result: an Area row sorts before every Block row. */
export type FindRow =
  | { kind: "area"; key: string; name: string; area: AreaKey; depth: Count; hidden: false }
  | (FindBlockInput & { key: string; depth: Count });

/** The facts `resolveKeyboardContext` reads instead of DOM nodes. */
export type KeyboardContextFacts = {
  goTo?: boolean;
  modal?: boolean;
  documentPeek?: boolean;
  session?: boolean;
  focusPicker?: boolean;
  transient?: boolean;
  textEntry?: boolean;
  view?: string;
};

/** The one visible surface that owns a keyboard event. */
export type KeyboardContext = "modal" | "go-to" | "session" | "document-peek" | "transient" | "focus-picker" | "text-entry" | "work" | "document" | "screen";

/** The parts of a keyboard event the composition check reads. */
export type ComposingKeyboardEvent = { isComposing?: boolean; key?: string };

/** One image file entry a projection's figure icons need registered with Excalidraw. */
export type FigureIconFile = Pick<BinaryFileData, "id" | "mimeType" | "dataURL" | "created">;

/** The target type one Map kind resolves to. */
export type MapKindTarget = "path" | "url" | "vault";
/** The link providers Tangent recognises. */
export type MapKindProvider = "github-pr" | "phabricator-revision";

/** One entry of Julian's `map-kinds.md`, parsed and checked. A kind with problems falls back to a card. */
export type MapKindEntry = {
  id: string;
  label: string;
  target: MapKindTarget;
  provider: MapKindProvider | null;
  builtIn: boolean;
  icon: string | null;
  icons: { when: string; icon: string }[];
  click: string | null;
  problems: string[];
};

/** An icon drawn as an Excalidraw scene, normalised to its own origin. */
export type MapDrawingIcon = {
  name: string;
  kind: "drawing";
  width: ImagePixels;
  height: ImagePixels;
  elements: ExcalidrawElement[];
  elementCount: Count;
  warning: string | null;
};

/** An icon supplied as an image file, carried as a data URL. */
export type MapImageIcon = {
  name: string;
  kind: "image";
  mimeType: string;
  dataURL: string;
  width: ImagePixels;
  height: ImagePixels;
  contentHash: string;
  warning: string | null;
};

/** One icon of the kinds catalog. */
export type MapIcon = MapDrawingIcon | MapImageIcon;

/** One problem the kinds reader found in the definition or an icon file. */
export type MapKindsProblem = { scope: "definition" | "icon"; name: string | null; message: string };

/** The Map kinds catalog the server serves: the kinds, their icons, and its revision for a cheap no-op re-read. */
export type MapKindsCatalog = {
  revision: string;
  kinds: MapKindEntry[];
  icons: Record<string, MapIcon>;
  problems: MapKindsProblem[];
  error?: string;
};
