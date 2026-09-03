import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isBindableKey, modifiersOf, runBoundKey } from "./key-bindings.ts";
import type { KeyEventLike, KeyModifiers } from "./key-bindings.ts";

/** Builds a fake key event that records whether it was consumed. */
function fakeKeyEvent(key: string, modifiers: Partial<KeyModifiers> = {}): KeyEventLike & { consumed: boolean } {
  const event = {
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    consumed: false,
    /** Marks the event as default-prevented. */
    preventDefault() {
      event.consumed = true;
    },
    /** Marks the event as propagation-stopped. */
    stopPropagation() {
      event.consumed = true;
    },
    ...modifiers
  };
  return event;
}

test("Escape is never bindable, so it always reaches the dispatcher", () => {
  assert.equal(isBindableKey("Escape"), false);
  assert.equal(isBindableKey("Enter"), true);
  assert.equal(isBindableKey("ArrowDown"), true);
});

test("a bound key runs its handler with the modifiers and is consumed", () => {
  const seen: KeyModifiers[] = [];
  const event = fakeKeyEvent("Enter", { shiftKey: true });
  /** Records the modifiers it was handed. */
  const onEnter = (modifiers: KeyModifiers): void => {
    seen.push(modifiers);
  };
  assert.equal(runBoundKey({ Enter: onEnter }, event), true);
  assert.equal(event.consumed, true);
  assert.deepEqual(seen, [{ shiftKey: true, metaKey: false, ctrlKey: false, altKey: false }]);
});

test("an unbound key is left alone", () => {
  const event = fakeKeyEvent("ArrowUp");
  /** A binding that must never run in this test. */
  const onEnter = (): void => assert.fail("Enter is not the pressed key");
  assert.equal(runBoundKey({ Enter: onEnter }, event), false);
  assert.equal(runBoundKey(undefined, event), false);
  assert.equal(event.consumed, false);
});

test("modifiersOf copies only the four flags", () => {
  const event = fakeKeyEvent("Tab", { metaKey: true, altKey: true });
  assert.deepEqual(modifiersOf(event), { shiftKey: false, metaKey: true, ctrlKey: false, altKey: true });
});
