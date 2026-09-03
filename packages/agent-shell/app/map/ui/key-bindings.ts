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

/**
 * One chord on the Map host: the key and, per modifier, whether it must be held (`true`), must be
 * up (`false`) or does not matter (absent). `command` is Cmd on a Mac and Ctrl elsewhere; both
 * satisfy it. A single-letter key matches without regard to case, so Shift never hides a letter.
 */
export type KeyChord = {
  readonly key: string;
  readonly command?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
};

/** The key and the modifier state a chord is matched against. */
export type ChordInput = KeyModifiers & { readonly key: string };

/** The Map's host keys, named once. `input/key-routes.ts` decides what each does and in what order. */
export const MAP_KEYS = {
  escape: [{ key: "Escape" }],
  find: [{ key: "f", command: true, shift: false, alt: false }, { key: "/", command: false, shift: false, alt: false }],
  help: [{ key: "?" }, { key: "/", shift: true }],
  picker: [{ key: "b", command: false, alt: false }],
  outline: [{ key: "o", command: true, shift: true }],
  undo: [{ key: "z", command: true, shift: false }],
  redo: [{ key: "z", command: true, shift: true }],
  duplicate: [{ key: "d", command: true }],
  only: [{ key: "o", command: false, shift: true, alt: false }],
  findNext: [{ key: "n", command: false, shift: false, alt: false }],
  findPrevious: [{ key: "n", command: false, shift: true, alt: false }],
  activate: [{ key: "Enter" }],
  read: [{ key: "o", command: false, alt: false }],
  hide: [{ key: "x", command: false, alt: false }],
  fold: [{ key: " " }],
  remove: [{ key: "Backspace" }, { key: "Delete" }],
  finishTextEdit: [{ key: "Enter", command: true }],
  left: [{ key: "ArrowLeft" }],
  right: [{ key: "ArrowRight" }],
  up: [{ key: "ArrowUp" }],
  down: [{ key: "ArrowDown" }]
} as const satisfies Record<string, readonly KeyChord[]>;

/** The name of one Map host key. */
export type MapKey = keyof typeof MAP_KEYS;

/** True when a modifier requirement is met: absent means any state, else the flag must equal it. */
function modifierMatches(required: boolean | undefined, held: boolean): boolean {
  return required === undefined || required === held;
}

/** True when the pressed key is the chord's key, ignoring case for a single letter. */
function keyMatches(chord: KeyChord, key: string): boolean {
  if (chord.key.length === 1 && /[a-z]/i.test(chord.key)) return key.toLowerCase() === chord.key.toLowerCase();
  return key === chord.key;
}

/** True when the press is exactly this chord. */
export function chordMatches(chord: KeyChord, input: ChordInput): boolean {
  return keyMatches(chord, input.key)
    && modifierMatches(chord.command, input.metaKey || input.ctrlKey)
    && modifierMatches(chord.shift, input.shiftKey)
    && modifierMatches(chord.alt, input.altKey);
}

/** True when the press is any chord of the named Map key. */
export function isMapKey(name: MapKey, input: ChordInput): boolean {
  return MAP_KEYS[name].some((chord) => chordMatches(chord, input));
}
