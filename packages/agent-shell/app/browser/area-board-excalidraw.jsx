import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./area-board-excalidraw.css";
import core from "../public/area-board-core.js";
import pickerModel from "../public/area-board-picker.js";

globalThis.EXCALIDRAW_ASSET_PATH = "/agent-shell-map-assets/";

/** Consumes a map-local event before the shell keyboard grammar sees it. */
const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
/** Reports whether a keyboard target accepts text input. */
const isTyping = (target) => target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);

/** Keeps an editor render failure visible and lets the user try the mount again. */
class AreaMapErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, retry: 0 }; }
  /** Converts a descendant render failure into visible boundary state. */
  static getDerivedStateFromError(error) { return { error }; }
  /** Reports the failure after React commits the fallback. */
  componentDidCatch(error) { this.props.onError?.(error); }
  /** Renders the editor or its actionable failure state. */
  render() {
    if (!this.state.error) return <TangentMap key={this.state.retry} {...this.props.mapProps} />;
    return <section className="area-board-empty" role="alert">
      <h2>The drawing tools did not load.</h2>
      <p>{String(this.state.error?.message ?? this.state.error)}</p>
      <button type="button" onClick={() => this.setState(({ retry }) => ({ error: null, retry: retry + 1 }))}>Retry</button>
    </section>;
  }
}

/** Returns the selected Tangent block, when selection contains one. */
function selectedBlock(api, scene) {
  const selected = api?.getAppState?.().selectedElementIds ?? {};
  return scene.elements.find((element) => selected[element.id] && !element.isDeleted && core.tangentOf(element) && !core.isAreaBoundary(element)) ?? null;
}

/** Returns the selected unbound text element, when selection contains one. */
function selectedText(api, scene) {
  const selected = api?.getAppState?.().selectedElementIds ?? {};
  return scene.elements.find((element) => selected[element.id] && !element.isDeleted && element.type === "text" && !element.containerId) ?? null;
}

