// The one owner of every layout number in the Map.
//
// A surface anchored to the wrong inset, a nudge that moves a different distance from a pointer
// drag, a list window retyped in two places: the audit traced each of those to a number that lived
// in more than one file. Every such number is named exactly once here, with the unit it measures,
// and reaches the rest of the Map in two ways. TypeScript reads `LAYOUT` directly. The stylesheet
// reads the same values as `--tangent-map-*` custom properties, which `layoutCssVariables` builds
// and `MapRoot.tsx` sets on the root element. `ui/map.css` never restates a number that lives here.
//
// The groups below exist so the CSS emitter knows which unit each value carries at runtime, where
// the brands have been erased. `LAYOUT` is their flat union, which is the shape the design names.
//
// Design: docs/design/area-map-rebuild/code.md, "Layout tokens".

import { count, milliseconds, percent, scenePx, screenPx, sourcePx, zoom } from "../units/units.ts";
import type { Count, Milliseconds, Percent, ScenePx, ScreenPx, SourcePx, Zoom } from "../units/units.ts";

/** Screen-pixel anchors: where the Tangent surfaces sit on the Map and how wide they may grow. */
const SCREEN_TOKENS = {
  /** The least height the Map claims from the shell, so the tool bar and the control row never overlap. */
  minHeight: screenPx(420),
  /** Where the control row sits, and where it moves when Excalidraw's tool bar needs the top line. */
  rowTop: screenPx(16),
  rowTopUnderPanel: screenPx(76),
  /** Where the surfaces that hang under the control row start, following the row. */
  hangTop: screenPx(62),
  hangTopUnderPanel: screenPx(122),
  /** The gap between the hang top and a surface that hangs there. */
  hangGap: screenPx(2),
  /** Insets from the Map's right edge: the bare edge, the control row, and the save status left of Excalidraw's help button. */
  edgeInset: screenPx(12),
  controlInset: screenPx(24),
  saveInset: screenPx(62),
  /** Insets from the Map's bottom edge for the surfaces that sit above Excalidraw's footer. */
  bottomInset: screenPx(16),
  kindsBottom: screenPx(60),
  hangBottom: screenPx(62),
  draftChoiceBottom: screenPx(64),
  /** The Outline button on the format-2 rollback editor sits at the edge inset from the top. */
  outlineButtonTop: screenPx(12),
  /** The transaction toast hangs from the top edge. */
  toastTop: screenPx(18),
  /** How much a centred surface keeps free of the Map's edges, and how much a right-anchored surface keeps free of the panel. */
  centredMargin: screenPx(32),
  anchoredMargin: screenPx(24),
  rowWrapMargin: screenPx(36),
  kindsMargin: screenPx(90),
  /** How far the toolbar container moves left of the retained panel so Excalidraw recentres its tools. */
  toolbarPanelGap: screenPx(16),
  /** How much of the Map's height the hanging surfaces leave free below them. */
  dialogBottomReserve: screenPx(26),
  outlineBottomReserve: screenPx(28),
  modalBottomReserve: screenPx(96),
  modalViewportReserve: screenPx(160),
  /** The width each surface grows to before the Map's own width caps it. */
  findWidth: screenPx(760),
  dialogWidth: screenPx(560),
  outlineWidth: screenPx(360),
  debugWidth: screenPx(780),
  kindsWidth: screenPx(420),
  recoveryWidth: screenPx(520),
  placementNarrowWidth: screenPx(620),
  /** Where the control row and the bottom surfaces move at narrow widths, and on Excalidraw's mobile layout. */
  narrowControlInset: screenPx(60),
  mobileSaveBottom: screenPx(66),
  mobileKindsBottom: screenPx(110),
  mobileInboxBottom: screenPx(114),
  mobileOutlineTop: screenPx(110),
  mobileOutlineReserve: screenPx(200),
  narrowPlacementBottom: screenPx(72),
  /** Where an Area's name pill and its runtime facts sit inside the region's top-left corner. */
  labelInsetX: screenPx(12),
  labelInsetY: screenPx(10),
  runtimeFactsOffset: screenPx(30),
  runtimeFactsGap: screenPx(4),
  /** How far past an authored element's edge a press still grabs it, before dividing by the zoom. */
  grabPadding: screenPx(10),
  /** Widths of the window at which the layout changes. CSS media queries cannot read a custom property, so `map.css` restates these and a test holds the two equal. */
  narrowBreakpoint: screenPx(960),
  rowUnderToolbarBreakpoint: screenPx(1199),
  rowUnderToolbarWithVerbsBreakpoint: screenPx(1579),
  toolbarRecentreBreakpoint: screenPx(1240),
  findShortBreakpoint: screenPx(1119),
} as const satisfies Record<string, ScreenPx>;

/** Scene-pixel distances: what a key press moves on the canvas, before the camera scales it. */
const SCENE_TOKENS = {
  /** Arrow keys move the selection by one scene pixel, or ten with Shift held. */
  nudge: scenePx(1),
  nudgeFast: scenePx(10),
  /** Arrow keys move the placement preview by a step, or one pixel with Shift held. */
  placementStep: scenePx(16),
  placementStepFine: scenePx(1),
  /** How far an arrow endpoint may fall outside a shape and still bind to it. */
  arrowBindingReach: scenePx(24),
} as const satisfies Record<string, ScenePx>;

