// The top-right toolbar of the Map and the kinds notice beside it.

/** The toolbar buttons and the verbs shown for the selected Block. */
export const TOOLBAR = {
  /** The Block button: tooltip, glyph, label and the key it prints. */
  placeBlockTitle: "Place a Tangent block (B)",
  placeBlockGlyph: "◈",
  placeBlockLabel: "Block",
  placeBlockKey: "B",
  placeBlockShortcuts: "b Shift+B",
  /** The Resources button. */
  resourcesTitle: "Manage Map resources",
  resourcesGlyph: "⌘",
  resourcesLabel: "Resources",
  /** The Outline button. */
  outlineTitle: "Outline",
  outlineGlyph: "≣",
  outlineLabel: "Outline",
  /** The Keys button. */
  keysTitle: "Map keys (?)",
  keysGlyph: "?",
  keysLabel: "Keys",
  keysKey: "?",
  keysShortcuts: "?",
  /** The fallback name of a selected Block that resolves to nothing. */
  blockFallback: "Tangent block",
  /** Verb buttons beside the selected Block. */
  primaryKey: "Enter",
  addToArea: "Add to Area",
  details: "Details",
  hide: "Hide",
  hideKey: "X",
  /** The accessible name of the verbs group for one selected Block. */
  verbsGroupName(blockName: string): string { return `Actions for ${blockName}`; },
  /** The accessible name of one verb button: the verb, then the Block it acts on. */
  verbName(verb: string, blockName: string): string { return `${verb}. ${blockName}`; },
} as const;

/** The Map kinds notice: problems from Julian's map-kinds.md, one per line. */
export const KINDS = {
  statusName: "Map kinds status",
  /** One problem line. A problem with no name prints only its message. */
  problem(name: string | null, message: string): string { return `Map kinds: ${name ? `${name}: ` : ""}${message}`; },
  /** The message recorded when an image icon does not decode; the kind falls back to a card. */
  imageDidNotDecode: "the image did not decode",
  /** The message recorded when the browser gives no drawing context for an icon. */
  noCanvasContext: "the browser gave no 2d canvas",
  /** One icon problem as the catalog records it: the icon name, then what went wrong. */
  iconProblem(name: string, message: string): string { return `${name}: ${message}`; },
} as const;
