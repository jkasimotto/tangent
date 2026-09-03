// Text edits between Excalidraw and the controller.
//
// While Excalidraw's text editor is open it reports every keystroke through `onChange`. The
// controller must not see those: a text edit is one command, published once the editor closes.
// `TextEditBuffer` holds the live edit with named state, `captureLiveTextEdit` fills it from a
// change callback, and `finishTextEdit` merges the last buffered text into the final elements the
// editor hands back. `finishBufferedTextEdit` forces that finish after the editor consumed a
// finishing key, because Excalidraw then closes the editor without a change callback of its own.
//
// A second problem is a stale editor: the pointer session claims temporary ids for new elements,
// and a recomposition can leave Excalidraw editing an id the scene no longer holds. `staleEditingText`
// answers whether that is the case and which selection the repair should project.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { SceneElement } from "../kernel/kernel-types.ts";
import { runtimeId } from "../units/ids.ts";
import type { RuntimeId } from "../units/ids.ts";
import { asSceneElements, selectedIds } from "./projection.ts";

/** The live edit: which element the editor holds and the elements as they stood at the last keystroke. */
export type BufferedTextEdit = {
  readonly editingId: RuntimeId;
  readonly elements: readonly SceneElement[];
};

/** The appState slice a text edit reads. */
export type TextEditAppState = Pick<AppState, "editingTextElement">;

/** The appState slice a stale-editor check reads. */
export type StaleTextAppState = Pick<AppState, "editingTextElement" | "selectedElementIds" | "activeTool">;

/** What a stale-editor check needs beside the appState. */
export type StaleTextInput = {
  readonly appState: StaleTextAppState | null | undefined;
  /** Every id the composed scene holds now. */
  readonly validRuntimeIds: ReadonlySet<RuntimeId>;
  /** Maps a temporary id the pointer session claimed to the id the scene holds, or returns the id unchanged. */
  readonly resolveClaimedId: (id: RuntimeId) => RuntimeId;
  /** True to repair even a claimed editor under the text tool, as a new pointer press does. */
  readonly force: boolean;
};

/** The repair a stale editor needs: the selection to project with the editor cleared. */
export type StaleTextRepair = {
  readonly selection: readonly RuntimeId[];
};

/** The api calls a forced finish reads. */
export type TextEditApi = Pick<ExcalidrawImperativeAPI, "getAppState" | "getSceneElements">;

/** What a forced finish is built on. `settle` waits until Excalidraw has closed its editor, two frames in the browser. */
export type FinishTextEditDependencies = {
  readonly buffer: TextEditBuffer;
  readonly api: () => TextEditApi | null;
  readonly settle: (run: () => void) => void;
  readonly onChange: (elements: readonly ExcalidrawElement[], appState: AppState) => void;
};

/** Holds at most one live text edit. */
export class TextEditBuffer {
  private buffered: BufferedTextEdit | null = null;

  /** Starts or refreshes the live edit with an immutable copy of the elements. */
  begin(editingId: RuntimeId, elements: readonly SceneElement[]): void {
    this.buffered = { editingId, elements: structuredClone(elements) };
  }

  /** True while an edit is buffered. */
  isActive(): boolean {
    return this.buffered !== null;
  }

  /** The live edit, or null. */
  current(): BufferedTextEdit | null {
    return this.buffered;
  }

  /** Hands out the live edit and clears the buffer. */
  take(): BufferedTextEdit | null {
    const buffered = this.buffered;
    this.buffered = null;
    return buffered;
  }
}

/** The browser's settle: two animation frames, after which Excalidraw has closed its editor. */
export function browserSettle(run: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(run));
}

/**
 * Buffers a change callback that arrived with the text editor open. True when it did, so the
 * change handler stops there: nothing is published until the editor closes.
 */
export function captureLiveTextEdit(buffer: TextEditBuffer, elements: readonly ExcalidrawElement[], appState: TextEditAppState): boolean {
  const editing = appState.editingTextElement;
  if (editing === null) return false;
  buffer.begin(runtimeId(editing.id), asSceneElements(elements));
  return true;
}

/**
 * Closes the buffered edit against the elements Excalidraw handed back when the editor closed.
 * The last buffered text wins over the final callback's copy unless that copy was deleted, and a
 * text the final callback dropped is put back. Null when no edit was buffered.
 */
export function finishTextEdit(buffer: TextEditBuffer, elements: readonly SceneElement[]): readonly SceneElement[] | null {
  const buffered = buffer.take();
  if (buffered === null) return null;
  const latestText = buffered.elements.find((element) => element.id === buffered.editingId);
  if (latestText === undefined) return elements;
  const merged: SceneElement[] = structuredClone([...elements]);
  const position = merged.findIndex((element) => element.id === buffered.editingId);
  const existing = merged[position];
  if (existing === undefined) merged.push(latestText);
  else if (!existing.isDeleted) merged[position] = latestText;
  return merged;
}

/**
 * Publishes the buffered text after Excalidraw consumed a finishing key. Waits for the editor to
 * close, then runs the change handler with the editor reported closed, exactly as a natural close
 * would. Does nothing when no edit is buffered by then.
 */
export function finishBufferedTextEdit(deps: FinishTextEditDependencies): void {
  deps.settle(() => {
    const buffered = deps.buffer.current();
    const api = deps.api();
    if (buffered === null || api === null) return;
    deps.onChange(api.getSceneElements(), { ...api.getAppState(), editingTextElement: null });
  });
}

/**
 * Decides whether Excalidraw is editing an element the scene no longer holds. Null when nothing is
 * being edited, the edited id is live, or the editor holds a claimed temporary id under the text
 * tool and the caller did not force. Otherwise the selection the repair must project: what is
 * selected now, mapped through the claims and kept to live ids.
 */
export function staleEditingText(input: StaleTextInput): StaleTextRepair | null {
  const editing = input.appState?.editingTextElement;
  if (!editing?.id) return null;
  const editingId = runtimeId(editing.id);
  if (input.validRuntimeIds.has(editingId)) return null;
  const claimed = input.resolveClaimedId(editingId);
  const textToolClaim = claimed !== editingId && input.validRuntimeIds.has(claimed) && input.appState?.activeTool.type === "text";
  if (!input.force && textToolClaim) return null;
  const selection = new Set(selectedIds(input.appState).map(input.resolveClaimedId).filter((id) => input.validRuntimeIds.has(id)));
  return { selection: [...selection] };
}
