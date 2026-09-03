// A sentence with keyboard keys set inside it. The old component wrote these
// as JSX with <kbd> children; the copy keeps the words and marks each key so
// the kit renders the <kbd> and the sentence stays byte-identical.

/** One keyboard key inside a sentence, rendered by the kit as <kbd>. */
export type KeyPart = { readonly key: string };

/** A sentence made of plain runs and keys, in reading order. */
export type KeyedText = readonly (string | KeyPart)[];

/** Marks one key inside a sentence. */
export function key(value: string): KeyPart {
  return { key: value };
}

/** The sentence as one plain string, keys included, for accessible names and tests. */
export function keyedTextToString(parts: KeyedText): string {
  return parts.map((part) => (typeof part === "string" ? part : part.key)).join("");
}
