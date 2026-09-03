// The one esbuild entry of the Map: `mountAreaBoardEditor(host, options)`.
//
// The host and the browser suites import this from `/agent-shell-map.js`. It mounts one React root
// inside an error boundary, so a render failure stays visible and can be tried again, and it hands
// back the bridge of sixteen functions the host holds. The bridge object is filled in by React and
// read through here, because the host may call a bridge function before React has committed.
//
// The stylesheet imports are here because esbuild emits one `agent-shell-map.css` beside the bundle
// from whatever the entry pulls in; `public/area-board.js` waits for that file before it mounts.

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./ui/tokens.css";
import "./ui/layers.css";
import "./ui/map.css";
import { EDITOR_BOUNDARY, INTERNAL_ERRORS } from "./copy.ts";
import { LegacyAreaCanvas } from "./legacy/LegacyAreaCanvas.tsx";
import { MapRoot } from "./MapRoot.tsx";
import { emptyBridge, isLegacyMount } from "./mount-options.ts";
import type { AreaBoardBridge, MountOptions, WorldMountOptions } from "./mount-options.ts";
import type { CapturedView, Focus, SaveState, SceneElement } from "./kernel/kernel-types.ts";
import { Button } from "./ui/Button.tsx";
import { count } from "./units/units.ts";
import type { Count } from "./units/units.ts";
import type { AreaKey } from "./units/ids.ts";

(globalThis as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/agent-shell-map-assets/";

/** What the error boundary renders around. */
type BoundaryProps = {
  readonly host: HTMLElement;
  readonly bridge: AreaBoardBridge;
  readonly options: MountOptions;
  readonly onError: ((error: unknown) => void) | undefined;
};

/** What the error boundary is showing: a failure, and how many times the person retried. */
type BoundaryState = {
  readonly error: unknown;
  readonly retry: Count;
};

/** Keeps an editor render failure visible and lets the person try the mount again. */
class AreaMapErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  /** Starts with no failure and no retries. */
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null, retry: count(0) };
  }

  /** Converts a descendant render failure into visible boundary state. */
  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error, retry: count(0) };
  }

  /** Reports the failure after React commits the fallback. */
  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError?.(error);
  }

  /** Renders the Map, the rollback editor, or an actionable visible error. */
  override render(): ReactNode {
    const { host, bridge, options } = this.props;
    const failure = this.state.error ?? missingWorld(options);
    if (failure !== null) return <EditorFailure error={failure} onRetry={() => this.setState((state) => ({ error: null, retry: count(state.retry + 1) }))} />;
    if (isLegacyMount(options)) return <LegacyAreaCanvas key={this.state.retry} host={host} bridge={bridge} options={options} />;
    return <MapRoot key={this.state.retry} host={host} bridge={bridge} options={options} />;
  }
}

/** The failure a mount with neither a world nor a controller starts in, or null. */
function missingWorld(options: MountOptions): Error | null {
  if (isLegacyMount(options)) return null;
  const world = options as WorldMountOptions;
  return world.world === undefined && world.controller === undefined ? new Error(INTERNAL_ERRORS.worldUnavailable) : null;
}

/** The visible error the boundary shows instead of the Map. */
function EditorFailure({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }): ReactNode {
  return (
    <section className="area-board-empty" role="alert">
      <h2>{EDITOR_BOUNDARY.heading}</h2>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      <Button onActivate={onRetry}>{EDITOR_BOUNDARY.retry}</Button>
    </section>
  );
}

/** The bridge object the host holds: every function guarded, because React fills them in later. */
function hostBridge(bridge: AreaBoardBridge, unmount: () => void): Record<string, unknown> {
  return {
    /** Returns the current complete-world scene. */
    current: () => bridge.current(),
    /** Returns the elements Excalidraw holds now. */
    rendered: (): readonly SceneElement[] | null => bridge.rendered(),
    /** Returns Excalidraw's current application state. */
    appState: () => bridge.appState(),
    /** Fits one Area without replacing the mounted world. */
    fitArea: (area: AreaKey, settings?: { push?: boolean; select?: boolean }) => bridge.fitArea?.(area, settings) ?? null,
    /** Fits one Area and retargets an active restriction. */
    navigateArea: (area: AreaKey, settings?: { push?: boolean; select?: boolean }) => bridge.navigateArea?.(area, settings) ?? null,
    /** Selects one Area without fitting it. */
    selectArea: (area: AreaKey) => bridge.selectArea?.(area) ?? null,
    /** Opens the Map-owned Area finder. */
    openFind: () => bridge.openFind?.(),
    /** Toggles the ancestor-and-descendant restriction. */
    toggleRestriction: (area?: AreaKey) => bridge.toggleRestriction?.(area),
    /** Runs the Map's Escape order and reports what it closed. */
    escape: () => bridge.escape?.(),
    /** Waits for pending world persistence. */
    flush: () => bridge.flush?.(),
    /** Reflects direct-shard save state in the rollback editor. */
    setSaveState: (state: SaveState) => bridge.setSaveState?.(state),
    /** Refreshes facts or reconciles a changed Area tree. */
    refreshFacts: (documentsOrFocus?: unknown, maybeFocus?: Focus) => bridge.refreshFacts?.(documentsOrFocus, maybeFocus),
    /** Changes the rendering-only Focus mask. */
    setFocus: (focus: Focus | null) => bridge.setFocus?.(focus),
    /** Reloads current world authority after a conflict. */
    reload: () => bridge.reload?.(),
    /** Rebases and retries the conflicted local command. */
    keepMine: () => bridge.keepMine?.(),
    /** Returns the installed browser world controller. */
    controller: () => bridge.controller,
    /** Captures the Map's private view for an exact temporary return. */
    captureView: (): CapturedView | null => bridge.captureView?.() ?? null,
    /** Puts back a captured view. */
    restoreView: (value: Partial<CapturedView>) => bridge.restoreView?.(value) ?? null,
    /** Moves browser focus onto the canvas. */
    focus: () => bridge.moveFocus?.() ?? false,
    /** Unmounts the persistent editor island. */
    destroy: unmount,
  };
}

/** Mounts the one complete-world React editor island. */
export function mountAreaBoardEditor(host: HTMLElement, options: MountOptions): Record<string, unknown> {
  const bridge = emptyBridge(options.scene);
  const root = createRoot(host);
  root.render(<AreaMapErrorBoundary host={host} bridge={bridge} options={options} onError={options.onEditorError} />);
  return hostBridge(bridge, () => root.unmount());
}
