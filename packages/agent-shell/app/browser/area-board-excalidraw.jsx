import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./area-board-excalidraw.css";
import { AreaMapWorld } from "./area-map-world.jsx";
import boardCore from "../public/area-board-core.js";

globalThis.EXCALIDRAW_ASSET_PATH = "/agent-shell-map-assets/";

/** Renders one rollback-window format-2 shard without composing world authority. */
function LegacyAreaCanvas({ host, bridge, options }) {
  const [api, setApi] = useState(null);
  const [save, setSave] = useState(options.initialSaveState ?? { state: "saved" });
  const sceneRef = useRef(structuredClone(options.scene ?? boardCore.createEmptyScene()));
  const fingerprintRef = useRef(boardCore.authoredFingerprint(sceneRef.current.elements));
  const textEditRef = useRef(null);

  /** Publishes one settled direct-shard edit outside Excalidraw's text store callback. */
  const publish = (elements, appState) => {
    const fingerprint = boardCore.authoredFingerprint(elements);
    if (fingerprint === fingerprintRef.current) return;
    fingerprintRef.current = fingerprint;
    const next = boardCore.sceneForSave(elements, appState);
    sceneRef.current = next;
    options.onSceneChange?.(structuredClone(next));
  };

  useEffect(() => {
    bridge.setSaveState = setSave;
    bridge.current = () => sceneRef.current;
    bridge.appState = () => api?.getAppState?.() ?? null;
    bridge.escape = () => options.onBack?.();
    bridge.flush = () => {
      if (textEditRef.current) {
        const buffered = textEditRef.current; textEditRef.current = null;
        publish(buffered.elements, api?.getAppState?.() ?? {});
      }
      return options.onSaveNow?.();
    };
    bridge.refreshFacts = () => false;
    bridge.setFocus = () => false;
    bridge.fitArea = () => null;
    return () => {
      bridge.setSaveState = null;
      bridge.escape = null;
      bridge.flush = null;
    };
  }, [api]);

  useEffect(() => {
    /** Leaves the rollback editor through the same map-local Escape boundary. */
    const keydown = (event) => {
      if (event.key !== "Escape") return;
      if (api?.getAppState?.().editingTextElement) return;
      const selected = api?.getAppState?.().selectedElementIds ?? {};
      if (Object.values(selected).some(Boolean)) return;
      event.preventDefault(); event.stopPropagation(); options.onBack?.();
    };
    host.addEventListener("keydown", keydown, true);
    return () => host.removeEventListener("keydown", keydown, true);
  }, [api]);

  return <div className="TangentAreaMap theme--dark" data-tangent-area-map={options.area} data-tangent-area-map-legacy="format-2">
    <Excalidraw
      initialData={sceneRef.current}
      excalidrawAPI={setApi}
      theme="dark"
      name={`${options.area.split("/").at(-1)} map`}
      autoFocus
      handleKeyboardGlobally={false}
      UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } }}
      onChange={(elements, appState) => {
        if (appState.editingTextElement) {
          textEditRef.current = { editingId: appState.editingTextElement.id, elements: structuredClone(elements) };
          sceneRef.current = boardCore.sceneForSave(elements, appState);
          return;
        }
        let settled = elements;
        if (textEditRef.current) {
          const buffered = textEditRef.current; textEditRef.current = null;
          const latest = buffered.elements.find((element) => element.id === buffered.editingId);
          if (latest) {
            settled = structuredClone(elements);
            const index = settled.findIndex((element) => element.id === buffered.editingId);
            if (index < 0) settled.push(latest);
            else if (!settled[index].isDeleted) settled[index] = latest;
          }
        }
        publish(settled, appState);
      }}
    />
    <button type="button" className="tangent-map-escape" onClick={() => options.onBack?.()}>Esc → Work</button>
    <div className={`tangent-map-save ${save.state}`} role="status">
      {save.state === "saving" ? "Saving…" : save.state === "blocked" || save.state === "conflict" ? <>Not saved <button type="button" onClick={() => options.onRetry?.()}>Retry</button></> : "Saved"}
    </div>
  </div>;
}

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
    const error = this.state.error ?? (!options.legacy && !options.world && !options.controller ? new Error("The complete Area-map world is unavailable") : null);
    if (!error) return options.legacy
      ? <LegacyAreaCanvas key={this.state.retry} {...this.props.mapProps} />
      : <AreaMapWorld key={this.state.retry} {...this.props.mapProps} />;
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
    reload: null, keepMine: null, controller: null, setSaveState: null,
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
    /** Reflects direct-shard save state in the rollback editor. */
    setSaveState: (state) => bridge.setSaveState?.(state),
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
