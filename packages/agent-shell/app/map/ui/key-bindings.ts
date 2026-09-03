// The keys a kit control lets a feature bind, and the one place a bound key is run.
//
// Feature code may not write `onKeyDown`; the keyboard-confinement lint keeps that prop inside the
// kit. A feature instead hands a control a `KeyBindings` table and the control runs the matching
// entry from its own `onKeyDown`. Escape is deliberately not bindable: it belongs to the surface
// stack through `input/keyboard-dispatch.ts`, which pops the top surface and nothing else. A bound
// key is consumed (default prevented, propagation stopped) so the host dispatcher never sees it; an
// unbound key bubbles to the dispatcher untouched.

/** The keys a feature may bind on a kit control. Escape is absent on purpose; see the file header. */
export type BindableKey = "Enter" | "Tab" | "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

/** The modifier state handed to a bound-key handler and to a Listbox activation. */
export type KeyModifiers = {
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
};

/** What a feature runs when a bound key is pressed on a control. */
export type KeyHandler = (modifiers: KeyModifiers) => void;

/** A table from bindable key to handler. Missing keys bubble to the host dispatcher. */
export type KeyBindings = Partial<Readonly<Record<BindableKey, KeyHandler>>>;

/** The slice of a keyboard event this module reads, so it stays free of React and DOM types. */
export type KeyEventLike = KeyModifiers & {
  readonly key: string;
  preventDefault(): void;
  stopPropagation(): void;
};

const BINDABLE_KEYS: ReadonlySet<string> = new Set<BindableKey>([
  "Enter",
  "Tab",
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End"
]);

/** True when a key name is one a feature may bind. */
export function isBindableKey(key: string): key is BindableKey {
  return BINDABLE_KEYS.has(key);
}

/** Copies the modifier flags out of a keyboard or mouse event. */
export function modifiersOf(event: KeyModifiers): KeyModifiers {
  return { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey };
}

/**
 * Runs the binding for the event's key, if there is one, and consumes the event so the host
 * dispatcher does not see it twice. Returns true when a binding ran, false when the key was
 * unbound and left to bubble.
 */
export function runBoundKey(bindings: KeyBindings | undefined, event: KeyEventLike): boolean {
  if (!bindings || !isBindableKey(event.key)) return false;
  const handler = bindings[event.key];
  if (!handler) return false;
  event.preventDefault();
  event.stopPropagation();
  handler(modifiersOf(event));
  return true;
}
