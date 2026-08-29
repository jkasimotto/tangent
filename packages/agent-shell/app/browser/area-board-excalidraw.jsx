import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./area-board-excalidraw.css";
import core from "../public/area-board-core.js";

globalThis.EXCALIDRAW_ASSET_PATH = "/agent-shell-map-assets/";

/** Consumes a map-local event before the shell keyboard grammar sees it. */
const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
/** Reports whether a keyboard target accepts text input. */
const isTyping = (target) => target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);

/** Returns the selected Tangent block, when selection contains one. */
function selectedBlock(api, scene) {
  const selected = api?.getAppState?.().selectedElementIds ?? {};
  return scene.elements.find((element) => selected[element.id] && !element.isDeleted && core.tangentOf(element)) ?? null;
}

/** Returns the selected unbound text element, when selection contains one. */
function selectedText(api, scene) {
  const selected = api?.getAppState?.().selectedElementIds ?? {};
  return scene.elements.find((element) => selected[element.id] && !element.isDeleted && element.type === "text" && !element.containerId) ?? null;
}

/** Renders Excalidraw with Tangent blocks, verbs, inbox, and outline. */
function TangentMap({ host, bridge, options }) {
  const [api, setApi] = useState(null);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [help, setHelp] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [saveState, setSaveState] = useState(options.initialSaveState ?? { state: "saved" });
  const [selectionTick, setSelectionTick] = useState(0);
  const [sceneTick, setSceneTick] = useState(0);
  const [proposals, setProposals] = useState(options.proposals ?? []);
  const sceneRef = useRef(core.refreshTangentFacts(options.scene, options.getDocuments()).scene);
  const fingerprintRef = useRef(core.authoredFingerprint(sceneRef.current.elements));
  const viewFingerprintRef = useRef(JSON.stringify(core.viewFromAppState(sceneRef.current.appState, options.view)));
  const pointerRef = useRef(null);

  const documents = options.getDocuments();
  const choices = useMemo(() => core.entityChoices(options.area, documents), [options.area, documents, sceneTick]);
  const currentBlock = selectedBlock(api, sceneRef.current);
  const currentText = selectedText(api, sceneRef.current);
  const hiddenBlocks = sceneRef.current.elements.filter((element) => element.isDeleted && core.tangentOf(element));
  const outline = core.sceneOutline(sceneRef.current, documents);

  /** Publishes an authored edit or a non-dirty fact repaint. */
  function publish(next, { authored = true } = {}) {
    sceneRef.current = next;
    fingerprintRef.current = core.authoredFingerprint(next.elements);
    api?.updateScene({ elements: next.elements, appState: next.appState });
    setSceneTick((value) => value + 1);
    if (authored) options.onSceneChange(core.sceneForSave(next.elements, api?.getAppState?.() ?? next.appState));
    else options.onFactScene?.(next);
  }

  /** Places one selected entity block near the current pointer or viewport. */
  function place(choice, keepOpen = false) {
    if (!choice) return;
    const point = core.insertionPoint(api?.getAppState?.(), pointerRef.current);
    publish(core.addBlock(sceneRef.current, choice, point));
    setQuery("");
    setPicker(keepOpen);
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

  useEffect(() => {
    bridge.setSaveState = setSaveState;
    bridge.updateScene = (next) => publish(core.refreshTangentFacts(next, options.getDocuments()).scene, { authored: false });
    bridge.current = () => sceneRef.current;
    bridge.appState = () => api?.getAppState?.() ?? null;
    return () => { bridge.setSaveState = null; bridge.updateScene = null; };
  }, [api]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const refreshed = core.refreshTangentFacts(sceneRef.current, options.getDocuments());
      if (refreshed.changed) publish(refreshed.scene, { authored: false });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [api]);

  useEffect(() => {
    /** Applies map-local keyboard behavior before the shell sees a key. */
    const keydown = (event) => {
      if (isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      const block = selectedBlock(api, sceneRef.current);
      if ((event.metaKey || event.ctrlKey) && key === "s") { stop(event); options.onSaveNow?.(); return; }
      if (event.key === "?" || event.key === "/" && event.shiftKey) { stop(event); setHelp(true); return; }
      if (event.key === "Escape" && !picker && !help && !outlineOpen && api?.getAppState?.().activeTool?.type === "selection" && Object.keys(api.getAppState().selectedElementIds ?? {}).length === 0) { stop(event); options.onBack?.(); return; }
      if (block) {
        if (event.key === "Enter" || key === "o") { stop(event); openBlock(block, key === "o" ? "read" : "open"); return; }
        if (["a", "c", "b"].includes(key)) { stop(event); openBlock(block, key === "a" ? "ask" : key === "c" ? "correct" : "enter"); return; }
        if (key === "x" || event.key === "Delete" || event.key === "Backspace") { stop(event); hideBlock(block); return; }
      }
      if (key === "b") { stop(event); setPicker(true); return; }
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

  const filtered = (() => {
    const lower = query.trim().toLowerCase();
    const matches = lower ? choices.filter((choice) => `${choice.kind} ${choice.title} ${choice.ref}`.toLowerCase().includes(lower)) : choices;
    const typed = core.referenceFromText(query, choices);
    return typed && !matches.some((choice) => choice.ref === typed.ref) ? [typed, ...matches] : matches;
  })();

  return <div className="TangentAreaMap" data-tangent-area-map={options.area}>
    <Excalidraw
      initialData={{ elements: sceneRef.current.elements, appState: { ...sceneRef.current.appState, theme: "dark" }, files: {} }}
      excalidrawAPI={setApi}
      theme="dark"
      name={`${options.area.split("/").pop()} map`}
      autoFocus
      handleKeyboardGlobally={false}
      UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } }}
      onPointerUpdate={({ pointer }) => { pointerRef.current = pointer; }}
      onPaste={(data) => { if (data.files?.length) return true; const choice = core.referenceFromText(data.text, choices); if (!choice) return false; place(choice); return true; }}
      onChange={(elements, appState) => {
        const view = core.viewFromAppState(appState, options.view);
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
        sceneRef.current = core.sceneForSave(elements, appState);
        setSceneTick((value) => value + 1);
        options.onSceneChange(sceneRef.current);
      }}
    />

    <div className="tangent-map-toolbar-extra"><button type="button" onClick={() => setPicker(true)} aria-keyshortcuts="b" title="Place a Tangent block (B)"><span aria-hidden="true">◈</span><small>B</small><span className="visually-hidden">Block</span></button></div>
    <div className="tangent-map-top-right"><button type="button" onClick={() => setOutlineOpen(true)}>Outline</button><span>Go To <kbd>⌘K</kbd></span><button type="button" onClick={options.onBack}>Work <kbd>Esc</kbd></button></div>

    {(currentBlock || currentText) && <div className="tangent-map-verbs" aria-label={currentBlock ? "Tangent block actions" : "Text actions"}>
      {currentBlock ? <><button type="button" onClick={() => openBlock()}>Open <kbd>Enter</kbd></button><button type="button" onClick={() => openBlock(currentBlock, "ask")}>Ask brain <kbd>A</kbd></button><button type="button" onClick={() => openBlock(currentBlock, "correct")}>Correct <kbd>C</kbd></button><button type="button" onClick={() => hideBlock()}>Hide <kbd>X</kbd></button></> : <><button type="button" onClick={promoteIdea}>Send to brain as idea</button>{core.referenceFromText(currentText.text, choices) && <button type="button" onClick={makeSelectedTextBlock}>Make block</button>}</>}
    </div>}

    <div className={`tangent-map-save ${saveState.state}`} role="status">
      <span>{saveState.state === "dirty" ? "Saving…" : saveState.state === "conflict" ? "Changed elsewhere" : saveState.state === "blocked" ? "Save stopped" : saveState.label || "Saved"}</span>
      {saveState.state === "conflict" && <><button type="button" onClick={options.onReload}>Reload</button><button type="button" onClick={() => options.onKeepMine?.(saveState.result)}>Keep mine</button></>}
      {saveState.state === "blocked" && <button type="button" onClick={options.onRetry}>Retry</button>}
      <span className="tangent-map-brain">{options.brainLive ? "brain live" : "no brain"}</span>
    </div>

    {(proposals.length > 0 || hiddenBlocks.length > 0) && <section className="tangent-map-inbox" aria-label="Map inbox">
      <strong>Inbox</strong>
      {proposals.map((proposal) => <button type="button" key={proposal.id} onClick={() => { const source = proposal.source || {}; const ref = source.file ? `${source.file}${source.subpath || ""}` : source.url; const choice = { kind: proposal.kind === "link" ? "link" : core.kindForReference(ref), ref, title: proposal.note || ref }; place(choice); options.onProposalPlaced?.(proposal); setProposals((items) => items.filter((item) => item.id !== proposal.id)); }}>{proposal.note || proposal.source?.file || proposal.source?.url}<small>Place</small></button>)}
      {hiddenBlocks.map((block) => <button type="button" key={block.id} onClick={() => restoreBlock(block.id)}>{core.factForBlock(block, documents)?.title || core.tangentOf(block).ref}<small>Restore</small></button>)}
    </section>}

    {picker && <div className="tangent-map-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setPicker(false); }}><section className="tangent-map-picker" role="dialog" aria-modal="true" aria-labelledby="tangent-block-picker-title">
      <h2 id="tangent-block-picker-title">Place a Tangent block</h2>
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { stop(event); setPicker(false); } else if (event.key === "Enter" && filtered[0]) { stop(event); place(filtered[0], event.shiftKey); } }} placeholder="Goal, Document, Area, idea, or URL" />
      <ul role="listbox">{filtered.slice(0, 30).map((choice) => <li key={`${choice.kind}:${choice.ref}`}><button type="button" onClick={() => place(choice)}><small>{choice.kind}</small><span>{choice.title}</span><em>{choice.status}</em></button></li>)}</ul>
      <p><kbd>Enter</kbd> place · <kbd>⇧Enter</kbd> place another · <kbd>Esc</kbd> close</p>
    </section></div>}

    {help && <div className="tangent-map-dialog-backdrop"><section className="tangent-map-help" role="dialog" aria-modal="true" aria-labelledby="tangent-map-help-title"><h2 id="tangent-map-help-title">Map keys</h2><p><kbd>V</kbd> select · <kbd>R</kbd> rectangle · <kbd>D</kbd> diamond · <kbd>O</kbd> ellipse · <kbd>A</kbd> arrow · <kbd>L</kbd> line · <kbd>P</kbd> draw · <kbd>T</kbd> text · <kbd>F</kbd> frame · <kbd>E</kbd> erase · <kbd>B</kbd> block</p><p>Space-drag pans. ⌘-wheel zooms. ⌘Z undoes. ⌘S saves now. With a block selected: Enter opens, A asks, C corrects, X hides.</p><button type="button" autoFocus onClick={() => setHelp(false)}>Close</button></section></div>}

    <ol className={outlineOpen ? "tangent-map-outline visible" : "tangent-map-outline visually-hidden"} aria-label="Map outline">{outline.map((item) => <li key={item.id}><button type="button" onClick={() => selectOutline(item.id)}>{item.label}</button></li>)}</ol>
    {outlineOpen && <button type="button" className="tangent-map-outline-close" onClick={() => setOutlineOpen(false)}>Close outline</button>}
    {sceneRef.current.elements.filter((element) => !element.isDeleted).length === 0 && <p className="tangent-map-empty-hint">B places a block · T writes · P draws</p>}
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
  root.render(<TangentMap host={host} bridge={bridge} options={options} />);
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
