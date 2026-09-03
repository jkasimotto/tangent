// The Map keys dialog.

import type { KeyedText } from "./keyed-text.ts";
import { key } from "./keyed-text.ts";

/** One tool key and what it selects. */
export type ToolKey = { readonly key: string; readonly label: string };

/** The words of the keys dialog. */
export const HELP = {
  title: "Map keys",
  close: "Close",
  tools: [
    { key: "V", label: "select" }, { key: "R", label: "rectangle" }, { key: "D", label: "diamond" }, { key: "O", label: "ellipse" },
    { key: "A", label: "arrow" }, { key: "L", label: "line" }, { key: "P", label: "draw" }, { key: "T", label: "text" },
    { key: "F", label: "frame" }, { key: "E", label: "erase" }, { key: "B", label: "block" },
  ] as readonly ToolKey[],
  toolSeparator: " · ",
  find: [key("/"), " or ", key("Ctrl-F"), " finds visible Areas. ", key("⇧O"), " changes Only for the selected Area."] as KeyedText,
  canvas: "Space-drag pans. Command-wheel zooms. Command-Z undoes. Escape closes the top Map control or returns to the retained opener.",
  brain: ["Use the named Brain control or ", key("⌘⇧Enter"), " to open the relevant Brain. ", key("Ctrl-L"), " / ", key("Ctrl-H"), " switch columns."] as KeyedText,
  selected: ["With a block selected: ", key("Enter"), " opens · ", key("X"), " hides."] as KeyedText,
} as const;