/** Source-pixel sizes: what a new Block measures in its Area's shard. */
const SOURCE_TOKENS = {
  blockWidth: sourcePx(280),
  blockHeight: sourcePx(132),
} as const satisfies Record<string, SourcePx>;

/** Zoom factors: the camera magnifications a screen distance is divided by. */
const ZOOM_TOKENS = {
  /** The least zoom the grab padding is divided by, so a tiny zoom cannot grow it without bound. */
  grabZoomFloor: zoom(0.1),
} as const satisfies Record<string, Zoom>;

/** Shares out of one hundred: the opacities the Map draws its own disposable elements at. */
const PERCENT_TOKENS = {
  /** The placement preview Block is drawn translucent so it reads as not yet placed. */
  placementPreviewOpacity: percent(70),
} as const satisfies Record<string, Percent>;

/** Durations: the windows and cadences the Map keeps time with. */
const TIME_TOKENS = {
  /** A paste lands at the last placement point for this long after a copy. */
  pasteWindow: milliseconds(1_000),
  /** How often resource facts are refreshed, and the shortest cadence a configuration may ask for. */
  resourceCadence: milliseconds(30_000),
  resourceCadenceFloor: milliseconds(25),
  /** How long a spoken announcement and its visible toast stay before the store drops them. */
  announceTtl: milliseconds(9_000),
  /** How often the announce timer advances the store's clock. */
  announceTick: milliseconds(500),
  /** One beat of the pulse around the current Find match. */
  findPulse: milliseconds(900),
  /** How long a projection that replaced the elements fences Excalidraw's echoing change callbacks. */
  projectionFenceWindow: milliseconds(100),
} as const satisfies Record<string, Milliseconds>;

/** Cardinalities: how many rows a list shows and how many times a wait retries. */
const COUNT_TOKENS = {
  /** How many choices the picker lists. */
  pickerWindow: count(30),
  /** How many Find rows a short Map shows, and how many a tall one shows. */
  findWindow: count(4),
  findWindowTall: count(8),
  /** The `detail` a synthetic double click carries, which is how Excalidraw tells one apart from a click. */
  doubleClickDetail: count(2),
  /** How many animation frames the Map waits for Excalidraw's text editor before giving up on focusing it. */
  textEditFocusFrames: count(20),
  /** How many animation frames the mount waits for Excalidraw's canvas before giving up. */
  mountAttempts: count(120),
  /** How many expected projections the fence remembers before the oldest is forgotten. */
  projectionTokenCap: count(32),
  /** How many pixels long the long edge of a vector icon is rasterized at, so it stays sharp as the Map zooms. */
  iconRasterLongEdge: count(512),
} as const satisfies Record<string, Count>;

/** Every layout number of the Map, named once. The panel width is a CSS expression because it is a share of the Map, not a length. */
export const LAYOUT = {
  panelWidth: "min(680px, 72%)",
  narrowDialogWidth: "min(420px, 56vw)",
  inboxWidth: "min(680px, calc(100% - 520px))",
  ...SCREEN_TOKENS,
  ...SCENE_TOKENS,
  ...SOURCE_TOKENS,
  ...ZOOM_TOKENS,
  ...PERCENT_TOKENS,
  ...TIME_TOKENS,
  ...COUNT_TOKENS,
} as const;

/** The shape of `LAYOUT`, for a module that takes the table as a parameter. */
export type Layout = typeof LAYOUT;

/** The name of one layout token. */
export type LayoutToken = keyof Layout;

/** The CSS custom property one layout token is emitted as. */
export type LayoutCssVariable = `--tangent-map-${string}`;

/** Pairs every token of one group with the CSS unit suffix the group is written with. */
function unitEntries(tokens: Record<string, ScreenPx | ScenePx | SourcePx | Zoom | Percent | Milliseconds | Count>, unit: string): [string, string][] {
  return Object.keys(tokens).map((token): [string, string] => [token, unit]);
}

/** The CSS unit suffix of each token. Counts and zooms are unitless and string tokens are already CSS. */
const CSS_UNIT_BY_TOKEN: ReadonlyMap<string, string> = new Map([
  ...unitEntries(SCREEN_TOKENS, "px"),
  ...unitEntries(SCENE_TOKENS, "px"),
  ...unitEntries(SOURCE_TOKENS, "px"),
  ...unitEntries(ZOOM_TOKENS, ""),
  ...unitEntries(PERCENT_TOKENS, "%"),
  ...unitEntries(TIME_TOKENS, "ms"),
  ...unitEntries(COUNT_TOKENS, ""),
]);

/** Turns a camelCase token name into its `--tangent-map-kebab-case` custom property name. */
export function layoutCssVariableName(token: string): LayoutCssVariable {
  const kebab = token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return `--tangent-map-${kebab}`;
}

/** Writes one token's value as CSS: a string as given, a branded number with its group's unit. */
function layoutCssValue(token: string, value: Layout[LayoutToken]): string {
  if (typeof value === "string") return value;
  return `${value}${CSS_UNIT_BY_TOKEN.get(token) ?? ""}`;
}

/**
 * Builds the `--tangent-map-*` custom properties the Map root sets on its element, one per token
 * in the table. This is how `ui/map.css` reads the numbers this file owns without restating them.
 */
export function layoutCssVariables(layout: Layout): Record<LayoutCssVariable, string> {
  const variables: Record<LayoutCssVariable, string> = {};
  for (const [token, value] of Object.entries(layout)) {
    variables[layoutCssVariableName(token)] = layoutCssValue(token, value);
  }
  return variables;
}
