// A sentence with keys set inside it, as `copy/keyed-text.ts` writes one. The copy keeps the words
// and marks each key; this part renders every plain run as text and every key as <kbd>, so the
// sentence stays byte-identical to what the old component printed and no feature writes a <kbd>.

import type { ReactNode } from "react";
import type { KeyedText } from "../copy.ts";

export type KeyedSentenceProps = {
  readonly parts: KeyedText;
};

/** Renders the runs of a keyed sentence in order, keys as <kbd>. */
export function KeyedSentence({ parts }: KeyedSentenceProps): ReactNode {
  return parts.map((part, position) => (typeof part === "string" ? part : <kbd key={position}>{part.key}</kbd>));
}
