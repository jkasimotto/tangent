import React from "react";
import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./area-board-excalidraw.css";
import { AreaMapWorld } from "./area-map-world.jsx";

globalThis.EXCALIDRAW_ASSET_PATH = "/agent-shell-map-assets/";

/** Keeps an editor render failure visible and lets the user try the mount again. */
class AreaMapErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, retry: 0 }; }
  /** Converts a descendant render failure into visible boundary state. */
  static getDerivedStateFromError(error) { return { error }; }
  /** Reports the failure after React commits the fallback. */
  componentDidCatch(error) { this.props.onError?.(error); }
  /** Renders the authoritative world or an actionable visible error. */
  render() {
    const { options } = this.props.mapProps;
    const error = this.state.error ?? (!options.world && !options.controller ? new Error("The complete Area-map world is unavailable") : null);
    if (!error) return <AreaMapWorld key={this.state.retry} {...this.props.mapProps} />;
    return <section className="area-board-empty" role="alert">
      <h2>The complete Area map did not load.</h2>
      <p>{String(error?.message ?? error)}</p>
      <button type="button" onClick={() => this.setState(({ retry }) => ({ error: null, retry: retry + 1 }))}>Retry</button>
    </section>;
  }
}

/** Mounts the one complete-world React editor island. */
export function mountAreaBoardEditor(host, options) {
  const bridge = {
    fitArea: null, selectArea: null, escape: null, flush: null, refreshFacts: null, setFocus: null,
    reload: null, keepMine: null, controller: null,
    /** Returns the supplied empty bootstrap until React installs the world bridge. */
    current: () => options.scene ?? { elements: [], appState: {}, files: {} },
    /** Returns no app state until Excalidraw installs its live bridge. */
    appState: () => null,
  };
  const root = createRoot(host);
  root.render(<AreaMapErrorBoundary mapProps={{ host, bridge, options }} onError={options.onEditorError} />);
  return {
    /** Returns the current complete-world scene. */
    current: () => bridge.current(),
    /** Returns the current Excalidraw application state. */
    appState: () => bridge.appState(),
    /** Fits one Area without replacing the mounted world. */
    fitArea: (area, settings) => bridge.fitArea?.(area, settings),
    /** Selects one Area without fitting it. */
    selectArea: (area) => bridge.selectArea?.(area),
    /** Runs the map-owned Escape order. */
    escape: () => bridge.escape?.(),
    /** Waits for pending world persistence. */
    flush: () => bridge.flush?.(),
    /** Refreshes facts or reconciles a changed Area tree. */
    refreshFacts: (...args) => bridge.refreshFacts?.(...args),
    /** Changes the rendering-only Focus mask. */
    setFocus: (focus) => bridge.setFocus?.(focus),
    /** Reloads current world authority after a conflict. */
    reload: () => bridge.reload?.(),
    /** Rebases and retries the conflicted local command. */
    keepMine: () => bridge.keepMine?.(),
    /** Returns the installed browser world controller. */
    controller: () => bridge.controller,
    /** Unmounts the persistent editor island. */
    destroy: () => root.unmount(),
  };
}
