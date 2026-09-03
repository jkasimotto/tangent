// Buffered text edits and the stale-editor check, under Node with fake appState slices.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { SceneElement } from "../kernel/kernel-types.ts";
import { runtimeId } from "../units/ids.ts";
import type { RuntimeId } from "../units/ids.ts";
import { asExcalidrawElements, selectionAppState } from "./projection.ts";
import { TextEditBuffer, captureLiveTextEdit, finishBufferedTextEdit, finishTextEdit, staleEditingText } from "./text-edit.ts";

/** A text element with the given words, or a deleted one. */
function textElement(id: string, text: string, isDeleted = false): SceneElement {
  return { id: runtimeId(id), type: "text", text, isDeleted } as unknown as SceneElement;
}

/** The elements as Excalidraw hands them to onChange. */
function echo(elements: readonly SceneElement[]): readonly ExcalidrawElement[] {
  return asExcalidrawElements(elements);
}

/** An appState slice with an open editor on the given id, the selection and the active tool. */
function editingState(editingId: string | null, selected: readonly string[] = [], tool = "selection"): AppState {
  return {
    editingTextElement: editingId === null ? null : { id: editingId },
    ...selectionAppState(selected.map(runtimeId)),
    activeTool: { type: tool },
  } as unknown as AppState;
}

test("captureLiveTextEdit buffers a copy while the editor is open and ignores a closed editor", () => {
  const buffer = new TextEditBuffer();
  const elements = [textElement("t1", "hel")];
  assert.equal(captureLiveTextEdit(buffer, echo(elements), editingState(null)), false);
  assert.equal(buffer.isActive(), false);
  assert.equal(captureLiveTextEdit(buffer, echo(elements), editingState("t1")), true);
  assert.equal(buffer.isActive(), true);
  assert.equal(buffer.current()?.editingId, "t1");
  assert.notEqual(buffer.current()?.elements[0], elements[0], "the buffer holds a copy");
  assert.deepEqual(buffer.current()?.elements[0], elements[0]);
});

test("finishTextEdit prefers the last buffered text and puts back a text the final callback dropped", () => {
  const buffer = new TextEditBuffer();
  buffer.begin(runtimeId("t1"), [textElement("t1", "hello")]);
  const merged = finishTextEdit(buffer, [textElement("t1", "hel"), textElement("r1", "")]);
  assert.ok(merged !== null);
  assert.equal(merged[0]?.text, "hello");
  assert.equal(merged.length, 2);
  assert.equal(buffer.isActive(), false, "finishing takes the buffer");
  buffer.begin(runtimeId("t1"), [textElement("t1", "hello")]);
  const restored = finishTextEdit(buffer, [textElement("r1", "")]);
  assert.equal(restored?.length, 2);
  assert.equal(restored?.[1]?.text, "hello");
});

test("finishTextEdit keeps a deleted text deleted and returns null without a buffered edit", () => {
  const buffer = new TextEditBuffer();
  buffer.begin(runtimeId("t1"), [textElement("t1", "hello")]);
  const merged = finishTextEdit(buffer, [textElement("t1", "", true)]);
  assert.equal(merged?.[0]?.isDeleted, true);
  assert.equal(merged?.[0]?.text, "");
  assert.equal(finishTextEdit(buffer, []), null);
});

test("finishTextEdit returns the elements unchanged when the buffered edit names no element", () => {
  const buffer = new TextEditBuffer();
  buffer.begin(runtimeId("gone"), [textElement("t1", "hello")]);
  const elements = [textElement("t1", "hel")];
  assert.equal(finishTextEdit(buffer, elements), elements);
});

test("finishBufferedTextEdit runs the change handler with the editor closed after the settle, once buffered", () => {
  const buffer = new TextEditBuffer();
  const scene = [textElement("t1", "hello")];
  const calls: { elements: readonly ExcalidrawElement[]; editing: unknown }[] = [];
  let settled: (() => void) | null = null;
  finishBufferedTextEdit({
    buffer,
    /** Hands back a fake Excalidraw whose editor is still open on t1. */
    api: () => ({
      /** The appState the forced finish reads. */
      getAppState: () => editingState("t1"),
      /** The scene the forced finish publishes. */
      getSceneElements: () => echo(scene) as never,
    }),
    /** Holds the settle for the test to run by hand. */
    settle: (run) => { settled = run; },
    /** Records the change handler's arguments. */
    onChange: (elements, appState) => { calls.push({ elements, editing: appState.editingTextElement }); },
  });
  assert.equal(calls.length, 0, "nothing runs before the settle");
  buffer.begin(runtimeId("t1"), scene);
  settled?.();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.editing, null);
  assert.equal(calls[0]?.elements.length, 1);
  buffer.take();
  settled?.();
  assert.equal(calls.length, 1, "nothing runs without a buffered edit");
});

/** Maps the claimed temporary id to its live id. */
function resolveClaims(claims: Record<string, string>): (id: RuntimeId) => RuntimeId {
  return (id) => runtimeId(claims[id] ?? id);
}

test("staleEditingText is null when nothing is edited or the edited id is live", () => {
  const valid = new Set([runtimeId("t1")]);
  assert.equal(staleEditingText({ appState: editingState(null), validRuntimeIds: valid, resolveClaimedId: resolveClaims({}), force: false }), null);
  assert.equal(staleEditingText({ appState: editingState("t1"), validRuntimeIds: valid, resolveClaimedId: resolveClaims({}), force: false }), null);
  assert.equal(staleEditingText({ appState: null, validRuntimeIds: valid, resolveClaimedId: resolveClaims({}), force: true }), null);
});

test("staleEditingText spares a claimed editor under the text tool unless forced", () => {
  const valid = new Set([runtimeId("live")]);
  const claims = resolveClaims({ temp: "live" });
  assert.equal(staleEditingText({ appState: editingState("temp", ["temp"], "text"), validRuntimeIds: valid, resolveClaimedId: claims, force: false }), null);
  assert.deepEqual(staleEditingText({ appState: editingState("temp", ["temp"], "text"), validRuntimeIds: valid, resolveClaimedId: claims, force: true }), { selection: ["live"] });
  assert.deepEqual(staleEditingText({ appState: editingState("temp", ["temp"], "selection"), validRuntimeIds: valid, resolveClaimedId: claims, force: false }), { selection: ["live"] });
});

test("staleEditingText keeps only the live ids of the selection, mapped through the claims", () => {
  const valid = new Set([runtimeId("a"), runtimeId("b")]);
  const repair = staleEditingText({ appState: editingState("gone", ["a", "tempB", "zombie"]), validRuntimeIds: valid, resolveClaimedId: resolveClaims({ tempB: "b" }), force: false });
  assert.deepEqual(repair, { selection: ["a", "b"] });
});
