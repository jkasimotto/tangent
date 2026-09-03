// The format-2 rollback editor.
//
// When the workspace turns `areaMapWorld` off, the shell mounts one shard on its own, with no
// composed world, no controller and no Area regions. This component is that editor: Excalidraw over
// one scene, the save island beside it, and the same map-local Escape boundary the composed Map
// uses. It saves through `/api/areas/canvas` only, which is what the rollout suite asserts, and it
// renders no `.tangent-map-ancestry`, because a rollback restores no ancestor projections.
//
// It is built on `canvas/MapCanvas.tsx`, so Excalidraw is mounted in exactly one place, and on
// `canvas/text-edit.ts`, so a text edit is published once when the editor closes rather than on
// every keystroke. The keys go through `input/keyboard-dispatch.ts`, the one listener owner.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MapCanvas } from "../canvas/MapCanvas.tsx";
import type { CanvasHandlers, CanvasHandlersRef } from "../canvas/MapCanvas.tsx";
import { asSceneElements, selectedIds } from "../canvas/projection.ts";
import { TextEditBuffer, captureLiveTextEdit, finishTextEdit } from "../canvas/text-edit.ts";
import { installKeyboardDispatch } from "../input/keyboard-dispatch.ts";
import type { KeyCommand, KeyFacts } from "../input/key-routes.ts";
import { authoredFingerprint, createEmptyScene, sceneForSave } from "../kernel/kernel-boundary.ts";
import type { AuthoredFingerprint, SaveState, SceneElement, SourceScene } from "../kernel/kernel-types.ts";
import type { LegacyMountOptions } from "../mount-options.ts";
import { SaveStatus } from "../surfaces/save/SaveStatus.tsx";
import { EMPTY_SURFACE_STACK } from "../surfaces/surface-stack.ts";
import type { AreaBoardBridge } from "../mount-options.ts";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";

export type LegacyAreaCanvasProps = {
  readonly host: HTMLElement;
  readonly bridge: AreaBoardBridge;
  readonly options: LegacyMountOptions;
};

/** The save state a rollback editor starts in when the host named none. */
const CLEAN: SaveState = { state: "saved", result: null };

/** The rollback editor never opens a Map surface, so the dispatcher always sees an empty stack. */
function legacyKeyFacts(canvasOwnsKeys: boolean): KeyFacts {
  return {
    surfaces: EMPTY_SURFACE_STACK,
    // The rollback editor routes only Escape. Reporting the canvas as the owner of every other key
    // is how a selection or an open text editor keeps Escape, exactly as the old editor did: it
    // returned without consuming, so Excalidraw cleared the selection or closed the editor itself.
    editingText: canvasOwnsKeys,
    selectedArea: null,
    hasSelectedBlock: false,
    hasSelection: false,
    findActive: false,
  };
}

/** Renders one rollback-window format-2 shard with no composed world authority. */
export function LegacyAreaCanvas({ host, bridge, options }: LegacyAreaCanvasProps): ReactNode {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [save, setSave] = useState<SaveState>(options.initialSaveState ?? CLEAN);
  const sceneRef = useRef<SourceScene>(structuredClone(options.scene ?? createEmptyScene()));
  const fingerprintRef = useRef<AuthoredFingerprint>(authoredFingerprint(sceneRef.current.elements));
  const bufferRef = useRef(new TextEditBuffer());
  const initialDataRef = useRef(sceneRef.current);
  const handlersRef = useRef<CanvasHandlers>(noopHandlers());

  /** Publishes one settled direct-shard edit outside Excalidraw's text store callback. */
  function publish(elements: readonly SceneElement[]): void {
    const fingerprint = authoredFingerprint(elements);
    if (fingerprint === fingerprintRef.current) return;
    fingerprintRef.current = fingerprint;
    const next = sceneForSave(elements, api?.getAppState());
    sceneRef.current = next;
    options.onSceneChange?.(structuredClone(next));
  }

  /** Publishes whatever Excalidraw holds, merging a text edit that never closed. */
  function flushBufferedText(): void {
    const merged = finishTextEdit(bufferRef.current, asSceneElements(api?.getSceneElements() ?? []));
    if (merged !== null) publish(merged);
  }

  handlersRef.current = legacyHandlers(setApi, bufferRef.current, publish);

  useEffect(
    /** Installs the bridge the host holds while the rollback editor is mounted. */
    () => {
      bridge.setSaveState = setSave;
      bridge.current = () => sceneRef.current;
      bridge.rendered = () => asSceneElements(api?.getSceneElements() ?? []);
      bridge.appState = () => api?.getAppState() ?? null;
      bridge.escape = () => options.onBack?.();
      bridge.flush = () => {
        flushBufferedText();
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
    },
  );

  useEffect(
    /** Leaves the rollback editor through the one keyboard dispatcher. */
    () => installKeyboardDispatch(host, {
      /** The canvas owns every key while text is edited or anything is selected. */
      facts: () => legacyKeyFacts(Boolean(api?.getAppState().editingTextElement) || selectedIds(api?.getAppState()).length > 0),
      /** The rollback editor has no surfaces, so no target sits inside one. */
      surfaceOf: () => null,
      /** The rollback editor has no pointer session, so Space is nothing but Excalidraw's pan. */
      setSpaceHeld: () => undefined,
      /** Escape leaves the editor; a buffered text finish publishes what Excalidraw held. */
      run: (command: KeyCommand) => {
        if (command.kind === "escape") options.onBack?.();
        else if (command.kind === "finish-text-edit") flushBufferedText();
      },
    }),
    [host, api, options],
  );

  return (
    <div className="TangentAreaMap theme--dark" data-tangent-area-map={options.area} data-tangent-area-map-legacy="format-2">
      <MapCanvas initialData={initialDataRef.current as unknown as ExcalidrawInitialDataState} handlers={handlersRef as CanvasHandlersRef} />
      <SaveStatus status={save.state} draft={null} onRecover={() => options.onRetry?.()} />
    </div>
  );
}

/** The canvas callbacks the rollback editor answers: the api and one buffered change handler. */
function legacyHandlers(setApi: (api: ExcalidrawImperativeAPI) => void, buffer: TextEditBuffer, publish: (elements: readonly SceneElement[]) => void): CanvasHandlers {
  return {
    ...noopHandlers(),
    setApi,
    /** Buffers a live text edit and publishes every other change. */
    onChange: (elements, appState) => {
      if (captureLiveTextEdit(buffer, elements, appState)) return;
      const scene = asSceneElements(elements);
      publish(finishTextEdit(buffer, scene) ?? scene);
    },
  };
}

/** The canvas callbacks the rollback editor does not use: it has no pointer session and no camera of its own. */
function noopHandlers(): CanvasHandlers {
  return {
    /** Ignores the api until the component installs its own setter. */
    setApi: () => undefined,
    /** The rollback editor has no additive selection of its own. */
    onPressModifiers: () => undefined,
    /** The rollback editor runs no pointer gesture of its own. */
    onPointerDown: () => undefined,
    /** The rollback editor runs no pointer gesture of its own. */
    onPointerUp: () => undefined,
    /** The rollback editor tracks no pointer point. */
    onPointerMove: () => undefined,
    /** The rollback editor stores no camera. */
    onCamera: () => undefined,
    /** The rollback editor claims no paste; Excalidraw pastes as it always does. */
    onPaste: () => true,
    /** Replaced on every render by the component's own change handler. */
    onChange: () => undefined,
  };
}
