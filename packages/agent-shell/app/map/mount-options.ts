// What the host hands the Map when it mounts it, and what the Map hands back.
//
// `public/area-board.js` and the browser suites both call `mountAreaBoardEditor(host, options)`.
// This file is the typed shape of that one contract: the world options for the composed Map, the
// legacy options for the format-2 rollback editor, and the bridge of sixteen functions the host
// keeps a reference to. Nothing here has behaviour; `index.tsx` implements the bridge and
// `MapRoot.tsx` fills it in.

import type { AppState } from "@excalidraw/excalidraw/types";
import type {
  AreaMapController, CapturedView, CommandDirection, ComposedScene, ControllerEvent, Focus, MapEntityAction, MapEntityFacts, NavigationNotice, SaveResult,
  SaveState, SceneAppState, SceneElement, ShardLoadResult, Snapshot, SourceScene, StoredView, VaultDocument, World, WorldCommand, WorldDigest,
} from "./kernel/kernel-types.ts";
import type { ResourceApi } from "./surfaces/resources/resources-effects.ts";
import type { AreaKey, ShardOwner } from "./units/ids.ts";
import type { Milliseconds } from "./units/units.ts";

/** What the shell's header is told each time the Map's own view changes. */
export type ViewStateNotice = {
  readonly locatedArea: AreaKey;
  readonly selectedArea: AreaKey | "";
  readonly restrictionArea: AreaKey | null;
  readonly findOpen: boolean;
  readonly nextEscape: string;
};

/** The verb the shell runs for a Block or an Area: open Work, read a Document, enter a Goal. */
export type EntityVerbRequest = {
  readonly kind: "area" | "goal" | "document";
  readonly area?: AreaKey;
  readonly ref: string;
  readonly verb: string;
};

/** The vault search the host offers the wide picker. */
export type VaultSearchOption = (query: string, options: { signal: AbortSignal }) => Promise<readonly VaultDocument[] | null | undefined>;

/** The options the host passes for the composed Area Map. Only `world` or `controller` is required. */
export type WorldMountOptions = {
  readonly legacy?: false | undefined;
  readonly world?: World;
  /** The controller the host already built. When absent the Map builds its own and owns its life. */
  readonly controller?: AreaMapController;
  readonly scene?: SourceScene;
  readonly focus?: Focus;
  readonly getDocuments?: () => VaultDocument[];
  readonly searchDocuments?: VaultSearchOption;
  readonly api?: ResourceApi;
  readonly loadShard?: (area: AreaKey, context: { locatedArea: AreaKey; worldRevision: WorldDigest }) => Promise<ShardLoadResult>;
  readonly reloadWorld?: (request: { locatedArea: AreaKey; owners: ShardOwner[] }) => Promise<World>;
  readonly persistWorld?: (world: World, changedAreas: Set<AreaKey>, changedOwners: Set<ShardOwner>, command: WorldCommand, direction: CommandDirection) => Promise<SaveResult> | SaveResult;
  readonly onWorldChange?: (world: World, changedAreas: Set<AreaKey>, changedOwners: Set<ShardOwner>, command: WorldCommand, direction: CommandDirection) => Promise<SaveResult> | SaveResult;
  readonly persistView?: (view: StoredView) => unknown;
  readonly onBack?: () => void;
  readonly onNavigation?: (notice: NavigationNotice) => void;
  readonly onEvent?: (event: ControllerEvent) => void;
  readonly onEntityVerb?: (request: EntityVerbRequest) => void;
  readonly onEntityAction?: (action: MapEntityAction, entity: MapEntityFacts) => void;
  readonly onViewState?: (notice: ViewStateNotice) => void;
  readonly onEditorError?: (error: unknown) => void;
  /** How often resource facts are re-read. The host omits it for the default; a test fixture shortens it. */
  readonly resourceCadenceMs?: Milliseconds;
};

/** The options the host passes for the format-2 rollback editor. */
export type LegacyMountOptions = {
  readonly legacy: true;
  readonly area: AreaKey;
  readonly scene?: SourceScene;
  readonly onBack?: () => void;
  readonly onSceneChange?: (scene: SourceScene) => void;
  readonly onSaveNow?: () => unknown;
  readonly onRetry?: () => unknown;
  readonly initialSaveState?: SaveState;
  readonly onEditorError?: (error: unknown) => void;
};

/** Either shape the host may mount. */
export type MountOptions = WorldMountOptions | LegacyMountOptions;

/** True when the host asked for the format-2 rollback editor. */
export function isLegacyMount(options: MountOptions): options is LegacyMountOptions {
  return options.legacy === true;
}

/**
 * The functions React installs on the shared bridge object. Every one is null until the mounted
 * component fills it in, which is why `index.tsx` guards each call: the host may hold the bridge
 * before React has committed.
 */
export type AreaBoardBridge = {
  current: () => SourceScene | ComposedScene | { elements: readonly SceneElement[]; appState: Partial<SceneAppState>; files: Record<string, never> };
  rendered: () => readonly SceneElement[] | null;
  appState: () => Readonly<AppState> | null;
  controller: AreaMapController | null;
  fitArea: ((area: AreaKey, settings?: { push?: boolean; select?: boolean }) => SceneElement | null) | null;
  navigateArea: ((area: AreaKey, settings?: { push?: boolean; select?: boolean }) => SceneElement | null) | null;
  selectArea: ((area: AreaKey) => SceneElement | null) | null;
  openFind: (() => void) | null;
  toggleRestriction: ((area?: AreaKey) => unknown) | null;
  escape: (() => unknown) | null;
  flush: (() => unknown) | null;
  setSaveState: ((state: SaveState) => void) | null;
  refreshFacts: ((documentsOrFocus?: unknown, maybeFocus?: Focus) => unknown) | null;
  setFocus: ((focus: Focus | null) => unknown) | null;
  reload: (() => unknown) | null;
  keepMine: (() => unknown) | null;
  captureView: (() => CapturedView | null) | null;
  restoreView: ((value: Partial<CapturedView>) => Snapshot | null) | null;
  moveFocus: (() => boolean) | null;
};

/** The bridge before React has installed anything on it. */
export function emptyBridge(scene: SourceScene | undefined): AreaBoardBridge {
  return {
    /** Returns the bootstrap scene until React installs the world bridge. */
    current: () => scene ?? { elements: [], appState: {}, files: {} },
    /** Returns no runtime elements until Excalidraw installs its bridge. */
    rendered: () => null,
    /** Returns no app state until Excalidraw installs its live bridge. */
    appState: () => null,
    controller: null,
    fitArea: null, navigateArea: null, selectArea: null, openFind: null, toggleRestriction: null,
    escape: null, flush: null, setSaveState: null, refreshFacts: null, setFocus: null,
    reload: null, keepMine: null, captureView: null, restoreView: null, moveFocus: null,
  };
}