/** Renders Excalidraw with Tangent blocks, verbs, inbox, and outline. */
function TangentMap({ host, bridge, options }) {
  const [api, setApi] = useState(null);
  const [picker, setPicker] = useState(null);
  const [query, setQuery] = useState("");
  const [wide, setWide] = useState(false);
  const [help, setHelp] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [saveState, setSaveState] = useState(options.initialSaveState ?? { state: "saved" });
  const [selectionTick, setSelectionTick] = useState(0);
  const [sceneTick, setSceneTick] = useState(0);
  const [proposals, setProposals] = useState(options.proposals ?? []);
  const [collapsedIds, setCollapsedIds] = useState(options.view?.foldedGroupIds ?? []);
  const [notice, setNotice] = useState("");
  const [recoveredDraft, setRecoveredDraft] = useState(options.recoveredDraft ?? null);
  const [camera, setCamera] = useState({ scrollX: options.scene.appState?.scrollX ?? 0, scrollY: options.scene.appState?.scrollY ?? 0, zoom: options.scene.appState?.zoom?.value ?? 1 });
  const canonicalRef = useRef(core.scopeScene(core.refreshTangentFacts(options.scene, options.getDocuments()).scene, options.area, options.context, options.view));
  const frames = core.ancestryFrames(options.area, options.context, canonicalRef.current);
  const framed = structuredClone(canonicalRef.current);
  framed.elements.unshift(...core.ancestryProjection(frames));
  const spatial = core.projectSpatialChildren(framed, options.area, options.childScenes);
  const initialProjection = core.focusProjection(core.collapseSpatialRegions(spatial.scene, options.view?.foldedGroupIds), options.getDocuments(), options.focus, options.locatedArea);
  const hiddenFocusIdsRef = useRef(initialProjection.hiddenIds);
  const sceneRef = useRef(initialProjection.scene);
  const fingerprintRef = useRef(core.authoredFingerprint(sceneRef.current.elements));
  const viewFingerprintRef = useRef(JSON.stringify(core.viewFromAppState(sceneRef.current.appState, options.view)));
  const pointerRef = useRef(null);
  const projectedRegionFingerprintRef = useRef("");

  const documents = options.getDocuments();
  for (const frame of frames) {
    const document = documents.find((item) => item.kind === "area" && item.area === frame.area);
    if (document?.title) frame.label.name = document.title;
  }
  const targetArea = picker?.area ?? options.area;
  const choices = useMemo(() => wide ? pickerModel.wideChoices(query, documents) : core.entityChoices(targetArea, documents), [wide, query, targetArea, documents, sceneTick]);
  const currentBlock = selectedBlock(api, sceneRef.current);
  const currentText = selectedText(api, sceneRef.current);
  const hiddenBlocks = sceneRef.current.elements.filter((element) => element.isDeleted && core.tangentOf(element));
  const outline = core.sceneOutline(sceneRef.current, documents);
  const located = options.locatedArea === options.area || core.locateAreaBlock(canonicalRef.current, options.locatedArea, documents);
  const locatedDocument = documents.find((item) => item.kind === "area" && item.area === options.locatedArea);
  const locatedChoice = locatedDocument ? { kind: "area", ref: locatedDocument.file, title: locatedDocument.title || options.locatedArea, status: locatedDocument.status || "" } : null;
  const outsideStars = Boolean(options.focus?.only && (options.focus?.areas ?? []).length && !(options.focus.areas ?? []).some((root) => options.locatedArea === root || options.locatedArea?.startsWith(`${root}/`)));

  /** Describes which authoritative files one editor change made dirty. */
  function gestureFor(canonical, previous) {
    const nested = Boolean(options.context?.ancestors?.length);
    const currentCanvas = core.sceneWithoutScopeBoundary(canonical, nested);
    const previousCanvas = core.sceneWithoutScopeBoundary(previous, nested);
    const currentChanged = core.authoredFingerprint(currentCanvas.elements) !== core.authoredFingerprint(previousCanvas.elements);
    const extentWrite = core.scopeExtentGesture(canonical, previous, options.area, options.context);
    if (extentWrite) {
      const parent = options.context.ancestors.at(-1);
      parent.scene = structuredClone(extentWrite.canvas);
      const region = parent.scene.elements.find((element) => element.id === parent.elementId);
      if (region) parent.regionForChild = { x: region.x, y: region.y, width: region.width, height: region.height };
      const boundary = canonical.elements.find((element) => !element.isDeleted && core.isAreaBoundary(element));
      if (boundary) options.onViewChange?.(core.viewFromAppState(api?.getAppState?.(), { ...(options.view ?? {}), foldedGroupIds: collapsedIds, scopeProxy: { x: boundary.x, y: boundary.y } }));
      setNotice(`${frames.find((frame) => frame.area === options.area)?.label.name ?? options.area.split("/").at(-1)} moves inside ${parent.name ?? parent.area.split("/").at(-1)}`);
    }
    return { currentCanvas, currentChanged, extentWrite };
  }

  /** Publishes an authored edit or a non-dirty fact repaint. */
  function publish(next, { authored = true } = {}) {
    if (authored) setRecoveredDraft(null);
    const owned = authored ? core.stripSpatialProjections(next) : next;
    const restored = authored ? core.restoreFocusedElements(owned, canonicalRef.current, hiddenFocusIdsRef.current) : owned;
    const previous = canonicalRef.current;
    const fenced = authored ? core.fenceRegionGeometry(restored, previous, { area: options.area, context: options.context, childScenes: options.childScenes }) : { scene: restored, refused: null };
    const canonical = fenced.scene;
    const gesture = authored ? gestureFor(canonical, previous) : null;
    if (fenced.refused) setNotice(fenced.refused.wall ? `stopped at ${fenced.refused.wall.split("/").at(-1)}` : `stopped at ${fenced.refused.region.split("/").at(-1)}`);
    canonicalRef.current = canonical;
    const liveFrames = core.ancestryFrames(options.area, options.context, canonical);
    const withAncestry = structuredClone(canonical);
    withAncestry.elements.unshift(...core.ancestryProjection(liveFrames));
    const children = core.projectSpatialChildren(withAncestry, options.area, options.childScenes);
    const projection = core.focusProjection(core.collapseSpatialRegions(children.scene, collapsedIds), options.getDocuments(), options.focus, options.locatedArea);
    hiddenFocusIdsRef.current = projection.hiddenIds;
    sceneRef.current = projection.scene;
    fingerprintRef.current = core.authoredFingerprint(projection.scene.elements);
    api?.updateScene({ elements: projection.scene.elements, appState: projection.scene.appState });
    setSceneTick((value) => value + 1);
    if (authored) {
      options.onSceneChange(core.sceneForSave(canonical.elements, api?.getAppState?.() ?? canonical.appState), gesture);
    }
    else options.onFactScene?.(canonical);
  }

  /** Places one selected entity block near the current pointer or viewport. */
  async function place(choice, keepOpen = false) {
    if (!choice) return;
    const appState = api?.getAppState?.() ?? {};
    const selected = sceneRef.current.elements.filter((element) => appState.selectedElementIds?.[element.id]);
    const point = core.placementPoint(appState, pointerRef.current, selected, frames.find((frame) => frame.role === "scope"));
    if (picker?.area && picker.area !== options.area) {
      try { await options.onPlaceInto?.(picker, choice, point); } catch (error) { setNotice(String(error.message ?? error)); }
      setPicker(keepOpen ? picker : null); setQuery(""); return;
    }
    publish(core.addBlock(sceneRef.current, choice, point));
    setQuery("");
    setPicker(keepOpen ? picker : null);
  }

  /** Opens the picker for the smallest Area frame under the pointer. */
  function openPicker() {
    const appState = api?.getAppState?.() ?? {};
    const point = core.placementPoint(appState, pointerRef.current, [], frames.find((frame) => frame.role === "scope"));
    const center = core.insertionPoint(appState, null);
    setWide(false);
    setPicker({ ...(core.areaAtPoint(frames, point, appState.zoom?.value ?? 1) ?? { area: options.area, label: { name: "Outside every Area" }, outside: true }), dock: point.x < center.x ? "right" : "left" });
  }

  /** Sends a selected block verb to the Agent Shell. */
  function openBlock(block = currentBlock, verb = "open") {
    const tangent = core.tangentOf(block);
    if (tangent) options.onEntityVerb?.({ verb, ...tangent });
  }

  /** Hides a block without losing its restorable authored geometry. */
  function hideBlock(block = currentBlock) {
    if (block) publish(core.setBlockHidden(sceneRef.current, block.id, true));
  }

  /** Restores one hidden block from the inbox. */
  function restoreBlock(id) { publish(core.setBlockHidden(sceneRef.current, id, false)); }

  /** Toggles private collapsed state without changing the Area scene. */
  function toggleRegion(region = currentBlock) {
    if (!core.isAreaRegion(region)) return;
    const nextIds = collapsedIds.includes(region.id) ? collapsedIds.filter((id) => id !== region.id) : [...collapsedIds, region.id];
    setCollapsedIds(nextIds);
    options.onViewChange?.(core.viewFromAppState(api?.getAppState?.(), { ...(options.view ?? {}), foldedGroupIds: nextIds }));
    const withAncestry = structuredClone(canonicalRef.current);
    withAncestry.elements.unshift(...core.ancestryProjection(frames));
    const children = core.projectSpatialChildren(withAncestry, options.area, options.childScenes);
    const projection = core.focusProjection(core.collapseSpatialRegions(children.scene, nextIds), options.getDocuments(), options.focus, options.locatedArea);
    hiddenFocusIdsRef.current = projection.hiddenIds;
    sceneRef.current = projection.scene;
    fingerprintRef.current = core.authoredFingerprint(projection.scene.elements);
    api?.updateScene({ elements: projection.scene.elements });
  }

  /** Converts selected reference text into a first-class Tangent block. */
  function makeSelectedTextBlock() {
    const text = selectedText(api, sceneRef.current);
    const choice = text && core.referenceFromText(text.text, choices);
    if (!text || !choice) return;
    const next = structuredClone(sceneRef.current);
    const index = next.elements.findIndex((element) => element.id === text.id);
    const [block, label] = core.createBlockElements({ id: text.id, ...choice, x: text.x, y: text.y, width: Math.max(220, text.width), height: Math.max(100, text.height), style: { strokeColor: text.strokeColor, opacity: text.opacity, groupIds: text.groupIds, frameId: text.frameId } });
    block.boundElements.push(...(text.boundElements ?? []).filter((entry) => entry.type === "arrow"));
    next.elements.splice(index, 1, block, label);
    publish(next);
  }

  /** Sends selected text to the brain and replaces it with the durable idea. */
  async function promoteIdea() {
    const text = selectedText(api, sceneRef.current);
    if (!text) return;
    const durable = await options.onPromoteIdea?.(text.text);
    if (!durable?.file) return;
    const next = structuredClone(sceneRef.current);
    const index = next.elements.findIndex((element) => element.id === text.id);
    const [block, label] = core.createBlockElements({ id: text.id, kind: "idea", ref: `${durable.file}${durable.subpath || ""}`, title: text.text, status: "sent to brain", x: text.x, y: text.y, width: Math.max(220, text.width), height: Math.max(100, text.height), style: { strokeColor: text.strokeColor, opacity: text.opacity, groupIds: text.groupIds, frameId: text.frameId } });
    block.boundElements.push(...(text.boundElements ?? []).filter((entry) => entry.type === "arrow"));
    next.elements.splice(index, 1, block, label);
    publish(next);
  }

  /** Selects and reveals an element chosen through the accessible outline. */
  function selectOutline(id) {
    if (!api) return;
    api.updateScene({ appState: { selectedElementIds: { [id]: true } } });
    const element = sceneRef.current.elements.find((item) => item.id === id);
    if (element) api.scrollToContent([element], { fitToContent: true, animate: true });
    setOutlineOpen(false);
  }

  /** Performs the exact effect printed by the map's Escape control. */
  function escapeNow() {
    if (picker) { setPicker(null); return; }
    if (help) { setHelp(false); return; }
    if (outlineOpen) { setOutlineOpen(false); return; }
    const selectedIds = api?.getAppState?.().selectedElementIds ?? {};
    if (Object.keys(selectedIds).length) { api?.updateScene({ appState: { selectedElementIds: {} } }); return; }
    options.onBack?.();
  }

  useEffect(() => {
    bridge.setSaveState = setSaveState;
    bridge.updateScene = (next) => publish(core.refreshTangentFacts(core.stripSpatialProjections(next), options.getDocuments()).scene, { authored: false });
    bridge.current = () => sceneRef.current;
    bridge.appState = () => api?.getAppState?.() ?? null;
    return () => { bridge.setSaveState = null; bridge.updateScene = null; };
  }, [api]);

  useEffect(() => {
    if (!api || !located?.element) return;
    api.updateScene({ appState: { selectedElementIds: { [located.element.id]: true } } });
    api.scrollToContent([located.element], { fitToContent: true, animate: true });
    host.classList.add("tangent-map-locating");
    const timer = window.setTimeout(() => host.classList.remove("tangent-map-locating"), 2_000);
    return () => window.clearTimeout(timer);
  }, [api]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const refreshed = core.refreshTangentFacts(canonicalRef.current, options.getDocuments());
      if (refreshed.changed) publish(refreshed.scene, { authored: false });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [api]);

  useEffect(() => {
    /** Applies map-local keyboard behavior before the shell sees a key. */
    const keydown = (event) => {
      const key = event.key.toLowerCase();
      if (event.key === "Escape") {
        if (picker || help || outlineOpen) { stop(event); escapeNow(); return; }
        if (isTyping(event.target)) { stop(event); event.target.blur(); return; }
        const selectedIds = api?.getAppState?.().selectedElementIds ?? {};
        if (Object.keys(selectedIds).length) { stop(event); escapeNow(); return; }
        stop(event); escapeNow(); return;
      }
      if (isTyping(event.target)) return;
      const block = selectedBlock(api, sceneRef.current);
      if ((event.metaKey || event.ctrlKey) && key === "s") { stop(event); options.onSaveNow?.(); return; }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "f") { stop(event); options.onToggleStarredOnly?.(); return; }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "a") { stop(event); options.onToggleActiveOnly?.(); return; }
      if (event.key === "?" || event.key === "/" && event.shiftKey) { stop(event); setHelp(true); return; }
      if (block) {
        if (event.key === "Enter" || key === "o") { stop(event); openBlock(block, key === "o" ? "read" : "open"); return; }
        if (["a", "c", "b"].includes(key)) { stop(event); openBlock(block, key === "a" ? "ask" : key === "c" ? "correct" : "enter"); return; }
        if (key === "x" || event.key === "Delete" || event.key === "Backspace") { stop(event); hideBlock(block); return; }
        if (key === "f" && core.areaForBlock(block, documents)) { stop(event); options.onToggleAreaStar?.(core.areaForBlock(block, documents)); return; }
        if (event.key === " " && core.isAreaRegion(block)) { stop(event); toggleRegion(block); return; }
      }
      if (event.key === "Enter" && !located && locatedChoice) { stop(event); place(locatedChoice); return; }
      if (key === "b") { stop(event); openPicker(); return; }
    };
    /** Opens a Tangent block instead of editing its cached label. */
    const doubleClick = (event) => {
      const block = selectedBlock(api, sceneRef.current);
      if (block) { stop(event); openBlock(block); }
    };
    host.addEventListener("keydown", keydown, true);
    host.addEventListener("dblclick", doubleClick, true);
    return () => { host.removeEventListener("keydown", keydown, true); host.removeEventListener("dblclick", doubleClick, true); };
  }, [api, picker, help, outlineOpen, selectionTick]);

  useEffect(() => {
    if (!picker && !help && !outlineOpen) return undefined;
    /** Closes every transient before the underlying canvas handles the gesture. */
    const dismissOnCanvas = (event) => {
      if (event.target.closest?.(".tangent-map-picker, .tangent-map-help, .tangent-map-outline, .tangent-map-top-right")) return;
      setPicker(null); setHelp(false); setOutlineOpen(false);
    };
    host.addEventListener("pointerdown", dismissOnCanvas, true);
    return () => host.removeEventListener("pointerdown", dismissOnCanvas, true);
  }, [picker, help, outlineOpen]);

  const filtered = (() => {
    const lower = query.trim().toLowerCase();
    const matches = lower ? choices.filter((choice) => `${choice.kind} ${choice.title} ${choice.ref}`.toLowerCase().includes(lower)) : choices;
    const typed = core.referenceFromText(query, choices);
    return typed && !matches.some((choice) => choice.ref === typed.ref) ? [typed, ...matches] : matches;
  })();

  const theme = options.theme === "light" ? "light" : "dark";
  return <div className={`TangentAreaMap theme--${theme}`} data-tangent-area-map={options.area}>
    <Excalidraw
      initialData={{ elements: sceneRef.current.elements, appState: sceneRef.current.appState, files: {} }}
      excalidrawAPI={setApi}
      theme={theme}
      name={`${options.area.split("/").pop()} map`}
      autoFocus
      handleKeyboardGlobally={false}
      UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } }}
      renderTopRightUI={() => <div className="tangent-map-top-right"><div className="tangent-map-toolbar-extra"><button type="button" onClick={() => setPicker(true)} aria-keyshortcuts="b" title="Place a Tangent block (B)"><span aria-hidden="true">◈</span><span className="tangent-map-label">Block</span><kbd>B</kbd></button></div>{(currentBlock || currentText) && <div className="tangent-map-verbs" role="group" aria-label={currentBlock ? "Tangent block actions" : "Text actions"}>
      {currentBlock ? <><button type="button" onClick={() => openBlock()}>Open <kbd>Enter</kbd></button>{core.isAreaRegion(currentBlock) && <button type="button" onClick={() => toggleRegion()}>{collapsedIds.includes(currentBlock.id) ? "Expand" : "Collapse"} <kbd>Space</kbd></button>}<button type="button" onClick={() => openBlock(currentBlock, "ask")}>Ask brain <kbd>A</kbd></button><button type="button" onClick={() => openBlock(currentBlock, "correct")}>Correct <kbd>C</kbd></button><button type="button" onClick={() => hideBlock()}>Hide <kbd>X</kbd></button></> : <><button type="button" onClick={promoteIdea}>Send to brain as idea</button>{core.referenceFromText(currentText.text, choices) && <button type="button" onClick={makeSelectedTextBlock}>Make block</button>}</>}
    </div>}<button type="button" onClick={() => setOutlineOpen(true)} aria-expanded={outlineOpen} title="Outline"><span aria-hidden="true" className="tangent-map-glyph">≣</span><span className="tangent-map-label">Outline</span></button><button type="button" onClick={() => setHelp(true)} aria-keyshortcuts="?" title="Map keys (?)"><span aria-hidden="true" className="tangent-map-glyph">?</span><span className="tangent-map-label">Keys</span><kbd>?</kbd></button></div>}
      onPointerUpdate={({ pointer }) => { pointerRef.current = pointer; }}
      onScrollChange={(scrollX, scrollY, zoom) => setCamera({ scrollX, scrollY, zoom: zoom?.value ?? zoom ?? 1 })}
      onPaste={(data) => { if (data.files?.length) return true; const choice = core.referenceFromText(data.text, choices); if (!choice) return false; place(choice); return true; }}
      onChange={(elements, appState) => {
        const view = core.viewFromAppState(appState, { ...(options.view ?? {}), foldedGroupIds: collapsedIds });
        const viewFingerprint = JSON.stringify(view);
        if (viewFingerprint !== viewFingerprintRef.current) {
          viewFingerprintRef.current = viewFingerprint;
          options.onViewChange?.(view);
        }
        const fingerprint = core.authoredFingerprint(elements);
        const selected = Object.keys(appState.selectedElementIds ?? {}).join(":");
        if (selected !== bridge.selected) { bridge.selected = selected; setSelectionTick((value) => value + 1); }
        if (fingerprint === fingerprintRef.current) return;
        fingerprintRef.current = fingerprint;
        const authoredElements = core.stripSpatialProjections(core.sceneForSave(elements, appState));
        const previous = canonicalRef.current;
        const fenced = core.fenceRegionGeometry(authoredElements, previous, { area: options.area, context: options.context, childScenes: options.childScenes });
        const authored = fenced.scene;
        const corrected = core.authoredFingerprint(authored.elements) !== core.authoredFingerprint(authoredElements.elements);
        const regionFingerprint = JSON.stringify(authoredElements.elements.filter(core.isAreaRegion).map((element) => [element.id, Math.round(element.x * 100) / 100, Math.round(element.y * 100) / 100, Math.round(element.width * 100) / 100, Math.round(element.height * 100) / 100, Math.round(element.angle * 100) / 100]));
        const canonical = core.restoreFocusedElements(authored, previous, hiddenFocusIdsRef.current);
        const gesture = gestureFor(canonical, previous);
        const liveFrames = core.ancestryFrames(options.area, options.context, canonical);
        const withAncestry = structuredClone(canonical);
        withAncestry.elements.unshift(...core.ancestryProjection(liveFrames));
        const projected = core.projectSpatialChildren(withAncestry, options.area, options.childScenes);
        const visible = projected.scene;
        if (corrected || gesture.extentWrite || regionFingerprint !== projectedRegionFingerprintRef.current) {
          projectedRegionFingerprintRef.current = regionFingerprint;
          api?.updateScene({ elements: visible.elements, captureUpdate: "NEVER" });
        }
        if (fenced.refused) setNotice(fenced.refused.wall ? `stopped at ${fenced.refused.wall.split("/").at(-1)}` : `stopped at ${fenced.refused.region.split("/").at(-1)}`);
        sceneRef.current = visible;
        setSceneTick((value) => value + 1);
        canonicalRef.current = canonical;
        options.onSceneChange(canonical, gesture);
      }}
    />

    <div className="tangent-map-ancestry" aria-label="Area ancestry">
      {frames.map((frame, index) => <button type="button" key={frame.area} style={{ left: `${(frame.rect.x + camera.scrollX) * camera.zoom + 12}px`, top: `${(frame.rect.y + camera.scrollY) * camera.zoom + 10}px` }} aria-label={frame.role === "scope" ? `${frame.label.name}, your scope` : `${frame.label.name}, inside ${frames[index - 1]?.label.name ?? "vault"}`} onClick={() => frame.role === "ancestor" && options.onSelectArea?.(frame.area)}><strong>{frame.label.name}</strong> <span>{frame.label.status}</span></button>)}
    </div>

    <button type="button" className="tangent-map-escape" onClick={escapeNow} aria-keyshortcuts="Escape">{picker ? "Esc closes picker" : help ? "Esc closes key sheet" : outlineOpen ? "Esc closes outline" : currentBlock || currentText ? "Esc clears selection" : "Esc → " + (options.backLabel || "Work")}</button>
    <div className={`tangent-map-save ${saveState.state}`} role="status">
      <span>{saveState.state === "dirty" ? "• Saved" : saveState.state === "saving" ? "Saving…" : saveState.state === "conflict" ? "Not saved" : saveState.state === "blocked" ? "Not saved" : saveState.label || "Saved"}</span>
      {saveState.state === "conflict" && <><button type="button" onClick={options.onReload}>Reload</button><button type="button" onClick={() => options.onKeepMine?.(saveState.result)}>Keep mine</button></>}
      {saveState.state === "blocked" && <button type="button" onClick={options.onRetry}>Retry</button>}
    </div>
    {recoveredDraft && <div className="tangent-map-location" role="status">Draft from {new Date(recoveredDraft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} restored · <button type="button" onClick={() => { setRecoveredDraft(null); options.onDiscardDraft?.(); }}>Discard</button></div>}
    {notice && <div className="tangent-map-location" role="status">{notice} <button type="button" onClick={() => setNotice("")}>Dismiss</button></div>}

    {(outsideStars || !located && locatedChoice) && <div className="tangent-map-location" role="status">{outsideStars ? <>Outside your stars · <button type="button" onClick={options.onToggleStarredOnly}>F shows all</button></> : <>{options.locatedArea.split("/").at(-1)} is not on this map yet · <button type="button" onClick={() => place(locatedChoice)}>Place it ↵</button></>}</div>}

    {(core.scopedEntities(options.area, documents).children.length > 0 || proposals.length > 0 || hiddenBlocks.length > 0 || !located && locatedChoice) && <section className="tangent-map-inbox" aria-label="Map inbox">
      <strong>Inbox</strong>
      {core.scopedEntities(options.area, documents).children.length > 0 && <span>{core.scopedEntities(options.area, documents).children.length} Areas not placed · B</span>}
      {!located && locatedChoice && <button type="button" onClick={() => place(locatedChoice)}>{locatedChoice.title} · not placed<small>Place it ↵</small></button>}
      {proposals.map((proposal) => <button type="button" key={proposal.id} onClick={() => { const source = proposal.source || {}; const ref = source.file ? `${source.file}${source.subpath || ""}` : source.url; const choice = { kind: proposal.kind === "link" ? "link" : core.kindForReference(ref), ref, title: proposal.note || ref }; place(choice); options.onProposalPlaced?.(proposal); setProposals((items) => items.filter((item) => item.id !== proposal.id)); }}>{proposal.note || proposal.source?.file || proposal.source?.url}<small>Place</small></button>)}
      {hiddenBlocks.map((block) => <button type="button" key={block.id} onClick={() => restoreBlock(block.id)}>{core.factForBlock(block, documents)?.title || core.tangentOf(block).ref}<small>Restore</small></button>)}
    </section>}

    {picker && <div className={`tangent-map-dialog-backdrop dock-${picker.dock ?? "right"}`} onPointerDown={(event) => { if (event.target === event.currentTarget) setPicker(false); }}><section className="tangent-map-picker" role="dialog" aria-modal="true" aria-label="Place a Tangent block">
      <h2 id="tangent-block-picker-title">{wide ? "Place from the whole vault" : `Place in ${picker.label?.name ?? options.area.split("/").at(-1)}`}</h2>
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Tab") { stop(event); setWide((value) => !value); } else if (event.key === "Escape") { stop(event); setPicker(false); } else if (event.key === "Enter" && filtered[0]) { stop(event); place(filtered[0], event.shiftKey); } }} placeholder="Goal, Document, Area, idea, or URL" />
      <ul role="listbox">{filtered.slice(0, 30).map((choice) => <li key={`${choice.kind}:${choice.ref}`}><button type="button" onClick={() => place(choice)}><small>{choice.kind}</small><span>{choice.title}</span><em>{choice.status}</em></button></li>)}</ul>
      <p><kbd>Tab</kbd> {wide ? "return here" : "whole vault"} · <kbd>Enter</kbd> place · <kbd>⇧Enter</kbd> place another · <kbd>Esc</kbd> close</p>
    </section></div>}

    {help && <div className="tangent-map-dialog-backdrop"><section className="tangent-map-help" role="dialog" aria-modal="true" aria-labelledby="tangent-map-help-title"><h2 id="tangent-map-help-title">Map keys</h2><p><kbd>V</kbd> select · <kbd>R</kbd> rectangle · <kbd>D</kbd> diamond · <kbd>O</kbd> ellipse · <kbd>A</kbd> arrow · <kbd>L</kbd> line · <kbd>P</kbd> draw · <kbd>T</kbd> text · <kbd>F</kbd> frame · <kbd>E</kbd> erase · <kbd>B</kbd> block</p><p>Space-drag pans. ⌘-wheel zooms. ⌘Z undoes. ⌘S saves now. Esc with nothing selected returns to Work.</p><p>Scope: <kbd>f</kbd> stars the selected Area. <kbd>⌘⇧F</kbd> shows starred Areas. <kbd>⌘⇧A</kbd> shows active work.</p><p>With a block selected: <kbd>Enter</kbd> opens · <kbd>A</kbd> asks the brain · <kbd>C</kbd> corrects · <kbd>X</kbd> hides.</p><button type="button" autoFocus onClick={() => setHelp(false)}>Close</button></section></div>}

    <section className={outlineOpen ? "tangent-map-outline visible" : "tangent-map-outline visually-hidden"} aria-label="Map outline" hidden={!outlineOpen}>
      {outlineOpen && <header><strong>Outline</strong><button type="button" className="tangent-map-outline-close" onClick={() => setOutlineOpen(false)} aria-label="Close outline">✕</button></header>}
      <ol>{outline.map((item) => <li key={item.id}><button type="button" onClick={() => selectOutline(item.id)}>{item.label}</button></li>)}</ol>
      {outlineOpen && outline.length === 0 && <p>Nothing on the map yet.</p>}
    </section>
    {canonicalRef.current.elements.filter((element) => !element.isDeleted && !core.isAreaBoundary(element)).length === 0 && <p className="tangent-map-empty-hint">Empty · B places a block · draw anywhere</p>}
  </div>;
}

/** Mounts the React editor island inside the framework-free Agent Shell. */
export function mountAreaBoardEditor(host, options) {
  const bridge = {
    selected: "", setSaveState: null, updateScene: null,
    /** Returns the initial scene until React installs its live bridge. */
    current: () => options.scene,
    /** Returns no app state until Excalidraw installs its live bridge. */
    appState: () => null,
  };
  const root = createRoot(host);
  root.render(<AreaMapErrorBoundary mapProps={{ host, bridge, options }} onError={options.onEditorError} />);
  return {
    /** Returns the latest editor scene. */
    current: () => bridge.current(),
    /** Returns Excalidraw's current application state. */
    appState: () => bridge.appState(),
    /** Updates the visible durable-save status. */
    setSaveState: (state) => bridge.setSaveState?.(state),
    /** Applies an authoritative external scene refresh. */
    updateScene: (scene) => bridge.updateScene?.(scene),
    /** Unmounts the React editor island. */
    destroy: () => root.unmount(),
  };
}
